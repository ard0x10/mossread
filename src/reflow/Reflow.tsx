import '@fontsource-variable/literata/wght.css'
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css'
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type Ref,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { Locator } from '../focus/stream'
import type { Block } from '../text/layout'
import type { TextStore } from '../text/store'
import {
  caretAt,
  findSpot,
  locatorOf,
  offsetTop,
  register,
  renderedBlocks,
  textOffset,
  type ElementSpot,
} from './blocks'
import { FONT_STACKS, type ReflowSettings } from './settings'
import './reflow.css'

/** A place in the document: page number and the height on it, as a fraction from the top. */
export interface Position {
  page: number
  y: number
}

export interface ReflowHandle {
  position: () => Position
  jumpTo: (position: Position) => void
  /** False while still on the way to a place (its page is being read, or the layout is settling). */
  ready: () => boolean
  /** The first line in view, as an exact text point. */
  point: () => Locator | null
  /** The selected text in this view, if any. */
  selection: () => TextSelection | null
  /** The scrolling element and the text column, for overlays drawn over the text. */
  elements: () => { scroller: HTMLDivElement; column: HTMLDivElement } | null
}

export interface TextSelection {
  start: Locator
  /** The point just after the last selected character. */
  end: Locator
  text: string
}

interface ReflowProps {
  store: TextStore
  settings: ReflowSettings
  start: Position
  /** Height covered by the top bar, so "the top of the view" means the first readable line. */
  topInset: () => number
  onPageChange: (page: number) => void
  onShowPage: (position: Position) => void
  /** A tap on the text that is not on a button; the height is in screen space. */
  onTap: (clientY: number) => void
  handle: Ref<ReflowHandle>
}


/**
 * A key that follows a block when blocks before it come and go (a page
 * break mended, a paragraph joined), so React keeps the same element for it.
 */
function blockKey(block: Block): string {
  if (block.kind === 'figure') return `f:${block.page}:${block.y}`
  const first = block.anchors[0]
  return `${block.kind[0]}:${first.page}:${first.y}:${first.offset}`
}

export function Reflow({ store, settings, start, topInset, onPageChange, onShowPage, onTap, handle }: ReflowProps) {
  const { t } = useTranslation()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  const pending = useRef<Position | null>(start)
  // The scroll position this view last set itself. A scroll event that lands
  // there was ours (a jump or a correction), not the reader's, and must not
  // move the anchor: text above may have shifted again in the meantime.
  const ownScroll = useRef<number | null>(null)
  const anchor = useRef<{ element: Element; offset: number; top: number; spot: Position } | null>(null)
  const lastPage = useRef(start.page)
  const { cleanup } = settings
  const noText = useSyncExternalStore(store.subscribe, store.noTextLayer)

  const readingTop = useCallback(() => {
    const scroller = scrollerRef.current
    return (scroller?.getBoundingClientRect().top ?? 0) + topInset() + 12
  }, [topInset])

  const blockAt = useCallback(
    (element: Element | null) => {
      const blockEl = element?.closest<HTMLElement>('[data-b]')
      const sectionEl = element?.closest<HTMLElement>('[data-page]')
      if (!sectionEl) return null
      const page = Number(sectionEl.dataset.page)
      const block = blockEl ? renderedBlocks.get(blockEl) : undefined
      return { page, blockEl, block, sectionEl }
    },
    [],
  )

  const position = useCallback((): Position => {
    const column = columnRef.current
    if (!column) return { page: lastPage.current, y: 0 }
    const rect = column.getBoundingClientRect()
    const top = readingTop()
    let fallbackPage = lastPage.current
    for (const dy of [0, 16, 40, 80, 160]) {
      const hit = blockAt(document.elementFromPoint(rect.left + rect.width / 2, top + dy))
      if (!hit) continue
      const { block, blockEl, page } = hit
      // Between two blocks (a margin) or on a page still being read: look a little lower.
      if (!block || !blockEl) {
        fallbackPage = page
        continue
      }
      if (block.kind === 'figure') return { page: block.page, y: block.y }
      const box = blockEl.getBoundingClientRect()
      const caret = caretAt(box.left + 1, Math.max(top + dy, box.top + 1))
      const offset = caret && blockEl.contains(caret.node) ? caret.offset : 0
      let found = block.anchors[0]
      for (const a of block.anchors) if (a.offset <= offset) found = a
      return { page: found.page, y: found.y }
    }
    return { page: fallbackPage, y: 0 }
  }, [blockAt, readingTop])

  const point = useCallback((): Locator | null => {
    const column = columnRef.current
    if (!column) return null
    const rect = column.getBoundingClientRect()
    const top = readingTop()
    for (const dy of [0, 16, 40, 80, 160]) {
      const hit = blockAt(document.elementFromPoint(rect.left + rect.width / 2, top + dy))
      if (!hit?.block || !hit.blockEl) continue
      if (hit.block.kind === 'figure') return locatorOf(hit.blockEl, 0)
      const box = hit.blockEl.getBoundingClientRect()
      const caret = caretAt(box.left + 1, Math.max(top + dy, box.top + 1))
      const offset = caret && hit.blockEl.contains(caret.node) ? textOffset(hit.blockEl, caret.node, caret.offset) : 0
      return locatorOf(hit.blockEl, offset)
    }
    return null
  }, [blockAt, readingTop])

  const selectionInView = useCallback((): TextSelection | null => {
    const column = columnRef.current
    const selection = window.getSelection()
    if (!column || !selection || selection.isCollapsed || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0)
    if (!column.contains(range.commonAncestorContainer)) return null
    const edge = (node: Node, offset: number, atEnd: boolean): Locator | null => {
      const element = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('[data-b]')
      if (element && column.contains(element)) return locatorOf(element, textOffset(element, node, offset))
      // A boundary between blocks: the nearest block inside the selection.
      const inside = [...column.querySelectorAll<HTMLElement>('[data-b]')].filter((el) => range.intersectsNode(el))
      const el = atEnd ? inside.at(-1) : inside[0]
      return el ? locatorOf(el, atEnd ? (el.textContent?.length ?? 0) : 0) : null
    }
    const start = edge(range.startContainer, range.startOffset, false)
    const end = edge(range.endContainer, range.endOffset, true)
    return start && end ? { start, end, text: selection.toString() } : null
  }, [])

  const rememberAnchor = useCallback(() => {
    const column = columnRef.current
    if (!column) return
    const rect = column.getBoundingClientRect()
    const top = readingTop()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, top)
    const element = hit?.closest('[data-b]') ?? hit?.closest('[data-page]')
    // Something else is on top (a settings sheet): keep the last good anchor.
    if (!element || !column.contains(element)) return
    // Held by the character at the start of the first line, so a new text size
    // keeps that line in place rather than the top of its paragraph.
    const box = element.getBoundingClientRect()
    const caret = caretAt(box.left + 1, Math.max(top, box.top + 1))
    const offset = caret && element.contains(caret.node) ? caret.offset : 0
    anchor.current = { element, offset, top: offsetTop(element, offset), spot: position() }
  }, [readingTop, position])

  /** Scrolls so the line that came from this spot of the page is the first one in view. Returns false while that page is still being read. */
  const tryJump = useCallback(
    (target: Position): boolean => {
      const scroller = scrollerRef.current
      if (!scroller) return false
      // Searched among the blocks on screen, which is what the scroll is measured against.
      const spot: ElementSpot | null = findSpot(scroller, target)
      const sectionEl = scroller.querySelector<HTMLElement>(`[data-page="${target.page}"]`)
      if (!spot) {
        sectionEl?.scrollIntoView({ block: 'start' })
        scroller.scrollTop -= topInset()
        ownScroll.current = scroller.scrollTop
        // A page with nothing on it (or whose text all joined the previous page) is still a place to stop.
        return sectionEl !== null && !sectionEl.classList.contains('is-pending')
      }
      scroller.scrollTop += offsetTop(spot.element, spot.offset) - readingTop()
      ownScroll.current = scroller.scrollTop
      return true
    },
    [topInset, readingTop],
  )

  // Right after a jump the pages around it are still settling: the browser
  // swaps estimated heights for real ones (content-visibility) a frame or two
  // later. For a short while the jump is repeated, unless the reader moves.
  const settling = useRef<{ target: Position; until: number; frame: number } | null>(null)

  const stopSettling = useCallback(() => {
    if (settling.current) cancelAnimationFrame(settling.current.frame)
    settling.current = null
  }, [])

  const land = useCallback(
    (target: Position): boolean => {
      if (!tryJump(target)) {
        pending.current = target
        return false
      }
      pending.current = null
      stopSettling()
      const state = { target, until: performance.now() + 600, frame: 0 }
      const tick = () => {
        if (settling.current !== state) return
        tryJump(target)
        if (performance.now() < state.until) state.frame = requestAnimationFrame(tick)
        else {
          settling.current = null
          rememberAnchor()
        }
      }
      settling.current = state
      state.frame = requestAnimationFrame(tick)
      rememberAnchor()
      return true
    },
    [tryJump, rememberAnchor, stopSettling],
  )

  const jumpTo = useCallback(
    (target: Position) => {
      store.setFocus(target.page)
      lastPage.current = target.page
      onPageChange(target.page)
      land(target)
    },
    [store, land, onPageChange],
  )

  useImperativeHandle(
    handle,
    () => ({
      position,
      jumpTo,
      ready: () => pending.current === null && settling.current === null,
      point,
      selection: selectionInView,
      elements: () => {
        const scroller = scrollerRef.current
        const column = columnRef.current
        return scroller && column ? { scroller, column } : null
      },
    }),
    [position, jumpTo, point, selectionInView],
  )

  // Opening: go to the starting place as soon as its page has been read.
  useLayoutEffect(() => {
    store.setFocus(start.page)
    const target = pending.current
    if (target) land(target)
    const unsubscribe = store.subscribe(() => {
      const waiting = pending.current
      if (waiting) land(waiting)
    })
    return () => {
      unsubscribe()
      // If this effect runs again (React does that in development), it picks
      // the jump up where it stopped.
      if (settling.current) pending.current = settling.current.target
      stopSettling()
    }
  }, [store, start.page, land, stopSettling])

  // Any input from the reader ends the settling at once.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    // A jump still waiting for its page is dropped too: the reader has chosen to be elsewhere.
    const onInput = () => {
      stopSettling()
      pending.current = null
    }
    for (const name of events) scroller.addEventListener(name, onInput, { passive: true })
    return () => {
      for (const name of events) scroller.removeEventListener(name, onInput)
    }
  }, [stopSettling])

  const tryJumpRef = useRef(tryJump)
  const rememberAnchorRef = useRef(rememberAnchor)
  useEffect(() => {
    tryJumpRef.current = tryJump
    rememberAnchorRef.current = rememberAnchor
  })

  // Text above the reader can change height (a page finished reading, a new
  // text size). The first line in view stays where it was.
  useEffect(() => {
    const column = columnRef.current
    const scroller = scrollerRef.current
    if (!column || !scroller) return
    const observer = new ResizeObserver(() => {
      const saved = anchor.current
      if (pending.current || settling.current || !saved) return
      // The block itself can go: its page break was mended and it joined the
      // paragraph before. Then the place is found again from the page.
      if (!saved.element.isConnected) {
        if (tryJumpRef.current(saved.spot)) rememberAnchorRef.current()
        return
      }
      const delta = offsetTop(saved.element, saved.offset) - saved.top
      if (Math.abs(delta) > 0.5) {
        scroller.scrollTop += delta
        ownScroll.current = scroller.scrollTop
      }
    })
    observer.observe(column)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (pending.current) return
        const own = ownScroll.current
        if (own === null || Math.abs(scroller.scrollTop - own) > 1) {
          ownScroll.current = null
          rememberAnchor()
        }
        const { page } = position()
        store.setFocus(page)
        if (page !== lastPage.current) {
          lastPage.current = page
          onPageChange(page)
        }
      })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', onScroll)
    }
  }, [position, rememberAnchor, store, onPageChange])

  useEffect(() => {
    scrollerRef.current?.focus({ preventScroll: true })
  }, [])

  const pages = Array.from({ length: store.total }, (_, i) => i + 1)

  const style = {
    '--reading-font': FONT_STACKS[settings.font],
    '--reading-size': `${settings.size}px`,
    '--reading-leading': settings.lineHeight,
  } as CSSProperties

  return (
    <div
      ref={scrollerRef}
      className={`reflow width-${settings.width} margin-${settings.margin} align-${settings.align}`}
      style={style}
      tabIndex={0}
      onClick={(event) => {
        const selection = window.getSelection()
        if (selection && !selection.isCollapsed) return
        if ((event.target as Element).closest('button, a')) return
        onTap(event.clientY)
      }}
    >
      <div ref={columnRef} className="reflow-column">
        {noText ? (
          <div className="reflow-notice">
            <p>{t('reflow.noText')}</p>
          </div>
        ) : (
          pages.map((page) => (
            <SectionView key={page} store={store} page={page} cleanup={cleanup} onShowPage={onShowPage} />
          ))
        )}
      </div>
    </div>
  )
}

interface SectionViewProps {
  store: TextStore
  page: number
  cleanup: boolean
  onShowPage: (position: Position) => void
}

const SectionView = memo(function SectionView({ store, page, cleanup, onShowPage }: SectionViewProps) {
  const { t } = useTranslation()
  const section = useSyncExternalStore(store.subscribe, () => store.section(page, cleanup))

  if (!section) {
    return (
      <section className="reflow-page is-pending" data-page={page} aria-busy="true">
        <span className="reflow-pending">{t('reflow.reading', { page })}</span>
      </section>
    )
  }

  if (!section.hasText) {
    return (
      <section className="reflow-page" data-page={page}>
        <button type="button" className="reflow-card" data-b={0} onClick={() => onShowPage({ page, y: 0 })}>
          <span>{t('reflow.pageWithoutText', { page })}</span>
          <span className="reflow-card-action">{t('reflow.showPage')}</span>
        </button>
      </section>
    )
  }

  // Two blocks can start on the same line (cells of a table row); the later ones get a count.
  const used = new Map<string, number>()
  const keyOf = (block: Block) => {
    const base = blockKey(block)
    const count = used.get(base) ?? 0
    used.set(base, count + 1)
    return count === 0 ? base : `${base}#${count}`
  }

  return (
    <section className="reflow-page" data-page={page}>
      {section.blocks.map((block, index) => {
        const key = keyOf(block)
        switch (block.kind) {
          case 'heading': {
            const Tag = block.level === 1 ? 'h2' : block.level === 2 ? 'h3' : 'h4'
            return (
              <Tag key={key} className={`reflow-heading level-${block.level}`} data-b={index} ref={register(block)}>
                {block.text}
              </Tag>
            )
          }
          case 'code':
            return (
              <pre key={key} className="reflow-code" data-b={index} ref={register(block)}>
                <code>{block.text}</code>
              </pre>
            )
          case 'figure':
            return (
              <button
                key={key}
                type="button"
                className="reflow-card"
                data-b={index}
                ref={register(block)}
                onClick={() => onShowPage({ page: block.page, y: block.y })}
              >
                <span>{t('reflow.figure', { page: block.page })}</span>
                <span className="reflow-card-action">{t('reflow.showPage')}</span>
              </button>
            )
          default:
            return (
              <p
                key={key}
                className={[
                  'reflow-paragraph',
                  block.list ? 'is-list' : '',
                  block.rel < 0.9 ? 'is-small' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-b={index}
                ref={register(block)}
              >
                {block.text}
              </p>
            )
        }
      })}
    </section>
  )
})

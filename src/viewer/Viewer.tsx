import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { FocusReader } from '../focus/FocusReader'
import { FocusSheet, type FocusKind } from '../focus/FocusSheet'
import { LineFocus, type LineFocusHandle } from '../focus/LineFocus'
import { useFocusSettings } from '../focus/settings'
import type { Locator, Scope, Spot } from '../focus/stream'
import { useBackHandler } from '../lib/backStack'
import { getOcrPages, putOcrPage, updateBook, type SavedPosition } from '../library/db'
import { isOcrLang, OcrEngine, type OcrLang } from '../ocr/engine'
import type { OpenedPdf } from '../pdf/pdfjs'
import { Reflow, type Position, type ReflowHandle } from '../reflow/Reflow'
import { ReflowSettingsSheet } from '../reflow/ReflowSettingsSheet'
import { FONT_STACKS, useReflowSettings } from '../reflow/settings'
import { TextStore } from '../text/store'
import { ContentsIcon, HomeIcon, SettingsIcon } from '../ui/icons'
import { ContentsSheet } from './ContentsSheet'
import { GoToSheet } from './GoToSheet'
import { PageView, type Size } from './PageView'
import { SettingsSheet } from './SettingsSheet'
import { useViewerSettings } from './settings'
import { useZoomGestures, type Point, type ZoomTarget } from './useZoomGestures'
import './viewer.css'

interface ViewerProps {
  pdf: OpenedPdf
  fileName: string
  /** Where this book was left last time, if it is in the library. */
  start?: SavedPosition | null
  /** Library id, or null when the book is not kept. */
  bookId?: string | null
  /** Language this scanned book's text was read in before. */
  ocrLang?: string | null
  /** Called with the reading position as it changes, for the library. */
  onPosition?: (position: SavedPosition) => void
  onClose: () => void
}

// How often the reading position is checked for the library.
const POSITION_INTERVAL = 2000

type SheetName = 'contents' | 'goto' | 'settings' | 'focus'

/** A focus mode in use: what it reads, and an id that changes when the scope does. */
interface Reading {
  kind: FocusKind
  scope: Scope
  id: number
}

const startOf = (scope: Scope): Locator =>
  scope.kind === 'pages' ? { spot: { page: scope.from, y: 0 } } : scope.start

/** True for a line past the end of a scope. */
function isBeyond(scope: Scope, line: Locator): boolean {
  if (scope.kind === 'here') return false
  if (scope.kind === 'pages') return line.spot.page > scope.to
  const { end } = scope
  if (end.point && line.point) {
    const a = line.point
    const b = end.point
    return a.section > b.section || (a.section === b.section && (a.block > b.block || (a.block === b.block && a.offset >= b.offset)))
  }
  return line.spot.page > end.spot.page || (line.spot.page === end.spot.page && line.spot.y > end.spot.y + 0.002)
}

// How long a finished selection waits before the "Read with" bar goes, so a
// tap on the bar (which can clear the selection first) still lands.
const PICK_SHOW_DELAY = 150
const PICK_HIDE_DELAY = 400

const GAP = 8
// On a wide screen, "fit width" stops here; a full-width A4 page is too big to read.
const MAX_FIT_WIDTH = 960
const MIN_ZOOM = 0.5
const MAX_ZOOM = 5
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5]

const clampZoom = (zoom: number) => Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM)

export function Viewer({ pdf, fileName, start, bookId = null, ocrLang: savedOcrLang, onPosition, onClose }: ViewerProps) {
  const { doc } = pdf
  const { t } = useTranslation()
  // A book from the library reopens in the view it was left in.
  const [settings, updateSettings] = useViewerSettings(start?.mode)
  const { flow, night, mode } = settings
  const [reflowSettings, updateReflowSettings] = useReflowSettings()
  const reflowRef = useRef<ReflowHandle>(null)
  // Where the text view opens; set from the page view's position on each switch.
  const [textStart, setTextStart] = useState<Position>(() =>
    start?.mode === 'text' ? { page: start.page, y: start.y } : { page: 1, y: 0 },
  )
  const [textPage, setTextPage] = useState(() => (start?.mode === 'text' ? start.page : 1))
  const [store, setStore] = useState<TextStore | null>(() => (mode === 'text' ? new TextStore(doc) : null))
  const pendingSpot = useRef<Position | null>(start?.mode === 'page' ? { page: start.page, y: start.y } : null)
  // The saved place is not overwritten until the view has actually reached it.
  const restored = useRef(!start || start.mode === 'text')

  const scrollerRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  const topBarRef = useRef<HTMLElement>(null)
  const bottomBarRef = useRef<HTMLElement>(null)
  const [fallbackSize, setFallbackSize] = useState<Size | null>(null)
  // Scroller size, and the height left between the two bars.
  const [box, setBox] = useState({ w: 0, h: 0, between: 0 })
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  const [active, setActive] = useState<ReadonlySet<number>>(() => new Set())
  const [current, setCurrent] = useState(1)
  const currentRef = useRef(1)
  const [chromeVisible, setChromeVisible] = useState(true)
  const chromeVisibleRef = useRef(true)
  const [sheet, setSheet] = useState<SheetName | null>(null)
  const [focusSettings, updateFocusSettings] = useFocusSettings()
  const [reading, setReading] = useState<Reading | null>(null)
  const readingId = useRef(0)
  // Where focus mode is, for the library and for going back when it closes.
  const focusSpot = useRef<Spot | null>(null)
  const lineRef = useRef<LineFocusHandle>(null)
  const [linePlaying, setLinePlaying] = useState(false)
  // The page focus mode is on, for the options sheet's "this page".
  const [focusPage, setFocusPage] = useState(1)
  const [picked, setPicked] = useState<Extract<Scope, { kind: 'selection' }> | null>(null)

  useEffect(() => {
    chromeVisibleRef.current = chromeVisible
  }, [chromeVisible])

  useEffect(() => {
    store?.resume()
    return () => store?.destroy()
  }, [store])

  // A scanned book's text is read on this device once the reader asks, and
  // again on later visits in the language they chose; pages read are kept.
  const [ocrLang, setOcrLang] = useState<OcrLang | null>(() => (isOcrLang(savedOcrLang) ? savedOcrLang : null))
  useEffect(() => {
    if (!store || !ocrLang) return
    const engine = new OcrEngine(ocrLang)
    let cancelled = false
    const saved = bookId ? getOcrPages(bookId).catch(() => new Map()) : Promise.resolve(new Map())
    void saved.then((pages) => {
      if (cancelled) return
      store.enableOcr({
        saved: pages,
        recognize: async (page) => {
          const raw = await engine.recognize(doc, page)
          if (bookId) void putOcrPage(bookId, page, raw).catch(() => {})
          return raw
        },
      })
    })
    return () => {
      cancelled = true
      engine.stop()
    }
  }, [store, ocrLang, bookId, doc])

  const recognise = useCallback(
    (lang: OcrLang) => {
      setOcrLang(lang)
      if (bookId) void updateBook(bookId, { ocrLang: lang }).catch(() => {})
    },
    [bookId],
  )

  const total = doc.numPages
  const pages = useMemo(() => Array.from({ length: total }, (_, i) => i + 1), [total])

  // Placeholders take the first page's size until each page reports its own.
  useEffect(() => {
    let cancelled = false
    doc.getPage(1).then((page) => {
      if (cancelled) return
      const { width, height } = page.getViewport({ scale: 1 })
      setFallbackSize({ w: width, h: height })
    })
    return () => {
      cancelled = true
    }
  }, [doc])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const measure = () => {
      const bars = (topBarRef.current?.offsetHeight ?? 0) + (bottomBarRef.current?.offsetHeight ?? 0)
      setBox({ w: scroller.clientWidth, h: scroller.clientHeight, between: scroller.clientHeight - bars })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  // Page by page, the whole page fits between the bars, so nothing is hidden
  // while they are showing.
  const fit = useMemo(() => {
    if (!fallbackSize || box.w === 0) return 0
    const width = Math.min(box.w - 2 * GAP, MAX_FIT_WIDTH) / fallbackSize.w
    if (flow === 'scroll') return width
    return Math.min(width, (box.between - 2 * GAP) / fallbackSize.h)
  }, [fallbackSize, box, flow])

  const scale = fit * zoom

  // Pages near the viewport get drawn; the rest stay as sized placeholders.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !fit) return
    const observer = new IntersectionObserver(
      (entries) => {
        setActive((prev) => {
          const next = new Set(prev)
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.page)
            if (entry.isIntersecting) next.add(page)
            else next.delete(page)
          }
          return next
        })
      },
      { root: scroller, rootMargin: flow === 'scroll' ? '150% 0px' : '0px 100%' },
    )
    scroller.querySelectorAll('.page').forEach((el) => observer.observe(el))
    return () => {
      observer.disconnect()
      setActive(new Set())
    }
  }, [flow, fit, total])

  const updateCurrent = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const rect = scroller.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    const page = Number(hit?.closest<HTMLElement>('[data-page]')?.dataset.page)
    if (page && page !== currentRef.current) {
      currentRef.current = page
      setCurrent(page)
    }
  }, [])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updateCurrent)
    }
    // Capture also catches the inner scroll of a zoomed page in page-by-page mode.
    scroller.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => {
      cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [updateCurrent])

  const jumpTo = useCallback((page: number) => {
    const scroller = scrollerRef.current
    const target = scroller?.querySelector<HTMLElement>(`.slide[data-page="${page}"], .page[data-page="${page}"]`)
    if (!target) return
    target.scrollIntoView({ block: 'start', inline: 'start' })
    currentRef.current = page
    setCurrent(page)
  }, [])

  const topInset = useCallback(() => (chromeVisibleRef.current ? (topBarRef.current?.offsetHeight ?? 0) : 0), [])

  /** The first line in view in the page view: page number and height on it. */
  const pagePosition = useCallback((): Position => {
    const scroller = scrollerRef.current
    const page = currentRef.current
    if (!scroller) return { page, y: 0 }
    const top = scroller.getBoundingClientRect().top + topInset() + GAP
    // The page under the top line can be a few before the one in the middle of the screen.
    for (let n = Math.max(1, page - 3); n <= Math.min(total, page + 1); n++) {
      const el = scroller.querySelector<HTMLElement>(`.page[data-page="${n}"]`)
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (rect.bottom > top && rect.right > 0 && rect.left < window.innerWidth) {
        return { page: n, y: Math.min(Math.max((top - rect.top) / rect.height, 0), 1) }
      }
    }
    return { page, y: 0 }
  }, [topInset, total])

  const jumpToSpot = useCallback(
    (spot: Position) => {
      jumpTo(spot.page)
      const scroller = scrollerRef.current
      const el = scroller?.querySelector<HTMLElement>(`.page[data-page="${spot.page}"]`)
      if (!scroller || !el || flow !== 'scroll' || spot.y <= 0) return
      scroller.scrollTop += spot.y * el.offsetHeight
    },
    [jumpTo, flow],
  )

  const switchMode = useCallback(
    (next: 'page' | 'text', spot?: Position) => {
      if (next === mode) return
      if (next === 'text') {
        const start = spot ?? pagePosition()
        setTextStart(start)
        setTextPage(start.page)
        setStore((existing) => existing ?? new TextStore(doc))
      } else {
        pendingSpot.current = spot ?? reflowRef.current?.position() ?? null
      }
      updateSettings({ mode: next })
    },
    [mode, pagePosition, doc, updateSettings],
  )

  // Back on the pages (or reopening a book), go to where the reader was.
  useLayoutEffect(() => {
    if (mode !== 'page' || !fit) return
    const spot = pendingSpot.current
    pendingSpot.current = null
    if (spot) jumpToSpot(spot)
    restored.current = true
  }, [mode, fit, jumpToSpot])

  // The library hears where the reader is: every few seconds when it has
  // changed, and when the tab is hidden or closed.
  const lastReported = useRef('')
  const reportPosition = useRef(() => {})
  useEffect(() => {
    reportPosition.current = () => {
      if (!onPosition || !restored.current) return
      let spot: Position | null
      if (reading?.kind === 'focus' && focusSpot.current) {
        spot = focusSpot.current
      } else if (mode === 'text' && store) {
        const reflow = reflowRef.current
        spot = reflow && reflow.ready() ? reflow.position() : null
      } else {
        spot = pagePosition()
      }
      if (!spot) return
      const position: SavedPosition = { mode: mode === 'text' && store ? 'text' : 'page', page: spot.page, y: spot.y }
      const key = `${position.mode}:${position.page}:${position.y.toFixed(3)}`
      if (key === lastReported.current) return
      lastReported.current = key
      onPosition(position)
    }
  })

  useEffect(() => {
    if (!onPosition) return
    const report = () => reportPosition.current()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') report()
    }
    const timer = setInterval(report, POSITION_INTERVAL)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', report)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', report)
    }
  }, [onPosition])

  const textMode = mode === 'text' && store !== null

  /** Starts a focus mode: on a given scope, or from the first line in view to the end. */
  const startReading = (kind: FocusKind, given?: Scope) => {
    let scope = given
    if (!scope) {
      const reflow = reflowRef.current
      const start: Locator | null = textMode && reflow ? (reflow.point() ?? { spot: reflow.position() }) : { spot: pagePosition() }
      scope = { kind: 'here', start: start ?? { spot: { page: 1, y: 0 } } }
    }
    window.getSelection()?.removeAllRanges()
    setPicked(null)
    setSheet(null)
    setStore((existing) => existing ?? new TextStore(doc))
    if (kind === 'line') {
      const start = startOf(scope)
      if (!textMode) switchMode('text', start.spot)
      else if (scope.kind === 'pages') reflowRef.current?.jumpTo(start.spot)
      setLinePlaying(false)
    } else {
      focusSpot.current = startOf(scope).spot
    }
    readingId.current += 1
    setReading({ kind, scope, id: readingId.current })
  }

  const closeFocus = useCallback(
    (at: Spot | null) => {
      setReading(null)
      focusSpot.current = null
      if (!at) return
      if (mode === 'text') reflowRef.current?.jumpTo(at)
      else jumpToSpot(at)
    },
    [mode, jumpToSpot],
  )

  const closeLine = useCallback(() => {
    setReading(null)
    setLinePlaying(false)
  }, [])

  useBackHandler(reading?.kind === 'line', closeLine)
  // Registered here rather than in the focus screen, which mounts already
  // open: React runs a mount effect twice in development and the history
  // entry would be pushed, dropped and pushed again.
  useBackHandler(reading?.kind === 'focus', () => closeFocus(focusSpot.current))

  const changeScope = (next: Scope | 'here') => {
    if (!reading) return
    let scope: Scope
    if (next === 'here') {
      const here = reading.kind === 'focus' ? focusSpot.current : reflowRef.current?.position()
      scope = { kind: 'here', start: { spot: here ?? startOf(reading.scope).spot } }
    } else {
      scope = next
    }
    setSheet(null)
    if (reading.kind === 'line') {
      if (scope.kind === 'pages') reflowRef.current?.jumpTo(startOf(scope).spot)
      setLinePlaying(false)
    } else {
      focusSpot.current = startOf(scope).spot
    }
    readingId.current += 1
    setReading({ kind: reading.kind, scope, id: readingId.current })
  }

  const onFocusSpot = useCallback((at: Spot) => {
    focusSpot.current = at
    setFocusPage(at.page)
  }, [])

  // A selection offers to be read in a focus mode. The bar shows once the
  // selection stops changing.
  const textModeRef = useRef(textMode)
  useEffect(() => {
    textModeRef.current = textMode
  })
  useEffect(() => {
    let timer = 0
    const pageSelection = (): Extract<Scope, { kind: 'selection' }> | null => {
      const selection = window.getSelection()
      const scroller = scrollerRef.current
      if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !scroller) return null
      const range = selection.getRangeAt(0)
      if (!scroller.contains(range.commonAncestorContainer)) return null
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
      const edge = (node: Node, rect: DOMRect | undefined): Locator | null => {
        const page = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('.page[data-page]')
        if (!page || !rect) return null
        const box = page.getBoundingClientRect()
        return { spot: { page: Number(page.dataset.page), y: Math.min(Math.max((rect.top - box.top) / box.height, 0), 1) } }
      }
      const start = edge(range.startContainer, rects[0])
      const end = edge(range.endContainer, rects.at(-1))
      const text = selection.toString()
      return start && end && text.trim() ? { kind: 'selection', start, end, text } : null
    }
    const update = () => {
      let next: Extract<Scope, { kind: 'selection' }> | null = null
      if (textModeRef.current) {
        const found = reflowRef.current?.selection()
        if (found && found.text.trim()) next = { kind: 'selection', ...found }
      } else {
        next = pageSelection()
      }
      setPicked(next)
    }
    const onChange = () => {
      window.clearTimeout(timer)
      const selection = window.getSelection()
      const collapsed = !selection || selection.isCollapsed
      timer = window.setTimeout(update, collapsed ? PICK_HIDE_DELAY : PICK_SHOW_DELAY)
    }
    document.addEventListener('selectionchange', onChange)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('selectionchange', onChange)
    }
  }, [])

  const closeBook = () => {
    reportPosition.current()
    onClose()
  }

  // Switching between scrolling and page-by-page keeps the reader on the same page.
  const lastFlow = useRef(flow)
  useLayoutEffect(() => {
    if (lastFlow.current === flow || !fit) return
    lastFlow.current = flow
    jumpTo(currentRef.current)
  }, [flow, fit, jumpTo])

  // Zoom keeps the point under the fingers (or cursor) where it was.
  const pendingFix = useRef<{ target: ZoomTarget; x: number; y: number; ratio: number; focal: Point } | null>(null)

  const zoomTo = useCallback((next: number, focal: Point, target: ZoomTarget) => {
    const clamped = clampZoom(next)
    const previous = zoomRef.current
    if (Math.abs(clamped - previous) < 0.001) return
    const rect = target.anchor.getBoundingClientRect()
    pendingFix.current = { target, x: focal.x - rect.left, y: focal.y - rect.top, ratio: clamped / previous, focal }
    zoomRef.current = clamped
    setZoom(clamped)
  }, [])

  useLayoutEffect(() => {
    const fix = pendingFix.current
    if (!fix) return
    pendingFix.current = null
    const rect = fix.target.anchor.getBoundingClientRect()
    fix.target.scroller.scrollLeft += rect.left + fix.x * fix.ratio - fix.focal.x
    fix.target.scroller.scrollTop += rect.top + fix.y * fix.ratio - fix.focal.y
  }, [zoom])

  const targetAt = useCallback(
    (point: Point): ZoomTarget | null => {
      const scroller = scrollerRef.current
      if (!scroller) return null
      const hit = document.elementFromPoint(point.x, point.y)
      if (flow === 'paged') {
        const slide =
          hit?.closest<HTMLElement>('.slide') ??
          scroller.querySelector<HTMLElement>(`.slide[data-page="${currentRef.current}"]`)
        const page = slide?.querySelector<HTMLElement>('.page')
        return slide && page ? { scroller: slide, visual: page, anchor: page } : null
      }
      const column = columnRef.current
      const page =
        hit?.closest<HTMLElement>('.page') ??
        scroller.querySelector<HTMLElement>(`.page[data-page="${currentRef.current}"]`)
      return column && page ? { scroller, visual: column, anchor: page } : null
    },
    [flow],
  )

  const zoomAtCenter = useCallback(
    (next: number) => {
      const scroller = scrollerRef.current
      if (!scroller) return
      const rect = scroller.getBoundingClientRect()
      const focal = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      const target = targetAt(focal)
      if (target) zoomTo(next, focal, target)
    },
    [targetAt, zoomTo],
  )

  const zoomStep = (direction: -1 | 1) => {
    const steps = direction > 0 ? ZOOM_STEPS : [...ZOOM_STEPS].reverse()
    const next = steps.find((step) => (direction > 0 ? step > zoom + 0.001 : step < zoom - 0.001))
    if (next !== undefined) zoomAtCenter(next)
  }

  useZoomGestures({
    surface: scrollerRef,
    targetAt,
    getZoom: () => zoomRef.current,
    clampZoom,
    zoomTo,
    onTap: () => setChromeVisible((visible) => !visible),
  })

  useEffect(() => {
    scrollerRef.current?.focus({ preventScroll: true })
  }, [])

  const closeSheet = useCallback(() => setSheet(null), [])

  const scopeLabel = (scope: Scope): string => {
    if (scope.kind === 'here') return t('focus.scopeHere')
    if (scope.kind === 'selection') return t('focus.scopeSelection')
    if (scope.title) return scope.title
    return scope.from === scope.to ? t('focus.scopePage', { page: scope.from }) : t('focus.scopePages', { from: scope.from, to: scope.to })
  }

  const pageViews = (n: number) =>
    fallbackSize && fit ? (
      <PageView
        key={n}
        doc={doc}
        pageNumber={n}
        scale={scale}
        fallbackSize={fallbackSize}
        active={active.has(n)}
        night={night}
      />
    ) : null

  const shownPage = textMode ? textPage : current
  const lineMode = reading?.kind === 'line' && textMode
  const goTo = (page: number) => {
    setSheet(null)
    if (textMode) reflowRef.current?.jumpTo({ page, y: 0 })
    else jumpTo(page)
  }
  const viewerClass = [
    'viewer',
    chromeVisible ? '' : 'is-chrome-hidden',
    textMode ? 'is-text' : '',
    textMode || reading ? `theme-${reflowSettings.theme}` : '',
    lineMode ? 'is-line' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const viewerStyle =
    (textMode || reading) && reflowSettings.theme === 'custom'
      ? ({ '--bg': reflowSettings.customBackground, '--text': reflowSettings.customText } as CSSProperties)
      : undefined

  return (
    <div className={viewerClass} style={viewerStyle}>
      <header ref={topBarRef} className="viewer-bar viewer-topbar">
        <button
          type="button"
          className="bar-icon"
          aria-label={t('viewer.home')}
          title={t('viewer.home')}
          onClick={closeBook}
        >
          <HomeIcon />
        </button>
        <h1 className="viewer-title">{fileName}</h1>
        <div className="mode-switch" role="group" aria-label={t('viewer.modeLabel')}>
          <button
            type="button"
            className="mode-switch-option"
            aria-pressed={!textMode}
            onClick={() => switchMode('page')}
          >
            {t('viewer.modePage')}
          </button>
          <button
            type="button"
            className="mode-switch-option"
            aria-pressed={textMode}
            onClick={() => switchMode('text')}
          >
            {t('viewer.modeText')}
          </button>
        </div>
      </header>

      {textMode && (
        <Reflow
          store={store}
          settings={reflowSettings}
          start={textStart}
          topInset={topInset}
          onPageChange={setTextPage}
          onShowPage={(spot) => switchMode('page', spot)}
          onRecognise={recognise}
          onTap={(clientY) => {
            if (lineMode) lineRef.current?.tap(clientY)
            else setChromeVisible((visible) => !visible)
          }}
          handle={reflowRef}
        />
      )}

      {lineMode && reading && store && (
        <LineFocus
          key={reading.id}
          elements={() => {
            const reflow = reflowRef.current
            return reflow && reflow.ready() ? reflow.elements() : null
          }}
          start={startOf(reading.scope)}
          beyond={(line) => isBeyond(reading.scope, line)}
          settings={focusSettings}
          playing={linePlaying}
          onPlayingChange={setLinePlaying}
          onEnd={() => setLinePlaying(false)}
          insets={() => ({ top: 0, bottom: bottomBarRef.current?.offsetHeight ?? 0 })}
          handle={lineRef}
        />
      )}

      <div
        ref={scrollerRef}
        className={[
          'viewer-scroller',
          flow === 'scroll' ? 'is-scroll' : 'is-paged',
          textMode ? 'is-behind' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        tabIndex={0}
        aria-label={t('viewer.documentLabel', { name: fileName })}
        aria-hidden={textMode || undefined}
      >
        {flow === 'scroll' ? (
          <div ref={columnRef} className="viewer-column">
            {pages.map(pageViews)}
          </div>
        ) : (
          pages.map((n) => (
            <div key={n} className="slide" data-page={n}>
              {pageViews(n)}
            </div>
          ))
        )}
      </div>

      {picked && !reading && (
        <div className="read-with" role="toolbar" aria-label={t('focus.readWith')} onPointerDown={(event) => event.preventDefault()}>
          <span className="read-with-label">{t('focus.readWith')}</span>
          <button type="button" className="button-quiet" onClick={() => startReading('focus', picked)}>
            {t('focus.modeFocus')}
          </button>
          <button type="button" className="button-quiet" onClick={() => startReading('line', picked)}>
            {t('focus.modeLine')}
          </button>
        </div>
      )}

      {lineMode ? (
        <nav ref={bottomBarRef} className="viewer-bar viewer-bottombar line-bar" aria-label={t('focus.lineTools')}>
          <button type="button" className="button-quiet" onClick={closeLine}>
            {t('focus.done')}
          </button>
          <button type="button" className="button-quiet" aria-label={t('focus.previousLineLabel')} onClick={() => lineRef.current?.step(-1)}>
            {t('focus.previousLine')}
          </button>
          {focusSettings.lineAdvance === 'auto' || focusSettings.lineGuide === 'words' ? (
            <button type="button" className="button-quiet" onClick={() => setLinePlaying((value) => !value)}>
              {linePlaying ? t('focus.pause') : t('focus.play')}
            </button>
          ) : (
            <button type="button" className="button-quiet" aria-label={t('focus.nextLineLabel')} onClick={() => lineRef.current?.step(1)}>
              {t('focus.nextLine')}
            </button>
          )}
          <button type="button" className="button-quiet" onClick={() => setSheet('focus')}>
            {t('focus.options')}
          </button>
        </nav>
      ) : (
        <nav ref={bottomBarRef} className="viewer-bar viewer-bottombar" aria-label={t('viewer.toolbarLabel')}>
          <button
            type="button"
            className="bar-icon"
            aria-label={t('viewer.contents')}
            title={t('viewer.contents')}
            onClick={() => setSheet('contents')}
          >
            <ContentsIcon />
          </button>
          <button type="button" className="bar-mode" onClick={() => startReading('focus')}>
            {t('focus.modeFocus')}
          </button>
          <button
            type="button"
            className="viewer-page-indicator"
            aria-label={t('viewer.pageIndicatorLabel', { current: shownPage, total })}
            onClick={() => setSheet('goto')}
          >
            {t('viewer.pageIndicator', { current: shownPage, total })}
          </button>
          <button type="button" className="bar-mode" onClick={() => startReading('line')}>
            {t('focus.modeLine')}
          </button>
          <button
            type="button"
            className="bar-icon"
            aria-label={t('viewer.settings')}
            title={t('viewer.settings')}
            onClick={() => setSheet('settings')}
          >
            <SettingsIcon />
          </button>
        </nav>
      )}

      {reading?.kind === 'focus' && store && (
        <FocusReader
          key={reading.id}
          store={store}
          cleanup={reflowSettings.cleanup}
          scope={reading.scope}
          scopeLabel={scopeLabel(reading.scope)}
          font={FONT_STACKS[reflowSettings.font]}
          settings={focusSettings}
          paused={sheet === 'focus'}
          onOptions={() => setSheet('focus')}
          onClose={closeFocus}
          onSpot={onFocusSpot}
        />
      )}
      {reading && (
        <FocusSheet
          open={sheet === 'focus'}
          kind={reading.kind}
          doc={doc}
          scope={reading.scope}
          page={reading.kind === 'focus' ? focusPage : textPage}
          settings={focusSettings}
          onChange={updateFocusSettings}
          onScope={changeScope}
          onClose={closeSheet}
        />
      )}

      <ContentsSheet
        open={sheet === 'contents'}
        doc={doc}
        currentPage={shownPage}
        onClose={closeSheet}
        onPick={goTo}
      />
      <GoToSheet open={sheet === 'goto'} total={total} onClose={closeSheet} onGo={goTo} />
      <ReflowSettingsSheet
        open={sheet === 'settings' && textMode}
        settings={reflowSettings}
        onClose={closeSheet}
        onChange={updateReflowSettings}
      />
      <SettingsSheet
        open={sheet === 'settings' && !textMode}
        settings={settings}
        zoom={zoom}
        canZoomOut={zoom > MIN_ZOOM + 0.001}
        canZoomIn={zoom < MAX_ZOOM - 0.001}
        onClose={closeSheet}
        onChange={updateSettings}
        onZoomStep={zoomStep}
        onZoomReset={() => zoomAtCenter(1)}
      />
    </div>
  )
}

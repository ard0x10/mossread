import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { createPortal } from 'react-dom'
import {
  elementOf,
  findSpot,
  firstTextNode,
  lineBoxes,
  lineIndexOf,
  locatorOf,
  type ElementSpot,
  type LineBox,
} from '../reflow/blocks'
import type { FocusSettings } from './settings'
import type { Locator } from './stream'
import { useWakeLock } from './useWakeLock'
import './focus.css'

export interface LineFocusHandle {
  step: (direction: 1 | -1) => void
  /** A tap on the text: the top part goes back a line, the rest goes on (or pauses, when it runs by itself). */
  tap: (clientY: number) => void
}

interface LineFocusProps {
  /** The text view's scrolling element and column, once it is drawn and settled. */
  elements: () => { scroller: HTMLDivElement; column: HTMLDivElement } | null
  start: Locator
  /** True for a line past the end of what is being read. */
  beyond: (line: Locator) => boolean
  settings: FocusSettings
  playing: boolean
  onPlayingChange: (playing: boolean) => void
  onEnd: () => void
  /** Screen space taken by bars at the top and bottom. */
  insets: () => { top: number; bottom: number }
  handle: Ref<LineFocusHandle>
}

interface Mask {
  top: number
  height: number
  dim: Array<{ top: number; height: number }>
}

const PAD = 4
const BACK_ZONE = 0.3

function isBlock(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element.hasAttribute('data-b')
}

/** The block before or after this one in reading order, or 'pending' when its page is still being read. */
function neighbour(element: HTMLElement, direction: 1 | -1): HTMLElement | 'pending' | null {
  let sibling = direction > 0 ? element.nextElementSibling : element.previousElementSibling
  while (sibling && !isBlock(sibling))
    sibling = direction > 0 ? sibling.nextElementSibling : sibling.previousElementSibling
  if (sibling) return sibling as HTMLElement
  let section = element.closest('[data-page]')
  for (;;) {
    section = (direction > 0 ? section?.nextElementSibling : section?.previousElementSibling) ?? null
    if (!section) return null
    if (section.classList.contains('is-pending')) return 'pending'
    const blocks = section.querySelectorAll<HTMLElement>('[data-b]')
    if (blocks.length > 0) return direction > 0 ? blocks[0] : blocks[blocks.length - 1]
  }
}

/** The line before or after one, crossing into the next block when needed. */
function stepLine(spot: ElementSpot, direction: 1 | -1): ElementSpot | 'pending' | null {
  const lines = lineBoxes(spot.element)
  const index = lineIndexOf(lines, spot.offset) + direction
  if (index >= 0 && index < lines.length) return { element: spot.element, offset: lines[index].offset }
  const next = neighbour(spot.element, direction)
  if (!next || next === 'pending') return next
  const nextLines = lineBoxes(next)
  return { element: next, offset: direction > 0 ? 0 : nextLines[nextLines.length - 1].offset }
}

function boxOf(spot: ElementSpot): LineBox {
  const lines = lineBoxes(spot.element)
  return lines[lineIndexOf(lines, spot.offset)]
}

function wordsOnLine(spot: ElementSpot): { words: number; ends: boolean } {
  const text = firstTextNode(spot.element)?.data ?? ''
  if (!text) return { words: 3, ends: true }
  const lines = lineBoxes(spot.element)
  const index = lineIndexOf(lines, spot.offset)
  const slice = text.slice(lines[index].offset, lines[index + 1]?.offset ?? text.length)
  return { words: slice.split(/\s+/).filter(Boolean).length, ends: /[.!?…:]\s*$/.test(slice) }
}

/**
 * Darkens the text view except the line being read. The lit window lives in
 * the text column, so it scrolls with the text; the dark around it is its shadow.
 */
export function LineFocus({
  elements,
  start,
  beyond,
  settings,
  playing,
  onPlayingChange,
  onEnd,
  insets,
  handle,
}: LineFocusProps) {
  const [column, setColumn] = useState<HTMLDivElement | null>(null)
  const [mask, setMask] = useState<Mask | null>(null)
  const current = useRef<ElementSpot | null>(null)
  // The current line as a place in the document, to find it again if its block is redrawn.
  const place = useRef<Locator>(start)
  const auto = settings.lineAdvance === 'auto'

  useWakeLock(true)

  const measure = useCallback(() => {
    const els = elements()
    const spot = current.current
    if (!els || !spot) return
    if (!spot.element.isConnected) {
      const again = findSpot(els.column, place.current.spot)
      if (!again) return
      current.current = again
    }
    const origin = els.column.getBoundingClientRect().top
    const here = boxOf(current.current!)
    let top = here.top
    let bottom = here.bottom
    const dim: Mask['dim'] = []
    if (settings.lines === 3) {
      for (const direction of [-1, 1] as const) {
        const other = stepLine(current.current!, direction)
        if (!other || other === 'pending') continue
        const box = boxOf(other)
        // A neighbour far away (past a figure card, a page gap) is left dark.
        if (Math.abs(direction < 0 ? here.top - box.bottom : box.top - here.bottom) > (here.bottom - here.top) * 2)
          continue
        top = Math.min(top, box.top)
        bottom = Math.max(bottom, box.bottom)
        dim.push({ top: box.top - origin - PAD, height: box.bottom - box.top + 2 * PAD })
      }
    }
    setMask({ top: top - origin - PAD, height: bottom - top + 2 * PAD, dim })
  }, [elements, settings.lines])

  /** Scrolls so the line sits in the upper part of the view when it has gone near an edge. */
  const keepInView = useCallback((instant: boolean) => {
    const els = elements()
    const spot = current.current
    if (!els || !spot) return
    const view = els.scroller.getBoundingClientRect()
    const { top: topBar, bottom: bottomBar } = insets()
    const box = boxOf(spot)
    const visibleTop = view.top + topBar
    const visibleBottom = view.bottom - bottomBar
    const height = visibleBottom - visibleTop
    if (box.top >= visibleTop + height * 0.12 && box.bottom <= visibleBottom - height * 0.35) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    els.scroller.scrollTo({
      top: els.scroller.scrollTop + box.top - (visibleTop + height * 0.3),
      behavior: reduce || instant ? 'auto' : 'smooth',
    })
  }, [elements, insets])

  const moveTo = useCallback(
    (spot: ElementSpot, instant = false) => {
      current.current = spot
      const located = locatorOf(spot.element, spot.offset)
      if (located) place.current = located
      measure()
      keepInView(instant)
    },
    [measure, keepInView],
  )

  // Finds the starting line once its page is drawn and the text view has
  // settled there (until then it keeps moving the scroll itself).
  useEffect(() => {
    const tryStart = () => {
      if (current.current) return true
      const els = elements()
      if (!els) return false
      setColumn(els.column)
      const element = start.point ? elementOf(els.column, start.point) : null
      const spot = element ? { element, offset: start.point!.offset } : findSpot(els.column, start.spot)
      if (!spot) return false
      const lines = lineBoxes(spot.element)
      // Placed at once: a smooth scroll here would be cut short by the text
      // view still adjusting the pages around it.
      moveTo({ element: spot.element, offset: lines[lineIndexOf(lines, spot.offset)].offset }, true)
      return true
    }
    if (tryStart()) return
    const timer = window.setInterval(() => {
      if (tryStart()) window.clearInterval(timer)
    }, 100)
    return () => window.clearInterval(timer)
  }, [elements, start, moveTo])

  const step = useCallback(
    (direction: 1 | -1) => {
      const spot = current.current
      if (!spot) return
      const next = stepLine(spot, direction)
      if (next === 'pending') return
      if (!next) {
        if (direction > 0) onEnd()
        return
      }
      const located = locatorOf(next.element, next.offset)
      if (direction > 0 && located && beyond(located)) {
        onEnd()
        return
      }
      moveTo(next)
    },
    [beyond, moveTo, onEnd],
  )

  useImperativeHandle(
    handle,
    () => ({
      step,
      tap: (clientY: number) => {
        const els = elements()
        if (!els) return
        const view = els.scroller.getBoundingClientRect()
        if (clientY < view.top + view.height * BACK_ZONE) step(-1)
        else if (auto) onPlayingChange(!playing)
        else step(1)
      },
    }),
    [step, elements, auto, playing, onPlayingChange],
  )

  // Running by itself: each line stays for as long as its words take at the chosen speed.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!auto || !playing) return
    const spot = current.current
    if (!spot) return
    const { words, ends } = wordsOnLine(spot)
    const base = 60000 / settings.wpm
    const ms = Math.max(500, words * base + (ends ? base : 0))
    const timer = setTimeout(() => {
      step(1)
      setTick((n) => n + 1)
    }, ms)
    return () => clearTimeout(timer)
  }, [auto, playing, settings.wpm, step, tick, mask])

  // New text size, a page finishing below or above: the line moves, the window follows.
  useLayoutEffect(() => {
    if (!column) return
    measure()
    const observer = new ResizeObserver(() => measure())
    observer.observe(column)
    return () => observer.disconnect()
  }, [column, measure])

  if (!column || !mask) return null
  return createPortal(
    <div className="line-focus" aria-hidden="true">
      <div className="line-window" style={{ top: mask.top, height: mask.height }} />
      {mask.dim.map((row, k) => (
        <div key={k} className="line-dim" style={{ top: row.top, height: row.height }} />
      ))}
    </div>,
    column,
  )
}

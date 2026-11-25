import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OpenedPdf } from '../pdf/pdfjs'
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
  onClose: () => void
}

type SheetName = 'contents' | 'goto' | 'settings'

const GAP = 8
// On a wide screen, "fit width" stops here; a full-width A4 page is too big to read.
const MAX_FIT_WIDTH = 960
const MIN_ZOOM = 0.5
const MAX_ZOOM = 5
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5]

const clampZoom = (zoom: number) => Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM)

export function Viewer({ pdf, fileName, onClose }: ViewerProps) {
  const { doc } = pdf
  const { t } = useTranslation()
  const [settings, updateSettings] = useViewerSettings()
  const { flow, night } = settings

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
  const [sheet, setSheet] = useState<SheetName | null>(null)

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

  return (
    <div className={chromeVisible ? 'viewer' : 'viewer is-chrome-hidden'}>
      <header ref={topBarRef} className="viewer-bar viewer-topbar">
        <button type="button" className="button-quiet" onClick={onClose}>
          {t('viewer.close')}
        </button>
        <h1 className="viewer-title">{fileName}</h1>
      </header>

      <div
        ref={scrollerRef}
        className={flow === 'scroll' ? 'viewer-scroller is-scroll' : 'viewer-scroller is-paged'}
        tabIndex={0}
        aria-label={t('viewer.documentLabel', { name: fileName })}
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

      <nav ref={bottomBarRef} className="viewer-bar viewer-bottombar" aria-label={t('viewer.toolbarLabel')}>
        <button type="button" className="button-quiet" onClick={() => setSheet('contents')}>
          {t('viewer.contents')}
        </button>
        <button
          type="button"
          className="viewer-page-indicator"
          aria-label={t('viewer.pageIndicatorLabel', { current, total })}
          onClick={() => setSheet('goto')}
        >
          {t('viewer.pageIndicator', { current, total })}
        </button>
        <button type="button" className="button-quiet" onClick={() => setSheet('settings')}>
          {t('viewer.settings')}
        </button>
      </nav>

      <ContentsSheet
        open={sheet === 'contents'}
        doc={doc}
        currentPage={current}
        onClose={closeSheet}
        onPick={(page) => {
          setSheet(null)
          jumpTo(page)
        }}
      />
      <GoToSheet
        open={sheet === 'goto'}
        total={total}
        onClose={closeSheet}
        onGo={(page) => {
          setSheet(null)
          jumpTo(page)
        }}
      />
      <SettingsSheet
        open={sheet === 'settings'}
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

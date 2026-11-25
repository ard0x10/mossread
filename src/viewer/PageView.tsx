import { TextLayer, type RenderTask } from 'pdfjs-dist'
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { PDFDocumentProxy, PDFPageProxy } from '../pdf/pdfjs'
import { acquireRenderSlot } from '../pdf/renderLimiter'
import { useSettled } from '../lib/useSettled'

export interface Size {
  w: number
  h: number
}

interface PageViewProps {
  doc: PDFDocumentProxy
  pageNumber: number
  // CSS pixels per PDF unit. Changes on zoom; the canvas follows once it settles.
  scale: number
  // Size at scale 1 used until this page has loaded and reports its own.
  fallbackSize: Size
  // Inside the render window around the viewport.
  active: boolean
  night: boolean
}

// One canvas this size is about 20 MB of memory. Beyond it the page is drawn
// at a lower density instead of risking a blank page on a phone.
const MAX_CANVAS_PIXELS = 5_000_000
const MAX_DEVICE_RATIO = 2

function pixelRatioFor(cssWidth: number, cssHeight: number): number {
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_RATIO)
  const pixels = cssWidth * cssHeight * ratio * ratio
  return pixels > MAX_CANVAS_PIXELS ? Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight)) : ratio
}

export const PageView = memo(function PageView({
  doc,
  pageNumber,
  scale,
  fallbackSize,
  active,
  night,
}: PageViewProps) {
  const { t } = useTranslation()
  const paintRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(scale)
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  const settledScale = useSettled(scale, 160)

  useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let loaded: PDFPageProxy | null = null
    doc.getPage(pageNumber).then(
      (p) => {
        if (cancelled) return
        loaded = p
        setPage(p)
      },
      () => {},
    )
    return () => {
      cancelled = true
      setPage(null)
      loaded?.cleanup()
    }
  }, [doc, pageNumber, active])

  const size = useMemo<Size>(() => {
    if (!page) return fallbackSize
    const { width, height } = page.getViewport({ scale: 1 })
    return { w: width, h: height }
  }, [page, fallbackSize])

  // Canvas. A fresh canvas is drawn off-screen and swapped in when complete,
  // so zooming shows the previous (stretched) image instead of a blank page.
  useEffect(() => {
    const paint = paintRef.current
    if (!paint) return
    if (!page) {
      paint.replaceChildren()
      return
    }

    const controller = new AbortController()
    let task: RenderTask | null = null
    let release: (() => void) | null = null

    const draw = async () => {
      try {
        release = await acquireRenderSlot(controller.signal)
        const css = page.getViewport({ scale: settledScale })
        const viewport = page.getViewport({ scale: settledScale * pixelRatioFor(css.width, css.height) })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.className = 'page-canvas'
        task = page.render({ canvas, viewport })
        await task.promise
        if (!controller.signal.aborted) paint.replaceChildren(canvas)
      } catch {
        // Cancelled by scrolling away or zooming again; the old image stays.
      } finally {
        release?.()
      }
    }
    void draw()

    return () => {
      controller.abort()
      task?.cancel()
    }
  }, [page, settledScale])

  // Selectable text. Positions are stored as percentages and font sizes follow
  // --total-scale-factor, so zooming does not need a new text layer.
  useEffect(() => {
    const container = textRef.current
    if (!page || !container) return

    const layer = new TextLayer({
      textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
      container,
      viewport: page.getViewport({ scale: scaleRef.current }),
    })
    layer.render().then(
      () => {
        const end = document.createElement('div')
        end.className = 'endOfContent'
        container.append(end)
      },
      () => {},
    )

    return () => {
      layer.cancel()
      container.replaceChildren()
    }
  }, [page])

  const style = {
    width: `${size.w * scale}px`,
    height: `${size.h * scale}px`,
    '--total-scale-factor': scale,
  } as CSSProperties

  return (
    <div
      className={night ? 'page is-night' : 'page'}
      data-page={pageNumber}
      style={style}
      role="group"
      aria-label={t('viewer.pageLabel', { page: pageNumber })}
    >
      <div ref={paintRef} className="page-paint" aria-hidden="true" />
      <div
        ref={textRef}
        className="textLayer"
        onPointerDown={(e) => e.currentTarget.classList.add('selecting')}
        onPointerUp={(e) => e.currentTarget.classList.remove('selecting')}
        onPointerCancel={(e) => e.currentTarget.classList.remove('selecting')}
      />
    </div>
  )
})

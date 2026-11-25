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

/** A picture's box on the page, as fractions of its width and height. */
interface Box {
  x: number
  y: number
  w: number
  h: number
}

// Smaller than this (a bullet, a tiny icon) is left as it is.
const MIN_PICTURE_AREA = 0.002

/** pdf.js gives three corners of each drawn image, as fractions of the canvas. */
function picturesFrom(coords: ArrayLike<number> | null): Box[] {
  if (!coords) return []
  const boxes: Box[] = []
  for (let i = 0; i + 5 < coords.length; i += 6) {
    const [x0, y0, x1, y1, x2, y2] = Array.from({ length: 6 }, (_, k) => coords[i + k])
    const xs = [x0, x1, x2, x1 + x2 - x0]
    const ys = [y0, y1, y2, y1 + y2 - y0]
    const x = Math.max(0, Math.min(...xs))
    const y = Math.max(0, Math.min(...ys))
    const w = Math.min(1, Math.max(...xs)) - x
    const h = Math.min(1, Math.max(...ys)) - y
    if (w * h >= MIN_PICTURE_AREA) boxes.push({ x, y, w, h })
  }
  return boxes
}

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
  const [pictures, setPictures] = useState<Box[]>([])
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
        // Where the pictures are, so night mode can turn them back the right way round.
        task = page.render({ canvas, viewport, recordImages: true })
        await task.promise
        if (controller.signal.aborted) return
        paint.replaceChildren(canvas)
        setPictures(picturesFrom(task.imageCoordinates))
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
      {night &&
        page &&
        pictures.map((box, i) => (
          <div
            key={i}
            className="page-picture"
            aria-hidden="true"
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
            }}
          />
        ))}
      <div
        ref={textRef}
        className="textLayer"
        // Only a mouse drag needs the end-of-content guard; touch selection uses
        // the phone's own handles.
        onPointerDown={(e) => e.pointerType === 'mouse' && e.currentTarget.classList.add('selecting')}
        onPointerUp={(e) => e.currentTarget.classList.remove('selecting')}
        onPointerCancel={(e) => e.currentTarget.classList.remove('selecting')}
      />
    </div>
  )
})

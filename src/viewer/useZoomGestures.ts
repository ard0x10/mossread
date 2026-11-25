import { useEffect, useRef, type RefObject } from 'react'

export interface Point {
  x: number
  y: number
}

export interface ZoomTarget {
  // Element whose scroll position keeps the focal point in place.
  scroller: HTMLElement
  // Element scaled with a CSS transform while the fingers are still moving.
  visual: HTMLElement
  // Page under the focal point; its position after the zoom decides the scroll fix.
  anchor: HTMLElement
}

interface Options {
  surface: RefObject<HTMLElement | null>
  targetAt: (point: Point) => ZoomTarget | null
  getZoom: () => number
  clampZoom: (zoom: number) => number
  zoomTo: (zoom: number, focal: Point, target: ZoomTarget) => void
  onTap: () => void
}

const TAP_MAX_MS = 300
const TAP_SLOP_PX = 10
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP_PX = 30
const DOUBLE_TAP_ZOOM = 2

const distance = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
const midpoint = (a: Touch, b: Touch): Point => ({
  x: (a.clientX + b.clientX) / 2,
  y: (a.clientY + b.clientY) / 2,
})

// Pinch is previewed with a transform and committed once, when the fingers
// lift, so pages are laid out and redrawn one time per gesture.
export function useZoomGestures(options: Options) {
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  useEffect(() => {
    const surface = options.surface.current
    if (!surface) return

    let pinch: {
      startDistance: number
      focal: Point
      startZoom: number
      factor: number
      target: ZoomTarget
    } | null = null
    let tap: { point: Point; time: number } | null = null
    let lastTap: { point: Point; time: number } | null = null
    let singleTapTimer = 0

    const endPreview = (target: ZoomTarget) => {
      target.visual.style.transform = ''
      target.visual.style.transformOrigin = ''
    }

    const onTouchStart = (event: TouchEvent) => {
      const o = optionsRef.current
      if (event.touches.length === 2) {
        const [a, b] = [event.touches[0], event.touches[1]]
        const focal = midpoint(a, b)
        const target = o.targetAt(focal)
        tap = null
        if (!target) return
        const rect = target.visual.getBoundingClientRect()
        target.visual.style.transformOrigin = `${focal.x - rect.left}px ${focal.y - rect.top}px`
        pinch = { startDistance: distance(a, b), focal, startZoom: o.getZoom(), factor: 1, target }
        event.preventDefault()
      } else if (event.touches.length === 1) {
        const t = event.touches[0]
        tap = { point: { x: t.clientX, y: t.clientY }, time: performance.now() }
      } else {
        tap = null
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      if (pinch && event.touches.length === 2) {
        const o = optionsRef.current
        const zoom = o.clampZoom((pinch.startZoom * distance(event.touches[0], event.touches[1])) / pinch.startDistance)
        pinch.factor = zoom / pinch.startZoom
        pinch.target.visual.style.transform = `scale(${pinch.factor})`
        if (event.cancelable) event.preventDefault()
        return
      }
      if (tap) {
        const t = event.touches[0]
        if (Math.hypot(t.clientX - tap.point.x, t.clientY - tap.point.y) > TAP_SLOP_PX) tap = null
      }
    }

    const handleTap = (point: Point) => {
      const o = optionsRef.current
      const now = performance.now()
      if (
        lastTap &&
        now - lastTap.time < DOUBLE_TAP_MS &&
        Math.hypot(point.x - lastTap.point.x, point.y - lastTap.point.y) < DOUBLE_TAP_SLOP_PX
      ) {
        window.clearTimeout(singleTapTimer)
        lastTap = null
        const target = o.targetAt(point)
        if (target) o.zoomTo(o.getZoom() < (1 + DOUBLE_TAP_ZOOM) / 2 ? DOUBLE_TAP_ZOOM : 1, point, target)
        return
      }
      lastTap = { point, time: now }
      // Wait to see whether a second tap follows before treating it as a single tap.
      singleTapTimer = window.setTimeout(() => {
        lastTap = null
        optionsRef.current.onTap()
      }, DOUBLE_TAP_MS)
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (pinch) {
        if (event.touches.length < 2) {
          const { target, factor, startZoom, focal } = pinch
          pinch = null
          endPreview(target)
          if (Math.abs(factor - 1) > 0.01) optionsRef.current.zoomTo(startZoom * factor, focal, target)
        }
        tap = null
        return
      }
      if (tap && event.touches.length === 0) {
        if (performance.now() - tap.time < TAP_MAX_MS) handleTap(tap.point)
        tap = null
      }
    }

    const onTouchCancel = () => {
      if (pinch) endPreview(pinch.target)
      pinch = null
      tap = null
    }

    // Trackpad pinch arrives as ctrl + wheel; so does ctrl + mouse wheel.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      const o = optionsRef.current
      const focal = { x: event.clientX, y: event.clientY }
      const target = o.targetAt(focal)
      if (target) o.zoomTo(o.getZoom() * Math.exp(-event.deltaY * 0.01), focal, target)
    }

    surface.addEventListener('touchstart', onTouchStart, { passive: false })
    surface.addEventListener('touchmove', onTouchMove, { passive: false })
    surface.addEventListener('touchend', onTouchEnd)
    surface.addEventListener('touchcancel', onTouchCancel)
    surface.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      window.clearTimeout(singleTapTimer)
      surface.removeEventListener('touchstart', onTouchStart)
      surface.removeEventListener('touchmove', onTouchMove)
      surface.removeEventListener('touchend', onTouchEnd)
      surface.removeEventListener('touchcancel', onTouchCancel)
      surface.removeEventListener('wheel', onWheel)
    }
  }, [options.surface])
}

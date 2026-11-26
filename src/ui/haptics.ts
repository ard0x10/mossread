// A very short buzz when a finger presses a button, on phones that can do it
// (Android; iPhones have no vibration for web pages). Nothing when the reader
// asked for less motion.

const BUZZ_MS = 8

export function startHaptics() {
  if (typeof navigator.vibrate !== 'function') return
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)')
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType !== 'touch' || calm.matches) return
      const button = (event.target as Element | null)?.closest?.('button')
      if (!button || button.disabled) return
      navigator.vibrate(BUZZ_MS)
    },
    { passive: true },
  )
}

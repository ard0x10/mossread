import { useCallback, useEffect, useState } from 'react'

/**
 * Whether the page fills the whole screen (no address bar, no status bar),
 * and a way to switch. `available` is false where browsers do not let a page
 * do this, as Safari on an iPhone.
 */
export function useFullscreen() {
  const available = typeof document !== 'undefined' && document.fullscreenEnabled === true
  const [active, setActive] = useState(() => available && document.fullscreenElement !== null)

  useEffect(() => {
    if (!available) return
    const onChange = () => setActive(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [available])

  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
  }, [])

  return { available, active, toggle }
}

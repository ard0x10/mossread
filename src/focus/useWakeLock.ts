import { useEffect } from 'react'

/**
 * Keeps the screen on while `active`. The browser drops the lock when the
 * tab is hidden, so it is asked for again on return. Where the API is
 * missing (older browsers, a page opened over plain http) nothing happens.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let stopped = false
    const request = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return
      try {
        const next = await navigator.wakeLock.request('screen')
        if (stopped) void next.release()
        else lock = next
      } catch {
        // Refused (battery saver, permissions): the screen may dim as usual.
      }
    }
    void request()
    const onVisibility = () => void request()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisibility)
      void lock?.release().catch(() => {})
    }
  }, [active])
}

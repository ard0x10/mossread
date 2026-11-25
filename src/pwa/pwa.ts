import { useEffect, useState } from 'react'

// Offline support, installing, and PDFs shared to the app from other apps.

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let installPrompt: InstallPromptEvent | null = null
const installListeners = new Set<() => void>()

function notifyInstall() {
  for (const listener of installListeners) listener()
}

/** Called once before the app renders, so the browser's install offer is not missed. */
export function startPwa() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installPrompt = event as InstallPromptEvent
    notifyInstall()
  })
  window.addEventListener('appinstalled', () => {
    installPrompt = null
    notifyInstall()
  })

  // Service workers need https (or localhost); the dev server would also fight with one.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Without it the app still works, just not offline.
    })
  })
}

export function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** iPhone and iPad Safari, where installing goes through the Share menu. */
export function isAppleMobile(): boolean {
  const ua = navigator.userAgent
  const iPadAsMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return /iPhone|iPad|iPod/.test(ua) || iPadAsMac
}

export type InstallWay = 'prompt' | 'apple' | null

function readInstallWay(): InstallWay {
  if (isInstalled()) return null
  if (installPrompt) return 'prompt'
  return isAppleMobile() ? 'apple' : null
}

/** How this browser can install the app right now, if at all. */
export function useInstallWay(): InstallWay {
  const [way, setWay] = useState(readInstallWay)
  useEffect(() => {
    const update = () => setWay(readInstallWay())
    installListeners.add(update)
    update()
    return () => {
      installListeners.delete(update)
    }
  }, [])
  return way
}

export async function promptInstall(): Promise<void> {
  const event = installPrompt
  if (!event) return
  installPrompt = null
  await event.prompt()
  notifyInstall()
}

const HINT_KEY = 'mossread.installHint'

export function readHintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === 'dismissed'
  } catch {
    return false
  }
}

export function writeHintDismissed() {
  try {
    localStorage.setItem(HINT_KEY, 'dismissed')
  } catch {
    // Storage blocked: the line comes back next time, nothing else breaks.
  }
}

const SHARE_CACHE = 'mossread-share'
const SHARE_KEY = '/shared-file'

/**
 * A PDF shared from another app arrives through the service worker, which keeps
 * it on the device and opens the app at "/?shared". Returns it once, then forgets it.
 */
export async function takeSharedFile(): Promise<File | null> {
  const params = new URLSearchParams(location.search)
  if (!params.has('shared')) return null
  params.delete('shared')
  const query = params.toString()
  history.replaceState(history.state, '', location.pathname + (query ? `?${query}` : '') + location.hash)
  if (!('caches' in window)) return null
  try {
    const cache = await caches.open(SHARE_CACHE)
    const response = await cache.match(SHARE_KEY)
    if (!response) return null
    await cache.delete(SHARE_KEY)
    const name = decodeURIComponent(response.headers.get('X-File-Name') ?? '') || 'shared.pdf'
    return new File([await response.blob()], name, { type: 'application/pdf' })
  } catch {
    return null
  }
}

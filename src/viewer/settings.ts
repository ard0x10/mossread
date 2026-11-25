import { useCallback, useEffect, useState } from 'react'

export type PageFlow = 'scroll' | 'paged'
/** The PDF's own pages, or its text laid out for reading. */
export type ViewMode = 'page' | 'text'

export interface ViewerSettings {
  flow: PageFlow
  night: boolean
  mode: ViewMode
}

const STORAGE_KEY = 'mossread.viewer'

function prefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

// Night mode starts out matching the system theme; after the first change the
// reader's own choice wins.
function readSettings(): ViewerSettings {
  const defaults: ViewerSettings = { flow: 'scroll', night: prefersDark(), mode: 'page' }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const saved = JSON.parse(raw) as Partial<ViewerSettings>
    return {
      flow: saved.flow === 'paged' ? 'paged' : 'scroll',
      night: typeof saved.night === 'boolean' ? saved.night : defaults.night,
      mode: saved.mode === 'text' ? 'text' : 'page',
    }
  } catch {
    return defaults
  }
}

export function useViewerSettings(initialMode?: ViewMode) {
  const [settings, setSettings] = useState(() => {
    const saved = readSettings()
    return initialMode ? { ...saved, mode: initialMode } : saved
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Storage unavailable: settings last for this visit only.
    }
  }, [settings])

  const update = useCallback((patch: Partial<ViewerSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }))
  }, [])

  return [settings, update] as const
}

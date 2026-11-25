import { useCallback, useEffect, useRef, useState } from 'react'

export type PageFlow = 'scroll' | 'paged'
/** The PDF's own pages, or its text laid out for reading. */
export type ViewMode = 'page' | 'text'

export interface ViewerSettings {
  flow: PageFlow
  night: boolean
  mode: ViewMode
}

const STORAGE_KEY = 'mossread.viewer'
// Saved settings without this mark were written before night mode stopped
// following the system theme, often without the reader choosing anything, so
// their night value is not trusted.
const VERSION = 2

// Pages start in their own colours; night mode is the reader's choice.
function readSettings(): ViewerSettings {
  const defaults: ViewerSettings = { flow: 'scroll', night: false, mode: 'page' }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const saved = JSON.parse(raw) as Partial<ViewerSettings> & { v?: number }
    return {
      flow: saved.flow === 'paged' ? 'paged' : 'scroll',
      night: saved.v === VERSION && typeof saved.night === 'boolean' ? saved.night : defaults.night,
      mode: saved.mode === 'text' ? 'text' : 'page',
    }
  } catch {
    return defaults
  }
}

function writeSettings(settings: ViewerSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, v: VERSION }))
  } catch {
    // Storage unavailable: settings last for this visit only.
  }
}

export function useViewerSettings(initialMode?: ViewMode) {
  const [settings, setSettings] = useState(() => {
    const saved = readSettings()
    return initialMode ? { ...saved, mode: initialMode } : saved
  })

  // Saved only when the reader changes something, so a default never gets
  // stored and later mistaken for a choice.
  const changed = useRef(false)
  useEffect(() => {
    if (changed.current) writeSettings(settings)
  }, [settings])

  const update = useCallback((patch: Partial<ViewerSettings>) => {
    changed.current = true
    setSettings((prev) => ({ ...prev, ...patch }))
  }, [])

  return [settings, update] as const
}

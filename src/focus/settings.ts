import { useCallback, useEffect, useState } from 'react'

export type LineAdvance = 'tap' | 'auto'

export interface FocusSettings {
  /** Words per minute, before the pauses at punctuation. */
  wpm: number
  /** Words shown at once in focus mode. */
  size: number
  /** Lines left lit in line focus: the one being read, or it and its neighbours. */
  lines: 1 | 3
  lineAdvance: LineAdvance
}

export const MIN_WPM = 100
export const MAX_WPM = 1000
export const WPM_STEP = 25
export const SIZES = [1, 2, 3, 4, 5] as const

const STORAGE_KEY = 'mossread.focus'

const DEFAULTS: FocusSettings = { wpm: 250, size: 1, lines: 1, lineAdvance: 'tap' }

function readSettings(): FocusSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const saved = JSON.parse(raw) as Partial<Record<keyof FocusSettings, unknown>>
    const wpm = typeof saved.wpm === 'number' && Number.isFinite(saved.wpm) ? saved.wpm : DEFAULTS.wpm
    return {
      wpm: Math.min(MAX_WPM, Math.max(MIN_WPM, Math.round(wpm / WPM_STEP) * WPM_STEP)),
      size: SIZES.includes(saved.size as 1) ? (saved.size as number) : DEFAULTS.size,
      lines: saved.lines === 3 ? 3 : 1,
      lineAdvance: saved.lineAdvance === 'auto' ? 'auto' : 'tap',
    }
  } catch {
    return DEFAULTS
  }
}

export function useFocusSettings() {
  const [settings, setSettings] = useState(readSettings)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Storage unavailable: settings last for this visit only.
    }
  }, [settings])

  const update = useCallback((patch: Partial<FocusSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }))
  }, [])

  return [settings, update] as const
}

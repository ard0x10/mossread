import { useCallback, useEffect, useState } from 'react'

export type ReadingFont = 'system' | 'literata' | 'atkinson'
export type ReadingTheme = 'light' | 'sepia' | 'dark' | 'black' | 'custom'
export type ColumnWidth = 'narrow' | 'medium' | 'wide'
export type Margin = 'small' | 'medium' | 'large'
export type Alignment = 'start' | 'justify'

export interface ReflowSettings {
  font: ReadingFont
  /** Text size in CSS pixels. */
  size: number
  lineHeight: number
  width: ColumnWidth
  margin: Margin
  align: Alignment
  theme: ReadingTheme
  customBackground: string
  customText: string
  cleanup: boolean
}

export const SIZES = [14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 28, 32]
export const LINE_HEIGHTS = [1.3, 1.45, 1.6, 1.75, 1.9, 2.1]

const FONTS: readonly ReadingFont[] = ['system', 'literata', 'atkinson']
const THEMES: readonly ReadingTheme[] = ['light', 'sepia', 'dark', 'black', 'custom']
const WIDTHS: readonly ColumnWidth[] = ['narrow', 'medium', 'wide']
const MARGINS: readonly Margin[] = ['small', 'medium', 'large']
const HEX = /^#[0-9a-f]{6}$/i

const STORAGE_KEY = 'mossread.reflow'

function prefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function defaults(): ReflowSettings {
  return {
    font: 'system',
    size: 18,
    lineHeight: 1.6,
    width: 'medium',
    margin: 'medium',
    align: 'start',
    theme: prefersDark() ? 'dark' : 'light',
    customBackground: '#f6f1e7',
    customText: '#2b2b2b',
    cleanup: true,
  }
}

// The theme starts out matching the system; after the first change the
// reader's own choice wins. Anything unreadable in storage falls back.
function readSettings(): ReflowSettings {
  const base = defaults()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return base
    const saved = JSON.parse(raw) as Partial<Record<keyof ReflowSettings, unknown>>
    return {
      font: pick(saved.font, FONTS, base.font),
      size: pick(saved.size, SIZES, base.size),
      lineHeight: pick(saved.lineHeight, LINE_HEIGHTS, base.lineHeight),
      width: pick(saved.width, WIDTHS, base.width),
      margin: pick(saved.margin, MARGINS, base.margin),
      align: saved.align === 'justify' ? 'justify' : 'start',
      theme: pick(saved.theme, THEMES, base.theme),
      customBackground:
        typeof saved.customBackground === 'string' && HEX.test(saved.customBackground)
          ? saved.customBackground
          : base.customBackground,
      customText:
        typeof saved.customText === 'string' && HEX.test(saved.customText) ? saved.customText : base.customText,
      cleanup: typeof saved.cleanup === 'boolean' ? saved.cleanup : base.cleanup,
    }
  } catch {
    return base
  }
}

export function useReflowSettings() {
  const [settings, setSettings] = useState(readSettings)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Storage unavailable: settings last for this visit only.
    }
  }, [settings])

  const update = useCallback((patch: Partial<ReflowSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }))
  }, [])

  return [settings, update] as const
}

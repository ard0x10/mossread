// Small drawings that show what a setting does, for the settings sheets.
// Drawn on a 48 by 32 grid in the text colour of their button.

import type { ReactNode } from 'react'

function Drawing({ children }: { children: ReactNode }) {
  return (
    <svg
      className="drawing"
      width="48"
      height="32"
      viewBox="0 0 48 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

const Page = () => <rect x="5" y="2" width="38" height="28" rx="3" strokeWidth="1.5" opacity="0.45" />

function lines(rows: Array<[number, number]>, top = 8, gap = 5) {
  return rows.map(([x1, x2], k) => <path key={k} d={`M${x1} ${top + k * gap}H${x2}`} />)
}

/** Text column of three widths on the same page. */
export function WidthDrawing({ size }: { size: 'narrow' | 'medium' | 'wide' }) {
  const half = { narrow: 6, medium: 10, wide: 14 }[size]
  const full: [number, number] = [24 - half, 24 + half]
  return (
    <Drawing>
      <Page />
      {lines([full, full, full, [24 - half, 24 + half * 0.4]])}
    </Drawing>
  )
}

/** Shaded margins of three sizes, text between them. */
export function MarginDrawing({ size }: { size: 'small' | 'medium' | 'large' }) {
  const inset = { small: 3, medium: 6, large: 9 }[size]
  const from = 5 + inset + 3
  const to = 43 - inset - 3
  return (
    <Drawing>
      <Page />
      <rect x="5" y="2" width={inset} height="28" rx="2" fill="currentColor" stroke="none" opacity="0.18" />
      <rect x={43 - inset} y="2" width={inset} height="28" rx="2" fill="currentColor" stroke="none" opacity="0.18" />
      {lines([[from, to], [from, to], [from, to], [from, from + (to - from) * 0.6]])}
    </Drawing>
  )
}

/** Lines with a ragged right edge, or all of one length. */
export function AlignDrawing({ align }: { align: 'start' | 'justify' }) {
  const rows: Array<[number, number]> =
    align === 'start'
      ? [[11, 37], [11, 31], [11, 35], [11, 25]]
      : [[11, 37], [11, 37], [11, 37], [11, 25]]
  return (
    <Drawing>
      <Page />
      {lines(rows)}
    </Drawing>
  )
}

/** Pages one under the other, or one at a time side by side. */
export function FlowDrawing({ flow }: { flow: 'scroll' | 'paged' }) {
  return flow === 'scroll' ? (
    <Drawing>
      <rect x="14" y="1" width="20" height="13" rx="2" strokeWidth="1.5" />
      <rect x="14" y="17" width="20" height="13" rx="2" strokeWidth="1.5" opacity="0.5" />
      <path d="M40 10v13m-3-3 3 3 3-3" strokeWidth="1.5" />
    </Drawing>
  ) : (
    <Drawing>
      <rect x="15" y="3" width="18" height="26" rx="2" strokeWidth="1.5" />
      <path d="M8 16H2m3-3-3 3 3 3M40 16h6m-3-3 3 3-3 3" strokeWidth="1.5" />
    </Drawing>
  )
}

/** Blocks for the words shown at once. */
export function WordsDrawing({ count }: { count: number }) {
  const width = 6
  const gap = 2
  const total = count * width + (count - 1) * gap
  const start = 24 - total / 2
  return (
    <Drawing>
      {Array.from({ length: count }, (_, k) => (
        <rect key={k} x={start + k * (width + gap)} y="12" width={width} height="8" rx="1.5" fill="currentColor" stroke="none" />
      ))}
    </Drawing>
  )
}

/** The word in the middle, with faded words on each side. */
export function NeighboursDrawing({ count }: { count: number }) {
  const side = (k: number, direction: 1 | -1) => {
    const x = direction > 0 ? 31 + k * 7 : 11 - k * 7
    return <rect key={`${direction}${k}`} x={x} y="13" width="6" height="6" rx="1.5" fill="currentColor" stroke="none" opacity="0.35" />
  }
  return (
    <Drawing>
      <rect x="18" y="11" width="12" height="10" rx="2" fill="currentColor" stroke="none" />
      {Array.from({ length: count }, (_, k) => [side(k, -1), side(k, 1)])}
    </Drawing>
  )
}

/** Three lines with the middle one lit, whole or a few words of it. */
export function GuideDrawing({ guide }: { guide: 'line' | 'words' }) {
  return (
    <Drawing>
      <path d="M8 8H40M8 24H34" opacity="0.3" />
      {guide === 'line' ? (
        <rect x="5" y="12" width="38" height="8" rx="2.5" fill="currentColor" stroke="none" opacity="0.25" />
      ) : (
        <rect x="16" y="12" width="13" height="8" rx="2.5" fill="currentColor" stroke="none" opacity="0.35" />
      )}
      <path d="M8 16H40" />
    </Drawing>
  )
}

/** Five lines, one or three of them lit. */
export function LinesDrawing({ count }: { count: 1 | 3 }) {
  const lit = (k: number) => (count === 1 ? k === 2 : k >= 1 && k <= 3)
  return (
    <Drawing>
      {[0, 1, 2, 3, 4].map((k) => (
        <path key={k} d={`M8 ${4 + k * 6}H40`} opacity={lit(k) ? 1 : 0.25} />
      ))}
    </Drawing>
  )
}

/** A finger tapping, or lines moving on by themselves. */
export function AdvanceDrawing({ advance }: { advance: 'tap' | 'auto' }) {
  return advance === 'tap' ? (
    <Drawing>
      <rect x="15" y="2" width="18" height="28" rx="3" strokeWidth="1.5" opacity="0.45" />
      <circle cx="24" cy="17" r="3" fill="currentColor" stroke="none" />
      <circle cx="24" cy="17" r="7" strokeWidth="1.5" opacity="0.4" />
    </Drawing>
  ) : (
    <Drawing>
      <path d="M17 9v14l12-7z" fill="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M33 11h6M33 16h8M33 21h6" strokeWidth="1.5" opacity="0.5" />
    </Drawing>
  )
}

// End marks for sliders, 20 by 20.

function Mark({ children }: { children: ReactNode }) {
  return (
    <svg
      className="slider-mark"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export const SmallTextMark = () => (
  <Mark>
    <path d="M6.5 14 10 6l3.5 8M7.8 11.2h4.4" strokeWidth="1.5" />
  </Mark>
)
export const LargeTextMark = () => (
  <Mark>
    <path d="M3.5 18 10 2.5 16.5 18M5.8 12.8h8.4" strokeWidth="2" />
  </Mark>
)
export const TightLinesMark = () => (
  <Mark>
    <path d="M4 7h12M4 10h12M4 13h12" />
  </Mark>
)
export const LooseLinesMark = () => (
  <Mark>
    <path d="M4 3.5h12M4 10h12M4 16.5h12" />
  </Mark>
)
export const SlowMark = () => (
  <Mark>
    <path d="m8 5 5 5-5 5" />
  </Mark>
)
export const FastMark = () => (
  <Mark>
    <path d="m2.5 5 5 5-5 5M8.5 5l5 5-5 5M14.5 5l3 5-3 5" />
  </Mark>
)
export const ZoomOutMark = () => (
  <Mark>
    <circle cx="8.5" cy="8.5" r="5.5" />
    <path d="m13 13 4.5 4.5M6 8.5h5" />
  </Mark>
)
export const ZoomInMark = () => (
  <Mark>
    <circle cx="8.5" cy="8.5" r="5.5" />
    <path d="m13 13 4.5 4.5M6 8.5h5M8.5 6v5" />
  </Mark>
)

// Group icons, 20 by 20.

export const TextGroupIcon = () => (
  <Mark>
    <path d="M4 5V3.5h12V5M10 3.5v13M7.5 16.5h5" />
  </Mark>
)
export const ColourGroupIcon = () => (
  <Mark>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 3a7 7 0 0 0 0 14z" fill="currentColor" />
  </Mark>
)
export const LayoutGroupIcon = () => (
  <Mark>
    <rect x="3.5" y="2.5" width="13" height="15" rx="2" />
    <path d="M7 7h6M7 10h6M7 13h4" />
  </Mark>
)
export const CleanupGroupIcon = () => (
  <Mark>
    <path d="M10 2.5v3M10 14.5v3M2.5 10h3M14.5 10h3M5 5l1.8 1.8M13.2 13.2 15 15M15 5l-1.8 1.8M6.8 13.2 5 15" />
  </Mark>
)
export const PagesGroupIcon = () => (
  <Mark>
    <rect x="5.5" y="2.5" width="11" height="14" rx="1.5" />
    <path d="M3.5 5.5v11a1.5 1.5 0 0 0 1.5 1.5h8" />
  </Mark>
)
export const ReadGroupIcon = () => (
  <Mark>
    <path d="M10 5.5c-2-1.6-4.5-2-7-1.5v11.5c2.5-.5 5 0 7 1.5 2-1.5 4.5-2 7-1.5V4c-2.5-.5-5-.1-7 1.5zM10 5.5v11.5" />
  </Mark>
)
export const ShowGroupIcon = () => (
  <Mark>
    <path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6z" />
    <circle cx="10" cy="10" r="2.5" />
  </Mark>
)
export const PaceGroupIcon = () => (
  <Mark>
    <path d="M3 14.5a7.5 7.5 0 1 1 14 0" />
    <path d="m10 11 3.5-4" />
  </Mark>
)
export const MoonMark = () => (
  <Mark>
    <path d="M16.5 12.5A7 7 0 0 1 7.5 3.5a7 7 0 1 0 9 9z" />
  </Mark>
)

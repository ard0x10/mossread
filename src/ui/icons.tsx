// Small line icons drawn for Mossread. They take the text colour of their button.

const common = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  'aria-hidden': true,
  focusable: false,
}

/** A house: back to the home screen and the library. */
export function HomeIcon() {
  return (
    <svg {...common} strokeLinejoin="round">
      <path d="M3.5 11 12 4l8.5 7" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-5.5h4V20" />
    </svg>
  )
}

/** A list with bullets: the table of contents. */
export function ContentsIcon() {
  return (
    <svg {...common}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Two sliders: reading settings. */
export function SettingsIcon() {
  return (
    <svg {...common}>
      <path d="M4 7h8.5M17.5 7H20M4 17h2.5M11.5 17H20" />
      <circle cx="15" cy="7" r="2.5" />
      <circle cx="9" cy="17" r="2.5" />
    </svg>
  )
}

/** A page with a plus: open a PDF. */
export function OpenFileIcon() {
  return (
    <svg {...common} strokeLinejoin="round">
      <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" />
      <path d="M14 3v5h5M12 11v6M9 14h6" />
    </svg>
  )
}

/** An arrow into a tray: install the app. */
export function DownloadIcon() {
  return (
    <svg {...common} strokeLinejoin="round">
      <path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M4.5 16v2.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V16" />
    </svg>
  )
}

/** An open padlock: unlock a protected PDF. */
export function UnlockIcon() {
  return (
    <svg {...common} strokeLinejoin="round">
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8.5 10.5V7a3.5 3.5 0 0 1 6.8-1.2M12 14.5v2.5" />
    </svg>
  )
}

/** A cross: close or cancel. */
export function CloseIcon() {
  return (
    <svg {...common}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

/** A bin: delete. */
export function TrashIcon() {
  return (
    <svg {...common} strokeLinejoin="round">
      <path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10.5 11v5.5M13.5 11v5.5" />
    </svg>
  )
}

/** A page as printed: the page view. */
export function PageIcon() {
  return (
    <svg {...common} strokeLinejoin="round">
      <rect x="5.5" y="3" width="13" height="18" rx="1.5" />
      <path d="M8.5 7.5h7M8.5 11h7M8.5 14.5h4" opacity="0.55" />
    </svg>
  )
}

/** Lines of flowing text: the text view. */
export function TextIcon() {
  return (
    <svg {...common}>
      <path d="M4 6h16M4 10h16M4 14h16M4 18h10" />
    </svg>
  )
}

/** A dot in a ring with marks: focus mode, one word in the middle. */
export function FocusIcon() {
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    </svg>
  )
}

/** One lit line between faded ones: line focus. */
export function LineIcon() {
  return (
    <svg {...common}>
      <path d="M5 4.5h14M5 19.5h14" opacity="0.4" />
      <rect x="2.5" y="8.5" width="19" height="7" rx="2" strokeWidth="1.5" />
      <path d="M6 12h12" />
    </svg>
  )
}

export function ArrowRightIcon() {
  return (
    <svg {...common} strokeLinejoin="round">
      <path d="M5 12h14m-5.5-5.5L19 12l-5.5 5.5" />
    </svg>
  )
}

export function ArrowUpIcon() {
  return (
    <svg {...common} strokeLinejoin="round">
      <path d="M12 19V5m-5.5 5.5L12 5l5.5 5.5" />
    </svg>
  )
}

export function ArrowDownIcon() {
  return (
    <svg {...common} strokeLinejoin="round">
      <path d="M12 5v14m-5.5-5.5L12 19l5.5-5.5" />
    </svg>
  )
}

export function PlayIcon() {
  return (
    <svg {...common} strokeLinejoin="round">
      <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
    </svg>
  )
}

export function PauseIcon() {
  return (
    <svg {...common}>
      <rect x="6.5" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5.5" width="3.5" height="13" rx="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Back to the start of the sentence. */
export function SentenceBackIcon() {
  return (
    <svg {...common} strokeLinejoin="round">
      <path d="M6 5.5v13M18 6v12l-9-6z" />
    </svg>
  )
}

/** A circular arrow: read again. */
export function ReplayIcon() {
  return (
    <svg {...common} strokeLinejoin="round">
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4" />
    </svg>
  )
}

/** A clock face: time left. */
export function ClockIcon() {
  return (
    <svg {...common} width={16} height={16}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  )
}

/** A picture: a figure in the text. */
export function ImageIcon() {
  return (
    <svg {...common} strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4 17.5 5-4.5 3.5 3 3-2.5 4.5 4" />
    </svg>
  )
}

/** Angle brackets: code in the text. */
export function CodeIcon() {
  return (
    <svg {...common} strokeLinejoin="round">
      <path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5" />
    </svg>
  )
}

/** A frame being scanned: recognise the text of a scan. */
export function ScanIcon() {
  return (
    <svg {...common} strokeLinejoin="round">
      <path d="M4 8.5V5.5A1.5 1.5 0 0 1 5.5 4h3M15.5 4h3A1.5 1.5 0 0 1 20 5.5v3M20 15.5v3a1.5 1.5 0 0 1-1.5 1.5h-3M8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3" />
      <path d="M8 9.5h8M8 12h8M8 14.5h5" />
    </svg>
  )
}

/** Two arrowheads: skip ahead. */
export function SkipIcon() {
  return (
    <svg {...common} strokeLinejoin="round">
      <path d="M4.5 6.5v11l7-5.5zM12.5 6.5v11l7-5.5z" fill="currentColor" />
    </svg>
  )
}

/** Four corners pointing out: full screen. */
export function FullscreenIcon() {
  return (
    <svg {...common} strokeLinejoin="round">
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    </svg>
  )
}

/** Four corners pointing in: leave full screen. */
export function ExitFullscreenIcon() {
  return (
    <svg {...common} strokeLinejoin="round">
      <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" />
    </svg>
  )
}

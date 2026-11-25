import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { TextStore } from '../text/store'
import type { FocusSettings } from './settings'
import { spotOf, WordStream, type Scope, type Spot } from './stream'
import { useWakeLock } from './useWakeLock'
import {
  chunkDuration,
  chunkEnd,
  pivotIndex,
  rampFactor,
  rewindSentence,
  sentenceEnd,
  sentenceStart,
  skipTime,
  timeBetween,
  type Token,
} from './words'
import './focus.css'

interface FocusReaderProps {
  store: TextStore
  cleanup: boolean
  scope: Scope
  scopeLabel: string
  /** CSS font stack of the reading text. */
  font: string
  settings: FocusSettings
  /** The options sheet is open over this screen; reading waits. */
  paused: boolean
  onOptions: () => void
  /** Called with the spot of the last word shown, to go back there. */
  onClose: (at: Spot | null) => void
  /** Where the reader is, for the library. */
  onSpot: (at: Spot) => void
}

// Words kept ready ahead of the reader; more pages are read as this runs low.
const AHEAD = 600
const SKIP_MS = 10000
// The sentence shown while paused is cut down to this many words around the current one.
const CONTEXT_WORDS = 60
const SWIPE = 40

function textOf(tokens: readonly Token[], from: number, to: number): string {
  const words: string[] = []
  for (let k = from; k < to; k++) {
    const token = tokens[k]
    if (token.kind === 'word') words.push(token.text)
  }
  return words.join(' ')
}

export function FocusReader({
  store,
  cleanup,
  scope,
  scopeLabel,
  font,
  settings,
  paused,
  onOptions,
  onClose,
  onSpot,
}: FocusReaderProps) {
  const { t } = useTranslation()
  const stream = useMemo(() => new WordStream(store, cleanup, scope), [store, cleanup, scope])
  const [, setVersion] = useState(0)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [ended, setEnded] = useState(false)
  // Groups shown since the last start or resume, for the slow start.
  const shown = useRef(0)
  const { wpm, size } = settings
  const tokens = stream.tokens

  useWakeLock(playing && !paused)

  // Keeps words ready ahead of the reader, waiting for pages as needed.
  const indexRef = useRef(0)
  useEffect(() => {
    indexRef.current = index
  })
  useEffect(() => {
    const fill = () => {
      if (stream.done) return
      const before = stream.tokens.length
      stream.fill(indexRef.current + AHEAD)
      if (stream.tokens.length !== before || stream.done) setVersion((v) => v + 1)
    }
    fill()
    return store.subscribe(fill)
  }, [store, stream])

  useEffect(() => {
    if (index + AHEAD / 2 > tokens.length && !stream.done) {
      stream.fill(index + AHEAD)
      setVersion((v) => v + 1)
    }
  }, [index, tokens.length, stream])

  const waiting = !stream.done && index >= tokens.length
  const empty = stream.done && tokens.length === 0

  useEffect(() => {
    if (!playing || paused || ended || index >= tokens.length) return
    const end = chunkEnd(tokens, index, size)
    // A group cut short by the end of what is ready waits for the rest.
    if (end >= tokens.length && !stream.done) return
    const ms = chunkDuration(tokens, index, end, wpm) * rampFactor(shown.current)
    const timer = setTimeout(() => {
      shown.current++
      if (end >= tokens.length) {
        setPlaying(false)
        setEnded(true)
      } else {
        setIndex(end)
      }
    }, ms)
    return () => clearTimeout(timer)
    // tokens.length: more words arrived while the reader was waiting at the end of them.
  }, [playing, paused, ended, index, tokens, tokens.length, size, wpm, stream])

  const current = tokens[Math.min(index, tokens.length - 1)] as Token | undefined
  useEffect(() => {
    if (current) onSpot(spotOf(current.at))
  }, [current, onSpot])

  const toggle = useCallback(() => {
    shown.current = 0
    if (ended) {
      setEnded(false)
      setIndex(0)
      setPlaying(true)
      return
    }
    setPlaying((value) => !value)
  }, [ended])

  const back = useCallback(() => {
    setEnded(false)
    shown.current = 0
    setIndex((i) => rewindSentence(stream.tokens, Math.min(i, stream.tokens.length - 1), 0))
  }, [stream])

  const skip = useCallback(() => {
    setIndex((i) => Math.min(skipTime(stream.tokens, i, SKIP_MS, size, wpm), Math.max(0, stream.tokens.length - 1)))
  }, [stream, size, wpm])

  const close = useCallback(() => {
    onClose(current ? spotOf(current.at) : null)
  }, [current, onClose])

  // The screen takes the keyboard when it opens, so the viewer button that opened it
  // (still focused underneath) does not get the next key press.
  const screenRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    screenRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (paused || event.altKey || event.ctrlKey || event.metaKey) return
      const onButton = (event.target as Element | null)?.closest?.('button')
      // Space always plays or pauses, as in a media player, even when a button was
      // clicked last and still has focus. Enter is left to a focused button.
      if (event.key === ' ' || (event.key === 'Enter' && !onButton)) {
        event.preventDefault()
        if (!event.repeat) toggle()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        back()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        skip()
      }
    }
    // A focused button acts on Space when the key comes up, not when it goes down.
    const onKeyUp = (event: KeyboardEvent) => {
      if (!paused && event.key === ' ') event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [paused, toggle, back, skip])

  // A tap pauses or resumes; a swipe to the left goes back a sentence.
  const press = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = (event: PointerEvent) => {
    if ((event.target as Element).closest('button')) return
    press.current = { x: event.clientX, y: event.clientY }
  }
  const onPointerUp = (event: PointerEvent) => {
    const start = press.current
    press.current = null
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (dx < -SWIPE && Math.abs(dx) > Math.abs(dy)) back()
    else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) toggle()
  }

  // The group on screen, split around the letter the eye rests on.
  const end = current ? Math.max(chunkEnd(tokens, index, size), index + 1) : index
  const card = current?.kind === 'card' ? current : null
  const shownText = current && !card ? textOf(tokens, index, end) : ''
  const pivot = pivotIndex(shownText, end - index > 1)

  // A long word is drawn smaller rather than past the edges.
  const wordRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const word = wordRef.current
    if (!word) return
    word.style.setProperty('--fit', '1')
    const half = word.clientWidth / 2
    let widest = 0
    for (const part of word.querySelectorAll<HTMLElement>('.focus-before, .focus-after'))
      widest = Math.max(widest, part.scrollWidth)
    const pivotWidth = word.querySelector<HTMLElement>('.focus-pivot')?.offsetWidth ?? 0
    const room = half - pivotWidth / 2
    if (widest > room && room > 0) word.style.setProperty('--fit', String(Math.max(0.4, room / widest)))
  }, [shownText])

  const showChrome = !playing || ended || waiting || empty

  // Worked out on each render: the token list grows in place, and both are cheap.
  let context: { before: string; here: string; after: string } | null = null
  if (showChrome && current && !card) {
    const from = Math.max(sentenceStart(tokens, index, 0), index - CONTEXT_WORDS / 2)
    const to = Math.min(sentenceEnd(tokens, index), index + CONTEXT_WORDS / 2)
    context = { before: textOf(tokens, from, index), here: shownText, after: textOf(tokens, end, Math.max(end, to)) }
  }

  // Progress: exact once every word of the scope is in; until then, estimated from the pages read.
  const sample = Math.min(tokens.length, 2000)
  const msPerToken = sample > 0 ? timeBetween(tokens, 0, sample, size, wpm) / sample : 60000 / wpm
  const estimatedTotal = stream.done
    ? tokens.length
    : tokens.length / Math.max(stream.pagesRead, 1 / (stream.last - stream.first + 1))
  const progress = estimatedTotal > 0 ? Math.min(1, index / estimatedTotal) : 0
  const minutesLeft = Math.ceil((Math.max(0, estimatedTotal - index) * msPerToken) / 60000)

  return (
    <div
      ref={screenRef}
      tabIndex={-1}
      className={`focus-screen${showChrome ? '' : ' is-reading'}`}
      style={{ '--reading-font': font } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (press.current = null)}
    >
      <header className="focus-bar focus-topbar">
        <button type="button" className="button-quiet" onClick={close}>
          {t('focus.done')}
        </button>
        <p className="focus-scope">{scopeLabel}</p>
        <button type="button" className="button-quiet" onClick={onOptions}>
          {t('focus.options')}
        </button>
      </header>

      <div className="focus-stage" aria-live="off">
        {empty ? (
          <p className="focus-notice">{t('focus.empty')}</p>
        ) : waiting || !current ? (
          <p className="focus-notice">
            {t('reflow.reading', {
              page: Math.min(
                stream.last,
                stream.first + Math.floor(stream.pagesRead * (stream.last - stream.first + 1)),
              ),
            })}
          </p>
        ) : card ? (
          <p className="focus-card">
            {card.label === 'code'
              ? t('focus.code', { page: card.at.page })
              : t('reflow.figure', { page: card.at.page })}
          </p>
        ) : (
          <div ref={wordRef} className="focus-word">
            <span className="focus-before">{shownText.slice(0, pivot)}</span>
            <span className="focus-pivot">{shownText[pivot]}</span>
            <span className="focus-after">{shownText.slice(pivot + 1)}</span>
          </div>
        )}
        {context && (
          <p className="focus-context">
            {context.before} <mark>{context.here}</mark> {context.after}
          </p>
        )}
        {ended && <p className="focus-end">{t('focus.end')}</p>}
      </div>

      <footer className="focus-bar focus-bottombar">
        <div
          className="focus-progress"
          role="progressbar"
          aria-label={t('focus.progress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <span style={{ inlineSize: `${progress * 100}%` }} />
        </div>
        <p className="focus-left">
          {minutesLeft <= 1
            ? t('focus.underMinute')
            : minutesLeft < 60
              ? t('focus.minutesLeft', { count: minutesLeft })
              : t('focus.hoursLeft', { hours: Math.floor(minutesLeft / 60), minutes: minutesLeft % 60 })}
        </p>
        <div className="focus-controls">
          <button type="button" className="focus-button" aria-label={t('focus.backLabel')} onClick={back}>
            {t('focus.back')}
          </button>
          <button type="button" className="focus-button is-main" onClick={toggle} disabled={empty}>
            {ended ? t('focus.again') : playing ? t('focus.pause') : t('focus.play')}
          </button>
          <button type="button" className="focus-button" aria-label={t('focus.skipLabel')} onClick={skip}>
            {t('focus.skip')}
          </button>
        </div>
      </footer>
    </div>
  )
}

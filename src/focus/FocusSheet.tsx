import { useEffect, useId, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { loadOutline, type OutlineEntry } from '../pdf/outline'
import type { PDFDocumentProxy } from '../pdf/pdfjs'
import { Sheet } from '../viewer/Sheet'
import { MAX_WPM, MIN_WPM, NEIGHBOURS, SIZES, WPM_STEP, type FocusSettings } from './settings'
import type { Scope } from './stream'

export type FocusKind = 'focus' | 'line'

interface FocusSheetProps {
  open: boolean
  kind: FocusKind
  doc: PDFDocumentProxy
  scope: Scope
  /** Page the reader is on now. */
  page: number
  settings: FocusSettings
  onChange: (patch: Partial<FocusSettings>) => void
  /** A new scope to read; "here" means from where the reader is now. */
  onScope: (scope: Scope | 'here') => void
  onClose: () => void
}

/** Pages of an outline entry: up to the next entry at the same level or above. */
function chapterPages(entries: readonly OutlineEntry[], index: number, total: number): [number, number] | null {
  const entry = entries[index]
  if (entry.page === null) return null
  for (let k = index + 1; k < entries.length; k++) {
    const next = entries[k]
    if (next.depth <= entry.depth && next.page !== null) return [entry.page, Math.max(entry.page, next.page - 1)]
  }
  return [entry.page, total]
}

export function FocusSheet({ open, kind, doc, scope, page, settings, onChange, onScope, onClose }: FocusSheetProps) {
  const { t } = useTranslation()
  const total = doc.numPages
  const [entries, setEntries] = useState<OutlineEntry[] | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const fromId = useId()
  const toId = useId()

  useEffect(() => {
    if (!open || entries) return
    let cancelled = false
    loadOutline(doc).then(
      (loaded) => !cancelled && setEntries(loaded),
      () => !cancelled && setEntries([]),
    )
    return () => {
      cancelled = true
    }
  }, [open, entries, doc])

  const clampPage = (value: string) => Math.min(Math.max(Number.parseInt(value, 10) || 1, 1), total)
  const isPages = (a: number, b: number) => scope.kind === 'pages' && scope.from === a && scope.to === b && !scope.title
  const guided = kind === 'line' && settings.lineGuide === 'words'
  const showSpeed = kind === 'focus' || guided || settings.lineAdvance === 'auto'

  return (
    <Sheet open={open} title={t('focus.optionsTitle')} onClose={onClose}>
      <div className="settings">
        <section className="setting" aria-labelledby="focus-scope">
          <h3 id="focus-scope" className="setting-name">
            {t('focus.read')}
          </h3>
          <div className="scope-list">
            {scope.kind === 'selection' && (
              <button type="button" className="scope-option" aria-pressed="true" onClick={onClose}>
                {t('focus.scopeSelection')}
              </button>
            )}
            <button
              type="button"
              className="scope-option"
              aria-pressed={scope.kind === 'here'}
              onClick={() => onScope('here')}
            >
              {t('focus.scopeHere')}
            </button>
            <button
              type="button"
              className="scope-option"
              aria-pressed={isPages(page, page)}
              onClick={() => onScope({ kind: 'pages', from: page, to: page })}
            >
              {t('focus.scopePage', { page })}
            </button>
          </div>
          <form
            className="scope-range"
            onSubmit={(event) => {
              event.preventDefault()
              const a = clampPage(from)
              const b = Math.max(a, clampPage(to || from))
              onScope({ kind: 'pages', from: a, to: b })
            }}
          >
            <div className="scope-field">
              <label htmlFor={fromId} className="field-label">
                {t('focus.fromPage')}
              </label>
              <input
                id={fromId}
                className="field-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                placeholder={String(page)}
                value={from}
                onChange={(event) => setFrom(event.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="scope-field">
              <label htmlFor={toId} className="field-label">
                {t('focus.toPage')}
              </label>
              <input
                id={toId}
                className="field-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                placeholder={String(Math.min(total, page + 9))}
                value={to}
                onChange={(event) => setTo(event.target.value.replace(/\D/g, ''))}
              />
            </div>
            <button type="submit" className="button-primary" disabled={from === ''}>
              {t('focus.readPages')}
            </button>
          </form>
          {entries && entries.length > 0 && (
            <details className="scope-chapters">
              <summary>{t('focus.chapter')}</summary>
              <ol className="contents-list">
                {entries.map((entry, i) => {
                  const pages = chapterPages(entries, i, total)
                  const current = scope.kind === 'pages' && scope.title === entry.title && pages?.[0] === scope.from
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        className={current ? 'contents-item is-here' : 'contents-item'}
                        style={{ '--depth': entry.depth } as CSSProperties}
                        disabled={!pages}
                        onClick={() =>
                          pages && onScope({ kind: 'pages', from: pages[0], to: pages[1], title: entry.title })
                        }
                      >
                        <span className="contents-title">{entry.title}</span>
                        {entry.page !== null && (
                          <span className="contents-page">{t('contents.page', { page: entry.page })}</span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ol>
            </details>
          )}
        </section>

        {kind === 'line' && (
          <section className="setting" aria-labelledby="focus-guide">
            <h3 id="focus-guide" className="setting-name">
              {t('focus.guide')}
            </h3>
            <div className="segmented" role="group" aria-labelledby="focus-guide">
              {(['line', 'words'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className="segmented-option"
                  aria-pressed={settings.lineGuide === value}
                  onClick={() => onChange({ lineGuide: value })}
                >
                  {value === 'line' ? t('focus.guideLine') : t('focus.guideWords')}
                </button>
              ))}
            </div>
            <p className="setting-hint">{t('focus.guideHint')}</p>
          </section>
        )}

        {(kind === 'focus' || guided) && (
          <section className="setting" aria-labelledby="focus-size">
            <h3 id="focus-size" className="setting-name">
              {t('focus.size')}
            </h3>
            <div className="segmented is-five" role="group" aria-labelledby="focus-size">
              {SIZES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="segmented-option"
                  aria-pressed={settings.size === value}
                  onClick={() => onChange({ size: value })}
                >
                  {value}
                </button>
              ))}
            </div>
          </section>
        )}

        {kind === 'focus' && (
          <section className="setting" aria-labelledby="focus-neighbours">
            <h3 id="focus-neighbours" className="setting-name">
              {t('focus.neighbours')}
            </h3>
            <div className="segmented is-three" role="group" aria-labelledby="focus-neighbours">
              {NEIGHBOURS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="segmented-option"
                  aria-pressed={settings.neighbours === value}
                  onClick={() => onChange({ neighbours: value })}
                >
                  {value === 0 ? t('focus.neighboursOff') : value}
                </button>
              ))}
            </div>
            <p className="setting-hint">{t('focus.neighboursHint')}</p>
          </section>
        )}

        {kind === 'line' && (
          <>
            <section className="setting" aria-labelledby="focus-lines">
              <h3 id="focus-lines" className="setting-name">
                {t('focus.lines')}
              </h3>
              <div className="segmented" role="group" aria-labelledby="focus-lines">
                {([1, 3] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="segmented-option"
                    aria-pressed={settings.lines === value}
                    onClick={() => onChange({ lines: value })}
                  >
                    {t('focus.linesValue', { count: value })}
                  </button>
                ))}
              </div>
            </section>
            {!guided && (
              <section className="setting" aria-labelledby="focus-advance">
                <h3 id="focus-advance" className="setting-name">
                  {t('focus.advance')}
                </h3>
                <div className="segmented" role="group" aria-labelledby="focus-advance">
                  {(['tap', 'auto'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className="segmented-option"
                      aria-pressed={settings.lineAdvance === value}
                      onClick={() => onChange({ lineAdvance: value })}
                    >
                      {value === 'tap' ? t('focus.advanceTap') : t('focus.advanceAuto')}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {showSpeed && (
          <section className="setting setting-inline" aria-labelledby="focus-speed">
            <h3 id="focus-speed" className="setting-name">
              {t('focus.speed')}
            </h3>
            <div className="stepper">
              <button
                type="button"
                className="stepper-button"
                aria-label={t('focus.slower')}
                disabled={settings.wpm <= MIN_WPM}
                onClick={() => onChange({ wpm: Math.max(MIN_WPM, settings.wpm - WPM_STEP) })}
              >
                {'−'}
              </button>
              <span className="stepper-value" role="status">
                {t('focus.wpm', { value: settings.wpm })}
              </span>
              <button
                type="button"
                className="stepper-button"
                aria-label={t('focus.faster')}
                disabled={settings.wpm >= MAX_WPM}
                onClick={() => onChange({ wpm: Math.min(MAX_WPM, settings.wpm + WPM_STEP) })}
              >
                +
              </button>
            </div>
          </section>
        )}
      </div>
    </Sheet>
  )
}

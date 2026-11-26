import { useEffect, useId, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { loadOutline, type OutlineEntry } from '../pdf/outline'
import type { PDFDocumentProxy } from '../pdf/pdfjs'
import {
  AdvanceDrawing,
  FastMark,
  GuideDrawing,
  LinesDrawing,
  NeighboursDrawing,
  PaceGroupIcon,
  ReadGroupIcon,
  ShowGroupIcon,
  SlowMark,
  WordsDrawing,
} from '../ui/drawings'
import { SettingGroup, Slider, VisualChoice } from '../ui/settings'
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
      <div className="settings is-grouped">
        <SettingGroup icon={<ReadGroupIcon />} title={t('focus.read')}>
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
        </SettingGroup>

        <SettingGroup icon={<ShowGroupIcon />} title={t('settings.groups.show')}>
          {kind === 'line' && (
            <VisualChoice
              name={t('focus.guide')}
              hint={t('focus.guideHint')}
              value={settings.lineGuide}
              onChange={(lineGuide) => onChange({ lineGuide })}
              choices={(['line', 'words'] as const).map((value) => ({
                value,
                label: value === 'line' ? t('focus.guideLine') : t('focus.guideWords'),
                picture: <GuideDrawing guide={value} />,
              }))}
            />
          )}
          {(kind === 'focus' || guided) && (
            <VisualChoice
              name={t('focus.size')}
              value={settings.size}
              onChange={(size) => onChange({ size })}
              choices={SIZES.map((value) => ({ value, label: String(value), picture: <WordsDrawing count={value} /> }))}
            />
          )}
          {kind === 'focus' && (
            <VisualChoice
              name={t('focus.neighbours')}
              hint={t('focus.neighboursHint')}
              value={settings.neighbours}
              onChange={(neighbours) => onChange({ neighbours })}
              choices={NEIGHBOURS.map((value) => ({
                value,
                label: value === 0 ? t('focus.neighboursOff') : String(value),
                picture: <NeighboursDrawing count={value} />,
              }))}
            />
          )}
          {kind === 'line' && (
            <VisualChoice
              name={t('focus.lines')}
              value={settings.lines}
              onChange={(lines) => onChange({ lines })}
              choices={([1, 3] as const).map((value) => ({
                value,
                label: t('focus.linesValue', { count: value }),
                picture: <LinesDrawing count={value} />,
              }))}
            />
          )}
        </SettingGroup>

        {(showSpeed || (kind === 'line' && !guided)) && (
          <SettingGroup icon={<PaceGroupIcon />} title={t('settings.groups.pace')}>
            {kind === 'line' && !guided && (
              <VisualChoice
                name={t('focus.advance')}
                value={settings.lineAdvance}
                onChange={(lineAdvance) => onChange({ lineAdvance })}
                choices={(['tap', 'auto'] as const).map((value) => ({
                  value,
                  label: value === 'tap' ? t('focus.advanceTap') : t('focus.advanceAuto'),
                  picture: <AdvanceDrawing advance={value} />,
                }))}
              />
            )}
            {showSpeed && (
              <Slider
                name={t('focus.speed')}
                min={MIN_WPM}
                max={MAX_WPM}
                step={WPM_STEP}
                value={settings.wpm}
                valueText={(value) => t('focus.wpm', { value })}
                lower={<SlowMark />}
                upper={<FastMark />}
                lowerLabel={t('focus.slower')}
                upperLabel={t('focus.faster')}
                onChange={(wpm) => onChange({ wpm })}
              />
            )}
          </SettingGroup>
        )}
      </div>
    </Sheet>
  )
}

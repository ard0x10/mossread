import { useTranslation } from 'react-i18next'
import { Sheet } from '../viewer/Sheet'
import {
  LINE_HEIGHTS,
  SIZES,
  type Alignment,
  type ColumnWidth,
  type Margin,
  type ReadingFont,
  type ReadingTheme,
  type ReflowSettings,
} from './settings'

interface ReflowSettingsSheetProps {
  open: boolean
  settings: ReflowSettings
  onClose: () => void
  onChange: (patch: Partial<ReflowSettings>) => void
}

const SWATCHES: Record<Exclude<ReadingTheme, 'custom'>, { background: string; text: string }> = {
  light: { background: '#fbfaf6', text: '#272b25' },
  sepia: { background: '#f4ecd8', text: '#4a3b2a' },
  dark: { background: '#1b1f1a', text: '#d6dccf' },
  black: { background: '#000000', text: '#c9c9c4' },
}

function step<T>(list: readonly T[], value: T, direction: -1 | 1): T {
  const index = list.indexOf(value)
  return list[Math.min(Math.max(index + direction, 0), list.length - 1)] ?? value
}

export function ReflowSettingsSheet({ open, settings, onClose, onChange }: ReflowSettingsSheetProps) {
  const { t } = useTranslation()

  const fonts: Array<{ value: ReadingFont; label: string }> = [
    { value: 'system', label: t('reflowSettings.fontSystem') },
    { value: 'literata', label: 'Literata' },
    { value: 'atkinson', label: 'Atkinson' },
  ]
  const widths: Array<{ value: ColumnWidth; label: string }> = [
    { value: 'narrow', label: t('reflowSettings.narrow') },
    { value: 'medium', label: t('reflowSettings.medium') },
    { value: 'wide', label: t('reflowSettings.wide') },
  ]
  const margins: Array<{ value: Margin; label: string }> = [
    { value: 'small', label: t('reflowSettings.small') },
    { value: 'medium', label: t('reflowSettings.medium') },
    { value: 'large', label: t('reflowSettings.large') },
  ]
  const alignments: Array<{ value: Alignment; label: string }> = [
    { value: 'start', label: t('reflowSettings.alignStart') },
    { value: 'justify', label: t('reflowSettings.alignJustify') },
  ]
  const themes: Array<{ value: ReadingTheme; label: string }> = [
    { value: 'light', label: t('reflowSettings.themeLight') },
    { value: 'sepia', label: t('reflowSettings.themeSepia') },
    { value: 'dark', label: t('reflowSettings.themeDark') },
    { value: 'black', label: t('reflowSettings.themeBlack') },
    { value: 'custom', label: t('reflowSettings.themeCustom') },
  ]

  const sizeIndex = SIZES.indexOf(settings.size)
  const leadingIndex = LINE_HEIGHTS.indexOf(settings.lineHeight)

  return (
    <Sheet open={open} title={t('settings.title')} onClose={onClose}>
      <div className="settings">
        <section className="setting" aria-labelledby="reflow-font">
          <h3 id="reflow-font" className="setting-name">
            {t('reflowSettings.font')}
          </h3>
          <div className="segmented is-three" role="group" aria-labelledby="reflow-font">
            {fonts.map((font) => (
              <button
                key={font.value}
                type="button"
                className="segmented-option has-sample"
                aria-pressed={settings.font === font.value}
                onClick={() => onChange({ font: font.value })}
              >
                <span className={`font-sample font-${font.value}`} aria-hidden="true">
                  Aa
                </span>
                <span className="font-name">{font.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="setting setting-inline" aria-labelledby="reflow-size">
          <h3 id="reflow-size" className="setting-name">
            {t('reflowSettings.size')}
          </h3>
          <div className="stepper">
            <button
              type="button"
              className="stepper-button"
              aria-label={t('reflowSettings.smaller')}
              disabled={sizeIndex <= 0}
              onClick={() => onChange({ size: step(SIZES, settings.size, -1) })}
            >
              {'−'}
            </button>
            <span className="stepper-value" role="status">
              {t('reflowSettings.sizeValue', { value: settings.size })}
            </span>
            <button
              type="button"
              className="stepper-button"
              aria-label={t('reflowSettings.larger')}
              disabled={sizeIndex >= SIZES.length - 1}
              onClick={() => onChange({ size: step(SIZES, settings.size, 1) })}
            >
              +
            </button>
          </div>
        </section>

        <section className="setting setting-inline" aria-labelledby="reflow-leading">
          <h3 id="reflow-leading" className="setting-name">
            {t('reflowSettings.lineHeight')}
          </h3>
          <div className="stepper">
            <button
              type="button"
              className="stepper-button"
              aria-label={t('reflowSettings.tighter')}
              disabled={leadingIndex <= 0}
              onClick={() => onChange({ lineHeight: step(LINE_HEIGHTS, settings.lineHeight, -1) })}
            >
              {'−'}
            </button>
            <span className="stepper-value" role="status">
              {t('reflowSettings.lineHeightValue', { value: settings.lineHeight })}
            </span>
            <button
              type="button"
              className="stepper-button"
              aria-label={t('reflowSettings.looser')}
              disabled={leadingIndex >= LINE_HEIGHTS.length - 1}
              onClick={() => onChange({ lineHeight: step(LINE_HEIGHTS, settings.lineHeight, 1) })}
            >
              +
            </button>
          </div>
        </section>

        <section className="setting" aria-labelledby="reflow-theme">
          <h3 id="reflow-theme" className="setting-name">
            {t('reflowSettings.theme')}
          </h3>
          <div className="themes" role="group" aria-labelledby="reflow-theme">
            {themes.map((theme) => {
              const colors =
                theme.value === 'custom'
                  ? { background: settings.customBackground, text: settings.customText }
                  : SWATCHES[theme.value]
              return (
                <button
                  key={theme.value}
                  type="button"
                  className="theme-option"
                  aria-pressed={settings.theme === theme.value}
                  onClick={() => onChange({ theme: theme.value })}
                >
                  <span
                    className="theme-swatch"
                    style={{ background: colors.background, color: colors.text }}
                    aria-hidden="true"
                  >
                    Aa
                  </span>
                  {theme.label}
                </button>
              )
            })}
          </div>
          {settings.theme === 'custom' && (
            <div className="custom-colors">
              <label className="color-field">
                {t('reflowSettings.background')}
                <input
                  type="color"
                  value={settings.customBackground}
                  onChange={(event) => onChange({ customBackground: event.target.value })}
                />
              </label>
              <label className="color-field">
                {t('reflowSettings.textColor')}
                <input
                  type="color"
                  value={settings.customText}
                  onChange={(event) => onChange({ customText: event.target.value })}
                />
              </label>
            </div>
          )}
        </section>

        <section className="setting" aria-labelledby="reflow-width">
          <h3 id="reflow-width" className="setting-name">
            {t('reflowSettings.width')}
          </h3>
          <div className="segmented is-three" role="group" aria-labelledby="reflow-width">
            {widths.map((width) => (
              <button
                key={width.value}
                type="button"
                className="segmented-option"
                aria-pressed={settings.width === width.value}
                onClick={() => onChange({ width: width.value })}
              >
                {width.label}
              </button>
            ))}
          </div>
        </section>

        <section className="setting" aria-labelledby="reflow-margin">
          <h3 id="reflow-margin" className="setting-name">
            {t('reflowSettings.margin')}
          </h3>
          <div className="segmented is-three" role="group" aria-labelledby="reflow-margin">
            {margins.map((margin) => (
              <button
                key={margin.value}
                type="button"
                className="segmented-option"
                aria-pressed={settings.margin === margin.value}
                onClick={() => onChange({ margin: margin.value })}
              >
                {margin.label}
              </button>
            ))}
          </div>
        </section>

        <section className="setting" aria-labelledby="reflow-align">
          <h3 id="reflow-align" className="setting-name">
            {t('reflowSettings.align')}
          </h3>
          <div className="segmented" role="group" aria-labelledby="reflow-align">
            {alignments.map((alignment) => (
              <button
                key={alignment.value}
                type="button"
                className="segmented-option"
                aria-pressed={settings.align === alignment.value}
                onClick={() => onChange({ align: alignment.value })}
              >
                {alignment.label}
              </button>
            ))}
          </div>
        </section>

        <section className="setting setting-inline">
          <div>
            <h3 id="reflow-cleanup" className="setting-name">
              {t('reflowSettings.cleanup')}
            </h3>
            <p className="setting-hint">{t('reflowSettings.cleanupHint')}</p>
          </div>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={settings.cleanup}
            aria-labelledby="reflow-cleanup"
            onClick={() => onChange({ cleanup: !settings.cleanup })}
          >
            <span className="switch-thumb" />
          </button>
        </section>
      </div>
    </Sheet>
  )
}

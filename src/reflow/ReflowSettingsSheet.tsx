import { useTranslation } from 'react-i18next'
import {
  AlignDrawing,
  CleanupGroupIcon,
  ColourGroupIcon,
  LargeTextMark,
  LayoutGroupIcon,
  LooseLinesMark,
  MarginDrawing,
  SmallTextMark,
  TextGroupIcon,
  TightLinesMark,
  WidthDrawing,
} from '../ui/drawings'
import { SettingGroup, Slider, SwitchRow, VisualChoice } from '../ui/settings'
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

export function ReflowSettingsSheet({ open, settings, onClose, onChange }: ReflowSettingsSheetProps) {
  const { t } = useTranslation()

  const fonts: Array<{ value: ReadingFont; label: string }> = [
    { value: 'system', label: t('reflowSettings.fontSystem') },
    { value: 'literata', label: 'Literata' },
    { value: 'atkinson', label: 'Atkinson' },
  ]
  const widths: ColumnWidth[] = ['narrow', 'medium', 'wide']
  const margins: Margin[] = ['small', 'medium', 'large']
  const alignments: Alignment[] = ['start', 'justify']
  const themes: Array<{ value: ReadingTheme; label: string }> = [
    { value: 'light', label: t('reflowSettings.themeLight') },
    { value: 'sepia', label: t('reflowSettings.themeSepia') },
    { value: 'dark', label: t('reflowSettings.themeDark') },
    { value: 'black', label: t('reflowSettings.themeBlack') },
    { value: 'custom', label: t('reflowSettings.themeCustom') },
  ]

  // The sliders move along the lists of sizes, so every stop is one the reader can get back to.
  const sizeIndex = Math.max(0, SIZES.indexOf(settings.size))
  const leadingIndex = Math.max(0, LINE_HEIGHTS.indexOf(settings.lineHeight))

  return (
    <Sheet open={open} title={t('settings.title')} onClose={onClose}>
      <div className="settings is-grouped">
        <SettingGroup icon={<TextGroupIcon />} title={t('settings.groups.text')}>
          <VisualChoice
            name={t('reflowSettings.font')}
            value={settings.font}
            onChange={(font) => onChange({ font })}
            choices={fonts.map((font) => ({
              value: font.value,
              label: font.label,
              picture: (
                <span className={`font-sample font-${font.value}`} aria-hidden="true">
                  Aa
                </span>
              ),
            }))}
          />
          <Slider
            name={t('reflowSettings.size')}
            min={0}
            max={SIZES.length - 1}
            value={sizeIndex}
            valueText={(k) => t('reflowSettings.sizeValue', { value: SIZES[k] })}
            lower={<SmallTextMark />}
            upper={<LargeTextMark />}
            lowerLabel={t('reflowSettings.smaller')}
            upperLabel={t('reflowSettings.larger')}
            onChange={(k) => onChange({ size: SIZES[k] })}
          />
          <Slider
            name={t('reflowSettings.lineHeight')}
            min={0}
            max={LINE_HEIGHTS.length - 1}
            value={leadingIndex}
            valueText={(k) => t('reflowSettings.lineHeightValue', { value: LINE_HEIGHTS[k] })}
            lower={<TightLinesMark />}
            upper={<LooseLinesMark />}
            lowerLabel={t('reflowSettings.tighter')}
            upperLabel={t('reflowSettings.looser')}
            onChange={(k) => onChange({ lineHeight: LINE_HEIGHTS[k] })}
          />
        </SettingGroup>

        <SettingGroup icon={<ColourGroupIcon />} title={t('settings.groups.colour')}>
          <div className="themes" role="group" aria-label={t('reflowSettings.theme')}>
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
        </SettingGroup>

        <SettingGroup icon={<LayoutGroupIcon />} title={t('settings.groups.layout')}>
          <VisualChoice
            name={t('reflowSettings.width')}
            value={settings.width}
            onChange={(width) => onChange({ width })}
            choices={widths.map((width) => ({
              value: width,
              label: t(`reflowSettings.${width}`),
              picture: <WidthDrawing size={width} />,
            }))}
          />
          <VisualChoice
            name={t('reflowSettings.margin')}
            value={settings.margin}
            onChange={(margin) => onChange({ margin })}
            choices={margins.map((margin) => ({
              value: margin,
              label: t(`reflowSettings.${margin}`),
              picture: <MarginDrawing size={margin} />,
            }))}
          />
          <VisualChoice
            name={t('reflowSettings.align')}
            value={settings.align}
            onChange={(align) => onChange({ align })}
            choices={alignments.map((align) => ({
              value: align,
              label: align === 'start' ? t('reflowSettings.alignStart') : t('reflowSettings.alignJustify'),
              picture: <AlignDrawing align={align} />,
            }))}
          />
        </SettingGroup>

        <SettingGroup icon={<CleanupGroupIcon />} title={t('settings.groups.cleanup')}>
          <SwitchRow
            name={t('reflowSettings.cleanup')}
            hint={t('reflowSettings.cleanupHint')}
            checked={settings.cleanup}
            onChange={(cleanup) => onChange({ cleanup })}
          />
        </SettingGroup>
      </div>
    </Sheet>
  )
}

import { useTranslation } from 'react-i18next'
import { ColourGroupIcon, FlowDrawing, MoonMark, PagesGroupIcon, ZoomInMark, ZoomOutMark } from '../ui/drawings'
import { SettingGroup, Slider, SwitchRow, VisualChoice } from '../ui/settings'
import type { PageFlow, ViewerSettings } from './settings'
import { Sheet } from './Sheet'

interface SettingsSheetProps {
  open: boolean
  settings: ViewerSettings
  zoom: number
  minZoom: number
  maxZoom: number
  onClose: () => void
  onChange: (patch: Partial<ViewerSettings>) => void
  onZoom: (zoom: number) => void
}

// The zoom slider moves evenly in ratio, so 50% to 100% is as long a stretch as 100% to 200%.
const STOPS = 1000

export function SettingsSheet({ open, settings, zoom, minZoom, maxZoom, onClose, onChange, onZoom }: SettingsSheetProps) {
  const { t } = useTranslation()
  const span = Math.log(maxZoom / minZoom)
  const toZoom = (position: number) => minZoom * Math.exp((position / STOPS) * span)
  const toPosition = (value: number) => Math.round((Math.log(value / minZoom) / span) * STOPS)
  // Lands on whole 5% steps, and on exactly 100% near it, so a reader can get back to the page's own size.
  const snap = (value: number) => (Math.abs(value - 1) < 0.04 ? 1 : Math.round(value * 20) / 20)

  const flows: PageFlow[] = ['scroll', 'paged']

  return (
    <Sheet open={open} title={t('settings.title')} onClose={onClose}>
      <div className="settings is-grouped">
        <SettingGroup icon={<PagesGroupIcon />} title={t('settings.groups.pages')}>
          <VisualChoice
            name={t('settings.layout')}
            value={settings.flow}
            onChange={(flow) => onChange({ flow })}
            choices={flows.map((flow) => ({
              value: flow,
              label: flow === 'scroll' ? t('settings.layoutScroll') : t('settings.layoutPages'),
              picture: <FlowDrawing flow={flow} />,
            }))}
          />
          <Slider
            name={t('settings.zoom')}
            min={0}
            max={STOPS}
            step={10}
            endStep={STOPS / 10}
            value={toPosition(zoom)}
            valueText={(position) => t('settings.zoomValue', { value: snap(toZoom(position)) })}
            lower={<ZoomOutMark />}
            upper={<ZoomInMark />}
            lowerLabel={t('settings.zoomOut')}
            upperLabel={t('settings.zoomIn')}
            commitOnRelease
            onValueClick={() => onZoom(1)}
            valueClickLabel={t('settings.zoomReset')}
            onChange={(position) => onZoom(snap(toZoom(position)))}
          />
        </SettingGroup>

        <SettingGroup icon={<ColourGroupIcon />} title={t('settings.groups.colour')}>
          <SwitchRow
            icon={<MoonMark />}
            name={t('settings.night')}
            hint={t('settings.nightHint')}
            checked={settings.night}
            onChange={(night) => onChange({ night })}
          />
        </SettingGroup>
      </div>
    </Sheet>
  )
}

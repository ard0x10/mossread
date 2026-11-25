import { useTranslation } from 'react-i18next'
import type { PageFlow, ViewerSettings } from './settings'
import { Sheet } from './Sheet'

interface SettingsSheetProps {
  open: boolean
  settings: ViewerSettings
  zoom: number
  canZoomOut: boolean
  canZoomIn: boolean
  onClose: () => void
  onChange: (patch: Partial<ViewerSettings>) => void
  onZoomStep: (direction: -1 | 1) => void
  onZoomReset: () => void
}

export function SettingsSheet({
  open,
  settings,
  zoom,
  canZoomOut,
  canZoomIn,
  onClose,
  onChange,
  onZoomStep,
  onZoomReset,
}: SettingsSheetProps) {
  const { t } = useTranslation()

  const flows: Array<{ value: PageFlow; label: string }> = [
    { value: 'scroll', label: t('settings.layoutScroll') },
    { value: 'paged', label: t('settings.layoutPages') },
  ]

  return (
    <Sheet open={open} title={t('settings.title')} onClose={onClose}>
      <div className="settings">
        <section className="setting" aria-labelledby="setting-layout">
          <h3 id="setting-layout" className="setting-name">
            {t('settings.layout')}
          </h3>
          <div className="segmented" role="group" aria-labelledby="setting-layout">
            {flows.map((flow) => (
              <button
                key={flow.value}
                type="button"
                className="segmented-option"
                aria-pressed={settings.flow === flow.value}
                onClick={() => onChange({ flow: flow.value })}
              >
                {flow.label}
              </button>
            ))}
          </div>
        </section>

        <section className="setting setting-inline">
          <div>
            <h3 id="setting-night" className="setting-name">
              {t('settings.night')}
            </h3>
            <p className="setting-hint">{t('settings.nightHint')}</p>
          </div>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={settings.night}
            aria-labelledby="setting-night"
            onClick={() => onChange({ night: !settings.night })}
          >
            <span className="switch-thumb" />
          </button>
        </section>

        <section className="setting setting-inline" aria-labelledby="setting-zoom">
          <h3 id="setting-zoom" className="setting-name">
            {t('settings.zoom')}
          </h3>
          <div className="stepper">
            <button
              type="button"
              className="stepper-button"
              aria-label={t('settings.zoomOut')}
              disabled={!canZoomOut}
              onClick={() => onZoomStep(-1)}
            >
              {'−'}
            </button>
            <button
              type="button"
              className="stepper-value"
              aria-label={t('settings.zoomReset')}
              onClick={onZoomReset}
            >
              {t('settings.zoomValue', { value: zoom })}
            </button>
            <button
              type="button"
              className="stepper-button"
              aria-label={t('settings.zoomIn')}
              disabled={!canZoomIn}
              onClick={() => onZoomStep(1)}
            >
              +
            </button>
          </div>
        </section>
      </div>
    </Sheet>
  )
}

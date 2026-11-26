import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRightIcon } from '../ui/icons'
import { Sheet } from './Sheet'

interface GoToSheetProps {
  open: boolean
  total: number
  onClose: () => void
  onGo: (page: number) => void
}

export function GoToSheet({ open, total, onClose, onGo }: GoToSheetProps) {
  const { t } = useTranslation()
  const inputId = useId()
  const hintId = useId()
  const [value, setValue] = useState('')

  const close = () => {
    setValue('')
    onClose()
  }

  return (
    <Sheet open={open} title={t('goto.title')} onClose={close}>
      <form
        className="goto-form"
        onSubmit={(event) => {
          event.preventDefault()
          const page = Number.parseInt(value, 10)
          if (!Number.isFinite(page)) return
          setValue('')
          onGo(Math.min(Math.max(page, 1), total))
        }}
      >
        <label htmlFor={inputId} className="field-label">
          {t('goto.label')}
        </label>
        <div className="goto-row">
          <input
            id={inputId}
            className="field-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            autoFocus
            aria-describedby={hintId}
            value={value}
            onChange={(event) => setValue(event.target.value.replace(/\D/g, ''))}
          />
          <button
            type="submit"
            className="button-primary icon-action"
            disabled={value === ''}
            aria-label={t('goto.submit')}
            title={t('goto.submit')}
          >
            <ArrowRightIcon />
          </button>
        </div>
        <p id={hintId} className="sheet-note">
          {t('goto.hint', { total })}
        </p>
      </form>
    </Sheet>
  )
}

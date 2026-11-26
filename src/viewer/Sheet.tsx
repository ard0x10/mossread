import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CloseIcon } from '../ui/icons'
import { useBackHandler } from '../lib/backStack'

interface SheetProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

// Bottom sheet on a native <dialog>: focus stays inside, Escape and the
// back button close it, and a tap on the dimmed area outside closes it too.
export function Sheet({ open, title, onClose, children }: SheetProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useBackHandler(open, onClose)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onClose={() => {
        if (open) onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="sheet-body">
        <header className="sheet-header">
          <h2 id={titleId} className="sheet-title">
            {title}
          </h2>
          <button type="button" className="icon-button" aria-label={t('sheet.close')} title={t('sheet.close')} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        {open && children}
      </div>
    </dialog>
  )
}

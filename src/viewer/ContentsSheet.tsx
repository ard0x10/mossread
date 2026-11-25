import { useEffect, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { loadOutline, type OutlineEntry } from '../pdf/outline'
import type { PDFDocumentProxy } from '../pdf/pdfjs'
import { Sheet } from './Sheet'

interface ContentsSheetProps {
  open: boolean
  doc: PDFDocumentProxy
  currentPage: number
  onClose: () => void
  onPick: (page: number) => void
}

export function ContentsSheet({ open, doc, currentPage, onClose, onPick }: ContentsSheetProps) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<OutlineEntry[] | null>(null)

  // Bookmarks are resolved the first time the sheet opens, not on every open.
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

  // The entry for the section being read: the last one starting at or before the current page.
  const here = entries?.reduce<number>((found, e, i) => (e.page !== null && e.page <= currentPage ? i : found), -1)

  return (
    <Sheet open={open} title={t('contents.title')} onClose={onClose}>
      {entries === null && <p className="sheet-note">{t('contents.loading')}</p>}
      {entries?.length === 0 && <p className="sheet-note">{t('contents.empty')}</p>}
      {entries && entries.length > 0 && (
        <ol className="contents-list">
          {entries.map((entry, i) => (
            <li key={i}>
              <button
                type="button"
                className={i === here ? 'contents-item is-here' : 'contents-item'}
                style={{ '--depth': entry.depth } as CSSProperties}
                disabled={entry.page === null}
                aria-current={i === here ? 'location' : undefined}
                onClick={() => entry.page !== null && onPick(entry.page)}
              >
                <span className="contents-title">{entry.title}</span>
                {entry.page !== null && <span className="contents-page">{t('contents.page', { page: entry.page })}</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  )
}

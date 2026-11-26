import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../viewer/Sheet'
import { promptInstall, readHintDismissed, useInstallWay, writeHintDismissed } from '../pwa/pwa'
import { useFileSize } from '../lib/useFileSize'
import { CloseIcon, DownloadIcon, TrashIcon } from '../ui/icons'
import { deleteBook, readRemember, writeRemember, type Book } from './db'

/** How much of a book is read, as a ring that fills on the corner of its cover. */
function ProgressRing({ value }: { value: number }) {
  const r = 9
  const length = 2 * Math.PI * r
  return (
    <span className="shelf-ring" aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r={r} className="shelf-ring-track" />
        <circle
          cx="12"
          cy="12"
          r={r}
          className="shelf-ring-fill"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - Math.min(1, value))}
        />
      </svg>
    </span>
  )
}

interface ShelfProps {
  books: Book[]
  /** Disabled while a book is being opened. */
  busy: boolean
  onOpen: (book: Book) => void
  onDeleted: () => void
}

/** Sizes in the reader's language: "820 KB", "19 MB", "1.2 GB". */

/** One line under the shelf, until it is used or closed. */
function InstallHint() {
  const { t } = useTranslation()
  const way = useInstallWay()
  const [dismissed, setDismissed] = useState(readHintDismissed)
  if (!way || dismissed) return null
  const close = () => {
    writeHintDismissed()
    setDismissed(true)
  }
  return (
    <div className="install-hint">
      <p className="install-hint-text">{way === 'apple' ? t('install.apple') : t('install.prompt')}</p>
      {way === 'prompt' && (
        <button
          type="button"
          className="icon-button is-accent"
          aria-label={t('install.install')}
          title={t('install.install')}
          onClick={() => void promptInstall().then(close)}
        >
          <DownloadIcon />
        </button>
      )}
      <button type="button" className="icon-button" aria-label={t('install.close')} title={t('install.close')} onClick={close}>
        <CloseIcon />
      </button>
    </div>
  )
}

function Cover({ book }: { book: Book }) {
  return book.cover ? (
    <img className="shelf-cover" src={book.cover} alt="" draggable={false} />
  ) : (
    <span className="shelf-cover is-blank" aria-hidden="true" />
  )
}

export function Shelf({ books, busy, onOpen, onDeleted }: ShelfProps) {
  const { t } = useTranslation()
  const fileSize = useFileSize()
  const [remember, setRemember] = useState(readRemember)
  const [doomed, setDoomed] = useState<Book | null>(null)
  const [failed, setFailed] = useState(false)

  const total = books.reduce((sum, book) => sum + book.size, 0)

  return (
    <section className="shelf" aria-labelledby="shelf-title">
      {books.length > 0 && (
        <>
          <h2 id="shelf-title" className="visually-hidden">
            {t('library.title')}
          </h2>
          <ul className="shelf-grid">
            {books.map((book) => (
              <li key={book.id} className="shelf-item">
                <button
                  type="button"
                  className="shelf-open"
                  disabled={busy}
                  onClick={() => onOpen(book)}
                  aria-label={t('library.openLabel', { name: book.name, progress: book.progress })}
                >
                  <span className="shelf-cover-wrap">
                    <Cover book={book} />
                    {book.progress > 0 && <ProgressRing value={book.progress} />}
                  </span>
                  <span className="shelf-name">{book.name.replace(/\.pdf$/i, '')}</span>
                </button>
                <button
                  type="button"
                  className="shelf-delete"
                  aria-label={t('library.deleteLabel', { name: book.name })}
                  onClick={() => {
                    setFailed(false)
                    setDoomed(book)
                  }}
                >
                  <CloseIcon />
                </button>
              </li>
            ))}
          </ul>
          <p className="shelf-usage">{t('library.usage', { count: books.length, size: fileSize(total) })}</p>
          <InstallHint />
        </>
      )}

      <div className="shelf-remember">
        <h3 id="shelf-remember" className="setting-name">
          {t('library.remember')}
        </h3>
        <button
          type="button"
          className="switch"
          role="switch"
          aria-checked={remember}
          aria-labelledby="shelf-remember"
          onClick={() => {
            writeRemember(!remember)
            setRemember(!remember)
          }}
        >
          <span className="switch-thumb" />
        </button>
      </div>

      <Sheet
        open={doomed !== null}
        title={doomed ? t('library.deleteTitle', { name: doomed.name }) : ''}
        onClose={() => setDoomed(null)}
      >
        {doomed && (
          <div className="confirm">
            <p className="confirm-text">{t('library.deleteBody', { size: fileSize(doomed.size) })}</p>
            {failed && (
              <p className="home-error" role="alert">
                {t('library.deleteFailed')}
              </p>
            )}
            <div className="confirm-actions">
              <button type="button" className="button-quiet icon-action" onClick={() => setDoomed(null)}>
                <CloseIcon />
                {t('library.cancel')}
              </button>
              <button
                type="button"
                className="button-danger icon-action"
                onClick={() => {
                  deleteBook(doomed.id).then(
                    () => {
                      setDoomed(null)
                      onDeleted()
                    },
                    () => setFailed(true),
                  )
                }}
              >
                <TrashIcon />
                {t('library.delete')}
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </section>
  )
}

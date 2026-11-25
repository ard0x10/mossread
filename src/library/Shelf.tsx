import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../viewer/Sheet'
import { promptInstall, readHintDismissed, useInstallWay, writeHintDismissed } from '../pwa/pwa'
import { deleteBook, readRemember, writeRemember, type Book } from './db'

interface ShelfProps {
  books: Book[]
  /** Disabled while a book is being opened. */
  busy: boolean
  onOpen: (book: Book) => void
  onDeleted: () => void
}

/** Sizes in the reader's language: "820 KB", "19 MB", "1.2 GB". */
function useFileSize() {
  const { i18n } = useTranslation()
  return useMemo(() => {
    const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const
    return (bytes: number) => {
      let value = bytes
      let unit = 0
      while (value >= 1000 && unit < units.length - 1) {
        value /= 1000
        unit++
      }
      return new Intl.NumberFormat(i18n.language, {
        style: 'unit',
        unit: units[unit],
        unitDisplay: 'short',
        maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0,
      }).format(value)
    }
  }, [i18n.language])
}

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
        <button type="button" className="button-quiet" onClick={() => void promptInstall().then(close)}>
          {t('install.install')}
        </button>
      )}
      <button type="button" className="install-hint-close" aria-label={t('install.close')} onClick={close}>
        {'×'}
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
          <h2 id="shelf-title" className="shelf-title">
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
                  <Cover book={book} />
                  <span className="shelf-name">{book.name.replace(/\.pdf$/i, '')}</span>
                  <span className="shelf-meta">
                    <span className="shelf-bar" aria-hidden="true">
                      <span style={{ inlineSize: `${Math.round(book.progress * 100)}%` }} />
                    </span>
                    {t('library.progress', { value: book.progress })}
                  </span>
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
                  {'×'}
                </button>
              </li>
            ))}
          </ul>
          <p className="shelf-usage">{t('library.usage', { count: books.length, size: fileSize(total) })}</p>
          <InstallHint />
        </>
      )}

      <div className="shelf-remember">
        <div>
          <h3 id="shelf-remember" className="setting-name">
            {t('library.remember')}
          </h3>
          <p className="setting-hint">{t('library.rememberHint')}</p>
        </div>
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
              <button type="button" className="button-quiet" onClick={() => setDoomed(null)}>
                {t('library.cancel')}
              </button>
              <button
                type="button"
                className="button-danger"
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
                {t('library.delete')}
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </section>
  )
}

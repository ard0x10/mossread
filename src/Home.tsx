import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CloseIcon, OpenFileIcon, UnlockIcon } from './ui/icons'
import { getFile, listBooks, type Book } from './library/db'
import { Shelf } from './library/Shelf'
import type { OpenedPdf } from './pdf/pdfjs'
import { takeSharedFile } from './pwa/pwa'

// pdf.js is most of the app's weight; the home screen shows without it and
// fetches it in the background, so it is usually ready by the time a file is picked.
const loadPdfModule = () => import('./pdf/pdfjs')

const SOURCE_URL = 'https://github.com/ard0x10/mossread'

type State =
  | { kind: 'idle' }
  | { kind: 'opening'; name: string }
  | { kind: 'password'; file: File; wrong: boolean }
  | { kind: 'error'; message: 'invalid' | 'unknown' | 'missing' }

interface HomeProps {
  /** Resolves once the book is open (and kept in the library, if it is). */
  onOpen: (pdf: OpenedPdf, file: File) => Promise<void>
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

export function Home({ onOpen }: HomeProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const passwordId = useId()
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [password, setPassword] = useState('')
  const [dragging, setDragging] = useState(false)
  const [books, setBooks] = useState<Book[]>([])

  const refreshBooks = () => {
    listBooks().then(setBooks, () => setBooks([]))
  }

  useEffect(refreshBooks, [])

  const attempt = async (file: File, pass?: string) => {
    setState({ kind: 'opening', name: file.name })
    try {
      const { openPdf } = await loadPdfModule()
      const pdf = await openPdf(file, pass)
      setPassword('')
      await onOpen(pdf, file)
    } catch (error) {
      const reason =
        error instanceof Error && 'reason' in error && typeof error.reason === 'string' ? error.reason : 'unknown'
      if (reason === 'needs-password' || reason === 'wrong-password') {
        setState({ kind: 'password', file, wrong: reason === 'wrong-password' })
      } else {
        setState({ kind: 'error', message: reason === 'invalid' ? 'invalid' : 'unknown' })
      }
    }
  }

  const openFromShelf = async (book: Book) => {
    setState({ kind: 'opening', name: book.name })
    const blob = await getFile(book.id).catch(() => undefined)
    if (!blob) {
      setState({ kind: 'error', message: 'missing' })
      return
    }
    void attempt(new File([blob], book.name, { type: 'application/pdf' }))
  }

  const choose = (file: File | undefined) => {
    if (!file) return
    if (!isPdf(file)) {
      setState({ kind: 'error', message: 'invalid' })
      return
    }
    void attempt(file)
  }

  useEffect(() => {
    const warm = () => void loadPdfModule()
    // Safari has no requestIdleCallback.
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 3000 })
      return () => window.cancelIdleCallback(id)
    }
    const timer = setTimeout(warm, 1500)
    return () => clearTimeout(timer)
  }, [])

  // Desktop: a PDF can be dropped anywhere on the page.
  const chooseRef = useRef(choose)
  useEffect(() => {
    chooseRef.current = choose
  })

  // Android: a PDF shared from another app opens straight away.
  useEffect(() => {
    void takeSharedFile().then((file) => {
      if (file) chooseRef.current(file)
    })
  }, [])
  useEffect(() => {
    let depth = 0
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth += 1
      setDragging(true)
    }
    const onLeave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth = 0
      setDragging(false)
      chooseRef.current(event.dataTransfer?.files[0])
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  const opening = state.kind === 'opening'

  return (
    <div className="shell">
      <header className="brand">
        <h1 className="brand-name">
          <picture>
            <source srcSet="/icons/icon.svg" media="(prefers-color-scheme: dark)" />
            <img className="brand-logo" src="/icons/mark.svg" alt="" draggable={false} />
          </picture>
          {t('app.name')}
        </h1>
        <p className="brand-tagline">{t('app.tagline')}</p>
      </header>

      <main className="home">

        {state.kind === 'password' ? (
          <form
            className="home-password"
            onSubmit={(event) => {
              event.preventDefault()
              if (password) void attempt(state.file, password)
            }}
          >
            <h2 className="home-password-title">{t('home.passwordTitle')}</h2>
            <label htmlFor={passwordId} className="field-label">
              {t('home.passwordLabel')}
            </label>
            <input
              id={passwordId}
              className="field-input"
              type="password"
              autoComplete="off"
              autoFocus
              value={password}
              aria-invalid={state.wrong}
              onChange={(event) => setPassword(event.target.value)}
            />
            {state.wrong && (
              <p className="home-error" role="alert">
                {t('home.passwordWrong')}
              </p>
            )}
            <div className="home-password-actions">
              <button
                type="submit"
                className="button-primary icon-action"
                disabled={!password}
                aria-label={t('home.passwordSubmit')}
                title={t('home.passwordSubmit')}
              >
                <UnlockIcon />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={t('home.passwordCancel')}
                title={t('home.passwordCancel')}
                onClick={() => {
                  setPassword('')
                  setState({ kind: 'idle' })
                }}
              >
                <CloseIcon />
              </button>
            </div>
          </form>
        ) : (
          <div className="home-actions">
            {state.kind === 'error' && (
              <p className="home-error" role="alert">
                {state.message === 'invalid'
                  ? t('home.errorInvalid')
                  : state.message === 'missing'
                    ? t('home.errorMissing')
                    : t('home.errorUnknown')}
              </p>
            )}
            <button
              type="button"
              className="home-open"
              title={t('home.open')}
              disabled={opening}
              aria-busy={opening}
              onClick={() => inputRef.current?.click()}
            >
              <span className="home-open-circle">
                <OpenFileIcon />
              </span>
              <span className="home-open-label">
                {opening ? t('home.opening', { name: state.name }) : t('home.openShort')}
              </span>
            </button>
            <p className="home-drop-hint">{t('home.dropHint')}</p>
            <input
              ref={inputRef}
              className="visually-hidden"
              type="file"
              accept="application/pdf,.pdf"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                choose(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </div>
        )}
        {state.kind !== 'password' && (
          <Shelf
            books={books}
            busy={opening}
            onOpen={(book) => void openFromShelf(book)}
            onDeleted={refreshBooks}
          />
        )}
      </main>

      <footer className="footer">
        <span>{t('footer.openSource')}</span>
        <span aria-hidden="true">·</span>
        <a className="footer-link" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
          {t('footer.sourceCode')}
        </a>
      </footer>

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <p>{t('home.dropOverlay')}</p>
        </div>
      )}
    </div>
  )
}

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OpenedPdf } from './pdf/pdfjs'

// pdf.js is most of the app's weight; the home screen shows without it and
// fetches it in the background, so it is usually ready by the time a file is picked.
const loadPdfModule = () => import('./pdf/pdfjs')

const SOURCE_URL = 'https://github.com/ard0x10/mossread'

type State =
  | { kind: 'idle' }
  | { kind: 'opening'; name: string }
  | { kind: 'password'; file: File; wrong: boolean }
  | { kind: 'error'; message: 'invalid' | 'unknown' }

interface HomeProps {
  onOpen: (pdf: OpenedPdf, name: string) => void
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

  const attempt = async (file: File, pass?: string) => {
    setState({ kind: 'opening', name: file.name })
    try {
      const { openPdf } = await loadPdfModule()
      const pdf = await openPdf(file, pass)
      setPassword('')
      onOpen(pdf, file.name)
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
      <header className="topbar">
        <span className="wordmark">{t('app.name')}</span>
      </header>

      <main className="home">
        <div className="home-intro">
          <h1 className="home-title">{t('app.tagline')}</h1>
          <p className="home-note">{t('app.privacy')}</p>
        </div>

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
              <button type="submit" className="button-primary" disabled={!password}>
                {t('home.passwordSubmit')}
              </button>
              <button
                type="button"
                className="button-quiet"
                onClick={() => {
                  setPassword('')
                  setState({ kind: 'idle' })
                }}
              >
                {t('home.passwordCancel')}
              </button>
            </div>
          </form>
        ) : (
          <div className="home-actions">
            {state.kind === 'error' && (
              <p className="home-error" role="alert">
                {state.message === 'invalid' ? t('home.errorInvalid') : t('home.errorUnknown')}
              </p>
            )}
            <button
              type="button"
              className="button-primary button-large"
              disabled={opening}
              onClick={() => inputRef.current?.click()}
            >
              {opening ? t('home.opening', { name: state.name }) : t('home.open')}
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
      </main>

      <footer className="footer">
        <p className="footer-text">{t('footer.openSource')}</p>
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

import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Home } from './Home'
import { useBackHandler } from './lib/backStack'
import { makeCover } from './library/cover'
import {
  addBook,
  askToKeep,
  fingerprint,
  getBook,
  progressOf,
  readRemember,
  updateBook,
  type SavedPosition,
} from './library/db'
import type { OpenedPdf } from './pdf/pdfjs'

const Viewer = lazy(() => import('./viewer/Viewer').then((m) => ({ default: m.Viewer })))

// The cover is drawn once the first page of the book itself is on screen.
const COVER_DELAY = 1500

interface OpenBook {
  pdf: OpenedPdf
  name: string
  /** Library id, or null when this book is not kept. */
  id: string | null
  start: SavedPosition | null
  /** Language a scanned book's text was read in before; reading resumes in it. */
  ocrLang: string | null
}

/**
 * Finds the file in the library, or adds it there when remembering is on.
 * Storage that is missing, blocked or full only means the book is not kept.
 */
async function keep(pdf: OpenedPdf, file: File): Promise<Pick<OpenBook, 'id' | 'start' | 'ocrLang'>> {
  try {
    const id = await fingerprint(file)
    const existing = await getBook(id)
    const now = Date.now()
    if (existing) {
      void updateBook(id, { openedAt: now })
      return { id, start: existing.position, ocrLang: existing.ocrLang ?? null }
    }
    if (!readRemember()) return { id: null, start: null, ocrLang: null }
    const pages = pdf.doc.numPages
    await addBook(
      { id, name: file.name, size: file.size, pages, addedAt: now, openedAt: now, progress: 0, position: null, cover: null },
      file,
    )
    void askToKeep()
    setTimeout(() => {
      void makeCover(pdf.doc).then((cover) => (cover ? updateBook(id, { cover }) : undefined))
    }, COVER_DELAY)
    return { id, start: null, ocrLang: null }
  } catch {
    return { id: null, start: null, ocrLang: null }
  }
}

export default function App() {
  const { t } = useTranslation()
  const [book, setBook] = useState<OpenBook | null>(null)

  const open = useCallback(async (pdf: OpenedPdf, file: File) => {
    const kept = await keep(pdf, file)
    setBook({ pdf, name: file.name, ...kept })
  }, [])

  const close = useCallback(() => {
    if (book) void book.pdf.close()
    setBook(null)
  }, [book])

  const savePosition = useCallback(
    (position: SavedPosition) => {
      if (!book?.id) return
      const pages = book.pdf.doc.numPages
      void updateBook(book.id, { position, progress: progressOf(position, pages), openedAt: Date.now() }).catch(() => {})
    },
    [book],
  )

  useBackHandler(book !== null, close)

  useEffect(() => {
    document.title = book ? t('app.documentTitle', { name: book.name }) : t('app.name')
  }, [book, t])

  return book ? (
    <Suspense fallback={null}>
      <Viewer
        pdf={book.pdf}
        fileName={book.name}
        start={book.start}
        bookId={book.id}
        ocrLang={book.ocrLang}
        onPosition={book.id ? savePosition : undefined}
        onClose={close}
      />
    </Suspense>
  ) : (
    <Home onOpen={open} />
  )
}

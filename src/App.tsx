import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Home } from './Home'
import { useBackHandler } from './lib/backStack'
import type { OpenedPdf } from './pdf/pdfjs'

const Viewer = lazy(() => import('./viewer/Viewer').then((m) => ({ default: m.Viewer })))

interface Book {
  pdf: OpenedPdf
  name: string
}

export default function App() {
  const { t } = useTranslation()
  const [book, setBook] = useState<Book | null>(null)

  const close = useCallback(() => {
    if (book) void book.pdf.close()
    setBook(null)
  }, [book])

  useBackHandler(book !== null, close)

  useEffect(() => {
    document.title = book ? t('app.documentTitle', { name: book.name }) : t('app.name')
  }, [book, t])

  return book ? (
    <Suspense fallback={null}>
      <Viewer pdf={book.pdf} fileName={book.name} onClose={close} />
    </Suspense>
  ) : (
    <Home onOpen={(pdf, name) => setBook({ pdf, name })} />
  )
}

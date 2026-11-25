import {
  GlobalWorkerOptions,
  InvalidPDFException,
  PasswordException,
  PasswordResponses,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist'
import rendererUrl from 'pdfjs-dist/build/pdf.renderer.min.mjs?url'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

GlobalWorkerOptions.workerSrc = workerUrl
// Pages are drawn on an OffscreenCanvas in a second worker when the browser
// supports it, which keeps scrolling smooth on phones. Otherwise pdf.js falls
// back to drawing on the main thread by itself.
GlobalWorkerOptions.rendererSrc = rendererUrl

const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`

export interface OpenedPdf {
  doc: PDFDocumentProxy
  close: () => Promise<void>
}

export type OpenError = 'needs-password' | 'wrong-password' | 'invalid' | 'unknown'

export class PdfOpenError extends Error {
  readonly reason: OpenError

  constructor(reason: OpenError, cause?: unknown) {
    super(reason, { cause })
    this.reason = reason
  }
}

function classify(error: unknown): OpenError {
  if (error instanceof PasswordException) {
    return error.code === PasswordResponses.INCORRECT_PASSWORD ? 'wrong-password' : 'needs-password'
  }
  if (error instanceof InvalidPDFException) return 'invalid'
  return 'unknown'
}

// pdf.js takes ownership of the bytes it is given, so every attempt (for
// example a retry with a password) reads the file again.
export async function openPdf(file: Blob, password?: string): Promise<OpenedPdf> {
  const data = new Uint8Array(await file.arrayBuffer())
  const task: PDFDocumentLoadingTask = getDocument({
    data,
    password,
    cMapUrl: `${ASSETS}cmaps/`,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    iccUrl: `${ASSETS}iccs/`,
    wasmUrl: `${ASSETS}wasm/`,
    enableXfa: false,
  })

  try {
    const doc = await task.promise
    return { doc, close: () => task.destroy() }
  } catch (error) {
    void task.destroy()
    throw new PdfOpenError(classify(error), error)
  }
}

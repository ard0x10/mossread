import type { Worker } from 'tesseract.js'
import type { PDFDocumentProxy } from '../pdf/pdfjs'
import { acquireRenderSlot } from '../pdf/renderLimiter'
import type { RawPage } from '../text/layout'
import { ocrToRaw, type OcrBlock } from './toRaw'

declare const __OCR_BASE__: string
declare const __OCR_DOWNLOAD__: Record<string, number>

export type OcrLang = 'eng' | 'tur'
export const OCR_LANGS: readonly OcrLang[] = ['eng', 'tur']

export function isOcrLang(value: unknown): value is OcrLang {
  return value === 'eng' || value === 'tur'
}

/** Turkish on a device set to Turkish, English otherwise. */
export function defaultOcrLang(): OcrLang {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  return languages[0]?.toLowerCase().startsWith('tr') ? 'tur' : 'eng'
}

/** Bytes fetched the first time this language is used. */
export function downloadSize(lang: OcrLang): number {
  return __OCR_DOWNLOAD__[lang] ?? 0
}

// Twice the page's own size draws 10 pt body text 20 pixels tall, which reads
// as well as larger drawings did on sample scans and takes about a third less
// time than three times the size. The width cap keeps a large page from using
// too much memory.
const SCALE = 2
const MAX_WIDTH = 2400

/**
 * Reads the text of scanned pages on this device, one page at a time. The
 * recogniser (tesseract.js) is loaded the first time it is needed.
 */
export class OcrEngine {
  readonly lang: OcrLang
  private worker: Promise<Worker> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private stopped = false
  private onStop: () => void = () => {}
  // Settles a page still being read when the recogniser is ended, so nobody waits on it.
  private readonly stopping = new Promise<never>((_, reject) => {
    this.onStop = () => reject(new Error('stopped'))
  })

  constructor(lang: OcrLang) {
    this.lang = lang
    this.stopping.catch(() => {})
  }

  private start(): Promise<Worker> {
    this.worker ??= import('tesseract.js').then(({ createWorker, OEM }) =>
      createWorker(this.lang, OEM.LSTM_ONLY, {
        workerPath: `${__OCR_BASE__}worker.min.js`,
        corePath: `${__OCR_BASE__}core/`,
        langPath: `${__OCR_BASE__}lang`,
        workerBlobURL: false,
        // The service worker keeps the files; a second copy in IndexedDB would only take space.
        cacheMethod: 'none',
      }),
    )
    return this.worker
  }

  /** Text of one page, as positioned runs in page space at scale 1. Pages are read in the order asked. */
  recognize(doc: PDFDocumentProxy, pageNumber: number): Promise<RawPage> {
    const run = this.queue.then(() => this.read(doc, pageNumber))
    this.queue = run.catch(() => {})
    return run
  }

  private async read(doc: PDFDocumentProxy, pageNumber: number): Promise<RawPage> {
    if (this.stopped) throw new Error('stopped')
    const worker = await this.start()
    const page = await doc.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(SCALE, MAX_WIDTH / base.width)
    const viewport = page.getViewport({ scale })
    const width = Math.round(viewport.width)
    const height = Math.round(viewport.height)

    // pdf.js may draw in its renderer worker, where the canvas cannot be read
    // back, so the finished page is copied onto a second canvas first.
    const drawn = document.createElement('canvas')
    drawn.width = width
    drawn.height = height
    // Waits its turn with the pages being drawn on screen, to keep memory down on phones.
    const release = await acquireRenderSlot(new AbortController().signal)
    try {
      await page.render({ canvas: drawn, viewport }).promise
    } finally {
      release()
    }
    const copy = document.createElement('canvas')
    copy.width = width
    copy.height = height
    const context = copy.getContext('2d')
    if (!context) throw new Error('no canvas')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(drawn, 0, 0)
    drawn.width = 0

    if (this.stopped) throw new Error('stopped')
    const { data } = await Promise.race([worker.recognize(copy, {}, { blocks: true, text: false }), this.stopping])
    copy.width = 0
    return ocrToRaw((data.blocks ?? []) as unknown as OcrBlock[], scale, base.width, base.height)
  }

  /** Ends the recogniser; pages still waiting fail. */
  stop() {
    this.stopped = true
    this.onStop()
    void this.worker?.then((worker) => worker.terminate()).catch(() => {})
    this.worker = null
  }
}

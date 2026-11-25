import type { PDFDocumentProxy } from '../pdf/pdfjs'
import { extractPage } from './extract'
import {
  continuationTarget,
  layoutPage,
  mergeParagraphs,
  NEIGHBOURS,
  type Block,
  type PageLayout,
  type ParagraphBlock,
  type RawPage,
} from './layout'

/** What one page contributes to the reading view once page breaks are mended. */
export interface Section {
  page: number
  blocks: Block[]
  hasText: boolean
}

/** Reads the text of pages that have none of their own, such as scans. */
export interface OcrSource {
  /** Pages read on an earlier visit. */
  saved: ReadonlyMap<number, RawPage>
  recognize(page: number): Promise<RawPage>
}

// Scanned pages are read around the reader only: these many before (the
// reading view's page-break mending looks two pages back) and after.
const OCR_BEHIND = 2
const OCR_AHEAD = 3

interface CachedSection {
  inputs: Array<PageLayout | undefined>
  value: Section
}

/**
 * Pulls text out of a document page by page, nearest the reader first, and
 * lays it out. Extraction runs on pdf.js's own worker; the layout pass is a
 * few milliseconds per page, so it runs here between pages.
 */
export class TextStore {
  readonly total: number
  private readonly doc: PDFDocumentProxy
  private readonly raw = new Map<number, RawPage>()
  private readonly failed = new Set<number>()
  private readonly layouts = new Map<string, PageLayout>()
  private readonly sections = new Map<string, CachedSection>()
  private readonly listeners = new Set<() => void>()
  private focus = 1
  private running = false
  private destroyed = false
  private notifyQueued = false
  private ocr: OcrSource | null = null
  private readonly ocrPages = new Map<number, RawPage>()
  private readonly ocrFailed = new Set<number>()
  private ocrRunning = false

  constructor(doc: PDFDocumentProxy) {
    this.doc = doc
    this.total = doc.numPages
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Moves extraction to the pages around this one. */
  setFocus(page: number) {
    this.focus = Math.min(Math.max(1, Math.round(page)), this.total)
    void this.pump()
    void this.pumpOcr()
  }

  /**
   * Starts reading the text of pages that have none, around the reader.
   * Pages already laid out without text are laid out again. A second call
   * hands the work to a new source and keeps what was read.
   */
  enableOcr(source: OcrSource) {
    const first = this.ocr === null
    this.ocr = source
    for (const [page, raw] of source.saved) if (!this.ocrPages.has(page)) this.ocrPages.set(page, raw)
    this.ocrFailed.clear()
    if (first) {
      this.layouts.clear()
      this.sections.clear()
    }
    this.queueNotify()
    void this.pumpOcr()
  }

  ocrEnabled = (): boolean => this.ocr !== null

  /** A page with no text of its own whose text has not been read yet. */
  private ocrPending(page: number): boolean {
    return this.needsOcr(page) && !this.ocrPages.has(page) && !this.ocrFailed.has(page)
  }

  private needsOcr(page: number): boolean {
    return this.ocr !== null && this.raw.has(page) && !this.withText.has(page)
  }

  /** Stops reading pages. Subscribers remove themselves. */
  destroy() {
    this.destroyed = true
  }

  /** Undoes destroy(); React runs effects twice in development, and a store can outlive the first run. */
  resume() {
    if (!this.destroyed) return
    this.destroyed = false
    void this.pump()
    void this.pumpOcr()
  }

  /** True once every page has been read (or failed to read). */
  get complete(): boolean {
    return this.raw.size + this.failed.size >= this.total
  }

  private readonly withText = new Set<number>()

  /** Enough pages have been read to say this PDF has no text layer at all (a scan). */
  noTextLayer = (): boolean => {
    const checked = this.raw.size + this.failed.size
    return this.withText.size === 0 && checked >= Math.min(this.total, 6)
  }

  private windowRange(page: number): [number, number] {
    return [Math.max(1, page - NEIGHBOURS), Math.min(this.total, page + NEIGHBOURS)]
  }

  private ready(page: number): boolean {
    const [lo, hi] = this.windowRange(page)
    for (let n = lo; n <= hi; n++) if (!this.raw.has(n) && !this.failed.has(n)) return false
    // A scanned page waits for its own text; scanned neighbours still being
    // read are left out of its window rather than waited for, so the first
    // page shows after one page is read, and a layout never changes once made.
    return !this.ocrPending(page)
  }

  layout(page: number, cleanup: boolean): PageLayout | undefined {
    if (page < 1 || page > this.total) return undefined
    const key = `${cleanup ? 1 : 0}:${page}`
    const cached = this.layouts.get(key)
    if (cached) return cached
    if (!this.ready(page)) return undefined
    if (this.failed.has(page)) {
      const empty: PageLayout = { page, blocks: [], hasText: false }
      this.layouts.set(key, empty)
      return empty
    }
    const [lo, hi] = this.windowRange(page)
    const window: RawPage[] = []
    let index = 0
    for (let n = lo; n <= hi; n++) {
      if (n !== page && this.ocrPending(n)) continue
      const raw = this.ocrPages.get(n) ?? this.raw.get(n)
      if (!raw) continue
      if (n === page) index = window.length
      window.push(raw)
    }
    const result = layoutPage(page, window, index, { cleanup })
    this.layouts.set(key, result)
    return result
  }

  /**
   * The blocks shown for a page. A paragraph that runs over a page break is
   * shown whole on the page where it starts, and left out where it ends.
   * Depends on the pages two before and one after.
   */
  section(page: number, cleanup: boolean): Section | undefined {
    const own = this.layout(page, cleanup)
    if (!own) return undefined
    const inputs = [this.layout(page - 2, cleanup), this.layout(page - 1, cleanup), own, this.layout(page + 1, cleanup)]
    const key = `${cleanup ? 1 : 0}:${page}`
    const cached = this.sections.get(key)
    if (cached && cached.inputs.every((input, k) => input === inputs[k])) return cached.value

    const [beforePrev, prev, , next] = inputs
    const target = (a: PageLayout | undefined, b: PageLayout | undefined) => (a && b ? continuationTarget(a, b) : -1)
    // Joined into the previous page, unless that page's own first paragraph
    // was itself joined further back (then this one stays, rather than vanish).
    const firstJoinedBack = (p: PageLayout | undefined, before: PageLayout | undefined) => target(before, p) >= 0
    const intoPrev = target(prev, own)
    const skipFirst = intoPrev >= 0 && !(intoPrev === 0 && firstJoinedBack(prev, beforePrev))
    const intoOwn = target(own, next)
    const mergeAt = intoOwn >= 0 && !(intoOwn === 0 && skipFirst) ? intoOwn : -1

    const blocks = [...own.blocks]
    if (mergeAt >= 0 && next) {
      blocks[mergeAt] = mergeParagraphs(blocks[mergeAt] as ParagraphBlock, next.blocks[0] as ParagraphBlock, cleanup)
    }
    if (skipFirst) blocks.shift()

    const value: Section = { page, blocks, hasText: own.hasText }
    this.sections.set(key, { inputs, value })
    return value
  }

  /**
   * The section once it can no longer change: every page its page-break
   * mending looks at has been laid out. Undefined until then.
   */
  settledSection(page: number, cleanup: boolean): Section | undefined {
    for (const n of [page - 2, page - 1, page + 1]) {
      if (n >= 1 && n <= this.total && !this.layout(n, cleanup)) return undefined
    }
    return this.section(page, cleanup)
  }

  private nextPage(): number | null {
    // The reader's page and its layout window first, then outwards.
    for (let distance = 0; distance < this.total; distance++) {
      for (const n of [this.focus + distance, this.focus - distance]) {
        if (n >= 1 && n <= this.total && !this.raw.has(n) && !this.failed.has(n)) return n
      }
    }
    return null
  }

  private queueNotify() {
    if (this.notifyQueued) return
    this.notifyQueued = true
    requestAnimationFrame(() => {
      this.notifyQueued = false
      for (const listener of this.listeners) listener()
    })
  }

  private async pump() {
    if (this.running) return
    this.running = true
    try {
      while (!this.destroyed) {
        const n = this.nextPage()
        if (n === null) break
        try {
          const page = await this.doc.getPage(n)
          const raw = await extractPage(page)
          this.raw.set(n, raw)
          if (raw.items.some((item) => item.str.trim() !== '')) this.withText.add(n)
        } catch {
          if (this.destroyed) return
          this.failed.add(n)
        }
        this.queueNotify()
        if (this.ocr) void this.pumpOcr()
        // Leaves room for input and drawing between pages.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    } finally {
      this.running = false
    }
  }

  private nextOcrPage(): number | null {
    // The reader's page, then the ones after it before the ones behind.
    for (let distance = 0; distance <= Math.max(OCR_AHEAD, OCR_BEHIND); distance++) {
      const candidates = distance <= OCR_AHEAD ? [this.focus + distance] : []
      if (distance > 0 && distance <= OCR_BEHIND) candidates.push(this.focus - distance)
      for (const n of candidates) if (n >= 1 && n <= this.total && this.ocrPending(n)) return n
    }
    return null
  }

  private async pumpOcr() {
    if (this.ocrRunning || !this.ocr) return
    this.ocrRunning = true
    try {
      while (!this.destroyed && this.ocr) {
        const n = this.nextOcrPage()
        if (n === null) break
        const source: OcrSource = this.ocr
        try {
          this.ocrPages.set(n, await source.recognize(n))
        } catch {
          if (this.destroyed) return
          // A source that was replaced meanwhile failed by being stopped, not on this page.
          if (source === this.ocr) this.ocrFailed.add(n)
        }
        this.queueNotify()
      }
    } finally {
      this.ocrRunning = false
    }
  }
}

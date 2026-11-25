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
  }

  /** True once every page has been read (or failed to read). */
  get complete(): boolean {
    return this.raw.size + this.failed.size >= this.total
  }

  private pagesWithText = 0

  /** Enough pages have been read to say this PDF has no text layer at all (a scan). */
  noTextLayer = (): boolean => {
    const checked = this.raw.size + this.failed.size
    return this.pagesWithText === 0 && checked >= Math.min(this.total, 6)
  }

  private windowRange(page: number): [number, number] {
    return [Math.max(1, page - NEIGHBOURS), Math.min(this.total, page + NEIGHBOURS)]
  }

  private ready(page: number): boolean {
    const [lo, hi] = this.windowRange(page)
    for (let n = lo; n <= hi; n++) if (!this.raw.has(n) && !this.failed.has(n)) return false
    return true
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
      const raw = this.raw.get(n)
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
          if (raw.items.some((item) => item.str.trim() !== '')) this.pagesWithText++
        } catch {
          if (this.destroyed) return
          this.failed.add(n)
        }
        this.queueNotify()
        // Leaves room for input and drawing between pages.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    } finally {
      this.running = false
    }
  }
}

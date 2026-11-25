import type { TextStore } from '../text/store'
import { indexOfPoint, indexOfPosition, matchSelection, tokenizeSection, type Point, type Token } from './words'

/** A character in the text view: its section, block and offset. */
export interface TextPoint {
  section: number
  block: number
  offset: number
}

/** A spot on a PDF page: page number and height on it, as a fraction from the top. */
export interface Spot {
  page: number
  y: number
}

/** Where a scope starts or ends. The text point is exact; the spot alone is a whole line. */
export interface Locator {
  point?: TextPoint
  spot: Spot
}

export type Scope =
  | { kind: 'here'; start: Locator }
  | { kind: 'selection'; start: Locator; end: Locator; text: string }
  | { kind: 'pages'; from: number; to: number; title?: string }

export const spotOf = (at: Point): Spot => ({ page: at.page, y: at.y })

/**
 * The words of a scope, read from the text store a few pages at a time as
 * the reader gets near the end of what is ready. Nothing before the scope's
 * start is kept, so going back stops there.
 */
export class WordStream {
  readonly tokens: Token[] = []
  readonly first: number
  readonly last: number
  private next: number
  private startFound: boolean
  private endFound: boolean
  private readonly store: TextStore
  private readonly cleanup: boolean
  readonly scope: Scope

  constructor(store: TextStore, cleanup: boolean, scope: Scope) {
    this.store = store
    this.cleanup = cleanup
    this.scope = scope
    const total = store.total
    const clamp = (page: number) => Math.min(Math.max(1, page), total)
    if (scope.kind === 'pages') {
      // The page before may hold the start of a paragraph that runs onto the first page.
      this.first = clamp(scope.from - 1)
      this.last = clamp(scope.to)
    } else {
      this.first = clamp(scope.start.point?.section ?? scope.start.spot.page - 1)
      this.last = scope.kind === 'selection' ? clamp(scope.end.point?.section ?? scope.end.spot.page) : total
    }
    this.next = this.first
    this.startFound = scope.kind === 'pages'
    this.endFound = scope.kind !== 'selection'
  }

  /** Every word of the scope is in `tokens`. */
  get done(): boolean {
    return this.next > this.last && this.startFound && this.endFound
  }

  /** Share of the scope's pages read so far. */
  get pagesRead(): number {
    return Math.min(1, (this.next - this.first) / (this.last - this.first + 1))
  }

  /**
   * Reads pages until `wanted` tokens are ready or the scope is complete.
   * Returns false when it has to wait for the store to read more pages
   * (subscribe to it and call again).
   */
  fill(wanted: number): boolean {
    for (;;) {
      if (this.done) return true
      if (this.startFound && this.endFound && this.tokens.length >= wanted) return true
      if (this.next > this.last) {
        this.finish()
        return true
      }
      const section = this.store.settledSection(this.next, this.cleanup)
      if (!section) {
        this.store.setFocus(this.next)
        return false
      }
      const scope = this.scope
      const keep = scope.kind === 'pages' ? (at: Point) => at.page >= scope.from && at.page <= scope.to : undefined
      tokenizeSection(section, this.tokens, keep)
      this.next++
      this.findStart()
    }
  }

  private startPage(): number {
    const scope = this.scope
    if (scope.kind === 'pages') return scope.from
    return scope.start.point?.section ?? scope.start.spot.page
  }

  private findStart() {
    if (this.startFound || this.next <= this.startPage()) return
    const { start } = this.scope as Exclude<Scope, { kind: 'pages' }>
    const index = start.point
      ? indexOfPoint(this.tokens, start.point)
      : indexOfPosition(this.tokens, start.spot.page, start.spot.y)
    this.tokens.splice(0, index)
    this.startFound = true
  }

  private finish() {
    this.findStart()
    if (this.endFound || this.scope.kind !== 'selection') return
    const { end, start, text } = this.scope
    let stop = this.tokens.length
    if (end.point) {
      stop = Math.min(
        this.tokens.length,
        indexOfPoint(this.tokens, { ...end.point, offset: Math.max(0, end.point.offset - 1) }) + 1,
      )
    } else {
      for (let k = this.tokens.length - 1; k >= 0; k--) {
        const at = this.tokens[k].at
        if (at.page === end.spot.page && Math.abs(at.y - end.spot.y) < 0.004) {
          stop = k + 1
          break
        }
      }
    }
    if (!start.point || !end.point) {
      const [from, to] = matchSelection(this.tokens, 0, stop, text)
      this.tokens.splice(to)
      this.tokens.splice(0, from)
    } else {
      this.tokens.splice(stop)
    }
    this.endFound = true
  }
}

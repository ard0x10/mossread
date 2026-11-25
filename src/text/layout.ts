// Turns positioned PDF text into reading blocks: headings, paragraphs, code
// and placeholders for figures. A PDF stores where each run of text is drawn,
// not how it flows, so everything here is inferred from geometry.
//
// This file has no imports on purpose: the same code runs in the browser and
// in plain Node against sample PDFs.

/** One run of text in page space at scale 1. `y` is the baseline, from the page top. */
export interface RawItem {
  str: string
  x: number
  y: number
  w: number
  size: number
  font: string
}

export interface RawPage {
  width: number
  height: number
  items: RawItem[]
}

/** Where a line of a block came from, so the reader can return to that spot on the page. */
export interface Anchor {
  /** Character offset in the block's text where the line starts. */
  offset: number
  page: number
  /** Top of the line as a fraction of the page height. */
  y: number
}

export interface HeadingBlock {
  kind: 'heading'
  level: 1 | 2 | 3
  text: string
  anchors: Anchor[]
}

export interface ParagraphBlock {
  kind: 'paragraph'
  text: string
  anchors: Anchor[]
  /** The first line starts further in than the column edge. */
  indented: boolean
  /** Starts with a bullet or an item number. */
  list: boolean
  /** Font size relative to the body text. */
  rel: number
}

export interface CodeBlock {
  kind: 'code'
  text: string
  anchors: Anchor[]
}

/** Something drawn rather than written (a figure, a table, a diagram). */
export interface FigureBlock {
  kind: 'figure'
  page: number
  y: number
}

export type Block = HeadingBlock | ParagraphBlock | CodeBlock | FigureBlock
export type TextBlock = HeadingBlock | ParagraphBlock | CodeBlock

export interface PageLayout {
  page: number
  blocks: Block[]
  /** False for a page with no text layer at all, such as a scan. */
  hasText: boolean
}

export interface LayoutOptions {
  /** Drop running headers and page numbers, rejoin words split at line ends. */
  cleanup: boolean
}

/** Pages on each side used to recognise running headers and typical spacing. */
export const NEIGHBOURS = 4

interface Line {
  text: string
  x: number
  end: number
  y: number
  size: number
  mono: boolean
  /** Gaps wider than a few spaces inside the line, as in a table row. */
  wideGaps: number
}

interface PageStats {
  body: number
  leading: number
  column: number
  lefts: number[]
  textTop: number
}

const SPACE = /\s/
const TERMINAL = /[.!?\u2026:]["\u201D\u2019\u00BB)\]]*$/
const LIST_START = /^([\u2022\u00B7\u25AA\u25E6\u2023\u25CF\u25CB\u25A0\u25A1\u2013\-*]\s|\(?\d{1,3}[.)]\s|\(?[a-z][.)]\s)/
const LEADER = /\s*(\.\s?){4,}\s*(\d+|[ivxlcdm]+)\s*$/i
const LOWER_START =/^\p{Ll}/u
const HYPHEN_END = /(\p{L})[-\u2010\u00AD]$/u
const HYPHENATED = /\p{L}+[-\u2010]\p{L}+/gu
const PAGE_NUMBER = /^[-\u2013\u2014\s]*(page\s+)?(\d{1,4}|[ivxlcdm]{1,7})(\s*(of|\/)\s*\d{1,4})?[-\u2013\u2014\s]*$/i
const INVISIBLE = /\u00AD|\u200B|\u200C|\u200D|\uFEFF/g

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const quantile = (values: number[], q: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
}

/** Fonts whose characters all have the same advance, judged from runs of differing length. */
export function findMonospaceFonts(pages: readonly RawPage[]): Set<string> {
  const samples = new Map<string, { ratios: number[]; lengths: Set<number> }>()
  for (const page of pages) {
    for (const item of page.items) {
      const length = item.str.length
      if (length < 3 || item.w <= 0 || item.size <= 0) continue
      let entry = samples.get(item.font)
      if (!entry) {
        entry = { ratios: [], lengths: new Set() }
        samples.set(item.font, entry)
      }
      entry.ratios.push(item.w / (length * item.size))
      entry.lengths.add(length)
    }
  }
  const mono = new Set<string>()
  for (const [font, { ratios, lengths }] of samples) {
    if (ratios.length < 4 || lengths.size < 2) continue
    const mid = median(ratios)
    const spread = (Math.max(...ratios) - Math.min(...ratios)) / mid
    if (spread < 0.04) mono.add(font)
  }
  return mono
}

function charWidth(items: readonly RawItem[], size: number): number {
  const ratios = items.filter((i) => i.str.length >= 2).map((i) => i.w / (i.str.length * i.size))
  return (median(ratios) || 0.6) * size
}

/** Groups runs into lines in drawing order; a run that drops below or jumps back starts a new line. */
export function buildLines(page: RawPage, mono: ReadonlySet<string>): Line[] {
  const lines: Line[] = []
  let current: RawItem[] = []

  const flush = () => {
    const items = current
    current = []
    const visible = items.filter((i) => i.str.trim() !== '')
    if (visible.length === 0) return

    let size = 0
    let longest = -1
    for (const item of visible) {
      if (item.str.length > longest) {
        longest = item.str.length
        size = item.size
      }
    }
    const isMono = visible.every((i) => mono.has(i.font) || i.str.trim().length <= 1)
      && visible.some((i) => mono.has(i.font))
    const advance = isMono ? charWidth(visible.filter((i) => mono.has(i.font)), size) : 0

    let text = ''
    let wideGaps = 0
    let lastEnd = visible[0].x
    for (let k = 0; k < visible.length; k++) {
      const item = visible[k]
      if (k > 0) {
        const gap = item.x - lastEnd
        if (gap > 1.5 * size) wideGaps++
        const hasSpace = SPACE.test(text.at(-1) ?? ' ') || SPACE.test(item.str[0])
        if (isMono && gap > advance * 0.5) {
          text += ' '.repeat(Math.max(1, Math.round(gap / advance)))
        } else if (!hasSpace && gap > 0.12 * size) {
          text += ' '
        }
      }
      text += item.str
      lastEnd = Math.max(lastEnd, item.x + item.w)
    }

    const first = visible[0]
    lines.push({
      text: isMono ? text.trimEnd() : text.replace(/\s+/g, ' ').trim(),
      x: Math.min(...visible.map((i) => i.x)),
      end: lastEnd,
      y: median(visible.map((i) => i.y)) || first.y,
      size,
      mono: isMono,
      wideGaps,
    })
  }

  for (const item of page.items) {
    if (item.str === '') continue
    const last = current.at(-1)
    if (last) {
      const lineSize = Math.max(last.size, item.size)
      const sameLine = Math.abs(item.y - last.y) <= 0.45 * lineSize
      const forward = item.x >= last.x + last.w - 0.6 * lineSize
      if (!sameLine || !forward) flush()
    }
    current.push(item)
  }
  flush()
  return lines
}

const normalise = (text: string) => text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()

function inMargin(line: Line, page: RawPage): boolean {
  return line.y - line.size < page.height * 0.1 || line.y > page.height * 0.9
}

/** Lines that repeat in the same place on nearby pages, and bare page numbers. */
/** A page number printed at either end of a margin line, as in "18.10 Data encapsulation 179". */
function edgeNumber(text: string): number | null {
  const match = /^(\d{1,4})\s|\s(\d{1,4})$/.exec(text)
  return match ? Number(match[1] ?? match[2]) : null
}

function furniture(
  lines: Line[],
  page: RawPage,
  neighbours: Array<{ page: RawPage; lines: Line[]; offset: number }>,
): Set<Line> {
  const drop = new Set<Line>()
  const needed = Math.min(2, neighbours.length)
  for (const line of lines) {
    if (!inMargin(line, page)) continue
    if (PAGE_NUMBER.test(line.text)) {
      drop.add(line)
      continue
    }
    const key = normalise(line.text)
    const number = edgeNumber(line.text)
    let seen = 0
    for (const other of neighbours) {
      // The same line in the same place, or a running head whose title changes
      // but whose page number moves in step with the page.
      const match = other.lines.some(
        (o) =>
          inMargin(o, other.page) &&
          Math.abs(o.y / other.page.height - line.y / page.height) < 0.03 &&
          (normalise(o.text) === key || (number !== null && edgeNumber(o.text) === number + other.offset)),
      )
      if (match) seen++
      if (seen >= needed) break
    }
    if (needed > 0 && seen >= needed) drop.add(line)
  }
  return drop
}

function measure(pages: Array<{ page: RawPage; lines: Line[] }>): PageStats {
  const weights = new Map<number, number>()
  for (const { lines } of pages) {
    for (const line of lines) {
      if (line.mono) continue
      const key = Math.round(line.size * 4) / 4
      weights.set(key, (weights.get(key) ?? 0) + line.text.length)
    }
  }
  let body = 10
  let best = -1
  for (const [size, weight] of weights) {
    if (weight > best) {
      best = weight
      body = size
    }
  }

  const steps: number[] = []
  const widths: number[] = []
  const starts = new Map<number, number>()
  const tops: number[] = []
  for (const { lines } of pages) {
    const bodyLines = lines.filter((l) => !l.mono && Math.abs(l.size - body) <= body * 0.06)
    if (bodyLines.length > 0) tops.push(Math.min(...bodyLines.map((l) => l.y - l.size)))
    for (let k = 1; k < lines.length; k++) {
      const a = lines[k - 1]
      const b = lines[k]
      if (a.mono || b.mono || Math.abs(a.size - body) > body * 0.06 || Math.abs(b.size - body) > body * 0.06) continue
      const step = b.y - a.y
      if (step > 0.9 * body && step < 2.2 * body) steps.push(step)
    }
    for (const line of bodyLines) {
      widths.push(line.end - line.x)
      const x = Math.round(line.x)
      starts.set(x, (starts.get(x) ?? 0) + 1)
    }
  }
  const lefts = [...starts]
    .filter(([, count]) => count >= 3)
    .map(([x]) => x)
    .sort((a, b) => a - b)

  return {
    body,
    leading: median(steps) || body * 1.2,
    column: quantile(widths, 0.9) || 400,
    lefts,
    textTop: tops.length > 0 ? Math.min(...tops) : 0,
  }
}

function indentOf(line: Line, stats: PageStats): number {
  let left = -Infinity
  for (const x of stats.lefts) if (x <= line.x + 1) left = x
  return left === -Infinity ? 0 : line.x - left
}

/** Hyphenated words written mid-line on these pages, such as "e-mail". */
function hyphenatedWords(lines: Iterable<Line>): Set<string> {
  const words = new Set<string>()
  for (const line of lines) {
    for (const match of line.text.matchAll(HYPHENATED)) {
      if (match.index + match[0].length < line.text.length) words.add(match[0].toLowerCase())
    }
  }
  return words
}

/** Joins the next line (or page) onto text, rejoining a word split by a line-end hyphen. */
export function joinText(before: string, after: string, cleanup: boolean, hyphenated: ReadonlySet<string>): string {
  if (before === '') return after
  const split = HYPHEN_END.exec(before)
  if (split && cleanup && LOWER_START.test(after)) {
    const head = /\p{L}+[-\u2010\u00AD]$/u.exec(before)?.[0] ?? ''
    const tail = /^\p{L}+/u.exec(after)?.[0] ?? ''
    const kept = `${head.slice(0, -1)}-${tail}`.toLowerCase()
    return hyphenated.has(kept) ? before.replace(/\u00AD$/, '-') + after : before.slice(0, -1) + after
  }
  if (split || /[\u2013\u2014/]$/.test(before)) return before + after
  // "152-" + "layer": a hyphen after a number never splits a word, so it stays with no space.
  if (/\p{N}-$/u.test(before) && LOWER_START.test(after)) return before + after
  return `${before} ${after}`
}

export function isOpen(block: ParagraphBlock): boolean {
  return !TERMINAL.test(block.text)
}

export function startsLower(block: ParagraphBlock): boolean {
  return LOWER_START.test(block.text)
}

const clean = (text: string) => text.replace(INVISIBLE, '')

/**
 * Lays out one page. `window` holds the page itself plus up to NEIGHBOURS
 * pages on either side (`index` is the page's position in it); the
 * neighbours give running headers and typical spacing.
 */
export function layoutPage(
  pageNumber: number,
  window: readonly RawPage[],
  index: number,
  options: LayoutOptions,
  hyphenatedExtra?: ReadonlySet<string>,
): PageLayout {
  const mono = findMonospaceFonts(window)
  const all = window.map((page) => ({ page, lines: buildLines(page, mono) }))
  const { page, lines: pageLines } = all[index]
  if (pageLines.length === 0) return { page: pageNumber, blocks: [], hasText: false }

  const neighbours = all.map((entry, k) => ({ ...entry, offset: k - index })).filter((n) => n.offset !== 0)
  const stats = measure(all)
  const dropped = options.cleanup ? furniture(pageLines, page, neighbours) : new Set<Line>()
  const lines = pageLines.filter((l) => !dropped.has(l))
  const hyphenated = hyphenatedWords(all.flatMap((p) => p.lines))
  for (const word of hyphenatedExtra ?? []) hyphenated.add(word)

  const { body, leading, column } = stats
  const blocks: Block[] = []
  const toY = (line: Line) => Math.max(0, (line.y - line.size) / page.height)
  const anchor = (offset: number, line: Line): Anchor => ({ offset, page: pageNumber, y: toY(line) })

  const figure = (y: number) => {
    if (blocks.at(-1)?.kind !== 'figure') blocks.push({ kind: 'figure', page: pageNumber, y })
  }

  // Runs of lines that look like parts of a drawing: table rows, or small
  // scattered labels. Two or more in a row become one figure placeholder.
  // Code keeps its own column alignment, so wide gaps there are not a table.
  const isTableRow = (l: Line) => !l.mono && l.wideGaps >= 2
  const isLabel = (l: Line) => !l.mono && l.size < body * 0.88 && l.end - l.x < column * 0.5
  const isHeading = (l: Line) => !l.mono && l.size >= body * 1.15 && l.text.length < 200

  let current: TextBlock | null = null
  let currentSize = body
  let codeStep = 0
  let codeLeft = 0
  let codeAdvance = body * 0.6
  const codeIndent = (line: Line) => ' '.repeat(Math.max(0, Math.round((line.x - codeLeft) / codeAdvance)))
  let prev: Line | null = null
  const finish = () => {
    if (current) blocks.push(current)
    current = null
  }

  if (lines.length > 0) {
    const first = lines[0]
    const gap = first.y - first.size - stats.textTop
    if (stats.textTop > 0 && gap > leading * 6 && !isHeading(first)) figure(stats.textTop / page.height)
  }

  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]
    // A contents line keeps its own line; its dot leader shrinks to a separator.
    const leader = LEADER.test(line.text)
    const tidy = options.cleanup ? clean(line.text) : line.text
    const text = options.cleanup && leader ? tidy.replace(LEADER, ' \u00B7 $2') : tidy
    const step = prev ? line.y - prev.y : 0
    const scaled = leading * (line.size / body)
    const jumpedUp = prev !== null && step < -scaled * 1.5

    const drawingRun = (test: (l: Line) => boolean) => {
      let n = k
      while (n < lines.length && test(lines[n])) n++
      return n - k
    }
    const run = Math.max(drawingRun(isTableRow), drawingRun(isLabel))
    const continuesParagraph =
      current !== null && (current as TextBlock).kind === 'paragraph' && prev !== null && step > 0 && step < scaled * 1.3
    if (run >= 2 && !continuesParagraph) {
      finish()
      figure(toY(line))
      k += run - 1
      prev = lines[k]
      continue
    }

    if (prev && !jumpedUp && step > leading * 5 && !isHeading(line)) {
      finish()
      figure(prev.y / page.height)
    }

    if (line.mono) {
      const block = current as TextBlock | null
      if (block && block.kind === 'code' && !jumpedUp && step > 0 && step < (codeStep || line.size * 1.4) * 4) {
        codeStep = codeStep ? Math.min(codeStep, step) : step
        const blank = Math.max(0, Math.round(step / codeStep) - 1)
        block.text += '\n'.repeat(blank + 1)
        block.anchors.push(anchor(block.text.length, line))
        block.text += codeIndent(line) + text
      } else {
        finish()
        codeStep = 0
        // Indentation is measured from the leftmost line of the block, in characters.
        let n = k
        while (n < lines.length && lines[n].mono) n++
        codeLeft = Math.min(...lines.slice(k, n).map((l) => l.x))
        codeAdvance = advanceFor(line)
        current = { kind: 'code', text: codeIndent(line) + text, anchors: [anchor(0, line)] }
      }
      prev = line
      continue
    }

    if (isHeading(line)) {
      const block = current as TextBlock | null
      if (block && block.kind === 'heading' && Math.abs(line.size - currentSize) < currentSize * 0.03 && step > 0 && step < line.size * 1.8) {
        block.anchors.push(anchor(block.text.length + 1, line))
        block.text = joinText(block.text, text, options.cleanup, hyphenated)
      } else {
        finish()
        const ratio = line.size / body
        current = { kind: 'heading', level: ratio >= 1.6 ? 1 : ratio >= 1.3 ? 2 : 3, text, anchors: [anchor(0, line)] }
        currentSize = line.size
      }
      prev = line
      continue
    }

    const block = current as TextBlock | null
    let fresh = true
    if (block && block.kind === 'paragraph' && prev && !prev.mono) {
      const sizeChanged = Math.abs(line.size - currentSize) > currentSize * 0.12
      const gap = !jumpedUp && step > scaled * 1.3
      const lineIndent = indentOf(line, stats)
      const indent = lineIndent > 0.6 * line.size && lineIndent > indentOf(prev, stats) + 0.6 * line.size
      const hanging = block.list && line.x > prev.x - 0.5 * line.size
      const prevShort = prev.end - prev.x < column * 0.8 && TERMINAL.test(prev.text)
      const listItem = LIST_START.test(text)
      const overlap = !jumpedUp && step <= 0
      const contents = leader || LEADER.test(prev.text)
      fresh = sizeChanged || gap || (indent && !hanging) || prevShort || listItem || overlap || contents
    }

    if (fresh) {
      finish()
      const lineIndent = indentOf(line, stats)
      current = {
        kind: 'paragraph',
        text,
        anchors: [anchor(0, line)],
        indented: lineIndent > 0.6 * line.size,
        list: LIST_START.test(text),
        rel: line.size / body,
      }
      currentSize = line.size
    } else if (block && block.kind === 'paragraph') {
      const joined = joinText(block.text, text, options.cleanup, hyphenated)
      block.anchors.push(anchor(joined.length - text.length, line))
      block.text = joined
    }
    prev = line
  }
  finish()

  return { page: pageNumber, blocks: reattach(promoteHeadings(blocks), options.cleanup), hasText: true }

  function advanceFor(line: Line): number {
    const items = page.items.filter(
      (i) => mono.has(i.font) && Math.abs(i.y - line.y) < 0.2 * line.size && i.str.length >= 2,
    )
    return charWidth(items, line.size)
  }
}

const NUMBERED_HEADING = /^\d+(\.\d+)+\.?\s+\p{Lu}/u

/** "3.1. Residual Learning" set in body type on a line of its own is still a heading. */
function promoteHeadings(blocks: Block[]): Block[] {
  return blocks.map((block) =>
    block.kind === 'paragraph' &&
    block.anchors.length === 1 &&
    block.text.length < 80 &&
    NUMBERED_HEADING.test(block.text) &&
    !TERMINAL.test(block.text)
      ? { kind: 'heading', level: 3, text: block.text, anchors: block.anchors }
      : block,
  )
}

/** Footnotes, captions and figures that can sit between two halves of a paragraph. */
const interrupts = (block: Block) => block.kind === 'figure' || (block.kind === 'paragraph' && block.rel < 0.9)

function resumes(open: ParagraphBlock, next: Block | undefined): next is ParagraphBlock {
  return (
    next?.kind === 'paragraph' &&
    !next.indented &&
    !next.list &&
    Math.abs(next.rel - open.rel) <= 0.1 &&
    (isOpen(open) || startsLower(next))
  )
}

/** A paragraph broken by a footnote or a figure is joined up again; the interruption follows it. */
function reattach(blocks: Block[], cleanup: boolean): Block[] {
  const out = [...blocks]
  for (let i = 0; i < out.length; i++) {
    const block = out[i]
    if (block.kind !== 'paragraph' || block.rel < 0.9 || !isOpen(block)) continue
    let j = i + 1
    while (j < out.length && interrupts(out[j])) j++
    const next = out[j]
    if (j === i + 1 || !resumes(block, next) || !startsLower(next)) continue
    out[i] = mergeParagraphs(block, next, cleanup)
    out.splice(j, 1)
    i--
  }
  return out
}

/**
 * Index of the paragraph on the previous page that the next page opens in
 * the middle of, or -1. Footnotes and figures at the foot of the previous
 * page are looked past; the joined text then comes before them.
 */
export function continuationTarget(previous: PageLayout | undefined, next: PageLayout): number {
  if (!previous) return -1
  let k = previous.blocks.length - 1
  while (k >= 0 && interrupts(previous.blocks[k])) k--
  const last = previous.blocks[k]
  const first = next.blocks[0]
  if (last?.kind !== 'paragraph' || !resumes(last, first)) return -1
  // Past an interruption, only a lowercase start is evidence enough.
  if (k < previous.blocks.length - 1 && !startsLower(first)) return -1
  return k
}

/** One paragraph split across a page break, put back together. */
export function mergeParagraphs(a: ParagraphBlock, b: ParagraphBlock, cleanup: boolean): ParagraphBlock {
  const text = joinText(a.text, b.text, cleanup, new Set())
  const shift = text.length - b.text.length
  return {
    ...a,
    text,
    anchors: [...a.anchors, ...b.anchors.map((anchor) => ({ ...anchor, offset: anchor.offset + shift }))],
  }
}

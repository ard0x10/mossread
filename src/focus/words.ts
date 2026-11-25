// Turns reading blocks into a stream of words for the focus modes, groups
// them into what is shown at once, and decides how long each group stays.
//
// No imports on purpose: the same code runs in the browser and in plain Node
// against sample PDFs (see the lab scripts).

/** Where a word sits: the text view's section and block, and the spot on the PDF page. */
export interface Point {
  /** Page whose section holds the block (a paragraph that runs over a page break sits in the first one). */
  section: number
  /** Index of the block in that section. */
  block: number
  /** Character offset in the block's text. */
  offset: number
  page: number
  /** Top of the line as a fraction of the page height. */
  y: number
}

export const SENTENCE = 1
export const CLAUSE = 2
export const PARAGRAPH = 4
export const HEADING = 8

export interface WordToken {
  kind: 'word'
  text: string
  at: Point
  /** SENTENCE, CLAUSE, PARAGRAPH and HEADING bits. */
  flags: number
}

/** Something not read word by word (code, a figure); shown as a short card. */
export interface CardToken {
  kind: 'card'
  label: 'code' | 'figure'
  at: Point
}

export type Token = WordToken | CardToken

interface InputAnchor {
  offset: number
  page: number
  y: number
}

/** The parts of a layout block this file reads. */
export type InputBlock =
  | { kind: 'heading' | 'paragraph'; text: string; anchors: readonly InputAnchor[] }
  | { kind: 'code'; text: string; anchors: readonly InputAnchor[] }
  | { kind: 'figure'; page: number; y: number }

export interface InputSection {
  page: number
  blocks: readonly InputBlock[]
}

const WORD = /\S+/gu
const SENTENCE_END = /[.!?…]['"\p{Pe}\p{Pf}]*$/u
const CLAUSE_END = /[,;:]['"\p{Pe}\p{Pf}]*$|^\p{Pd}+$/u
const OPENS_SENTENCE = /^['"\p{Ps}\p{Pi}]*[\p{Lu}\p{Lt}\p{N}]/u
const INITIAL = /^\p{L}\.$|^(\p{L}\.){2,}$/u
const ABBREVIATIONS = new Set([
  'al.',
  'cf.',
  'ch.',
  'dr.',
  'e.g.',
  'eq.',
  'eqs.',
  'fig.',
  'figs.',
  'i.e.',
  'mr.',
  'mrs.',
  'ms.',
  'no.',
  'p.',
  'pp.',
  'sec.',
  'st.',
  'vol.',
  'vs.',
  'vb.',
  'örn.',
  'bkz.',
])
const LETTER = /[\p{L}\p{N}]/u

/** Appends the tokens of one section of the text view, in reading order. */
export function tokenizeSection(section: InputSection, out: Token[], keep: (at: Point) => boolean = () => true) {
  section.blocks.forEach((block, index) => {
    if (block.kind === 'figure') {
      const at = { section: section.page, block: index, offset: 0, page: block.page, y: block.y }
      if (keep(at)) out.push({ kind: 'card', label: 'figure', at })
      return
    }
    const first = block.anchors[0]
    if (!first) return
    if (block.kind === 'code') {
      const at = { section: section.page, block: index, offset: 0, page: first.page, y: first.y }
      if (keep(at)) out.push({ kind: 'card', label: 'code', at })
      return
    }
    const words = [...block.text.matchAll(WORD)]
    let anchor = 0
    for (let k = 0; k < words.length; k++) {
      const match = words[k]
      const offset = match.index
      while (anchor + 1 < block.anchors.length && block.anchors[anchor + 1].offset <= offset) anchor++
      const { page, y } = block.anchors[anchor]
      const at = { section: section.page, block: index, offset, page, y }
      if (!keep(at)) continue
      const text = match[0]
      const last = k === words.length - 1
      let flags = 0
      if (last) flags |= PARAGRAPH
      else if (endsSentence(text, words[k + 1][0])) flags |= SENTENCE
      else if (CLAUSE_END.test(text)) flags |= CLAUSE
      if (block.kind === 'heading') flags |= HEADING
      out.push({ kind: 'word', text, at, flags })
    }
  })
}

function endsSentence(word: string, next: string): boolean {
  if (!SENTENCE_END.test(word)) return false
  const bare = word.toLowerCase().replace(/^['"\p{Ps}\p{Pi}]+|['"\p{Pe}\p{Pf}]+$/gu, '')
  if (ABBREVIATIONS.has(bare) || INITIAL.test(bare)) return false
  return OPENS_SENTENCE.test(next)
}

const ends = (token: Token | undefined) =>
  token === undefined || token.kind === 'card' || (token.flags & (SENTENCE | PARAGRAPH)) !== 0

/** Words longer than this are shown on their own when several are shown at once. */
const LONG_WORD = 12

/** End (exclusive) of the group shown at `from`: up to `size` words, never past a punctuation mark. */
export function chunkEnd(tokens: readonly Token[], from: number, size: number): number {
  const first = tokens[from]
  if (!first) return from
  if (first.kind === 'card') return from + 1
  let end = from
  while (end < tokens.length && end - from < size) {
    const token = tokens[end]
    if (token.kind === 'card') break
    if (end > from && token.text.length > LONG_WORD) break
    end++
    if (token.flags & (SENTENCE | CLAUSE | PARAGRAPH)) break
    if (size > 1 && token.text.length > LONG_WORD) break
  }
  return end
}

const sameBlock = (a: Token, b: Token) => a.at.section === b.at.section && a.at.block === b.at.block

const breaksAfter = (token: Token) => token.kind === 'card' || (token.flags & (SENTENCE | CLAUSE | PARAGRAPH)) !== 0

/**
 * The groups [start, end) next to the one at [from, to), up to `count` on
 * each side and never outside its paragraph or heading. The groups after are
 * the ones that will be shown next; the ones before are cut the same way,
 * starting again at each punctuation mark as reading does.
 */
export function neighbourGroups(
  tokens: readonly Token[],
  from: number,
  to: number,
  size: number,
  count: number,
): { before: [number, number][]; after: [number, number][] } {
  const before: [number, number][] = []
  const after: [number, number][] = []
  const here = tokens[from]
  if (!here || here.kind === 'card' || count <= 0) return { before, after }
  const inBlock = (k: number) => {
    const token = tokens[k]
    return token !== undefined && token.kind === 'word' && sameBlock(token, here)
  }

  let start = from
  while (before.length < count && inBlock(start - 1)) {
    let segment = start - 1
    while (inBlock(segment - 1) && !breaksAfter(tokens[segment - 1])) segment--
    const groups: [number, number][] = []
    for (let k = segment; k < start; ) {
      const end = Math.min(chunkEnd(tokens, k, size), start)
      groups.push([k, end])
      k = end
    }
    before.unshift(...groups.slice(-(count - before.length)))
    start = segment
  }

  for (let k = to; after.length < count && inBlock(k); ) {
    const end = chunkEnd(tokens, k, size)
    after.push([k, end])
    k = end
  }
  return { before, after }
}

export const CARD_MS = 1100
/** Groups after a start or a resume that are shown slower, rising to full speed. */
export const RAMP = 8

/** How long the group [from, to) stays on screen, at full speed. */
export function chunkDuration(tokens: readonly Token[], from: number, to: number, wpm: number): number {
  const base = 60000 / wpm
  let ms = 0
  for (let k = from; k < to; k++) {
    const token = tokens[k]
    if (token.kind === 'card') {
      ms += CARD_MS
      continue
    }
    const letters = token.text.length
    ms += base * Math.min(1.8, 1 + Math.max(0, letters - 8) * 0.06)
  }
  const last = tokens[to - 1]
  if (last?.kind === 'word') {
    if (last.flags & (PARAGRAPH | HEADING)) ms += base * 1.5
    else if (last.flags & SENTENCE) ms += base
    else if (last.flags & CLAUSE) ms += base * 0.5
  }
  return ms
}

/** Slows the first groups after a start: 1.6 times as long at first, full speed after RAMP groups. */
export function rampFactor(shown: number): number {
  if (shown >= RAMP) return 1
  return 1 + 0.6 * (1 - shown / RAMP)
}

/** Reading time from `from` to `to` at full speed, as shown at `size` words a group. */
export function timeBetween(tokens: readonly Token[], from: number, to: number, size: number, wpm: number): number {
  let ms = 0
  let k = from
  while (k < to) {
    const end = Math.min(chunkEnd(tokens, k, size), to)
    ms += chunkDuration(tokens, k, end, wpm)
    k = end
  }
  return ms
}

/** Start of the sentence holding token `i`, not before `min`. */
export function sentenceStart(tokens: readonly Token[], i: number, min = 0): number {
  let k = Math.min(i, tokens.length - 1)
  while (k > min && !ends(tokens[k - 1])) k--
  return Math.max(k, min)
}

/** End (exclusive) of the sentence holding token `i`. */
export function sentenceEnd(tokens: readonly Token[], i: number): number {
  let k = i
  while (k < tokens.length && !ends(tokens[k])) k++
  return Math.min(k + 1, tokens.length)
}

/**
 * Where "back one sentence" goes from token `i`: the start of this sentence,
 * or the one before when this one has only just begun.
 */
export function rewindSentence(tokens: readonly Token[], i: number, min = 0): number {
  const start = sentenceStart(tokens, i, min)
  if (i > start + 1) return start
  return start > min ? sentenceStart(tokens, start - 1, min) : min
}

/** The token reached after reading for `ms` from `i` (always at least one group on). */
export function skipTime(tokens: readonly Token[], i: number, ms: number, size: number, wpm: number): number {
  let k = i
  let spent = 0
  while (k < tokens.length && spent < ms) {
    const end = chunkEnd(tokens, k, size)
    spent += chunkDuration(tokens, k, end, wpm)
    k = end
  }
  return k
}

/**
 * Index of the character the eye should rest on: a little left of centre
 * for one word, near the middle for a group.
 */
export function pivotIndex(text: string, group: boolean): number {
  const letters: number[] = []
  for (let k = 0; k < text.length; k++) if (LETTER.test(text[k])) letters.push(k)
  if (letters.length === 0) return 0
  let at: number
  if (group) at = Math.floor(letters.length * 0.45)
  else {
    const n = letters.length
    at = n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : 4
  }
  return letters[Math.min(at, letters.length - 1)]
}

const comparePoints = (
  a: Pick<Point, 'section' | 'block' | 'offset'>,
  b: Pick<Point, 'section' | 'block' | 'offset'>,
) => a.section - b.section || a.block - b.block || a.offset - b.offset

/**
 * First token at or after this text point: the word holding that character,
 * or the next one. Tokens are in reading order, which is also point order.
 */
export function indexOfPoint(tokens: readonly Token[], point: Pick<Point, 'section' | 'block' | 'offset'>): number {
  let lo = 0
  let hi = tokens.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (comparePoints(tokens[mid].at, point) <= 0) lo = mid + 1
    else hi = mid
  }
  // lo is the first token after the point; the one before holds it if it is in the same block.
  const before = tokens[lo - 1]
  if (before && before.at.section === point.section && before.at.block === point.block) {
    const length = before.kind === 'word' ? before.text.length : 1
    if (point.offset < before.at.offset + length) return lo - 1
  }
  return lo
}

/** First token on the line that starts at this spot of the page, or the first one after it in reading order. */
export function indexOfPosition(tokens: readonly Token[], page: number, y: number): number {
  let firstOnPage = -1
  for (let k = 0; k < tokens.length; k++) {
    const at = tokens[k].at
    if (at.page < page) continue
    if (at.page > page) return firstOnPage >= 0 ? firstOnPage : k
    if (firstOnPage < 0) firstOnPage = k
    if (at.y >= y - 0.002) return k
  }
  return firstOnPage >= 0 ? firstOnPage : tokens.length
}

const bare = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * Narrows the tokens [from, to) to the words of a selected text, when the
 * selection is only known by the lines it covers (the page view).
 * Returns the range unchanged if the words can't be matched.
 */
export function matchSelection(tokens: readonly Token[], from: number, to: number, selected: string): [number, number] {
  const wanted = (selected.match(WORD) ?? []).map(bare).filter(Boolean)
  if (wanted.length === 0) return [from, to]
  const head = wanted.slice(0, 3)
  const textOf = (k: number) => {
    const token = tokens[k]
    return token?.kind === 'word' ? bare(token.text) : ''
  }
  for (let k = from; k < to; k++) {
    // A selection can start or stop inside a word: the first selected word may
    // be the end of a word, the last one its start.
    const fits = (word: string, j: number) => {
      const text = textOf(k + j)
      if (text === word) return true
      if (j === 0 && head.length > 1) return text.endsWith(word)
      return j === head.length - 1 && text.startsWith(word)
    }
    if (head.every(fits)) {
      let end = k
      let seen = 0
      while (end < to && seen < wanted.length) {
        if (tokens[end].kind === 'word') seen++
        end++
      }
      return [k, end]
    }
  }
  return [from, to]
}

// What the text view knows about the blocks it has drawn: which layout block
// each element shows, where its characters and lines are on screen, and how
// a spot on the PDF page maps back to a character.

import type { Locator, Spot, TextPoint } from '../focus/stream'
import type { Block } from '../text/layout'

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

export function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as CaretDocument
  if (doc.caretPositionFromPoint) {
    const caret = doc.caretPositionFromPoint(x, y)
    return caret ? { node: caret.offsetNode, offset: caret.offset } : null
  }
  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y)
    return range ? { node: range.startContainer, offset: range.startOffset } : null
  }
  return null
}

export function firstTextNode(element: Element): Text | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  return walker.nextNode() as Text | null
}

/** The block each element on screen shows, so positions are read from what is drawn. */
export const renderedBlocks = new WeakMap<Element, Block>()

export const register = (block: Block) => (element: Element | null) => {
  if (element) renderedBlocks.set(element, block)
}

/** Screen top of the line holding this character of an element's text. */
export function offsetTop(element: Element, offset: number): number {
  const text = firstTextNode(element)
  // Measured on the character even at offset 0: a code block's padding sits above its first line.
  if (!text || text.length === 0) return element.getBoundingClientRect().top
  const range = document.createRange()
  const at = Math.min(offset, text.length - 1)
  range.setStart(text, at)
  range.setEnd(text, at + 1)
  const rects = range.getClientRects()
  return rects.length > 0 ? rects[rects.length - 1].top : element.getBoundingClientRect().top
}

/** An element and a character in its text. */
export interface ElementSpot {
  element: HTMLElement
  offset: number
}

/**
 * The drawn line that came from this spot of the page: the line closest
 * above the target height. In two columns the left one comes first in
 * reading order and wins a tie. Searched among the blocks on screen.
 */
export function findSpot(root: ParentNode, target: Spot): ElementSpot | null {
  let best: ElementSpot | null = null
  let bestY = -Infinity
  let fallback: ElementSpot | null = null
  for (const sectionPage of [target.page - 1, target.page]) {
    for (const element of root.querySelectorAll<HTMLElement>(`[data-page="${sectionPage}"] [data-b]`)) {
      const block = renderedBlocks.get(element)
      if (!block) continue
      const points = block.kind === 'figure' ? [{ offset: 0, page: block.page, y: block.y }] : block.anchors
      for (const a of points) {
        if (a.page !== target.page) continue
        const here: ElementSpot = { element, offset: a.offset }
        fallback ??= here
        if (a.y <= target.y + 0.01 && a.y > bestY + 0.004) {
          best = here
          bestY = a.y
        }
      }
    }
  }
  return best ?? fallback
}

/** The element showing this block of the text view, if it is drawn. */
export function elementOf(root: ParentNode, point: TextPoint): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-page="${point.section}"] [data-b="${point.block}"]`)
}

/** Text point and page spot of a character in a drawn block. */
export function locatorOf(element: Element, offset: number): Locator | null {
  const section = element.closest<HTMLElement>('[data-page]')
  const block = renderedBlocks.get(element)
  if (!section || !block) return null
  const point: TextPoint = {
    section: Number(section.dataset.page),
    block: Number((element as HTMLElement).dataset.b),
    offset,
  }
  if (block.kind === 'figure') return { point, spot: { page: block.page, y: block.y } }
  let found = block.anchors[0]
  for (const a of block.anchors) if (a.offset <= offset) found = a
  return { point, spot: { page: found.page, y: found.y } }
}

/** Offset in an element's text of a DOM boundary inside it. */
export function textOffset(element: Element, node: Node, offset: number): number {
  const range = document.createRange()
  range.setStart(element, 0)
  range.setEnd(node, offset)
  return range.toString().length
}

export interface LineBox {
  /** Offset of the line's first character in the element's text. */
  offset: number
  top: number
  bottom: number
  left: number
  right: number
}

function boxOf(element: Element): LineBox {
  const r = element.getBoundingClientRect()
  return { offset: 0, top: r.top, bottom: r.bottom, left: r.left, right: r.right }
}

/**
 * The lines an element is drawn on, in screen space, with the offset each
 * one starts at. Cards and empty blocks count as one line.
 */
export function lineBoxes(element: HTMLElement): LineBox[] {
  const block = renderedBlocks.get(element)
  const text = block && block.kind !== 'figure' ? firstTextNode(element) : null
  if (!text || text.length === 0) return [boxOf(element)]

  const range = document.createRange()
  range.selectNodeContents(text)
  const lines: LineBox[] = []
  for (const r of range.getClientRects()) {
    if (r.width === 0 || r.height === 0) continue
    const last = lines.at(-1)
    const middle = (r.top + r.bottom) / 2
    if (last && middle >= last.top && middle <= last.bottom) {
      last.left = Math.min(last.left, r.left)
      last.right = Math.max(last.right, r.right)
      last.top = Math.min(last.top, r.top)
      last.bottom = Math.max(last.bottom, r.bottom)
    } else {
      lines.push({ offset: 0, top: r.top, bottom: r.bottom, left: r.left, right: r.right })
    }
  }
  if (lines.length === 0) return [boxOf(element)]

  // Each line starts at the first character whose box is on it or below.
  const charTop = (i: number) => {
    range.setStart(text, i)
    range.setEnd(text, i + 1)
    const rects = range.getClientRects()
    return rects.length > 0 ? rects[rects.length - 1].top : -Infinity
  }
  let lo = 0
  for (let k = 1; k < lines.length; k++) {
    const target = (lines[k - 1].bottom + lines[k].top) / 2
    let a = lo
    let b = text.length
    while (a < b) {
      const mid = (a + b) >> 1
      if (charTop(mid) < target) a = mid + 1
      else b = mid
    }
    lines[k].offset = a
    lo = a
  }
  return lines
}

/** Index of the line holding this offset. */
export function lineIndexOf(lines: readonly LineBox[], offset: number): number {
  let index = 0
  for (let k = 0; k < lines.length; k++) if (lines[k].offset <= offset) index = k
  return index
}

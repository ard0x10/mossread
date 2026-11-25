// Turns what the text recogniser found on a picture of a page into the same
// positioned text runs a PDF's own text layer gives, so the reading view lays
// out a scanned page the same way it lays out any other.
//
// Type imports only: it runs in plain Node against sample scans too.

import type { RawItem, RawPage } from '../text/layout'

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** The parts of tesseract.js's result this file reads. */
export interface OcrWord {
  text: string
  confidence: number
  bbox: Box
}

export interface OcrLine {
  confidence: number
  bbox: Box
  baseline: Box
  rowAttributes?: { rowHeight?: number }
  words: OcrWord[]
}

export interface OcrBlock {
  paragraphs: Array<{ lines: OcrLine[] }>
}

/** Lines read with less certainty than this are noise, as from a photo or a drawing. */
const MIN_LINE_CONFIDENCE = 50
/** A row is about this much taller than the font size the layout expects. */
const ROW_TO_SIZE = 1.07

/**
 * Words of the recognised page in page space at scale 1. `scale` is how much
 * larger than that the picture was drawn; `width` and `height` are the page's
 * own size at scale 1.
 */
export function ocrToRaw(blocks: readonly OcrBlock[], scale: number, width: number, height: number): RawPage {
  const items: RawItem[] = []
  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        if (line.confidence < MIN_LINE_CONFIDENCE) continue
        const row = line.rowAttributes?.rowHeight || line.bbox.y1 - line.bbox.y0
        const size = (row * ROW_TO_SIZE) / scale
        // One baseline for the whole line, even on a slightly tilted scan, so the layout keeps its words together.
        const base = (line.baseline.y0 + line.baseline.y1) / 2
        for (const word of line.words) {
          const text = word.text.trim()
          if (!text) continue
          items.push({
            str: text,
            x: word.bbox.x0 / scale,
            y: base / scale,
            w: (word.bbox.x1 - word.bbox.x0) / scale,
            size,
            font: 'ocr',
          })
        }
      }
    }
  }
  return { width, height, items }
}

import type { PDFPageProxy } from '../pdf/pdfjs'
import type { RawItem, RawPage } from './layout'

/** Text runs of one page in viewport space at scale 1, which takes care of page rotation and crop. */
export async function extractPage(page: PDFPageProxy): Promise<RawPage> {
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const items: RawItem[] = []
  for (const item of content.items) {
    if (!('str' in item) || item.str === '') continue
    const [a, b, c, d, e, f] = item.transform
    const [x, y] = viewport.convertToViewportPoint(e, f)
    const [x2, y2] = viewport.convertToViewportPoint(e + a, f + b)
    // Vertical text in a margin, or mirrored text, is not part of the reading flow.
    if (x2 - x <= 0 || Math.abs(y2 - y) > Math.abs(x2 - x) * 0.2) continue
    items.push({ str: item.str, x, y, w: item.width, size: Math.hypot(c, d), font: item.fontName })
  }
  return { width: viewport.width, height: viewport.height, items }
}

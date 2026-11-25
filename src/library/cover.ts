import type { PDFDocumentProxy } from '../pdf/pdfjs'

const COVER_WIDTH = 320

/**
 * A small picture of the first page for the library shelf. pdf.js may draw
 * in its renderer worker, where the canvas cannot be read back, so the
 * finished page is copied onto a second canvas and encoded from there.
 */
export async function makeCover(doc: PDFDocumentProxy): Promise<string | null> {
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: COVER_WIDTH / base.width })
    const width = Math.round(viewport.width)
    const height = Math.round(viewport.height)

    const drawn = document.createElement('canvas')
    drawn.width = width
    drawn.height = height
    await page.render({ canvas: drawn, viewport }).promise

    const copy = document.createElement('canvas')
    copy.width = width
    copy.height = height
    const context = copy.getContext('2d')
    if (!context) return null
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(drawn, 0, 0)
    return copy.toDataURL('image/jpeg', 0.75)
  } catch {
    return null
  }
}

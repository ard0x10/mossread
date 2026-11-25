import type { PDFDocumentProxy } from './pdfjs'

export interface OutlineEntry {
  title: string
  depth: number
  // 1-based; null when the entry points nowhere this viewer can follow.
  page: number | null
}

type RawItem = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number]

async function pageOf(doc: PDFDocumentProxy, dest: RawItem['dest']): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
    const target = explicit?.[0]
    if (target == null) return null
    // A destination names its page either by reference or, in some files, by index.
    const index = typeof target === 'number' ? target : await doc.getPageIndex(target)
    return index + 1
  } catch {
    return null
  }
}

// Flattens the PDF bookmarks into a list with depth, which is easier to show
// as one scrolling list on a phone than a collapsible tree.
export async function loadOutline(doc: PDFDocumentProxy): Promise<OutlineEntry[]> {
  const root = await doc.getOutline()
  if (!root) return []

  const entries: OutlineEntry[] = []
  const walk = async (items: RawItem[], depth: number) => {
    for (const item of items) {
      entries.push({ title: item.title.trim(), depth, page: await pageOf(doc, item.dest) })
      if (item.items?.length) await walk(item.items, depth + 1)
    }
  }
  await walk(root, 0)
  return entries
}

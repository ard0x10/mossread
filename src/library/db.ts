// The library lives in this browser's IndexedDB. Nothing in it leaves the
// device: the PDF itself, a small cover picture, where the reader stopped and,
// for a scanned book, the text read from its pages.

import type { RawPage } from '../text/layout'

export type ViewMode = 'page' | 'text'

export interface SavedPosition {
  mode: ViewMode
  page: number
  /** Height on the page, as a fraction from the top. */
  y: number
}

export interface Book {
  /** Fingerprint of the file; the same file never gets two entries. */
  id: string
  name: string
  size: number
  pages: number
  addedAt: number
  openedAt: number
  /** Share of the book read, 0 to 1, from the saved position. */
  progress: number
  position: SavedPosition | null
  /** First page as a small JPEG data URL. */
  cover: string | null
  /** Language the text of this scanned book is read in, once the reader started that. */
  ocrLang?: string
}

const DB_NAME = 'mossread'
const DB_VERSION = 2
const BOOKS = 'books'
const FILES = 'files'
/** Text read from scanned pages, keyed by [book id, page]. */
const OCR = 'ocr'

let opening: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(BOOKS)) database.createObjectStore(BOOKS, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(FILES)) database.createObjectStore(FILES)
      if (!database.objectStoreNames.contains(OCR)) database.createObjectStore(OCR)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('blocked'))
  }).catch((error: unknown) => {
    opening = null
    throw error
  })
  return opening
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('aborted'))
  })
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Most recently opened first. */
export async function listBooks(): Promise<Book[]> {
  const tx = (await db()).transaction(BOOKS, 'readonly')
  const books = await result(tx.objectStore(BOOKS).getAll() as IDBRequest<Book[]>)
  return books.sort((a, b) => b.openedAt - a.openedAt)
}

export async function getBook(id: string): Promise<Book | undefined> {
  const tx = (await db()).transaction(BOOKS, 'readonly')
  return result(tx.objectStore(BOOKS).get(id) as IDBRequest<Book | undefined>)
}

/** Stores a new book with its file, in one go: either both are kept or neither. */
export async function addBook(book: Book, file: Blob): Promise<void> {
  const tx = (await db()).transaction([BOOKS, FILES], 'readwrite')
  tx.objectStore(BOOKS).put(book)
  tx.objectStore(FILES).put(file, book.id)
  await done(tx)
}

export async function updateBook(id: string, patch: Partial<Omit<Book, 'id'>>): Promise<void> {
  const tx = (await db()).transaction(BOOKS, 'readwrite')
  const store = tx.objectStore(BOOKS)
  const current = await result(store.get(id) as IDBRequest<Book | undefined>)
  if (current) store.put({ ...current, ...patch })
  await done(tx)
}

export async function getFile(id: string): Promise<Blob | undefined> {
  const tx = (await db()).transaction(FILES, 'readonly')
  return result(tx.objectStore(FILES).get(id) as IDBRequest<Blob | undefined>)
}

const ocrRange = (id: string) => IDBKeyRange.bound([id, 0], [id, Infinity])

/** Removes the book, its file, its cover, its position and any text read from it. Nothing is kept. */
export async function deleteBook(id: string): Promise<void> {
  const tx = (await db()).transaction([BOOKS, FILES, OCR], 'readwrite')
  tx.objectStore(BOOKS).delete(id)
  tx.objectStore(FILES).delete(id)
  tx.objectStore(OCR).delete(ocrRange(id))
  await done(tx)
}

/** Text read from this book's scanned pages on earlier visits, by page. */
export async function getOcrPages(id: string): Promise<Map<number, RawPage>> {
  const tx = (await db()).transaction(OCR, 'readonly')
  const store = tx.objectStore(OCR)
  const range = ocrRange(id)
  const [keys, values] = await Promise.all([
    result(store.getAllKeys(range) as unknown as IDBRequest<Array<[string, number]>>),
    result(store.getAll(range) as IDBRequest<RawPage[]>),
  ])
  return new Map(keys.map((key, k) => [key[1], values[k]]))
}

export async function putOcrPage(id: string, page: number, raw: RawPage): Promise<void> {
  const tx = (await db()).transaction(OCR, 'readwrite')
  tx.objectStore(OCR).put(raw, [id, page])
  await done(tx)
}

const SAMPLE = 1024 * 1024

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * SHA-256 of the size and the first and last megabyte. Hashing a whole
 * 100 MB file would keep a phone busy for a second on every open; two PDFs
 * that agree on size and both ends are, in practice, the same file.
 */
export async function fingerprint(file: Blob): Promise<string> {
  const head = await file.slice(0, SAMPLE).arrayBuffer()
  const tail = file.size > SAMPLE ? await file.slice(Math.max(SAMPLE, file.size - SAMPLE)).arrayBuffer() : new ArrayBuffer(0)
  const size = new TextEncoder().encode(String(file.size))
  const joined = new Uint8Array(size.byteLength + head.byteLength + tail.byteLength)
  joined.set(size, 0)
  joined.set(new Uint8Array(head), size.byteLength)
  joined.set(new Uint8Array(tail), size.byteLength + head.byteLength)
  // crypto.subtle exists only on https (and localhost). On a plain http
  // address, such as a phone reaching a dev server, a simpler hash stands in;
  // that is a different origin with its own library, so the ids never meet.
  if (crypto.subtle) return hex(await crypto.subtle.digest('SHA-256', joined))
  return `h:${quickHash(joined, 1)}${quickHash(joined, 2)}`
}

/** 53-bit string hash (cyrb53), run with two seeds for a 106-bit id. Not cryptographic. */
function quickHash(bytes: Uint8Array, seed: number): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (const byte of bytes) {
    h1 = Math.imul(h1 ^ byte, 2654435761)
    h2 = Math.imul(h2 ^ byte, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

/** Asks the browser not to clear the library when space runs low (and, on iOS, after a week away). */
export async function askToKeep(): Promise<void> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return
    await navigator.storage?.persist?.()
  } catch {
    // Not supported: the library still works, it is just not protected.
  }
}

const REMEMBER_KEY = 'mossread.remember'

export function readRemember(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== 'off'
  } catch {
    return true
  }
}

export function writeRemember(on: boolean) {
  try {
    localStorage.setItem(REMEMBER_KEY, on ? 'on' : 'off')
  } catch {
    // Storage unavailable: the choice lasts for this visit.
  }
}

export function progressOf(position: SavedPosition, pages: number): number {
  if (pages <= 0) return 0
  return Math.min(1, Math.max(0, (position.page - 1 + position.y) / pages))
}

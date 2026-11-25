// Service worker. Not part of the app bundle: the build fills in the file list
// and the version below and writes the result to /sw.js (see vite.config.ts).

const VERSION = __VERSION__
const FILES = __FILES__
const OCR_BASE = __OCR_BASE__

const PREFIX = 'mossread-app-'
const CURRENT = PREFIX + VERSION
// A file shared to the app from another one waits here until the page picks it up.
const SHARE_CACHE = 'mossread-share'
const SHARE_KEY = '/shared-file'
// Text recognition files, kept from the first time a reader uses them. The
// folder name carries the tesseract.js version, so a new version is a new folder.
const OCR_CACHE = 'mossread-ocr'

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CURRENT)
      await cache.addAll(FILES.map((path) => new Request(path, { cache: 'reload' })))
      // The new version takes over at once, but an open page keeps running the
      // code it started with and is never reloaded; the next launch gets the new one.
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // The version before this one stays: a page that is still open asks for its
      // own chunks by name, and the site no longer serves them after a deploy.
      const names = (await caches.keys()).filter((name) => name.startsWith(PREFIX) && name !== CURRENT)
      const keep = names.at(-1)
      await Promise.all(names.filter((name) => name !== keep).map((name) => caches.delete(name)))
      const ocr = await caches.open(OCR_CACHE)
      const stale = (await ocr.keys()).filter((request) => !new URL(request.url).pathname.startsWith(OCR_BASE))
      await Promise.all(stale.map((request) => ocr.delete(request)))
      await self.clients.claim()
    })(),
  )
})

/** The newest copy first, then the one kept from the previous version. */
async function fromCache(request) {
  const current = await caches.open(CURRENT)
  const hit = await current.match(request)
  if (hit) return hit
  const others = (await caches.keys()).filter((name) => name.startsWith(PREFIX) && name !== CURRENT).reverse()
  for (const name of others) {
    const older = await (await caches.open(name)).match(request)
    if (older) return older
  }
  return undefined
}

async function fromOcrCache(request, path) {
  const cache = await caches.open(OCR_CACHE)
  const hit = await cache.match(path)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) await cache.put(path, response.clone())
  return response
}

async function receiveShare(request) {
  try {
    const form = await request.formData()
    const file = form.getAll('pdf').find((item) => item instanceof File)
    if (file) {
      const cache = await caches.open(SHARE_CACHE)
      await cache.put(
        SHARE_KEY,
        new Response(file, {
          headers: { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent(file.name) },
        }),
      )
    }
  } catch {
    // Nothing usable was shared: the app just opens.
  }
  return Response.redirect('/?shared', 303)
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.method === 'POST' && url.pathname === '/share') {
    event.respondWith(receiveShare(request))
    return
  }
  if (request.method !== 'GET') return

  if (request.mode === 'navigate') {
    // One page app: every address opens the same page, from the newest version.
    event.respondWith(
      (async () => (await caches.open(CURRENT)).match('/index.html').then((hit) => hit ?? fetch(request)))(),
    )
    return
  }

  if (url.pathname.startsWith(OCR_BASE)) {
    event.respondWith(fromOcrCache(request, url.pathname))
    return
  }

  event.respondWith(fromCache(url.pathname).then((hit) => hit ?? fetch(request)))
})

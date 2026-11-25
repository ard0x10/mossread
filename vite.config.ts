import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

// pdf.js fetches character maps, fallback fonts, colour profiles and image
// decoders at runtime. They are served from this site under /pdfjs/ so the
// app never needs another origin (see the CSP in vercel.json).
const PDFJS_ROOT = fileURLToPath(new URL('./node_modules/pdfjs-dist/', import.meta.url))
const PDFJS_DIRS = ['cmaps', 'standard_fonts', 'iccs', 'wasm']
// The JavaScript engine for scripted PDF forms; scripting is never enabled here.
const PDFJS_SKIP = /^quickjs/

const CONTENT_TYPES: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.ttf': 'font/ttf',
}

function pdfjsAssets(): Plugin {
  return {
    name: 'mossread-pdfjs-assets',

    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const parts = decodeURIComponent((req.url ?? '').split('?')[0]).split('/').filter(Boolean)
        const [dir, ...rest] = parts
        if (!PDFJS_DIRS.includes(dir) || rest.length === 0 || rest.includes('..')) return next()

        const file = join(PDFJS_ROOT, dir, ...rest)
        if (!file.startsWith(PDFJS_ROOT + dir + sep)) return next()
        try {
          if (!statSync(file).isFile()) return next()
        } catch {
          return next()
        }
        res.setHeader('Content-Type', CONTENT_TYPES[extname(file)] ?? 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
    },

    generateBundle() {
      for (const dir of PDFJS_DIRS) {
        for (const name of readdirSync(join(PDFJS_ROOT, dir))) {
          const file = join(PDFJS_ROOT, dir, name)
          if (PDFJS_SKIP.test(name) || !statSync(file).isFile()) continue
          this.emitFile({ type: 'asset', fileName: `pdfjs/${dir}/${name}`, source: readFileSync(file) })
        }
      }
    },
  }
}

// Text recognition for scanned PDFs (tesseract.js) is served from this site
// under /ocr/<version>/. It is large and only some readers need it, so it is
// not stored for offline use up front: the service worker keeps each file the
// first time it is fetched (see src/pwa/sw.js).
const require = createRequire(import.meta.url)
const TESSERACT_VERSION: string = require('tesseract.js/package.json').version
const OCR_BASE = `/ocr/${TESSERACT_VERSION}/`
const OCR_LANGS = ['eng', 'tur']
const OCR_FILES: Record<string, string> = {
  'worker.min.js': require.resolve('tesseract.js/dist/worker.min.js'),
}
for (const name of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
  OCR_FILES[`core/${name}`] = require.resolve(`tesseract.js-core/${name}`)
}
for (const lang of OCR_LANGS) {
  OCR_FILES[`lang/${lang}.traineddata.gz`] = require.resolve(`@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`)
}
// What a reader downloads the first time, per language: the engine most
// browsers get (SIMD) plus the language's data.
const OCR_DOWNLOAD: Record<string, number> = Object.fromEntries(
  OCR_LANGS.map((lang) => [
    lang,
    ['worker.min.js', 'core/tesseract-core-simd-lstm.wasm.js', `lang/${lang}.traineddata.gz`].reduce(
      (sum, name) => sum + statSync(OCR_FILES[name]).size,
      0,
    ),
  ]),
)

function ocrAssets(): Plugin {
  return {
    name: 'mossread-ocr-assets',

    configureServer(server) {
      server.middlewares.use(OCR_BASE.slice(0, -1), (req, res, next) => {
        const file = OCR_FILES[decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '')]
        if (!file) return next()
        res.setHeader('Content-Type', CONTENT_TYPES[extname(file)] ?? 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
    },

    generateBundle() {
      for (const [name, file] of Object.entries(OCR_FILES)) {
        this.emitFile({ type: 'asset', fileName: `${OCR_BASE.slice(1)}${name}`, source: readFileSync(file) })
      }
    },
  }
}

// Everything the app can ask for is stored on the device the first time it is
// opened, so it works offline, PDFs with unusual fonts included.
function serviceWorker(): Plugin {
  return {
    name: 'mossread-service-worker',
    apply: 'build',
    enforce: 'post',

    generateBundle(_options, bundle) {
      // Files in public/ (manifest, icons) are copied as they are and never enter the bundle.
      const publicRoot = fileURLToPath(new URL('./public/', import.meta.url))
      const publicFiles = (readdirSync(publicRoot, { recursive: true }) as string[])
        .filter((name) => statSync(join(publicRoot, name)).isFile())
        .map((name) => name.split(sep).join('/'))
        .sort()
      const files = Object.keys(bundle)
        .filter((name) => !name.endsWith('.map') && !name.startsWith('ocr/'))
        .concat(publicFiles)
        .map((name) => '/' + name.split(sep).join('/'))
        .sort()
      const required = ['/index.html', '/manifest.webmanifest', '/icons/icon-512.png']
      if (!Object.keys(bundle).some((name) => name.startsWith(OCR_BASE.slice(1) + 'lang/'))) {
        this.error('the text recognition files are missing from the build')
      }
      const missing = required.filter((name) => !files.includes(name))
      if (missing.length > 0 || !files.some((name) => name.startsWith('/pdfjs/'))) {
        this.error(`service worker file list is missing ${missing.join(', ') || 'the pdf.js files'} (${files.length} files)`)
      }
      const template = readFileSync(fileURLToPath(new URL('./src/pwa/sw.js', import.meta.url)), 'utf8')
      // The page, the pdf.js files, public/ and this worker have no hash in
      // their names, so the version is taken from what every file contains.
      const hash = createHash('sha256').update(template)
      for (const name of Object.keys(bundle).sort()) {
        const item = bundle[name]
        hash.update(name).update(item.type === 'chunk' ? item.code : item.source)
      }
      for (const name of publicFiles) hash.update(name).update(readFileSync(join(publicRoot, name)))
      const version = hash.digest('hex').slice(0, 12)
      const source = template
        .replace('__VERSION__', JSON.stringify(version))
        .replace('__OCR_BASE__', JSON.stringify(OCR_BASE))
        .replace('__FILES__', JSON.stringify(files))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export default defineConfig({
  plugins: [react(), pdfjsAssets(), ocrAssets(), serviceWorker()],
  define: {
    __OCR_BASE__: JSON.stringify(OCR_BASE),
    __OCR_DOWNLOAD__: JSON.stringify(OCR_DOWNLOAD),
  },
})

import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
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
        .filter((name) => !name.endsWith('.map'))
        .concat(publicFiles)
        .map((name) => '/' + name.split(sep).join('/'))
        .sort()
      const required = ['/index.html', '/manifest.webmanifest', '/icons/icon-512.png']
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
        .replace('__FILES__', JSON.stringify(files))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export default defineConfig({
  plugins: [react(), pdfjsAssets(), serviceWorker()],
})

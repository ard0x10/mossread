import react from '@vitejs/plugin-react'
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

export default defineConfig({
  plugins: [react(), pdfjsAssets()],
})

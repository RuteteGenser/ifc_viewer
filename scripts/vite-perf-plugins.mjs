// Build-time helpers for loading speed (used by vite.config.js).
import { brotliCompressSync, gzipSync, constants } from 'node:zlib'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

// Adds preload hints for the files the viewer needs right after startup but
// that Vite does not know about: the engine chunk (dynamic import), the
// fragments worker (fetched as text) and the web-ifc wasm. Hrefs follow the build's base.
export function preloadHints() {
  let base = '/'
  return {
    name: 'preload-ifc-engine',
    apply: 'build',
    configResolved(config) {
      base = config.base
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const worker = Object.keys(ctx.bundle ?? {}).find((f) => /(^|\/)worker-[^/]+\.js$/.test(f))
        const tags = [{ tag: 'link', attrs: { rel: 'preload', as: 'fetch', crossorigin: '', href: `${base}wasm/web-ifc.wasm` } }]
        if (worker) tags.push({ tag: 'link', attrs: { rel: 'preload', as: 'fetch', crossorigin: '', href: `${base}${worker}` } })
        // The engine chunk is reached by a dynamic import, which Vite does not
        // preload; fetch it from the first byte of HTML, next to the entry.
        for (const f of Object.keys(ctx.bundle ?? {})) {
          if (/(^|\/)(ifc-engine|setupComponents)-[^/]+\.js$/.test(f)) {
            tags.push({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: '', href: `${base}${f}` } })
          }
        }
        return { html, tags: tags.map((t) => ({ ...t, injectTo: 'head-prepend' })) }
      },
    },
  }
}

// Fills the placeholders in the built public/sw.js: a version derived from
// the built files (so an unchanged build is a byte-identical worker) and the
// list of files to keep offline. Must run before precompress.
export function serviceWorkerManifest() {
  let outDir = 'dist'
  return {
    name: 'service-worker-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle: {
      order: 'pre',
      handler() {
        const swPath = join(outDir, 'sw.js')
        const files = walkFiles(outDir)
          .map((f) => f.slice(outDir.length + 1).split('\\').join('/'))
          .sort()
        const precache = files.filter(
          (f) =>
            /^assets\/.*\.(js|css)$/.test(f) ||
            f === 'wasm/web-ifc.wasm' ||
            f.startsWith('fonts/') ||
            f.startsWith('demo/'),
        )
        const hash = createHash('sha1')
        for (const f of [...precache, 'index.html']) hash.update(f).update(readFileSync(join(outDir, f)))
        const sw = readFileSync(swPath, 'utf8')
          .replace("'__BUILD__'", JSON.stringify(hash.digest('hex').slice(0, 12)))
          .replace("'__PRECACHE__'", JSON.stringify(precache))
        writeFileSync(swPath, sw)
      },
    },
  }
}

function walkFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walkFiles(path) : [path]
  })
}

// Writes .gz and .br next to every large text/wasm file in the output
// directory, so nginx `gzip_static on;` (or a brotli_static module) serves the
// pre-compressed bytes instead of compressing per request.
export function precompress({ minBytes = 1024 } = {}) {
  let outDir = 'dist'
  return {
    name: 'precompress',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle: {
      order: 'post',
      handler() {
        for (const file of walkFiles(outDir)) {
          if (!/\.(js|mjs|css|html|svg|wasm|ifc|json|webmanifest)$/.test(file)) continue
          const data = readFileSync(file)
          if (data.length < minBytes) continue
          writeFileSync(`${file}.gz`, gzipSync(data, { level: 9 }))
          writeFileSync(
            `${file}.br`,
            brotliCompressSync(data, {
              params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length },
            }),
          )
        }
      },
    },
  }
}

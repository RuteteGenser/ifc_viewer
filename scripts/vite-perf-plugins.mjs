// Build-time helpers for loading speed (used by vite.config.js).
import { brotliCompressSync, gzipSync, constants } from 'node:zlib'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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
        const walk = (dir) =>
          readdirSync(dir).flatMap((name) => {
            const path = join(dir, name)
            return statSync(path).isDirectory() ? walk(path) : [path]
          })
        for (const file of walk(outDir)) {
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

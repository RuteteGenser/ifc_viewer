// Build-time helpers for loading speed (used by vite.config.js).
import { brotliCompressSync, gzipSync, constants } from 'node:zlib'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

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
        // web-ifc's per-schema tables (the page's and the import worker's copy
        // of each) are fetched on demand, except IFC4's, which the sample needs:
        // a first visit should not download schemas its files may never use.
        // Any other schema is cached the first time a file of it is opened.
        const lazySchema = /web-ifc-schema-[13]-/
        const precache = files.filter(
          (f) =>
            (/^assets\/.*\.(js|css)$/.test(f) && !lazySchema.test(f)) ||
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

// Writes <meta name="argus-build"> into index.html: a short hash of every file
// name in the bundle (they are content-hashed, so it changes whenever anything
// does). The running page reads its own tag and compares it with a freshly
// fetched index.html to notice that a newer version has been deployed.
export function buildIdMeta() {
  return {
    name: 'argus-build-id',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const names = Object.keys(ctx.bundle ?? {}).sort().join('\n')
        const id = createHash('sha1').update(names).digest('hex').slice(0, 10)
        return html.replace('<head>', `<head>\n    <meta name="argus-build" content="${id}" />`)
      },
    },
  }
}

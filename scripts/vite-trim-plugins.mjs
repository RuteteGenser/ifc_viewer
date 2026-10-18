// Build-time byte trimming for third-party code (used by vite.config.js).
//
// Each patch edits a pinned piece of library source by exact text match and
// fails the build when the text is not found, so a dependency upgrade that
// moves things shows up as a build error instead of silently shipping the
// extra bytes (or, worse, a broken patch).

// @thatopen/fragments falls back to `new URL("./Worker/worker.mjs", ...)` when
// no worker URL is passed. The viewer always passes one (the minified build,
// see the alias in vite.config.js), but the bundler still sees the reference
// and emits the 3.3 MB unminified worker as a second asset, which the service
// worker would then download for nothing. After bundling, this repoints that
// dead reference at the minified worker and drops the extra file.
export function dropUnminifiedFragmentsWorker() {
  return {
    name: 'drop-unminified-fragments-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.values(bundle).filter((f) => f.type === 'asset' && /^assets\/worker[-.].*\.js$/.test(f.fileName))
      const min = assets.find((f) => f.fileName.startsWith('assets/worker.min-'))
      const big = assets.find((f) => f !== min)
      if (!min || !big) return // nothing duplicated, nothing to do
      let patched = 0
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk' || !file.code.includes(big.fileName)) continue
        file.code = file.code.split(big.fileName).join(min.fileName)
        patched++
      }
      if (patched === 0) this.error(`unminified worker ${big.fileName} is emitted but no chunk references it`)
      delete bundle[big.fileName]
    },
  }
}

// web-ifc ships one 5.9 MB file (about 3.4 MB after minifying) holding, besides
// the parser glue, a generated class and lookup tables for each of three IFC
// schemas. This removes the parts a read-only viewer cannot reach:
//  - the multithreaded emscripten glue. IfcAPI.Init only picks it on a
//    cross-origin-isolated page, inside a try/catch that falls back to the
//    single-thread build, so a throwing stub keeps that fallback working;
//  - the Constructors and ToRawLineData tables, used only by the write side of
//    the API (CreateIfcEntity, WriteLine), which nothing here calls.
export function slimWebIfc() {
  const mtGlue = /\/\/ dist\/web-ifc-mt\.js\nvar require_web_ifc_mt = __commonJS\(\{[\s\S]*?\n\}\);\n(?=\n\/\/ dist\/web-ifc\.js\n)/
  const writeTables = /^(Constructors|ToRawLineData)\[(\d)\] = \{\n[\s\S]*?\n\};\n/gm
  return {
    name: 'slim-web-ifc',
    enforce: 'pre',
    apply: 'build',
    transform(code, id) {
      if (!/node_modules[\\/]web-ifc[\\/]web-ifc-api\.js$/.test(id)) return null
      if (!mtGlue.test(code)) this.error(`slim-web-ifc: multithreaded glue not found in ${id}`)
      let out = code.replace(
        mtGlue,
        'var require_web_ifc_mt = () => {\n  throw new Error("multithreaded web-ifc is not bundled");\n};\n',
      )
      let tables = 0
      out = out.replace(writeTables, (_all, name, schema) => {
        tables++
        return `${name}[${schema}] = {};\n`
      })
      if (tables !== 6) this.error(`slim-web-ifc: expected 6 write tables, found ${tables}`)
      return { code: out, map: null }
    },
  }
}

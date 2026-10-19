import { readFileSync } from 'node:fs'

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

// The page never runs @thatopen/fragments' IFC importer (the import worker
// does), but the package is one module that imports web-ifc at the top, so a
// build of the page carries the whole parser (about 100 kB of gzip) for code
// that cannot run there. Only that one import is pointed at an empty module:
// every use of it in the package is inside a function of the importer or of
// its helpers (the few top-level uses read a property of the namespace, which
// is just undefined). The page's own use of web-ifc (src/ifc/rawIfcQuery.js)
// resolves to the real thing, loaded on first use.
export function emptyWebIfcForFragments() {
  const STUB = '\0empty-web-ifc'
  return {
    name: 'empty-web-ifc-for-fragments',
    enforce: 'pre',
    apply: 'build',
    resolveId(id, importer) {
      if (id === STUB) return STUB
      if (id === 'web-ifc' && importer && /node_modules[\\/]@thatopen[\\/]fragments[\\/]dist[\\/]index\.mjs$/.test(importer)) return STUB
      return null
    },
    load(id) {
      return id === STUB ? 'export {}\n' : null
    },
  }
}

// The import worker (src/ifc/ifcImportWorker.js) bundles @thatopen/fragments
// for its IfcImporter only and never makes a FragmentsModels, but it contains
// the same dead `new URL("./Worker/worker.mjs", ...)` fallback, which the
// worker build would emit as its own 3.3 MB asset. There the reference is cut
// out at the source, which fails the build if the text moves.
export function cutFragmentsWorkerFallback() {
  const FALLBACK = 'workerURL ?? new URL("./Worker/worker.mjs", import.meta.url).href'
  return {
    name: 'cut-fragments-worker-fallback',
    enforce: 'pre',
    transform(code, id) {
      if (!/node_modules[\\/]@thatopen[\\/]fragments[\\/]dist[\\/]index\.mjs$/.test(id)) return null
      if (!code.includes(FALLBACK)) this.error('cut-fragments-worker-fallback: fallback not found, update scripts/vite-trim-plugins.mjs')
      return { code: code.replace(FALLBACK, 'workerURL'), map: null }
    },
  }
}

// web-ifc ships one 5.9 MB file (about 3.4 MB after minifying) holding, besides
// the parser glue, a generated class and lookup tables for each of three IFC
// schemas (IFC2X3, IFC4, IFC4X3). A model uses exactly one of them, so this
// plugin cuts each schema out of the file into its own lazily loaded chunk
// (the virtual module `virtual:web-ifc-schema-<n>`; src/ifc/ifcSchemas.js
// loads the one a file needs before the file is opened) and trims what a
// read-only viewer cannot reach:
//  - the multithreaded emscripten glue. IfcAPI.Init only picks it on a
//    cross-origin-isolated page, inside a try/catch that falls back to the
//    single-thread build, so a throwing stub keeps that fallback working;
//  - the Constructors and ToRawLineData tables, used only by the write side of
//    the API (CreateIfcEntity, WriteLine), which nothing here calls.
// Everything is found by exact text match and any mismatch fails the build, so
// a web-ifc upgrade that changes the layout cannot ship a half-patched parser.

const SCHEMA_VIRTUAL = 'virtual:web-ifc-schema-'
const SCHEMAS = [
  { id: 1, ns: 'IFC2X3' },
  { id: 2, ns: 'IFC4' },
  { id: 3, ns: 'IFC4X3' },
]
const WEB_IFC_FILE = /node_modules[\\/]web-ifc[\\/]web-ifc-api\.js$/
const MT_GLUE = /\/\/ dist\/web-ifc-mt\.js\nvar require_web_ifc_mt = __commonJS\(\{[\s\S]*?\n\}\);\n(?=\n\/\/ dist\/web-ifc\.js\n)/
const WRITE_TABLES = /^(Constructors|ToRawLineData)\[(\d)\] = \{\n[\s\S]*?\n\};\n/gm
// IfcLengthMeasure is the one IFC4X3 class @thatopen/fragments touches
// directly (WEBIFC.IFC4X3.IfcLengthMeasure), whatever the file's schema, so
// it stays in the main chunk.
const LENGTH_MEASURE = /  class IfcLengthMeasure extends NumberHandle \{[\s\S]*?\n  \}\n  IFC4X32\.IfcLengthMeasure = IfcLengthMeasure;\n/

// Splits web-ifc's source into the main part and one region per schema.
// Pure, so the main chunk and the schema chunks are cut from the same text.
function splitWebIfc(code, fileName) {
  const fail = (what) => {
    throw new Error(`slim-web-ifc: ${what} not found in ${fileName}; web-ifc changed, update scripts/vite-trim-plugins.mjs`)
  }
  if (!MT_GLUE.test(code)) fail('multithreaded glue')
  let main = code.replace(
    MT_GLUE,
    'var require_web_ifc_mt = () => {\n  throw new Error("multithreaded web-ifc is not bundled");\n};\n',
  )

  const regions = {}
  let writeTables = 0
  for (const { id, ns } of SCHEMAS) {
    const start = main.indexOf(`\nFromRawLineData[${id}] = {\n`) + 1
    const endMark = `})(${ns} || (${ns} = {}));\n`
    const endAt = main.indexOf(endMark, start)
    if (start === 0 || endAt === -1) fail(`schema ${ns}`)
    if (!/SchemaNames\[\d\] = \[[^\n]*\];\n$/.test(main.slice(0, start))) fail(`SchemaNames line before ${ns}`)
    let region = main.slice(start, endAt + endMark.length)
    if (!region.includes(`var ${ns};\n`)) fail(`namespace declaration of ${ns}`)
    // Namespace: declared in the main chunk, filled in by the schema chunk.
    region = region.replace(`var ${ns};\n`, '').replace(endMark, `})(${ns});\n`)
    region = region.replace(WRITE_TABLES, () => {
      writeTables++
      return ''
    })
    let placeholder = `var ${ns} = {};\n`
    if (ns === 'IFC4X3') {
      const measure = region.match(LENGTH_MEASURE)
      if (!measure) fail('IFC4X3 IfcLengthMeasure')
      placeholder += `((IFC4X32) => {\n${measure[0]}})(${ns});\n`
    }
    regions[id] = region
    main = main.slice(0, start) + placeholder + main.slice(endAt + endMark.length)
  }
  if (writeTables !== 6) fail(`6 write tables (found ${writeTables})`)
  return { main, regions }
}

// Names a region uses from the main part of the file, and the export
// statement that makes the not-yet-exported ones importable.
function sharedNames(main, regions) {
  const topLevel = new Set([...main.matchAll(/^(?:var|let|const|class|function)\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1]))
  const exportBlock = main.match(/\nexport \{\n([\s\S]*?)\n\};?\s*$/)
  if (!exportBlock) throw new Error('slim-web-ifc: export list not found')
  const exported = new Map() // local name -> exported name
  for (const item of exportBlock[1].split(',')) {
    const [local, , alias] = item.trim().split(/\s+/)
    if (local) exported.set(local, alias ?? local)
  }
  const perSchema = {}
  const missing = new Set()
  for (const [id, region] of Object.entries(regions)) {
    const used = new Set(region.match(/[A-Za-z_$][A-Za-z0-9_$]*/g))
    perSchema[id] = [...used].filter((name) => topLevel.has(name)).sort()
    for (const name of perSchema[id]) if (!exported.has(name)) missing.add(name)
  }
  return { perSchema, exported, missing: [...missing].sort() }
}

// Trims web-ifc's multithreaded glue and write-only tables but leaves every
// schema's tables where they are (no split, nothing lazy).
function trimWebIfc(code, fileName) {
  const fail = (what) => {
    throw new Error(`slim-web-ifc: ${what} not found in ${fileName}; web-ifc changed, update scripts/vite-trim-plugins.mjs`)
  }
  if (!MT_GLUE.test(code)) fail('multithreaded glue')
  let writeTables = 0
  const main = code
    .replace(MT_GLUE, 'var require_web_ifc_mt = () => {\n  throw new Error("multithreaded web-ifc is not bundled");\n};\n')
    .replace(WRITE_TABLES, () => {
      writeTables++
      return ''
    })
  if (writeTables !== 6) fail(`6 write tables (found ${writeTables})`)
  return main
}

// split: false keeps every schema inside web-ifc (the virtual schema modules
// are then empty). The import worker is built that way: WebKit (Safari, every
// iOS browser) evaluates a module worker's entry script a SECOND time when a
// chunk imports it, so a lazily loaded schema chunk filled the tables of a
// second, unused copy of web-ifc and every model failed with "undefined is
// not an object (evaluating 'Object.keys(LD[this.modelSchemaList[e]])')".
export function slimWebIfc({ split = true } = {}) {
  let command = 'build'
  let root = process.cwd()
  return {
    name: 'slim-web-ifc',
    enforce: 'pre',
    configResolved(config) {
      command = config.command
      root = config.root
    },
    resolveId(id) {
      return id.startsWith(SCHEMA_VIRTUAL) ? `\0${id}` : null
    },
    async load(id) {
      if (!id.startsWith(`\0${SCHEMA_VIRTUAL}`)) return null
      // The dev server serves web-ifc untouched, with every schema inside.
      if (command !== 'build' || !split) return 'export {}\n'
      const resolved = await this.resolve('web-ifc', `${root}/index.html`, { skipSelf: true })
      if (!resolved) this.error('slim-web-ifc: cannot resolve web-ifc')
      const file = resolved.id.split('?')[0]
      const { main, regions } = splitWebIfc(readFileSync(file, 'utf8'), file)
      const { perSchema, exported } = sharedNames(main, regions)
      const schema = id.slice(`\0${SCHEMA_VIRTUAL}`.length)
      if (!(schema in regions)) this.error(`slim-web-ifc: unknown schema ${schema}`)
      const imports = perSchema[schema].map((name) => {
        const as = exported.get(name) ?? name
        return as === name ? name : `${as} as ${name}`
      })
      // Schema regions that use another schema's classes would need that
      // schema loaded first; none do today, and this keeps it that way.
      for (const { id: other, ns } of SCHEMAS) {
        if (String(other) !== schema && perSchema[schema].includes(ns)) this.error(`slim-web-ifc: schema ${schema} uses ${ns}`)
      }
      return `import { ${imports.join(', ')} } from ${JSON.stringify(file)};\n${regions[schema]}`
    },
    transform(code, id) {
      if (command !== 'build' || !WEB_IFC_FILE.test(id)) return null
      if (!split) return { code: trimWebIfc(code, id), map: null }
      let { main, regions } = splitWebIfc(code, id)
      const { missing } = sharedNames(main, regions)
      if (missing.length) main += `\nexport { ${missing.join(', ')} };\n`
      return { code: main, map: null }
    },
  }
}

// A module worker's chunks must never import the worker's entry file: WebKit
// does not reuse the running entry for that import but evaluates the file
// again, so the chunk talks to a second copy of every module in it (see
// slimWebIfc). Fails the worker build if any chunk does, statically or by
// import(). A one-file build lists itself among its own dynamic imports (the
// inlined ones); that only counts when its code really names its own file.
// Exported for the regression test.
export function entryImportsIn(bundle) {
  const chunks = Object.values(bundle).filter((f) => f.type === 'chunk')
  const entries = new Set(chunks.filter((c) => c.isEntry).map((c) => c.fileName))
  const found = []
  for (const c of chunks) {
    for (const target of new Set([...(c.imports ?? []), ...(c.dynamicImports ?? [])])) {
      if (!entries.has(target)) continue
      if (target === c.fileName && !String(c.code ?? '').includes(target.split('/').pop())) continue
      found.push(`${c.fileName} -> ${target}`)
    }
  }
  return found
}

export function noWorkerEntryImports() {
  return {
    name: 'no-worker-entry-imports',
    apply: 'build',
    generateBundle(_options, bundle) {
      const found = entryImportsIn(bundle)
      if (found.length) this.error(`a worker chunk imports the worker entry, which WebKit evaluates twice: ${found.join(', ')}`)
    },
  }
}

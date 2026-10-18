import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { cutFragmentsWorkerFallback, dropUnminifiedFragmentsWorker, emptyWebIfcForFragments, slimWebIfc } from './scripts/vite-trim-plugins.mjs'
import { precompress, serviceWorkerManifest } from './scripts/vite-perf-plugins.mjs'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this repo at https://<user>.github.io/ifc_viewer/,
  // so production builds need every asset URL prefixed accordingly.
  base: command === 'build' ? '/ifc_viewer/' : '/',
  resolve: {
    // Build only: the dev server pre-bundles dependencies and would trip over these.
    alias: command !== 'build' ? [] : [
      // The package's "./worker" export is the 3.3 MB unminified build; the
      // minified build of the same worker ships next to it (1.4 MB).
      {
        find: /^@thatopen\/fragments\/worker(\?.*)?$/,
        replacement: fileURLToPath(
          new URL('./node_modules/@thatopen/fragments/dist/Worker/worker.min.mjs', import.meta.url),
        ) + '$1',
      },
    ],
  },
  plugins: [dropUnminifiedFragmentsWorker(), emptyWebIfcForFragments(), slimWebIfc(), react(), serviceWorkerManifest(), precompress()],
  // The IFC import worker is a separate bundle: it needs the same web-ifc
  // trimming (one slim parser, lazy per-schema chunks) as the page.
  worker: {
    format: 'es',
    plugins: () => [slimWebIfc(), cutFragmentsWorkerFallback()],
    rollupOptions: {
      output: {
        // Own prefix so the import worker's copy of the per-schema chunks
        // (the page keeps another, for raw property lookups) is told apart.
        chunkFileNames: 'assets/iw-[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // The fragments worker is emitted as an asset with an .mjs name, and
        // plain static hosts (nginx's default mime.types) serve .mjs as
        // text/plain, which browsers refuse for a module worker, so models
        // would never finish loading. A .js name gets a JavaScript type.
        assetFileNames: (asset) =>
          asset.names?.some((name) => name.endsWith('.mjs'))
            ? 'assets/[name]-[hash].js'
            : 'assets/[name]-[hash][extname]',
        // Three.js and the IFC engine (@thatopen/*, web-ifc) are large and
        // rarely change, so they get their own long-cached chunks. The
        // engine chunk is only reached through a dynamic import started
        // from main.jsx, so it downloads and parses in parallel with the
        // UI instead of in front of it.
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 20 },
            // The parser itself is only used on the page for raw property
            // lookups (rawIfcQuery.js), so it is its own lazily loaded chunk.
            { name: 'web-ifc', test: /node_modules[\\/]web-ifc[\\/]/, priority: 15 },
            {
              name: 'ifc-engine',
              // Not the fragments worker's ?url module: main.jsx imports only
              // that URL, which must not drag the engine chunk into the entry.
              test: (id) => /node_modules[\\/](@thatopen|camera-controls)/.test(id) && !/[\\/]Worker[\\/]worker/.test(id),
              priority: 10,
            },
          ],
        },
      },
    },
  },
}))

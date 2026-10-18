import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { precompress, preloadHints, serviceWorkerManifest } from './scripts/vite-perf-plugins.mjs'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this repo at https://<user>.github.io/ifc_viewer/,
  // so production builds need every asset URL prefixed accordingly.
  base: command === 'build' ? '/ifc_viewer/' : '/',
  plugins: [react(), preloadHints(), serviceWorkerManifest(), precompress()],
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
            { name: 'ifc-engine', test: /node_modules[\\/](@thatopen|web-ifc|camera-controls)/, priority: 10 },
          ],
        },
      },
    },
  },
}))

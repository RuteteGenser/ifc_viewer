import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this repo at https://<user>.github.io/ifc_viewer/,
  // so production builds need every asset URL prefixed accordingly.
  base: command === 'build' ? '/ifc_viewer/' : '/',
  plugins: [react()],
  // Names the service worker's cache, so each build replaces the last.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
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
        // Three.js and the @thatopen/* IFC stack are large and rarely
        // change between deploys; splitting them into their own chunk
        // means a future app-only change doesn't invalidate the browser's
        // cached copy of them.
        manualChunks(id) {
          if (
            id.includes('node_modules/three') ||
            id.includes('node_modules/@thatopen')
          ) {
            return 'vendor'
          }
        },
      },
    },
  },
}))

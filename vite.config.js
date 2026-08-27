import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this repo at https://<user>.github.io/ifc_viewer/,
  // so production builds need every asset URL prefixed accordingly.
  base: command === 'build' ? '/ifc_viewer/' : '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
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

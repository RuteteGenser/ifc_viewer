import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import fragmentsWorkerUrl from '@thatopen/fragments/worker?url'

// Boot the IFC engine (separate chunk, web-ifc wasm, fragments worker) now,
// once the UI code is here, so it downloads and starts in parallel with React
// rendering the UI. Started any earlier, on a slow link these 1.5 MB would
// share bandwidth with the UI and delay the first usable screen.
for (const href of [`${import.meta.env.BASE_URL}wasm/web-ifc.wasm`, fragmentsWorkerUrl]) {
  const link = document.createElement('link')
  link.rel = 'preload'
  link.as = 'fetch'
  link.crossOrigin = ''
  link.href = href
  document.head.append(link)
}
import('./ifc/setupComponents').then((m) => m.startIfcPipeline()).catch(() => {})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Offline cache. A new deploy changes sw.js itself, which the browser checks on
// every visit, so the update installs in the background.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => {})
  })
}

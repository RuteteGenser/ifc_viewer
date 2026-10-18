import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import fragmentsWorkerUrl from '@thatopen/fragments/worker?url'
import { startEngineDownloads } from './ifc/engineDownloads'
import { prewarmIfcImporter } from './ifc/ifcImportClient'

// Boot the IFC engine (separate chunk, import worker, web-ifc wasm, fragments worker) now,
// once the UI code is here, so it downloads and starts in parallel with React
// rendering the UI. Started any earlier, on a slow link these 1.2 MB would
// share bandwidth with the UI and delay the first usable screen. The files
// are fetched one after another, in the order the first model needs them.
const engineImport = import('./ifc/setupComponents')
// The sample (?demo=1) is IFC4 (web-ifc schema id 2), so the import worker
// fetches that schema's tables while it boots.
const isDemo = new URLSearchParams(window.location.search).get('demo') === '1'
const engineFilesDownloaded = startEngineDownloads({
  engineImport,
  startImporter: () => prewarmIfcImporter(isDemo ? 2 : undefined),
  wasmUrl: `${import.meta.env.BASE_URL}wasm/web-ifc.wasm`,
  workerUrl: fragmentsWorkerUrl,
})
engineImport.then((m) => m.startIfcPipeline()).catch(() => {})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Offline cache. A new deploy changes sw.js itself, which the browser checks on
// every visit, so the update installs in the background. The worker's own
// fetches of every asset would share the link with the engine download, so on a
// first visit it is told to start only once that download is done.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then(() => Promise.all([navigator.serviceWorker.ready, engineFilesDownloaded]))
      .then(([registration]) => registration.active?.postMessage('precache'))
      .catch(() => {})
  })
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './index.css'
import App from './App.jsx'
import ErrorBoundary, { CrashProbe } from './ErrorBoundary.jsx'
import './styles/skin.css' // after App: the shared look of controls (tokens applied)
import './styles/chrome.css' // after the skin: where the phone's controls sit
import './styles/overlays.css' // after the chrome: overlays on the model, cases, states, tree
import './styles/polish.css' // last of the skin layers: menus, tabs, onboarding, states (pass 4)
import './motion.css' // after App so its rules win over component CSS
import fragmentsWorkerUrl from '@thatopen/fragments/worker?url'
import { startEngineDownloads } from './ifc/engineDownloads'
import { prewarmIfcImporter } from './ifc/ifcImportClient'
import { recoverFromChunkFailure } from './reliability/recovery'
import { initHaptics } from './haptics'

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
engineImport
  .then((m) => m.startIfcPipeline())
  .catch((err) => {
    console.error('The viewer engine failed to start', err)
    // An old tab after a deploy reloads (nothing is open yet); a momentary
    // failure is handled by the viewer, whose own import of the engine fails too.
    recoverFromChunkFailure()
  })
// Vite reports a lazily loaded chunk that did not download. Only a tab older
// than the deployed build, with no model open, reloads; otherwise the code that
// asked for the chunk retries it and says what is missing (see importRetrying).
// A model the user has open is never reloaded away.
window.addEventListener('vite:preloadError', () => {
  recoverFromChunkFailure()
})

initHaptics()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <CrashProbe />
      <App />
    </ErrorBoundary>
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

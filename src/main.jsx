import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Boot the IFC engine (separate chunk, web-ifc wasm, fragments worker) right
// now so it runs in parallel with React rendering the UI.
import('./ifc/setupComponents').then((m) => m.startIfcPipeline()).catch(() => {})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Offline app shell. The build id in the URL makes each deploy a new worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js?v=${__BUILD_ID__}`)
      .catch(() => {})
  })
}

// Minimal app-shell cache. Registered as sw.js?v=<build id>, so every deploy
// is a new worker with its own cache; activate deletes the old ones.
const CACHE = `ifc-viewer-${new URL(self.location).searchParams.get('v')}`
const SHELL = ['./', 'manifest.webmanifest', 'icon-192.png', 'apple-touch-icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

const store = (request, response) => {
  if (response.status === 200) {
    const copy = response.clone()
    caches.open(CACHE).then((c) => c.put(request, copy))
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  // Hashed assets never change, and the wasm lives in a per-build cache:
  // cache first.
  if (/\/(assets|wasm)\//.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((r) => store(request, r))),
    )
    return
  }

  // HTML and everything else: network first, cache as the offline fallback.
  event.respondWith(
    fetch(request)
      .then((r) => store(request, r))
      .catch(() => caches.match(request, { ignoreSearch: false }).then((hit) => hit || caches.match('./'))),
  )
})

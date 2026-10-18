// Offline-first service worker. The two placeholders below are filled in at
// build time (scripts/vite-perf-plugins.mjs): VERSION changes only when the
// built files change, PRECACHE lists the hashed assets worth keeping offline.
// A new deploy is a byte-different sw.js, so the browser installs it in the
// background; its new cache replaces the old one when it activates.
const VERSION = '__BUILD__'
const PRECACHE = '__PRECACHE__'
const CACHE = `ifc-viewer-${VERSION}`
const SHELL = ['./', 'manifest.webmanifest', 'icon-192.png', 'apple-touch-icon.png', 'favicon.svg']
const SCOPE = self.registration.scope
const INDEX = new URL('./', SCOPE).href

self.addEventListener('install', (event) => {
  // Only the tiny shell gates installation; a failure here keeps the old worker.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((path) => new Request(new URL(path, SCOPE), { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  )
})

// Fetches every large file once, a couple at a time at low priority. Files
// the page already downloaded come from the HTTP cache. Any failure is
// ignored: the fetch handler falls back to the network for what is missing.
async function precacheAll() {
  const cache = await caches.open(CACHE)
  const queue = Array.isArray(PRECACHE) ? [...PRECACHE] : []
  const worker = async () => {
    for (let path = queue.shift(); path; path = queue.shift()) {
      try {
        const url = new URL(path, SCOPE).href
        if (await cache.match(url)) continue
        const response = await fetch(url, { priority: 'low' })
        if (response.ok) await cache.put(url, response)
      } catch {
        // offline or flaky: try again on the next activation
      }
    }
  }
  await Promise.all([worker(), worker()])
}

// On a first visit the precache must not compete with the page's own critical
// downloads (they share one link), so the page asks for it with a 'precache'
// message once those are done. An update of a returning visitor, whose page
// already has everything it needs, starts it right away.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const old = keys.filter((k) => k.startsWith('ifc-viewer-') && k !== CACHE)
        return Promise.all(old.map((k) => caches.delete(k))).then(() => old.length > 0)
      })
      .then((isUpdate) => self.clients.claim().then(() => isUpdate && precacheAll()))
      .catch(() => {}),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'precache') event.waitUntil(precacheAll().catch(() => {}))
})

const cacheable = (response) => response && response.status === 200 && response.type === 'basic'

// Serve the cached copy at once and refresh it in the background.
function staleWhileRevalidate(event, cacheKey) {
  const { request } = event
  const refresh = fetch(request)
    .then(async (response) => {
      if (cacheable(response)) await (await caches.open(CACHE)).put(cacheKey, response.clone())
      return response
    })
    .catch(() => null)
  event.waitUntil(refresh)
  return caches.match(cacheKey, { ignoreSearch: true }).then((hit) => hit || refresh.then((r) => r || Response.error()))
}

// Cached copy if there is one, otherwise the network (and remember it).
function cacheFirst(request) {
  return caches.match(request).then(
    (hit) =>
      hit ||
      fetch(request).then((response) => {
        if (cacheable(response)) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      }),
  )
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return
  if (url.pathname.endsWith('/sw.js')) return

  if (request.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(event, INDEX))
    return
  }
  const path = url.href.slice(SCOPE.length)
  // The sample is a plain file that may change: show the cached one, refresh it.
  if (path.startsWith('demo/')) {
    event.respondWith(staleWhileRevalidate(event, request.url))
    return
  }
  // Everything else under the scope is content-hashed or effectively static.
  event.respondWith(cacheFirst(request))
})

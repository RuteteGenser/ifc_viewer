// Offline-first service worker. The two placeholders below are filled in at
// build time (scripts/vite-perf-plugins.mjs): VERSION changes only when the
// built files change, PRECACHE lists the hashed assets worth keeping offline.
// A new deploy is a byte-different sw.js, so the browser installs it in the
// background. Its new cache takes over when it activates; the previous
// version's cache is kept until the one after, so a tab that is still running
// the previous build keeps finding its (differently hashed) files.
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
        if (cacheableFile(response)) await cache.put(url, response)
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
    pruneCaches()
      .then((isUpdate) => self.clients.claim().then(() => isUpdate && precacheAll()))
      .catch(() => {}),
  )
})

// Keeps this version's cache and the previous one's (the list of both is
// remembered in META). Everything older goes. Resolves true if there was a previous one.
const META = 'ifc-viewer-meta'
async function pruneCaches() {
  const meta = await caches.open(META)
  const before = await meta
    .match('versions')
    .then((r) => (r ? r.json() : []))
    .catch(() => [])
  const keep = [CACHE, ...before.filter((k) => k !== CACHE)].slice(0, 2)
  await meta.put('versions', new Response(JSON.stringify(keep)))
  const stale = (await caches.keys()).filter((k) => k.startsWith('ifc-viewer-') && k !== META && !keep.includes(k))
  await Promise.all(stale.map((k) => caches.delete(k)))
  return keep.length > 1
}

self.addEventListener('message', (event) => {
  if (event.data === 'precache') event.waitUntil(precacheAll().catch(() => {}))
})

const cacheable = (response) => response && response.status === 200 && response.type === 'basic'
// A page (the index, or a server's error page) saved under a file's address
// would be served in place of that file for good, so only navigations may store HTML.
const cacheableFile = (response) => cacheable(response) && !/text\/html/i.test(response.headers.get('content-type') || '')

// Serve the cached copy at once and refresh it in the background.
function staleWhileRevalidate(event, cacheKey, store = cacheable) {
  const { request } = event
  const refresh = fetch(request)
    .then(async (response) => {
      if (store(response)) await (await caches.open(CACHE)).put(cacheKey, response.clone())
      return response
    })
    .catch(() => null)
  event.waitUntil(refresh)
  return matchOwnFirst(cacheKey, { ignoreSearch: true }).then((hit) => hit || refresh.then((r) => r || Response.error()))
}

// This version's cache first, then the previous one's (cache.match across
// caches would return the oldest copy, which for the index is the wrong page).
async function matchOwnFirst(key, options) {
  return (await (await caches.open(CACHE)).match(key, options)) || (await caches.match(key, options))
}

// A script, worker, stylesheet or wasm file must never be answered with a
// page: nginx falls back to index.html for unknown paths, and the browser
// would then fail on it with a misleading error.
const isCode = (request) =>
  /\.(m?js|css|wasm)$/.test(new URL(request.url).pathname) || ['script', 'worker', 'style'].includes(request.destination)
const isPage = (response) => /text\/html/i.test(response.headers.get('content-type') || '')
const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })

// Network, and once more past the HTTP cache when it failed in a way that may
// be momentary (connection error, 5xx, or a page where code was expected).
async function fetchChecked(request) {
  const bad = (response) => response.status >= 500 || (isCode(request) && response.ok && isPage(response))
  let response
  try {
    response = await fetch(request)
    if (!bad(response)) return response
  } catch {
    response = null
  }
  try {
    const again = await fetch(new Request(request, { cache: 'reload' }))
    if (!bad(again)) return again
    response = again
  } catch {
    // keep what the first try gave
  }
  if (!response) throw new TypeError('Failed to fetch')
  return isCode(request) && isPage(response) ? notFound() : response
}

// Cached copy if there is one, otherwise the network (and remember it).
function cacheFirst(request) {
  return matchOwnFirst(request).then(
    (hit) =>
      hit ||
      fetchChecked(request).then((response) => {
        if (cacheableFile(response)) {
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
  // The page asked for the network on purpose (a version check, a retry past the caches).
  if (request.cache === 'no-store' || request.cache === 'reload') return

  if (request.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(event, INDEX))
    return
  }
  const path = url.href.slice(SCOPE.length)
  // The sample is a plain file that may change: show the cached one, refresh it.
  if (path.startsWith('demo/')) {
    if (url.search) return // a cache-busting request goes straight to the network
    event.respondWith(staleWhileRevalidate(event, request.url, cacheableFile))
    return
  }
  // Everything else under the scope is content-hashed or effectively static.
  event.respondWith(cacheFirst(request))
})

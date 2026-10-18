// Version skew and reload recovery. A deploy replaces the hashed files a
// still-open tab asks for; the cure is a controlled reload that picks the
// user's action up again. Pure helpers take their storage and clock as
// arguments so the tests can drive them; the browser wrappers are at the end.

const GUARD_KEY = "argus-auto-reload-at";
const PENDING_KEY = "argus-pending-intent";
export const RELOAD_GUARD_MS = 60_000;
const PENDING_TTL_MS = 120_000;

// ---- reload loop guard: at most one automatic reload per minute ----
export function canAutoReload(storage, now = Date.now()) {
  try {
    const last = Number(storage.getItem(GUARD_KEY));
    return !(last && (now < last || now - last < RELOAD_GUARD_MS));
  } catch {
    return false; // no storage, no way to prove it is not a loop
  }
}
export function markAutoReload(storage, now = Date.now()) {
  try {
    storage.setItem(GUARD_KEY, String(now));
  } catch {
    // canAutoReload then refuses, which is the safe side
  }
}

// ---- the action to resume after the reload ----
// intent: { type: "library", id } | { type: "sample" } | { type: "local", name }
export function savePending(storage, intent, now = Date.now()) {
  try {
    storage.setItem(PENDING_KEY, JSON.stringify({ intent, at: now }));
  } catch {
    // nothing to resume, the user just opens the model again
  }
}
export function takePending(storage, now = Date.now()) {
  try {
    const raw = storage.getItem(PENDING_KEY);
    storage.removeItem(PENDING_KEY);
    const { intent, at } = JSON.parse(raw || "null") ?? {};
    return intent && now - at < PENDING_TTL_MS && now >= at ? intent : null;
  } catch {
    return null;
  }
}

// The intent saved before the reload that started this page, read once per page load.
let startup;
export function startupIntent() {
  if (startup === undefined) startup = typeof sessionStorage === "undefined" ? null : takePending(sessionStorage);
  return startup;
}

// ---- build ids: <meta name="argus-build"> is written into index.html at build time ----
export function parseBuildId(html) {
  const tag = /<meta[^>]+name=["']argus-build["'][^>]*>/i.exec(html)?.[0];
  return tag ? (/content=["']([^"']+)["']/i.exec(tag)?.[1] ?? null) : null;
}
export const runningBuildId = () =>
  typeof document === "undefined" ? null : document.querySelector('meta[name="argus-build"]')?.content || null;

// Newer build id than the running one, or null (unknown, equal, or offline).
export async function fetchNewerBuildId(running = runningBuildId(), base = import.meta.env.BASE_URL) {
  if (!running) return null;
  try {
    const res = await fetch(`${base}index.html?build-check=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const latest = parseBuildId(await res.text());
    return latest && latest !== running ? latest : null;
  } catch {
    return null;
  }
}

// Is one of Argus's own hashed files gone, or answered with a page? (An old tab asks for it.)
export async function assetIsGone(url) {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    return !res.ok || /text\/html/i.test(res.headers.get("content-type") || "");
  } catch {
    return false; // offline is not skew
  }
}

// This tab is older than the deployed build (a newer index.html, or its own entry script is gone).
export async function isStaleBuild() {
  const entry = typeof document === "undefined" ? null : document.querySelector("script[type=module][src]")?.src;
  return !!((await fetchNewerBuildId()) || (entry && (await assetIsGone(entry))));
}

// Before the import starts over: ask the network (not the HTTP cache) for the
// files the failure names, so a bad cached copy cannot repeat it. Best effort, 5 s at most.
export async function refreshFailedAssets(message) {
  const urls = [...new Set(String(message ?? "").match(/https?:\/\/[^\s"')]+\.(?:js|wasm)/g) ?? [])].slice(0, 3);
  if (urls.length === 0) return;
  const refresh = Promise.all(urls.map((u) => fetch(u, { cache: "reload" }).then((r) => r.arrayBuffer()).catch(() => {})));
  await Promise.race([refresh, new Promise((resolve) => setTimeout(resolve, 5000))]);
}

// ---- browser actions ----
export async function purgeStaleCaches() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = (await globalThis.caches?.keys?.()) ?? [];
    await Promise.all(keys.filter((k) => k.startsWith("ifc-viewer-")).map((k) => caches.delete(k)));
  } catch {
    // best effort: the reload still fetches the new index
  }
}

// Reloads once (guarded), remembering `intent`. Returns false if the guard
// says a reload already happened in the last minute (the caller then shows a button).
export async function reloadResuming(intent, onStart) {
  if (!canAutoReload(sessionStorage)) return false;
  markAutoReload(sessionStorage);
  onStart?.();
  if (intent) savePending(sessionStorage, intent);
  await purgeStaleCaches();
  location.reload();
  return true;
}

// Reload on user request (no guard, the user asked), still resuming.
export async function reloadNow(intent) {
  if (intent) savePending(sessionStorage, intent);
  await purgeStaleCaches();
  location.reload();
}

// ---- a lazily loaded chunk did not arrive ----
// Is there work on the page a reload would throw away (a model open or being
// opened, a file waiting to be opened)? The viewer registers the real check.
let workOpen = () => false;
export function registerOpenWork(check) {
  workOpen = check;
}
const hasOpenWork = () => {
  try {
    return !!workOpen();
  } catch {
    return true; // when in doubt, keep the page
  }
};

// What to do about a chunk that did not download: reload only when this tab
// is older than the deployed build AND nothing would be lost; otherwise the
// caller retries the import itself and says what is missing.
export const chunkFailureAction = ({ stale, workOpen }) => (stale && !workOpen ? "reload" : "retry");

// The engine or another lazily loaded chunk failed (vite:preloadError, or the
// engine import at boot). Never reloads away an open model: a momentary
// failure is retried where the import happened (importRetrying below).
// Resolves true if a reload was started.
export async function recoverFromChunkFailure() {
  if (hasOpenWork()) return false;
  const stale = await isStaleBuild();
  if (chunkFailureAction({ stale, workOpen: hasOpenWork() }) !== "reload") return false;
  return reloadResuming(null);
}

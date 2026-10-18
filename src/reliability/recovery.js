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
    return !(last && now - last < RELOAD_GUARD_MS && now >= last);
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

// The engine (or any lazily loaded chunk) failed while the page booted. If this
// tab is older than the deployed build, reload once; otherwise leave it be.
export async function recoverFromBootFailure() {
  const entry = document.querySelector("script[type=module][src]")?.src;
  if ((await fetchNewerBuildId()) || (entry && (await assetIsGone(entry)))) await reloadResuming(null);
}

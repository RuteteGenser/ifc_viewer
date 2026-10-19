// Thin client for the model store at same-origin /api/. Every function
// throws a LibraryError; `hidden` means "this deployment has no library".
import { checkDownload, expectedSha } from "../reliability/integrity";
import { withBackoff } from "../reliability/retry";

const API = import.meta.env.VITE_LIBRARY_API || "/api";
export const MAX_BYTES = 250 * 1024 * 1024;
export const ALLOWED = [".ifc", ".ifczip", ".zip"];

export class LibraryError extends Error {
  constructor(message, { status = 0, hidden = false, aborted = false, body = null } = {}) {
    super(message);
    this.body = body; // JSON of a 402, with the server's code and entitlement
    this.status = status;
    this.hidden = hidden;
    this.aborted = aborted;
  }
}

const STATUS_TEXT = {
  400: "The server did not accept that file.",
  401: "Sign in again to use your models.",
  402: "That needs a plan.",
  404: "That model is not saved here any more.",
  411: "The upload could not be sent. Try again.",
  413: "That file is too large. The limit is 250 MB.",
  507: "The library is full. Delete a model and try again.",
};

function sentence(text) {
  const t = String(text).trim();
  return t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".");
}

// Tell the access layer (if the new backend is present) that a plan is needed.
function upgrade(status, body) {
  if (status !== 402 || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("argus:upgrade", { detail: { code: body?.code, message: body?.error, entitlement: body?.entitlement } }));
}
const changed = () => typeof window !== "undefined" && window.dispatchEvent(new Event("argus:library-changed"));
const WRITE = { "X-Argus-Client": "1" };

async function problem(res) {
  let detail = "";
  let body = null;
  try {
    body = await res.json();
    detail = body?.error || "";
  } catch {
    // not JSON
  }
  upgrade(res.status, body);
  const base = STATUS_TEXT[res.status] || "Something went wrong. Try again.";
  // The server's own text is clearest for a rejected file (wrong type, not IFC).
  const err = new LibraryError((res.status === 400 || res.status === 402) && detail ? sentence(detail) : base, { status: res.status, body });
  err.retryAfter = Number(res.headers.get("retry-after")) || 0;
  return err;
}

async function request(path, init) {
  let res;
  try {
    res = await fetch(`${API}${path}`, init);
  } catch (err) {
    if (err?.name === "AbortError") throw new LibraryError("Cancelled", { aborted: true });
    throw new LibraryError("Could not reach your models. Check your connection.");
  }
  return res;
}

// Runs a read of the library again by itself when the failure is momentary.
const reading = (task) => withBackoff(task, { shouldRetry: (err) => isTransient(err), wait: waitFor });

export const listModels = (signal) => reading(() => listModelsOnce(signal));
async function listModelsOnce(signal) {
  const res = await request("/models", { signal, headers: { Accept: "application/json" } });
  if ([401, 403, 404, 405].includes(res.status)) throw new LibraryError("No library", { status: res.status, hidden: true });
  if (!res.ok) throw new LibraryError("Your models are not available right now.", { status: res.status });
  const type = res.headers.get("content-type") || "";
  if (!type.includes("json")) throw new LibraryError("No library", { hidden: true });
  const data = await res.json().catch(() => null);
  if (!Array.isArray(data)) throw new LibraryError("No library", { hidden: true });
  return data;
}

// ---- Offline copy of models that were opened before ----
// A model's file never changes for its id, so once downloaded it is kept in
// Cache Storage (at most about 100 MB, least recently used goes first) and an
// open that cannot reach the server uses it. Only complete, successful
// downloads are stored. The service worker cannot do this: the API is outside
// its scope, so the page keeps the copy itself.
const CACHE_NAME = "argus-library-v1";
const CACHE_MAX_BYTES = 100 * 1024 * 1024;
const USED_KEY = "ifcViewer.libraryCacheUsed";
const fileKey = (id) => `${API}/models/${encodeURIComponent(id)}/file`;
const recordKey = (id) => `${API}/models/${encodeURIComponent(id)}`;

async function openCache() {
  try {
    return typeof caches === "undefined" ? null : await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

function readUsed() {
  try {
    return JSON.parse(localStorage.getItem(USED_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeUsed(used) {
  try {
    localStorage.setItem(USED_KEY, JSON.stringify(used));
  } catch {
    // private mode: eviction order is then by the cache's own order
  }
}

async function evictOldest(cache, keep) {
  const used = readUsed();
  const ids = Object.keys(used);
  let total = ids.reduce((sum, id) => sum + (used[id].size || 0), 0);
  ids.sort((a, b) => (used[a].t || 0) - (used[b].t || 0));
  for (const id of ids) {
    if (total <= CACHE_MAX_BYTES) break;
    if (id === keep) continue;
    await cache.delete(fileKey(id));
    await cache.delete(recordKey(id));
    total -= used[id].size || 0;
    delete used[id];
  }
  writeUsed(used);
}

async function rememberModel(record, blob) {
  const cache = await openCache();
  if (!cache || !record?.id || blob.size > CACHE_MAX_BYTES) return;
  try {
    await cache.put(fileKey(record.id), new Response(blob, { headers: { "Content-Type": "application/octet-stream" } }));
    await cache.put(recordKey(record.id), new Response(JSON.stringify(record), { headers: { "Content-Type": "application/json" } }));
    const used = readUsed();
    used[record.id] = { t: Date.now(), size: blob.size };
    writeUsed(used);
    await evictOldest(cache, record.id);
  } catch {
    // storage full or blocked: the model just is not kept offline
  }
}

async function savedFile(item) {
  const cache = await openCache();
  const hit = await cache?.match(fileKey(item.id));
  if (!hit) return null;
  const blob = await hit.blob();
  if (item.size && blob.size !== item.size) return null;
  const used = readUsed();
  used[item.id] = { t: Date.now(), size: blob.size };
  writeUsed(used);
  return new File([blob], item.name, { type: "application/octet-stream" });
}

async function savedRecord(id) {
  const cache = await openCache();
  const hit = await cache?.match(recordKey(id));
  return hit ? hit.json().catch(() => null) : null;
}

// A deleted model must not stay on this device.
export async function forgetModel(id) {
  const cache = await openCache();
  if (!cache) return;
  await cache.delete(fileKey(id));
  await cache.delete(recordKey(id));
  const used = readUsed();
  delete used[id];
  writeUsed(used);
}

export const getModel = (id, signal) => reading(() => getModelOnce(id, signal));
async function getModelOnce(id, signal) {
  let res;
  try {
    res = await request(`/models/${encodeURIComponent(id)}`, { signal });
  } catch (err) {
    // Offline: a model opened before still has its record.
    const record = err?.aborted ? null : await savedRecord(id);
    if (record) return record;
    throw err;
  }
  if (!res.ok) throw await problem(res);
  return res.json();
}

export async function renameModel(id, name) {
  const res = await request(`/models/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...WRITE },
    credentials: "same-origin",
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw await problem(res);
  return res.json();
}

export async function deleteModel(id) {
  const res = await request(`/models/${encodeURIComponent(id)}`, { method: "DELETE", headers: WRITE, credentials: "same-origin" });
  if (!res.ok) throw await problem(res);
  forgetModel(id);
  changed();
}

// Reads the body of one response, reporting progress. A cut connection
// throws LibraryError with incomplete = true.
async function readBody(res, item, signal, onProgress) {
  // A compressed response reports the compressed length, which the decoded bytes never match.
  const encoded = !!res.headers.get("content-encoding");
  const declared = encoded ? 0 : Number(res.headers.get("content-length")) || 0;
  const total = declared || item.size || 0;
  const chunks = [];
  let received = 0;
  try {
    if (res.body?.getReader) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        onProgress?.(total ? Math.min(1, received / total) : null);
      }
    } else {
      chunks.push(new Uint8Array(await (await res.blob()).arrayBuffer()));
    }
  } catch (err) {
    if (err?.name === "AbortError" || signal?.aborted) throw new LibraryError("Cancelled", { aborted: true });
    throw Object.assign(new LibraryError("The download was incomplete. Try again."), { incomplete: true, detail: String(err?.message ?? err) });
  }
  return { chunks, declared, encoded, etag: res.headers.get("etag") };
}

// A momentary problem worth another go: the network, a busy or restarting
// server (5xx, 429), a body that arrived incomplete. 400/401/404 are answers, not accidents.
export const isTransient = (err) =>
  err instanceof LibraryError && !err.aborted && !err.hidden && (err.status === 0 || err.status >= 500 || err.status === 429 || !!err.incomplete);
// Retry-After (seconds), capped at 5 s, as a minimum wait.
const waitFor = (err) => Math.min(5000, (err?.retryAfter || 0) * 1000);

// The last download is kept so that opening the same model again, or an import
// that has to start over, never downloads it twice.
let lastDownload = null; // { key, file }

// Streams the file so the caller can show real progress, and checks it before
// it reaches the importer (size, header, sha256). A failed or bad download is
// done again by itself (0 s, 1 s, 3 s; later tries go past every cache); the
// error is only thrown once all attempts failed, with `retryable` set.
// onAttempt(n, total) is called before each repeat. The URL is
// immutable-cacheable, so a repeat open is normally served by the HTTP cache.
export async function downloadModel(item, { signal, onProgress, onAttempt }) {
  const kept = await savedFile(item);
  if (kept) {
    onProgress?.(1);
    kept.argusIntent = { type: "library", id: item.id };
    return kept;
  }
  const key = `${item.id}:${item.sha256 || item.size}`;
  if (lastDownload?.key === key) {
    onProgress?.(1);
    return lastDownload.file;
  }
  let detail = "";
  try {
    const file = await withBackoff(
      async (attempt) => {
        const res = await request(`/models/${encodeURIComponent(item.id)}/file`, { signal, ...(attempt > 1 ? { cache: "reload" } : {}) });
        if (!res.ok) throw await problem(res);
        const { chunks, declared, etag } = await readBody(res, item, signal, onProgress);
        const check = await checkDownload({ chunks, contentLength: declared, recordSize: item.size, sha: expectedSha(item, etag) });
        if (!check.ok) throw Object.assign(new LibraryError("The download was incomplete."), { incomplete: true, detail: check.reason });
        return new File(chunks, item.name, { type: "application/octet-stream" });
      },
      {
        shouldRetry: (err) => {
          detail = err.detail || err.message;
          return isTransient(err) && !signal?.aborted;
        },
        onRetry: (err, next, total) => onAttempt?.(next, total),
        wait: waitFor,
      },
    );
    onProgress?.(1);
    file.argusIntent = { type: "library", id: item.id };
    lastDownload = { key, file };
    rememberModel(item, file);
    return file;
  } catch (err) {
    if (!isTransient(err)) throw err;
    throw Object.assign(new LibraryError(err.incomplete ? "The download keeps arriving incomplete. Check your connection and try once more." : err.message), {
      retryable: true,
      detail: detail || err.detail,
    });
  }
}

export function extensionOf(name) {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

// XMLHttpRequest, because fetch cannot report upload progress.
// Returns { promise, abort }. Resolves { record, duplicate }.
export function uploadModel(file, onProgress) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    xhr.open("POST", `${API}/models?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("X-Argus-Client", "1");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // not JSON
      }
      if (xhr.status === 200 || xhr.status === 201) {
        changed();
        resolve({ record: body, duplicate: xhr.status === 200 });
        return;
      }
      const detail = body?.error;
      upgrade(xhr.status, body);
      const message = (xhr.status === 400 || xhr.status === 402) && detail ? sentence(detail) : STATUS_TEXT[xhr.status] || "Could not save that model. Try again.";
      reject(new LibraryError(message, { status: xhr.status, body }));
    };
    xhr.onerror = () => reject(new LibraryError("Could not reach your models. Check your connection."));
    xhr.onabort = () => reject(new LibraryError("Cancelled", { aborted: true }));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

export function linkFor(id) {
  return `${window.location.origin}${import.meta.env.BASE_URL}?model=${encodeURIComponent(id)}`;
}

// ---- Folders (only when the backend answers GET /folders with a JSON array) ----
// listFolders resolves null for "no folders here" (404, 401, HTML, network): the UI then shows nothing.
export async function listFolders(signal, retried = false) {
  try {
    const res = await fetch(`${API}/folders`, { signal, headers: { Accept: "application/json" }, credentials: "same-origin" });
    // A first visit asks before the session cookie exists: ask once more shortly after.
    if (res.status === 401 && !retried) {
      await new Promise((r) => setTimeout(r, 1500));
      return listFolders(signal, true);
    }
    if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) return null;
    const data = await res.json().catch(() => null);
    if (!Array.isArray(data)) return null;
    return { folders: data, limit: Number(res.headers.get("x-folder-limit")) || 0 };
  } catch {
    return null;
  }
}
async function folderCall(path, method, body) {
  const res = await request(path, {
    method,
    headers: { "Content-Type": "application/json", ...WRITE },
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await problem(res);
  return res.json().catch(() => ({}));
}
export const createFolder = (name, parentId = null) => folderCall("/folders", "POST", { name, parentId });
export const renameFolder = (id, name) => folderCall(`/folders/${encodeURIComponent(id)}`, "PATCH", { name });
export const moveFolder = (id, parentId) => folderCall(`/folders/${encodeURIComponent(id)}`, "PATCH", { parentId });
export const deleteFolder = (id) => folderCall(`/folders/${encodeURIComponent(id)}`, "DELETE");
export const moveModel = (id, folderId) => folderCall(`/models/${encodeURIComponent(id)}`, "PATCH", { folderId });

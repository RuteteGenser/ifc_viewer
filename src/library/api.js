// Thin client for the model store at same-origin /api/. Every function
// throws a LibraryError; `hidden` means "this deployment has no library".
const API = import.meta.env.VITE_LIBRARY_API || "/api";
export const MAX_BYTES = 250 * 1024 * 1024;
export const ALLOWED = [".ifc", ".ifczip", ".zip"];

export class LibraryError extends Error {
  constructor(message, { status = 0, hidden = false, aborted = false } = {}) {
    super(message);
    this.status = status;
    this.hidden = hidden;
    this.aborted = aborted;
  }
}

const STATUS_TEXT = {
  400: "The server did not accept that file.",
  401: "Sign in again to use your models.",
  404: "That model is not saved here any more.",
  411: "The upload could not be sent. Try again.",
  413: "That file is too large. The limit is 250 MB.",
  507: "The library is full. Delete a model and try again.",
};

function sentence(text) {
  const t = String(text).trim();
  return t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".");
}

async function problem(res) {
  let detail = "";
  try {
    detail = (await res.json())?.error || "";
  } catch {
    // not JSON
  }
  const base = STATUS_TEXT[res.status] || "Something went wrong. Try again.";
  // The server's own text is clearest for a rejected file (wrong type, not IFC).
  return new LibraryError(res.status === 400 && detail ? sentence(detail) : base, { status: res.status });
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

export async function listModels(signal) {
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

export async function getModel(id, signal) {
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw await problem(res);
  return res.json();
}

export async function deleteModel(id) {
  const res = await request(`/models/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw await problem(res);
  forgetModel(id);
}

// Streams the file so the caller can show real progress. The URL is
// immutable-cacheable, so a repeat open is served by the HTTP cache.
export async function downloadModel(item, { signal, onProgress }) {
  const kept = await savedFile(item);
  if (kept) {
    onProgress?.(1);
    return kept;
  }
  const res = await request(`/models/${encodeURIComponent(item.id)}/file`, { signal });
  if (!res.ok) throw await problem(res);
  const total = Number(res.headers.get("content-length")) || item.size || 0;
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
      chunks.push(await res.blob());
    }
  } catch (err) {
    if (err?.name === "AbortError") throw new LibraryError("Cancelled", { aborted: true });
    throw new LibraryError("The download was interrupted. Try again.");
  }
  onProgress?.(1);
  const file = new File(chunks, item.name, { type: "application/octet-stream" });
  if (!total || file.size === total) rememberModel(item, file);
  return file;
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
        resolve({ record: body, duplicate: xhr.status === 200 });
        return;
      }
      const detail = body?.error;
      const message = xhr.status === 400 && detail ? sentence(detail) : STATUS_TEXT[xhr.status] || "Could not save that model. Try again.";
      reject(new LibraryError(message, { status: xhr.status }));
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

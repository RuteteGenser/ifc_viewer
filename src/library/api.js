// Thin client for the model store at same-origin /api/. Every function
// throws a LibraryError; `hidden` means "this deployment has no library".
import { checkDownload, expectedSha } from "../reliability/integrity";

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

export async function getModel(id, signal) {
  const res = await request(`/models/${encodeURIComponent(id)}`, { signal });
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

// Streams the file so the caller can show real progress, and checks it before
// it reaches the importer (size, header, sha256). A bad copy is fetched once
// more past every cache; if that is bad too the error has `retryable` set.
// The URL is immutable-cacheable, so a repeat open is normally served by the HTTP cache.
export async function downloadModel(item, { signal, onProgress }) {
  let detail = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await request(`/models/${encodeURIComponent(item.id)}/file`, { signal, ...(attempt ? { cache: "reload" } : {}) });
    if (!res.ok) throw await problem(res);
    try {
      const { chunks, declared, etag } = await readBody(res, item, signal, onProgress);
      const check = await checkDownload({ chunks, contentLength: declared, recordSize: item.size, sha: expectedSha(item, etag) });
      if (check.ok) {
        onProgress?.(1);
        const file = new File(chunks, item.name, { type: "application/octet-stream" });
        file.argusIntent = { type: "library", id: item.id };
        return file;
      }
      detail = check.reason;
    } catch (err) {
      if (!err?.incomplete) throw err;
      detail = err.detail;
    }
    if (signal?.aborted) throw new LibraryError("Cancelled", { aborted: true });
  }
  throw Object.assign(new LibraryError("The download was incomplete. Try again."), { retryable: true, detail });
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

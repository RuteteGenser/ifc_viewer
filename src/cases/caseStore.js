// Local persistence for "cases" (a pinned spot in the model + summary +
// photos). Everything lives in the browser's IndexedDB — nothing is
// uploaded, matching the rest of the app. Each case is one record that
// embeds its photo Blobs, so a case is saved/deleted atomically.

export const DISCIPLINES = ["RIB", "RIV", "RIR", "RIE"];

const DB_NAME = "ifc-viewer-cases";
const DB_VERSION = 1;
const STORE = "cases";

const FULL_MAX_PX = 1600;
const THUMB_MAX_PX = 360;

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

function run(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const result = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(result?.result ?? undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export function loadAllCases() {
  return run("readonly", (store) => store.getAll()).then((rows) =>
    (rows ?? []).sort((a, b) => b.createdAt - a.createdAt),
  );
}

export function saveCase(record) {
  return run("readwrite", (store) => store.put(record));
}

export function deleteCaseRecord(id) {
  return run("readwrite", (store) => store.delete(id));
}

export function newId() {
  return crypto.randomUUID();
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode image"))), "image/jpeg", quality);
  });
}

function drawScaled(bitmap, maxPx) {
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Downscales a user-picked image file (phone photos are often 5–10 MB) to
 * a 1600px JPEG plus a small thumbnail, so dozens of cases stay well within
 * browser storage quotas.
 */
export async function processPhotoFile(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`"${file.name}" is not an image this browser can read (HEIC is not supported — use JPEG/PNG).`);
  }
  try {
    const [blob, thumb] = await Promise.all([
      canvasToBlob(drawScaled(bitmap, FULL_MAX_PX), 0.82),
      canvasToBlob(drawScaled(bitmap, THUMB_MAX_PX), 0.75),
    ]);
    return { id: newId(), name: file.name, addedAt: Date.now(), blob, thumb };
  } finally {
    bitmap.close?.();
  }
}

// Blob -> object URL, cached so re-renders don't leak new URLs.
const urlCache = new WeakMap();
const liveUrls = new Set();
export function blobUrl(blob) {
  let url = urlCache.get(blob);
  if (!url) {
    url = URL.createObjectURL(blob);
    urlCache.set(blob, url);
    liveUrls.add(url);
  }
  return url;
}
export function revokeBlobUrl(blob) {
  const url = urlCache.get(blob);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(blob);
    liveUrls.delete(url);
  }
}

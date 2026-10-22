// Keeps the converted form of a library model (the fragments bytes the slow wasm import produces) in Cache
// Storage, so opening the same model again skips the conversion. A library file never changes for its id, so
// the key is the id, its size, the converter's version and the settings that shape the output. Anything wrong
// with an entry means "no entry": the caller converts as usual. Least recently used goes first.
const CACHE_NAME = "argus-converted-v1";
const FORMAT = 1; // bump when the stored shape changes
export const CONVERTER = `fragments-3.4.7;f${FORMAT}`; // package version of @thatopen/fragments
const MAX_BYTES = 150 * 1024 * 1024;
const MAX_ONE = 80 * 1024 * 1024;
const INDEX_KEY = "ifcViewer.convertedCacheUsed";

const settingsKey = (settings) => JSON.stringify(settings ?? {});
export function convertedKey({ id, size, settings }) {
  return `https://converted.argus.invalid/${encodeURIComponent(id)}/${size}/${encodeURIComponent(`${CONVERTER}|${settingsKey(settings)}`)}`;
}

async function open() {
  try {
    return typeof caches === "undefined" ? null : await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}
const readIndex = () => {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) || "{}");
  } catch {
    return {};
  }
};
const writeIndex = (index) => {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // private mode: no eviction order beyond the cache's own
  }
};

// The stored fragments as a fresh Uint8Array (the caller hands its buffer to a worker), or null.
export async function readConverted(entry) {
  const cache = await open();
  if (!cache) return null;
  try {
    const key = convertedKey(entry);
    const hit = await cache.match(key);
    if (!hit) return null;
    const bytes = new Uint8Array(await hit.arrayBuffer());
    if (!bytes.byteLength) return null;
    const index = readIndex();
    index[key] = { t: Date.now(), size: bytes.byteLength };
    writeIndex(index);
    return bytes;
  } catch {
    return null;
  }
}

export async function writeConverted(entry, bytes) {
  if (!bytes?.byteLength || bytes.byteLength > MAX_ONE) return;
  const cache = await open();
  if (!cache) return;
  try {
    const key = convertedKey(entry);
    await cache.put(key, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }));
    const index = readIndex();
    index[key] = { t: Date.now(), size: bytes.byteLength };
    let total = Object.values(index).reduce((sum, v) => sum + (v.size || 0), 0);
    for (const [k, v] of Object.entries(index).sort((a, b) => a[1].t - b[1].t)) {
      if (total <= MAX_BYTES) break;
      if (k === key) continue;
      await cache.delete(k);
      delete index[k];
      total -= v.size || 0;
    }
    writeIndex(index);
  } catch {
    // storage full or blocked: the model is simply converted again next time
  }
}

export async function dropConverted(entry) {
  const cache = await open();
  if (!cache) return;
  try {
    const key = convertedKey(entry);
    await cache.delete(key);
    const index = readIndex();
    delete index[key];
    writeIndex(index);
  } catch {
    // nothing to drop
  }
}

// Every converted copy of a model id (a deleted model must not stay on the device).
export async function forgetConverted(id) {
  const cache = await open();
  if (!cache) return;
  try {
    const prefix = `https://converted.argus.invalid/${encodeURIComponent(id)}/`;
    const index = readIndex();
    for (const req of await cache.keys()) if (req.url.startsWith(prefix)) await cache.delete(req);
    for (const k of Object.keys(index)) if (k.startsWith(prefix)) delete index[k];
    writeIndex(index);
  } catch {
    // nothing to forget
  }
}

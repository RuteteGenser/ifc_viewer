// Device storage for cases. IndexedDB `argus-cases` v1: stores `cases` (case without images) and
// `images` (key `${caseId}:${snapshotId}:${kind}`, value = data URL). If IndexedDB cannot be opened
// (private mode, blocked) everything runs from memory and `persistent` is false: the UI must say
// "not saved on this device". Failures of single operations after a successful open are thrown, not
// hidden, so a full disk is never mistaken for a save.
export const DB_NAME = "argus-cases";
export const DB_VERSION = 1;
const KINDS = ["thumb", "image"];
const imgKey = (caseId, snapId, kind) => `${caseId}:${snapId}:${kind}`;

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error || new Error("IndexedDB request failed")); });
const txDone = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error || new Error("IndexedDB transaction failed")); tx.onabort = () => rej(tx.error || new Error("IndexedDB transaction aborted")); });

function openIdb(idb) {
  return new Promise((res, rej) => {
    let req;
    try { req = idb.open(DB_NAME, DB_VERSION); } catch (e) { rej(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("cases")) db.createObjectStore("cases", { keyPath: "id" });
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images");
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error || new Error("Could not open IndexedDB"));
    req.onblocked = () => rej(new Error("IndexedDB is blocked"));
  });
}

// Backends share one small interface: all(), get(id), put(caseNoImages, imageEntries, replacePrefix), remove(id), images(caseId) -> {key:value}, image(key).
function memoryBackend() {
  const cases = new Map(), images = new Map();
  const dropImages = (id) => { for (const k of [...images.keys()]) if (k.startsWith(id + ":")) images.delete(k); };
  return {
    async all() { return [...cases.values()].map((c) => structuredClone(c)); },
    async get(id) { return cases.has(id) ? structuredClone(cases.get(id)) : null; },
    async put(c, entries) { dropImages(c.id); cases.set(c.id, structuredClone(c)); for (const [k, v] of entries) images.set(k, v); },
    async remove(id) { cases.delete(id); dropImages(id); },
    async images(id) { const o = {}; for (const [k, v] of images) if (k.startsWith(id + ":")) o[k] = v; return o; },
    async image(key) { return images.get(key) ?? null; },
  };
}

function idbBackend(db) {
  return {
    async all() { return wrap(db.transaction(["cases"], "readonly").objectStore("cases").getAll()); },
    async get(id) { return (await wrap(db.transaction(["cases"], "readonly").objectStore("cases").get(id))) ?? null; },
    async put(c, entries) {
      const tx = db.transaction(["cases", "images"], "readwrite");
      const done = txDone(tx);
      const is = tx.objectStore("images");
      const keys = await wrap(is.getAllKeys());
      for (const k of keys) if (String(k).startsWith(c.id + ":")) is.delete(k);
      for (const [k, v] of entries) is.put(v, k);
      tx.objectStore("cases").put(c);
      await done;
    },
    async remove(id) {
      const tx = db.transaction(["cases", "images"], "readwrite");
      const done = txDone(tx);
      const is = tx.objectStore("images");
      const keys = await wrap(is.getAllKeys());
      for (const k of keys) if (String(k).startsWith(id + ":")) is.delete(k);
      tx.objectStore("cases").delete(id);
      await done;
    },
    async images(id) {
      const is = db.transaction(["images"], "readonly").objectStore("images");
      const keys = (await wrap(is.getAllKeys())).filter((k) => String(k).startsWith(id + ":"));
      const o = {};
      for (const k of keys) o[k] = await wrap(is.get(k));
      return o;
    },
    async image(key) { return (await wrap(db.transaction(["images"], "readonly").objectStore("images").get(key))) ?? null; },
  };
}

// opts: indexedDB (default globalThis.indexedDB), storage (default navigator.storage), onStatus(fn), now().
export function createStore({ indexedDB: idb = globalThis.indexedDB, storage, onStatus, now = () => new Date().toISOString() } = {}) {
  const listeners = new Set();
  let backendP = null;
  const api = { persistent: false, ready: null };

  const status = (persistent, reason) => { api.persistent = persistent; try { onStatus?.({ persistent, reason: reason || null }); } catch { /* listener errors never break storage */ } };
  const emit = (event) => { for (const fn of [...listeners]) { try { fn(event); } catch { /* ignore */ } } };

  function backend() {
    if (!backendP) {
      backendP = (async () => {
        if (!idb) { status(false, "IndexedDB is not available in this browser."); return memoryBackend(); }
        try { const db = await openIdb(idb); status(true); return idbBackend(db); }
        catch (e) { status(false, String(e?.message || e)); return memoryBackend(); }
      })();
      api.ready = backendP.then(() => api.persistent);
    }
    return backendP;
  }

  async function summary(b, c) {
    const first = c.snapshots?.[0];
    const thumb = first ? await b.image(imgKey(c.id, first.id, "thumb")) : null;
    return { id: c.id, name: c.name, updatedAt: c.updatedAt, snapshotCount: c.snapshots?.length || 0, model: { name: c.model?.name || "" }, thumb };
  }

  Object.assign(api, {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async listCases() {
      const b = await backend();
      const all = await b.all();
      const out = await Promise.all(all.map((c) => summary(b, c)));
      return out.sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : x.updatedAt > y.updatedAt ? -1 : 0));
    },

    async getCase(id) {
      const b = await backend();
      const c = await b.get(id);
      if (!c) return null;
      const imgs = await b.images(id);
      for (const s of c.snapshots || []) for (const k of KINDS) s[k] = imgs[imgKey(id, s.id, k)] ?? null;
      return c;
    },

    // Stores the case (images split out). Sets updatedAt unless { touch: false }. Returns the stored case.
    async saveCase(c, { touch = true } = {}) {
      if (!c || typeof c.id !== "string" || !c.id) throw new Error("saveCase needs a case with an id");
      const b = await backend();
      const entries = [];
      const slim = { ...c, updatedAt: touch ? now() : c.updatedAt, snapshots: (c.snapshots || []).map((s) => {
        for (const k of KINDS) if (typeof s[k] === "string" && s[k]) entries.push([imgKey(c.id, s.id, k), s[k]]);
        return { ...s, thumb: null, image: null };
      }) };
      await b.put(slim, entries);
      emit({ type: "save", id: c.id });
      return { ...slim, snapshots: (c.snapshots || []).map((s) => ({ ...s })) };
    },

    // Updates the images of one snapshot without rewriting the whole case record's images.
    async saveSnapshotImages(caseId, snapshotId, { thumb, image }) {
      const c = await api.getCase(caseId);
      const s = c?.snapshots.find((x) => x.id === snapshotId);
      if (!s) throw new Error("Snapshot not found");
      if (thumb !== undefined) s.thumb = thumb;
      if (image !== undefined) s.image = image;
      return api.saveCase(c);
    },

    async deleteCase(id) {
      const b = await backend();
      await b.remove(id);
      emit({ type: "delete", id });
    },

    // { usage, quota, ratio } in bytes, or null when the browser cannot say.
    async estimateQuota() {
      try {
        const st = storage || globalThis.navigator?.storage;
        if (!st?.estimate) return null;
        const { usage = 0, quota = 0 } = await st.estimate();
        return { usage, quota, ratio: quota ? usage / quota : 0 };
      } catch { return null; }
    },
  });
  return api;
}

// App-wide instance. Created lazily so importing this module never touches IndexedDB.
let shared = null;
export const store = new Proxy({}, {
  get(_, prop) { shared ||= createStore(); return shared[prop]; },
  set(_, prop, v) { shared ||= createStore(); shared[prop] = v; return true; },
});

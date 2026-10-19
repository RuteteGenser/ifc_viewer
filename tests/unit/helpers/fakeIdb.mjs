// Minimal fake of the IndexedDB subset src/cases/store.js uses: open/upgrade, transaction,
// objectStore get/put/delete/getAll/getAllKeys, tx complete. Async like the real thing.
export function fakeIndexedDB({ failOpen = false, failPut = false } = {}) {
  const dbs = new Map(); // name -> { stores: Map<name,{keyPath,data:Map}>, version }
  const later = (fn) => setTimeout(fn, 0);
  // Requests run on a timer; a transaction completes when none are pending (like the real thing),
  // or aborts when one fails.
  const req = (fn, tx) => {
    const r = { result: undefined, error: null };
    tx.pending++;
    later(() => {
      try { r.result = fn(); r.onsuccess?.({ target: r }); }
      catch (e) { r.error = e; tx.failed = e; r.onerror?.({ target: r }); }
      tx.pending--;
      later(() => tx.check());
    });
    return r;
  };
  function makeDb(rec) {
    return {
      objectStoreNames: { contains: (n) => rec.stores.has(n) },
      createObjectStore(n, opts = {}) { rec.stores.set(n, { keyPath: opts.keyPath, data: new Map() }); },
      transaction(names) {
        const tx = { error: null, pending: 0, failed: null, finished: false };
        tx.check = () => {
          if (tx.finished || tx.pending > 0) return;
          tx.finished = true;
          if (tx.failed) { tx.error = tx.failed; tx.onabort?.({}); } else tx.oncomplete?.({});
        };
        later(() => tx.check());
        tx.objectStore = (n) => {
          const st = rec.stores.get(n);
          if (!names.includes(n) || !st) throw new Error("NotFoundError " + n);
          const keyOf = (v, k) => (st.keyPath ? v[st.keyPath] : k);
          return {
            get: (k) => req(() => (st.data.has(k) ? structuredClone(st.data.get(k)) : undefined), tx),
            getAll: () => req(() => [...st.data.values()].map((v) => structuredClone(v)), tx),
            getAllKeys: () => req(() => [...st.data.keys()], tx),
            put: (v, k) => req(() => { if (failPut) throw new Error("QuotaExceededError"); st.data.set(keyOf(v, k), structuredClone(v)); }, tx),
            delete: (k) => req(() => { st.data.delete(k); }, tx),
          };
        };
        return tx;
      },
    };
  }
  return {
    dbs,
    open(name, version) {
      const r = { result: null, error: null };
      later(() => {
        if (failOpen) { r.error = new Error("SecurityError"); r.onerror?.({}); return; }
        let rec = dbs.get(name);
        const fresh = !rec;
        if (fresh) { rec = { stores: new Map(), version }; dbs.set(name, rec); }
        r.result = makeDb(rec);
        if (fresh) r.onupgradeneeded?.({});
        r.onsuccess?.({});
      });
      return r;
    },
  };
}

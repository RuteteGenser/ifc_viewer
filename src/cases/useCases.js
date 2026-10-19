// React access to the cases store. No UI. State lives in a small external store so every
// component using the hook sees the same list (useSyncExternalStore).
import { useSyncExternalStore, useCallback, useMemo } from "react";
import { store as defaultStore } from "./store";
import { newCase } from "./schema";
import { newId } from "./ids";
import { buildCaseExport, importCaseFile } from "./files";

const CURRENT_KEY = "argus.cases.current";
const readCurrent = (ss) => { try { return (ss || globalThis.sessionStorage)?.getItem(CURRENT_KEY) || null; } catch { return null; } };
const writeCurrent = (ss, id) => { try { const s = ss || globalThis.sessionStorage; if (!s) return; if (id) s.setItem(CURRENT_KEY, id); else s.removeItem(CURRENT_KEY); } catch { /* private mode */ } };

// Framework-free controller (tested directly). getState() returns a stable object until something changes.
export function createCasesController(store = defaultStore, { sessionStorage: ss } = {}) {
  let state = { cases: [], currentId: readCurrent(ss), loading: true, error: null, persistent: store.persistent };
  const subs = new Set();
  let started = false, unsubStore = null;
  const set = (patch) => { state = { ...state, ...patch }; subs.forEach((f) => f()); };

  async function refresh() {
    try {
      const cases = await store.listCases();
      let currentId = state.currentId;
      if (currentId && !cases.some((c) => c.id === currentId)) { currentId = null; writeCurrent(ss, null); }
      set({ cases, currentId, loading: false, error: null, persistent: store.persistent });
    } catch (e) { set({ loading: false, error: String(e?.message || e), persistent: store.persistent }); }
  }
  const guard = async (fn) => { try { return await fn(); } catch (e) { set({ error: String(e?.message || e) }); throw e; } };

  const actions = {
    refresh,
    setCurrent(id) { writeCurrent(ss, id); set({ currentId: id }); },
    create: (name, model, author) => guard(async () => {
      const c = await store.saveCase(newCase({ name: (name || "").trim() || "Untitled case", model, author }));
      actions.setCurrent(c.id); return c;
    }),
    rename: (id, name) => guard(async () => {
      const c = await store.getCase(id); if (!c) throw new Error("Case not found");
      c.name = String(name).trim().slice(0, 200) || c.name; return store.saveCase(c);
    }),
    remove: (id) => guard(async () => { await store.deleteCase(id); if (state.currentId === id) actions.setCurrent(null); }),
    duplicate: (id) => guard(async () => {
      const c = await store.getCase(id); if (!c) throw new Error("Case not found");
      const t = new Date().toISOString();
      return store.saveCase({ ...c, id: newId(), name: `${c.name} (copy)`.slice(0, 200), createdAt: t, updatedAt: t });
    }),
    importFile: (file) => guard(async () => {
      const existing = (await store.listCases()).map((c) => c.id);
      const { case: c, warnings } = await importCaseFile(file, { existingIds: existing });
      await store.saveCase(c, { touch: false });
      return { id: c.id, warnings };
    }),
    exportCase: (id) => guard(async () => {
      const c = await store.getCase(id); if (!c) throw new Error("Case not found");
      return buildCaseExport(c);
    }),
  };

  return {
    actions,
    getState: () => state,
    subscribe(fn) {
      subs.add(fn);
      if (!started) { started = true; unsubStore = store.subscribe(refresh); refresh(); }
      return () => { subs.delete(fn); if (!subs.size && unsubStore) { unsubStore(); unsubStore = null; started = false; } };
    },
  };
}

let shared = null;
const ctrl = () => (shared ||= createCasesController());

export function useCases() {
  const c = ctrl();
  const state = useSyncExternalStore(c.subscribe, c.getState, c.getState);
  const actions = useMemo(() => c.actions, [c]);
  const current = useCallback(() => state.cases.find((x) => x.id === state.currentId) || null, [state]);
  return { ...state, current: current(), ...actions };
}

// The surface manager (docs/SURFACES.md). One place decides what may be open over the 3D view.
//   sheet    menu, models, details, cases, views, share, help: ONE at a time on a phone.
//   tool     measure, tag, hide-category, section-move, camera-clip: ONE armed, and never beside a sheet.
//   overlay  context menu, popups, confirm dialogs: modal, may sit above a sheet.
// Sheets are owned here (useSurfaceFlag is the only way to open one). Tools and overlays keep their state in the
// viewer, so they report it with useSurfaceMirror and the manager closes the loser through the callback they give.
// On desktop the manager is not exclusive: sheets keep their own dismissal (Views and Share still exclude each other).
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";

export const PHONE_QUERY = "(max-width: 768px), (max-height: 500px) and (pointer: coarse)";
export const SHEETS = ["menu", "models", "details", "cases", "views", "share", "help"];
const POPOVERS = ["views", "share"];
const BOTTOM_SHEETS = ["models", "cases", "help"]; // toasts sit above these

export const initialState = { sheets: [], snap: {} };

// Pure: the sheet slot. `exclusive` is true on a phone.
export function reduce(state, action, exclusive) {
  const { sheets, snap } = state;
  switch (action.type) {
    case "open": {
      const { id } = action;
      if (!SHEETS.includes(id)) return state;
      const rest = sheets.filter((s) => s !== id && (exclusive ? false : !(POPOVERS.includes(id) && POPOVERS.includes(s))));
      const next = [...rest, id];
      const nextSnap = {};
      for (const s of next) if (snap[s]) nextSnap[s] = snap[s];
      if (id === "details") nextSnap.details = action.snap || snap.details || "half";
      const same = next.length === sheets.length && next.every((s, i) => s === sheets[i]) && nextSnap.details === snap.details;
      return same ? state : { sheets: next, snap: nextSnap };
    }
    case "close": {
      if (!sheets.includes(action.id)) return state;
      const { [action.id]: _gone, ...keep } = snap;
      return { sheets: sheets.filter((s) => s !== action.id), snap: keep };
    }
    case "snap":
      return sheets.includes(action.id) && snap[action.id] !== action.snap ? { sheets, snap: { ...snap, [action.id]: action.snap } } : state;
    case "closeAll":
      return sheets.length ? initialState : state;
    case "trim": // the layout became a phone: keep only the newest sheet
      return exclusive && sheets.length > 1 ? reduce(initialState, { type: "open", id: sheets[sheets.length - 1], snap: snap[sheets[sheets.length - 1]] }, true) : state;
    default:
      return state;
  }
}

// Pure: of the externally owned surfaces ({ id, slot, seq }), what Back or Esc closes first: overlay, then sheet, then tool.
export function topmost(sheets, externals) {
  const newest = (slot) => externals.filter((e) => e.slot === slot).sort((a, b) => a.seq - b.seq).pop();
  const overlay = newest("overlay");
  if (overlay) return { kind: "overlay", id: overlay.id };
  if (sheets.length) return { kind: "sheet", id: sheets[sheets.length - 1] };
  const tool = newest("tool");
  return tool ? { kind: "tool", id: tool.id } : null;
}

const Ctx = createContext(null);
const matches = () => typeof window !== "undefined" && !!window.matchMedia?.(PHONE_QUERY).matches;

export function SurfaceProvider({ children }) {
  const [phone, setPhone] = useState(matches);
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE_QUERY);
    if (!mq) return undefined;
    const update = () => setPhone(mq.matches);
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  const [state, dispatch] = useReducer((s, a) => reduce(s, a, a.exclusive), initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (phone) dispatch({ type: "trim", exclusive: true });
  }, [phone]);

  const externals = useRef(new Map()); // key -> { id, slot, seq, close }
  const closers = useRef(new Map()); // sheet id -> what closing it also does (clear the selection, ...)
  const seq = useRef(0);

  const api = useMemo(() => {
    const act = (a) => dispatch({ ...a, exclusive: phoneRef.current });
    const tools = () => [...externals.current.values()].filter((e) => e.slot === "tool");
    const closeTools = (except) => tools().filter((e) => e.id !== except).forEach((e) => e.close());
    const isOpen = (id) => stateRef.current.sheets.includes(id);
    const open = (id, opts = {}) => {
      // A sheet that opens by itself (a selection) must not knock the armed tool away.
      if (opts.auto && phoneRef.current && tools().length) return false;
      if (phoneRef.current) closeTools();
      act({ type: "open", id, snap: opts.snap });
      return true;
    };
    const close = (id) => act({ type: "close", id });
    return {
      isOpen,
      snapOf: (id) => stateRef.current.snap[id],
      open,
      close,
      toggle: (id) => (isOpen(id) ? close(id) : open(id)),
      closeAll: () => act({ type: "closeAll" }),
      setSnap: (id, snap) => act({ type: "snap", id, snap }),
      setCloser: (id, fn) => {
        if (fn) closers.current.set(id, fn);
        else closers.current.delete(id);
      },
      // Back / Esc: closes the topmost surface, true when there was one.
      closeTop: () => {
        const top = topmost(stateRef.current.sheets, [...externals.current.values()]);
        if (!top) return false;
        if (top.kind === "sheet") (closers.current.get(top.id) || (() => close(top.id)))();
        else [...externals.current.values()].find((e) => e.id === top.id && e.slot === top.kind)?.close();
        return true;
      },
      register: (slot, id, close) => {
        const key = `${slot}:${id}`;
        externals.current.set(key, { id, slot, seq: ++seq.current, close });
        if (slot === "tool") {
          closeTools(id); // arming one tool disarms the rest
          if (phoneRef.current) act({ type: "closeAll" }); // ... and clears the sheets
        }
        return () => externals.current.delete(key);
      },
    };
  }, []);

  usePublishSheetHeight(state.sheets, phone);
  useTestAssertion(state.sheets, phone);

  const value = useMemo(() => ({ api, sheets: state.sheets, snap: state.snap, phone }), [api, state, phone]);
  return createElement(Ctx.Provider, { value }, children);
}

export function useSurfaces() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSurfaces needs <SurfaceProvider>");
  const { api, sheets, snap, phone } = v;
  return useMemo(() => ({ ...api, sheets, snap, phone, anySheet: sheets.length > 0 }), [api, sheets, snap, phone]);
}

// [open, setOpen] for one sheet, shaped like useState so existing call sites keep their form.
// `onClose` is what Back/Esc also does when it closes this sheet.
export function useSurfaceFlag(id, onClose) {
  const s = useSurfaces();
  const { open: openSheet, close: closeSheet, setCloser } = s;
  const on = s.sheets.includes(id);
  const onRef = useRef(on);
  onRef.current = on;
  const set = useCallback(
    (v) => {
      const next = typeof v === "function" ? v(onRef.current) : v;
      if (next) openSheet(id);
      else closeSheet(id);
    },
    [id, openSheet, closeSheet],
  );
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!closeRef.current) return undefined;
    setCloser(id, () => closeRef.current());
    return () => setCloser(id, null);
  }, [id, setCloser]);
  return [on, set];
}

// Reports a tool or overlay whose state lives elsewhere. `close` ends it (called when something else wins).
export function useSurfaceMirror(slot, id, active, close) {
  const v = useContext(Ctx);
  const closeRef = useRef(close);
  closeRef.current = close;
  const register = v?.api.register;
  useEffect(() => {
    if (!active || !register) return undefined;
    return register(slot, id, () => closeRef.current());
  }, [slot, id, active, register]);
}

// Toasts and other bottom things sit above the open bottom sheet: its height is published as --surface-h.
function usePublishSheetHeight(sheets, phone) {
  const bottom = phone ? [...sheets].reverse().find((s) => BOTTOM_SHEETS.includes(s)) : null;
  useEffect(() => {
    const root = document.documentElement;
    let ro;
    let raf = 0;
    const find = () => (bottom ? document.querySelector(`[data-surface-sheet="${bottom}"]:not([data-state="closed"])`) : null);
    const set = (el) => root.style.setProperty("--surface-h", el ? `${Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top))}px` : "0px");
    const attach = () => {
      const el = find();
      if (!el) {
        raf = requestAnimationFrame(attach);
        return;
      }
      set(el);
      if (typeof ResizeObserver === "function") {
        ro = new ResizeObserver(() => set(el));
        ro.observe(el);
      }
    };
    set(null);
    attach();
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      root.style.setProperty("--surface-h", "0px");
    };
  }, [bottom]);
}

// Test builds only (VITE_TEST_HOOK): says so, loudly, when two sheets are on screen on a phone.
function useTestAssertion(sheets, phone) {
  useEffect(() => {
    if (!import.meta.env.VITE_TEST_HOOK || !phone) return undefined;
    const t = setTimeout(() => {
      const live = [...document.querySelectorAll("[data-surface-sheet]")].filter((e) => e.getAttribute("data-state") !== "closed" && !e.closest("[inert]") && e.getClientRects().length > 0);
      window.__surfaces = { sheets: live.map((e) => e.getAttribute("data-surface-sheet")), violations: (window.__surfaces?.violations || 0) + (live.length > 1 ? 1 : 0) };
      if (live.length > 1) console.error(`[surfaces] ${live.length} sheets mounted at once: ${window.__surfaces.sheets.join(", ")}`);
    }, 450); // after an exit animation
    return () => clearTimeout(t);
  }, [sheets, phone]);
}

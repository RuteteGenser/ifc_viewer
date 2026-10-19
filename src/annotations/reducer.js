// Pure editing state for the annotations of one snapshot: items + undo/redo history.
import { LIMITS } from "../cases/schema";

export const initialState = (items = []) => ({ items, past: [], future: [] });

const HISTORY = 100;
const push = (s, items) => ({ items, past: [...s.past, s.items].slice(-HISTORY), future: [] });

export function annotationsReducer(s, a) {
  switch (a.type) {
    case "reset": return initialState(a.items || []);
    case "add":
      if (s.items.length >= LIMITS.annotationsPerSnapshot) return s;
      return push(s, [...s.items, a.annotation]);
    case "update":
      if (!s.items.some((x) => x.id === a.id)) return s;
      return push(s, s.items.map((x) => (x.id === a.id ? { ...x, ...a.patch } : x)));
    case "remove":
      if (!s.items.some((x) => x.id === a.id)) return s;
      return push(s, s.items.filter((x) => x.id !== a.id));
    case "undo":
      if (!s.past.length) return s;
      return { items: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.items, ...s.future] };
    case "redo":
      if (!s.future.length) return s;
      return { items: s.future[0], past: [...s.past, s.items], future: s.future.slice(1) };
    default: return s;
  }
}

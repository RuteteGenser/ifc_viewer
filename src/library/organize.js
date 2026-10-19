// Client-side sorting, filtering and search for the library list. Pure functions,
// no React, so they work the same with the legacy and the new backend.
import { disciplineOf } from "../ifc/modelLabel";

export const SORT_KEYS = [
  { key: "name", label: "Name" },
  { key: "added", label: "Date added" },
  { key: "opened", label: "Last opened" },
  { key: "size", label: "Size" },
  { key: "format", label: "Format" },
];
export const DEFAULT_DIR = { name: "asc", added: "desc", opened: "desc", size: "desc", format: "asc" };
export const DEFAULTS = { query: "", sort: "added", dir: "desc", formats: [], disciplines: [], openNow: false };

const DIR_WORDS = {
  name: ["A to Z", "Z to A"],
  format: ["A to Z", "Z to A"],
  added: ["Oldest first", "Newest first"],
  opened: ["Oldest first", "Newest first"],
  size: ["Smallest first", "Largest first"],
};
export const dirLabel = (key, dir) => (DIR_WORDS[key] || DIR_WORDS.name)[dir === "desc" ? 1 : 0];

// Lower case, accents removed, and the Norwegian letters folded to plain ones.
export function fold(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export const formatOf = (item) => String(item?.schema ?? "").trim().toUpperCase();
export const disciplineCodeOf = (item) => disciplineOf(item?.name)?.code ?? "";

const time = (v) => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};
const number = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" && v !== undefined ? Number(v) : null);
const collator = new Intl.Collator("nb", { numeric: true, sensitivity: "base" });
const compareText = (a, b) => collator.compare(a, b);

const VALUE = {
  name: (i) => String(i?.name ?? "") || null,
  added: (i) => time(i?.uploadedAt),
  opened: (i) => time(i?.lastOpenedAt),
  size: (i) => number(i?.size),
  format: (i) => formatOf(i) || null,
};

// Stable. A missing value always goes last, in both directions.
export function sortModels(items, key = "added", dir) {
  const get = VALUE[key] || VALUE.name;
  const sign = (dir || DEFAULT_DIR[key] || "asc") === "desc" ? -1 : 1;
  return items
    .map((item, index) => ({ item, index, v: get(item) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) {
        if (a.v === b.v) return a.index - b.index;
        return a.v === null ? 1 : -1;
      }
      const c = typeof a.v === "string" ? compareText(a.v, b.v) : a.v - b.v;
      return c ? c * sign : a.index - b.index;
    })
    .map((x) => x.item);
}

export function matchesQuery(item, query) {
  const q = fold(query).trim();
  if (!q) return true;
  const hay = fold([item?.name, item?.note, item?.tags].filter(Boolean).join(" "));
  return q.split(/\s+/).every((word) => hay.includes(word));
}

// formats and disciplines: any of the chosen (empty = no filter); the groups combine with AND.
export function filterModels(items, state = DEFAULTS, loadedNames = new Set()) {
  const formats = state.formats || [];
  const disciplines = state.disciplines || [];
  return items.filter(
    (i) =>
      matchesQuery(i, state.query) &&
      (!formats.length || formats.includes(formatOf(i))) &&
      (!disciplines.length || disciplines.includes(disciplineCodeOf(i))) &&
      (!state.openNow || loadedNames.has(i?.name)),
  );
}

// The chips that make sense for these models: only values that are present.
export function optionsFor(items) {
  const order = ["IFC2X3", "IFC4", "IFC4X3"];
  const formats = [...new Set(items.map(formatOf).filter(Boolean))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || compareText(a, b));
  const present = new Set(items.map(disciplineCodeOf).filter(Boolean));
  return { formats, disciplines: ["ARC", "MEP", "STR"].filter((d) => present.has(d)) };
}

// Drop remembered chips that no model has, so a stale choice can't hide everything.
export function pruneState(state, options) {
  return {
    ...state,
    formats: (state.formats || []).filter((f) => options.formats.includes(f)),
    disciplines: (state.disciplines || []).filter((d) => options.disciplines.includes(d)),
  };
}

export const isFiltering = (s) => !!(fold(s.query).trim() || s.formats?.length || s.disciplines?.length || s.openNow);

// own: the user's models. samples: records from the Samples group (only the search applies to them).
export function applyOrganize({ own, samples = [], state = DEFAULTS, loadedNames = new Set() }) {
  const options = optionsFor(own);
  const s = pruneState(state, options);
  const shownOwn = sortModels(filterModels(own, s, loadedNames), s.sort, s.dir);
  const shownSamples = samples.filter((i) => matchesQuery(i, s.query));
  const builtIn = matchesQuery({ name: "Sample building", note: "Built in" }, s.query);
  return { own: shownOwn, samples: shownSamples, builtIn, total: own.length, count: shownOwn.length, options, state: s, filtering: isFiltering(s) };
}

const KEY = "argus.library.organize";
export function loadState(storage) {
  try {
    const raw = JSON.parse((storage ?? globalThis.localStorage).getItem(KEY));
    if (!raw || typeof raw !== "object") return { ...DEFAULTS };
    const sort = SORT_KEYS.some((k) => k.key === raw.sort) ? raw.sort : DEFAULTS.sort;
    const dir = raw.dir === "asc" || raw.dir === "desc" ? raw.dir : DEFAULT_DIR[sort];
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
    return { ...DEFAULTS, sort, dir, formats: list(raw.formats), disciplines: list(raw.disciplines), openNow: raw.openNow === true };
  } catch {
    return { ...DEFAULTS };
  }
}
export function saveState(state, storage) {
  try {
    const { sort, dir, formats, disciplines, openNow } = state;
    (storage ?? globalThis.localStorage).setItem(KEY, JSON.stringify({ sort, dir, formats, disciplines, openNow }));
  } catch {
    /* private mode or blocked storage: the choice just isn't remembered */
  }
}

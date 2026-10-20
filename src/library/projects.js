// Projects are the top level folders of the library. Pure functions, no React.
// Models that sit in no folder (saved before projects existed) form one virtual "Unsorted" project, always last.
import { validName } from "./folders";

export const UNSORTED_ID = "__unsorted";
export const DUMMY_ID = "__dummy";
export const DUMMY_NAME = "Dummy project";
export const UNSORTED_NAME = "Unsorted";

const collator = new Intl.Collator("nb", { numeric: true, sensitivity: "base" });
const time = (v) => {
  const t = new Date(v ?? 0).getTime();
  return Number.isFinite(t) ? t : 0;
};

// The top level folder a folder sits under (itself if it is one). Unknown id: null.
export function rootOf(folders, id) {
  const map = new Map(folders.map((f) => [f.id, f]));
  const seen = new Set();
  let f = map.get(id);
  while (f && f.parentId && map.has(f.parentId) && !seen.has(f.id)) {
    seen.add(f.id);
    f = map.get(f.parentId);
  }
  return f ? f.id : null;
}

// [{ id, name, count, updatedAt, virtual }]: real projects newest first (ties by name), then Unsorted when it has models.
// A project counts every model under it, in sub folders too. `items` are the user's own models (samples excluded).
export function listProjects(folders, items) {
  const roots = new Map();
  for (const f of folders || []) if (!f.parentId) roots.set(f.id, { id: f.id, name: f.name, count: 0, updatedAt: time(f.updatedAt ?? f.createdAt), virtual: false });
  const rootFor = new Map();
  for (const f of folders || []) rootFor.set(f.id, rootOf(folders, f.id));
  let loose = 0;
  let looseAt = 0;
  for (const m of items || []) {
    const at = time(m.updatedAt ?? m.uploadedAt);
    const root = m.folderId ? roots.get(rootFor.get(m.folderId)) : null;
    if (root) {
      root.count += 1;
      root.updatedAt = Math.max(root.updatedAt, at);
    } else {
      loose += 1;
      looseAt = Math.max(looseAt, at);
    }
  }
  const real = [...roots.values()].sort((a, b) => b.updatedAt - a.updatedAt || collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));
  return loose ? [...real, { id: UNSORTED_ID, name: UNSORTED_NAME, count: loose, updatedAt: looseAt, virtual: true }] : real;
}

// The models a project page shows: everything under a real project, or the loose models for Unsorted.
export function projectModels(folders, items, projectId) {
  const own = (items || []).filter((m) => m.owner !== "samples");
  if (projectId === UNSORTED_ID) return own.filter((m) => !m.folderId || !(folders || []).some((f) => f.id === m.folderId));
  return own.filter((m) => m.folderId && rootOf(folders || [], m.folderId) === projectId);
}

// "" when the name is fine as a new project, else a sentence. Names are unique among projects, ignoring case.
export function projectNameError(raw, projects, ignoreId = null) {
  const bad = validName(raw);
  if (bad) return bad;
  const key = String(raw).trim().toLocaleLowerCase("nb");
  const reserved = [UNSORTED_NAME, DUMMY_NAME].some((n) => n.toLocaleLowerCase("nb") === key);
  if (reserved || (projects || []).some((p) => !p.virtual && p.id !== ignoreId && p.name.toLocaleLowerCase("nb") === key)) return "A project with that name already exists.";
  return "";
}

export const isRealProject = (id) => !!id && id !== UNSORTED_ID && id !== DUMMY_ID;

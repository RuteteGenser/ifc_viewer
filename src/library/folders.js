// Folder logic for the library: tree, paths, move rules, messages. Pure functions, no React.
// A folder is { id, name, parentId|null, sortOrder, modelCount }. The list is flat.
export const MAX_DEPTH = 3;
export const NEAR_LIMIT = 3; // "x of N folders" shows when this few are left

const collator = new Intl.Collator("nb", { numeric: true, sensitivity: "base" });
const order = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1);
const byId = (folders) => new Map(folders.map((f) => [f.id, f]));

export const childrenOf = (folders, parentId = null) => folders.filter((f) => (f.parentId ?? null) === (parentId ?? null)).sort(order);

// Root first: [A, B, C] for folder C inside B inside A. Unknown id: [].
export function pathOf(folders, id) {
  const map = byId(folders);
  const out = [];
  const seen = new Set();
  for (let f = map.get(id); f && !seen.has(f.id); f = map.get(f.parentId)) {
    seen.add(f.id);
    out.unshift(f);
  }
  return out;
}
export const pathLabel = (folders, id) => pathOf(folders, id).map((f) => f.name).join(" / ");

// Levels from the top: a top level folder is 1, null (the top) is 0.
export const depthOf = (folders, id) => (id ? pathOf(folders, id).length : 0);

// Levels in the subtree under a folder, itself included: a folder without children is 1.
export function heightOf(folders, id) {
  const kids = folders.filter((f) => f.parentId === id);
  return 1 + Math.max(0, ...kids.map((k) => heightOf(folders, k.id)));
}

export const isDescendant = (folders, id, maybeAncestorId) => pathOf(folders, id).slice(0, -1).some((f) => f.id === maybeAncestorId);

export const canCreateIn = (folders, parentId) => depthOf(folders, parentId) + 1 <= MAX_DEPTH;

// { ok:true } or { ok:false, reason: "same" | "self" | "cycle" | "too_deep" } for moving folder `id` into `targetId` (null = top).
export function canMoveFolder(folders, id, targetId) {
  const f = folders.find((x) => x.id === id);
  if (!f) return { ok: false, reason: "missing" };
  if (targetId === id) return { ok: false, reason: "self" };
  if (targetId && isDescendant(folders, targetId, id)) return { ok: false, reason: "cycle" };
  if ((f.parentId ?? null) === (targetId ?? null)) return { ok: false, reason: "same" };
  if (depthOf(folders, targetId) + heightOf(folders, id) > MAX_DEPTH) return { ok: false, reason: "too_deep" };
  return { ok: true };
}

// The folder tree flattened for a picker: [{ folder|null, depth, disabled, reason, current }], "Top level" first.
// `moving` is a folder id being moved (its subtree and illegal targets are disabled), `current` the place it is now.
export function pickerRows(folders, { moving = null, current = null } = {}) {
  const rows = [];
  const check = (targetId) => (moving ? canMoveFolder(folders, moving, targetId) : { ok: true });
  const push = (folder, depth) => {
    const id = folder ? folder.id : null;
    const verdict = check(id);
    rows.push({ folder, depth, current: (current ?? null) === id, disabled: !verdict.ok && verdict.reason !== "same", reason: verdict.reason });
    for (const kid of childrenOf(folders, id)) push(kid, depth + 1);
  };
  push(null, 0);
  return rows;
}

const MESSAGES = {
  name_taken: "A folder with that name already exists here.",
  folder_too_deep: `Folders can only go ${MAX_DEPTH} levels deep.`,
  folder_cycle: "A folder cannot go inside itself.",
  upgrade_required: "Your plan is read-only right now, so folders cannot be changed.",
};
// Plain words for a failed folder call (a LibraryError with status and body.code).
export function folderMessage(err, limit) {
  const code = err?.body?.code;
  if (code === "quota_folders") return `You have reached the folder limit${limit ? ` (${limit})` : ""}. Delete a folder to make room.`;
  if (MESSAGES[code]) return MESSAGES[code];
  if (err?.status === 404) return "That folder or model is no longer there. Refresh and try again.";
  if (err?.status === 429) return "Too many changes at once. Wait a moment and try again.";
  if (err?.status === 400 && code === "invalid_format") return "Use 1 to 80 characters, without slashes.";
  return err?.message || "Could not do that. Try again.";
}

export const validName = (raw) => {
  const name = String(raw ?? "").trim();
  if (!name) return "Enter a name.";
  if (name.length > 80) return "Use 80 characters or fewer.";
  if (/[\\/\u0000-\u001f]/.test(name)) return "A name cannot contain slashes.";
  return "";
};

export const countText = (n) => `${n} ${n === 1 ? "model" : "models"}`;
// "3 of 20 folders" when close to the limit, else "".
export const limitHint = (count, limit) => (limit > 0 && limit - count <= NEAR_LIMIT ? `${count} of ${limit} folders` : "");
export const atLimit = (count, limit) => limit > 0 && count >= limit;

// Which models show: the current folder, or everything while a search is active.
export function scopeModels(own, { folderId = null, searching = false, enabled = true } = {}) {
  if (!enabled || searching) return own;
  return own.filter((m) => (m.folderId ?? null) === (folderId ?? null));
}

const KEY = "ifcViewer.libraryFolder";
export function loadFolder() {
  try {
    return sessionStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
}
export function saveFolder(id) {
  try {
    if (id) sessionStorage.setItem(KEY, id);
    else sessionStorage.removeItem(KEY);
  } catch {
    // private mode: the folder is just not remembered
  }
}

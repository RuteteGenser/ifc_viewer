// Generic, GUID-keyed, localStorage-backed tag store. `type` is a
// discriminator so a hypothetical future free-text "note" tag type could
// reuse this same store/schema later — only "dimension" (pinned
// dimension tags) is written/read today.
//
// Stored shape: { "<GUID>": { type: "dimension", createdAt: <ms> }, ... }
// Only the *fact* of a tag existing is persisted, never any snapshotted
// data (e.g. dimension numbers) — a restored tag always re-derives its
// content live from the (re-)loaded model, never stale.
const STORAGE_KEY = "ifcViewer.tags.v1";

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    console.error("Failed to persist tags", err);
  }
}

export function getTag(guid) {
  return readAll()[guid] ?? null;
}

export function setTag(guid, type) {
  const all = readAll();
  all[guid] = { type, createdAt: Date.now() };
  writeAll(all);
}

export function removeTag(guid) {
  const all = readAll();
  if (!(guid in all)) return;
  delete all[guid];
  writeAll(all);
}

export function listTagsOfType(type) {
  const all = readAll();
  return Object.entries(all)
    .filter(([, v]) => v?.type === type)
    .map(([guid, v]) => ({ guid, ...v }));
}

export function clearTagsOfType(type) {
  const all = readAll();
  let changed = false;
  for (const guid of Object.keys(all)) {
    if (all[guid]?.type === type) {
      delete all[guid];
      changed = true;
    }
  }
  if (changed) writeAll(all);
}

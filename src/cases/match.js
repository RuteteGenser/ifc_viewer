// Decides how well a loaded model fits the model a case was made on. Pure.
export const GUID_THRESHOLD = 0.8;

const lc = (s) => (typeof s === "string" ? s.trim().toLowerCase() : "");

// caseModel: case.model. loaded: { name, sha256, size, projectGuid } (any may be null).
// annotationGuids: GUIDs referenced by the case (anchors, targets, hidden/isolated). loadedGuidSet: Set|Array of the loaded model's GlobalIds.
// Levels: exact (same sha256) > name (same file name and size, unless both hashes are known and differ)
// > guid (same IfcProject GUID, or >= 80 percent of the case GUIDs exist in the model) > none.
export function matchModel(caseModel, loaded, annotationGuids = [], loadedGuidSet = null) {
  const cm = caseModel || {}, lm = loaded || {};
  const shaA = lc(cm.sha256), shaB = lc(lm.sha256);
  if (shaA && shaB && shaA === shaB) return { level: "exact", reason: "Same file (checksum matches)." };

  const hashesDiffer = !!(shaA && shaB && shaA !== shaB);
  if (!hashesDiffer && lc(cm.name) && lc(cm.name) === lc(lm.name) && cm.size != null && cm.size === lm.size) {
    return { level: "name", reason: "Same file name and size." };
  }

  if (cm.projectGuid && lm.projectGuid && cm.projectGuid === lm.projectGuid) {
    return { level: "guid", reason: "Same IFC project (project GUID matches)." };
  }

  const guids = [...new Set((annotationGuids || []).filter((g) => typeof g === "string" && g))];
  if (guids.length && loadedGuidSet) {
    const have = loadedGuidSet instanceof Set ? loadedGuidSet : new Set(loadedGuidSet);
    const missing = guids.filter((g) => !have.has(g));
    const found = guids.length - missing.length;
    const ratio = found / guids.length;
    const pct = Math.floor(ratio * 100);
    if (ratio >= GUID_THRESHOLD) {
      return { level: "guid", reason: `${found} of ${guids.length} referenced elements found (${pct} percent).`, found, total: guids.length, missing };
    }
    return { level: "none", reason: `Only ${found} of ${guids.length} referenced elements found (${pct} percent). This looks like a different model.`, found, total: guids.length, missing };
  }
  return { level: "none", reason: hashesDiffer ? "Different file (checksum differs)." : "Nothing links this case to the loaded model." };
}

// All element GUIDs a case refers to (for matchModel).
export function caseGuids(c) {
  const out = new Set();
  for (const s of c?.snapshots || []) {
    for (const a of s.annotations || []) { if (a.anchor?.guid) out.add(a.anchor.guid); if (a.target?.guid) out.add(a.target.guid); }
    for (const g of s.view?.hiddenGuids || []) out.add(g);
    for (const g of s.view?.isolatedGuids || []) out.add(g);
  }
  return [...out];
}

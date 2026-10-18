// Reads the building storeys (levels) of the loaded models, with every
// element that sits on each one, so the viewer can isolate a floor through
// its ordinary isolate logic.

import { readProjectUnits } from "./projectUnits";

// Storey elevations are IfcBuildingStorey.Elevation exactly as written in the
// IFC (the importer is told not to replace it with a placement-derived value,
// see ifcImportWorker.js), a plain number in the file's length unit. They are
// converted to metres with the project's declared length unit and are
// relative to the IFC project origin: a storey at 8060 mm in a file whose
// site sits at 131.2 m reads +8.06 m, not +139.26 m.

function collectLocalIds(node, out) {
  for (const child of node.children ?? []) {
    if (child.localId != null) out.push(child.localId);
    collectLocalIds(child, out);
  }
}

// The spatial tree alternates two kinds of node: a category node (category
// set, no localId) whose children are the instances of that category (localId
// set), each with further category nodes beneath it.
function findStoreys(node, out) {
  if (node.category && /^IFCBUILDINGSTOREY$/i.test(node.category)) {
    for (const instance of node.children ?? []) if (instance.localId != null) out.push(instance);
  }
  for (const child of node.children ?? []) findStoreys(child, out);
}

// -> [{ id, name, elevation (metres), keys: string[] }] sorted lowest first.
// Storeys with the same name and elevation in different models are merged.
export async function readLevels(entries) {
  const merged = new Map();
  for (const [modelId, { model, sourceBytes }] of entries) {
    let tree;
    try {
      tree = await model.getSpatialStructure();
    } catch (err) {
      console.error("Could not read the spatial structure", err);
      continue;
    }
    const storeys = [];
    findStoreys(tree, storeys);
    if (storeys.length === 0) continue;
    const unit = readProjectUnits(sourceBytes).factorToMetre;
    let data = [];
    try {
      data = await model.getItemsData(
        storeys.map((s) => s.localId),
        { attributesDefault: true, relations: {} },
      );
    } catch (err) {
      console.error("Could not read storey names", err);
    }
    storeys.forEach((storey, i) => {
      const name = String(data[i]?.Name?.value ?? data[i]?.LongName?.value ?? "").trim() || `Level ${i + 1}`;
      const raw = Number(data[i]?.Elevation?.value);
      const elevation = Number.isFinite(raw) ? raw * unit : null;
      const ids = [];
      collectLocalIds(storey, ids);
      const mergeKey = `${name}|${elevation === null ? "?" : elevation.toFixed(2)}`;
      const level = merged.get(mergeKey) ?? { id: mergeKey, name, elevation, keys: [] };
      for (const id of ids) level.keys.push(`${modelId}::${id}`);
      merged.set(mergeKey, level);
    });
  }
  return [...merged.values()].sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0));
}

export function formatElevation(metres) {
  if (metres === null || metres === undefined) return "";
  const sign = metres > 0.005 ? "+" : metres < -0.005 ? "-" : "";
  return `${sign}${Math.abs(metres).toFixed(2)} m`;
}

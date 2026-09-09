import * as WEBIFC from "web-ifc";

// @thatopen/fragments' getItemsData (the app's normal property-fetch
// path, see selectElementFrom in useIfcViewer.js) structurally excludes
// geometry/shape entities (IfcProductDefinitionShape, IfcShapeRepresentation,
// IfcExtrudedAreaSolid, profile defs) and has no relation path to
// IfcUnitAssignment — there is no config that makes these reachable
// through it. This module opens a second, independent raw web-ifc model
// (from the original file bytes already retained per loaded model, see
// modelsRef in useIfcViewer.js) to walk the raw STEP graph for exactly
// this data instead.

// The six element types this module knows how to extract extra data
// for, keyed by category name as fragments' _category field reports it
// (see formatElementData in useIfcViewer.js).
const NAME_TO_TYPE = {
  IFCFLOWSEGMENT: WEBIFC.IFCFLOWSEGMENT,
  IFCFLOWFITTING: WEBIFC.IFCFLOWFITTING,
  IFCFLOWTERMINAL: WEBIFC.IFCFLOWTERMINAL,
  IFCFLOWCONTROLLER: WEBIFC.IFCFLOWCONTROLLER,
  IFCFLOWTREATMENTDEVICE: WEBIFC.IFCFLOWTREATMENTDEVICE,
  IFCBUILDINGELEMENTPROXY: WEBIFC.IFCBUILDINGELEMENTPROXY,
};

// Checked before bothering to open/query the raw model at all, so
// ordinary building elements (walls, slabs, ...) pay no cost.
export function isEligibleCategoryName(category) {
  return !!category && NAME_TO_TYPE[category.toUpperCase()] !== undefined;
}

// Opens an independent web-ifc model from raw bytes, using the same wasm
// path already configured for the app's main IfcLoader (setupComponents.js).
export async function openRawIfcModel(sourceBytes) {
  const api = new WEBIFC.IfcAPI();
  api.SetWasmPath(`${import.meta.env.BASE_URL}wasm/`, true);
  await api.Init();
  const modelID = api.OpenModel(sourceBytes);
  return { api, modelID };
}

export function closeRawIfcModel(handle) {
  if (!handle) return;
  try {
    handle.api.CloseModel(handle.modelID);
  } catch {
    // Already closed or never fully opened — nothing more to clean up.
  }
}

function vectorToArray(vector) {
  const out = [];
  for (let i = 0; i < vector.size(); i++) out.push(vector.get(i));
  return out;
}

// Ported from @thatopen/fragments' FragmentsIfcUtils.getUnitsFactor,
// adapted to return a millimeters-per-unit factor directly (this app
// displays lengths in mm — see formatMm in useIfcViewer.js) instead of
// meters-per-unit.
export function getLengthUnitsFactorToMm(api, modelID) {
  const assignmentIds = api.GetLineIDsWithType(modelID, WEBIFC.IFCUNITASSIGNMENT);
  let metersPerUnit = 1;
  for (const assignmentId of vectorToArray(assignmentIds)) {
    const assignment = api.GetLine(modelID, assignmentId);
    const units = Array.isArray(assignment.Units) ? assignment.Units : [];
    for (const unitHandle of units) {
      const unit = api.GetLine(modelID, unitHandle.value);
      if (unit.UnitType?.value !== "LENGTHUNIT") continue;
      let base = 1;
      if (unit.Name?.value === "FOOT") base = 0.3048;
      let prefixFactor = 1;
      if (unit.Prefix?.value === "MILLI") prefixFactor = 1e-3;
      else if (unit.Prefix?.value === "CENTI") prefixFactor = 1e-2;
      else if (unit.Prefix?.value === "DECI") prefixFactor = 1e-1;
      metersPerUnit = base * prefixFactor;
    }
  }
  return metersPerUnit * 1000;
}

// Finds the raw expressID of the element matching `guid`, restricted to
// `ifcType` (already known from the fragments-side selection, so this
// only has to scan the — typically small, dozens to low hundreds —
// list of entities of that one type, not the whole file). Matching by
// GlobalId rather than assuming FragmentsModel's localId equals the
// original IFC expressID, which is not a documented/guaranteed mapping.
export function findExpressIdByGuid(api, modelID, ifcType, guid) {
  const ids = vectorToArray(api.GetLineIDsWithType(modelID, ifcType));
  for (const id of ids) {
    const line = api.GetLine(modelID, id);
    if (line.GlobalId?.value === guid) return id;
  }
  return null;
}

// Walks Representation -> IfcShapeRepresentation -> Items looking for an
// IfcExtrudedAreaSolid, then reads its SweptArea profile and Depth.
// Handle-by-handle (no `flatten`), matching how @thatopen/fragments'
// own code walks web-ifc lines. Defensive throughout: any missing or
// unexpected shape returns nulls rather than throwing, since not every
// element has usable geometry (per spec, some IfcBuildingElementProxy
// instances carry none at all).
function extractShapeAndLength(api, modelID, expressID, mmPerUnit) {
  const empty = { shape: null, diameter: null, width: null, height: null, length: null };
  const element = api.GetLine(modelID, expressID);
  if (!element.Representation) return empty;

  const productShape = api.GetLine(modelID, element.Representation.value);
  const representations = Array.isArray(productShape.Representations) ? productShape.Representations : [];
  return findExtrusionInRepresentations(api, modelID, representations, mmPerUnit, 0) ?? empty;
}

// Many real-world files (confirmed against the uploaded RIR file) give
// a pipe/duct instance a 'MappedRepresentation' whose one Item is an
// IfcMappedItem pointing at a *shared* IfcRepresentationMap — a single
// base geometry definition reused by every instance of that type,
// rather than each instance repeating its own IfcExtrudedAreaSolid.
// Recurses into the mapped representation the same way, up to a small
// fixed depth (real files nest at most one level deep; this just
// guards against a pathological cycle).
function findExtrusionInRepresentations(api, modelID, repHandles, mmPerUnit, depth) {
  if (depth > 4) return null;
  for (const repHandle of repHandles) {
    const rep = api.GetLine(modelID, repHandle.value);
    const items = Array.isArray(rep.Items) ? rep.Items : [];
    for (const itemHandle of items) {
      const item = api.GetLine(modelID, itemHandle.value);

      if (item.type === WEBIFC.IFCMAPPEDITEM) {
        if (!item.MappingSource) continue;
        const map = api.GetLine(modelID, item.MappingSource.value);
        if (!map.MappedRepresentation) continue;
        const found = findExtrusionInRepresentations(api, modelID, [map.MappedRepresentation], mmPerUnit, depth + 1);
        if (found) return found;
        continue;
      }

      if (item.type !== WEBIFC.IFCEXTRUDEDAREASOLID) continue;
      if (!item.SweptArea || typeof item.Depth?.value !== "number") continue;

      const profile = api.GetLine(modelID, item.SweptArea.value);
      const length = item.Depth.value * mmPerUnit;

      if (profile.type === WEBIFC.IFCCIRCLEHOLLOWPROFILEDEF || profile.type === WEBIFC.IFCCIRCLEPROFILEDEF) {
        if (typeof profile.Radius?.value !== "number") continue;
        return { shape: "circular", diameter: profile.Radius.value * 2 * mmPerUnit, width: null, height: null, length };
      }
      if (profile.type === WEBIFC.IFCRECTANGLEHOLLOWPROFILEDEF || profile.type === WEBIFC.IFCRECTANGLEPROFILEDEF) {
        if (typeof profile.XDim?.value !== "number" || typeof profile.YDim?.value !== "number") continue;
        return {
          shape: "rectangular",
          diameter: null,
          width: profile.XDim.value * mmPerUnit,
          height: profile.YDim.value * mmPerUnit,
          length,
        };
      }
      // A recognized extrusion but an unhandled profile type — length is
      // still meaningful even without a shape/diameter breakdown.
      return { shape: null, diameter: null, width: null, height: null, length };
    }
  }
  return null;
}

// Scans every IfcRelAssignsToGroup in the file for ones that include
// `expressID` among their RelatedObjects, collecting the relating
// group's own Name — an element can belong to more than one system.
function extractSystems(api, modelID, expressID) {
  const relIds = vectorToArray(api.GetLineIDsWithType(modelID, WEBIFC.IFCRELASSIGNSTOGROUP));
  const systems = [];
  for (const relId of relIds) {
    const rel = api.GetLine(modelID, relId);
    const related = Array.isArray(rel.RelatedObjects) ? rel.RelatedObjects : [];
    if (!related.some((h) => h.value === expressID)) continue;
    if (!rel.RelatingGroup) continue;
    const group = api.GetLine(modelID, rel.RelatingGroup.value);
    // IfcRelAssignsToGroup's RelatingGroup can be any IfcGroup subtype
    // (e.g. IfcZone) — only IfcSystem counts as "a system" per spec.
    if (group.type !== WEBIFC.IFCSYSTEM) continue;
    if (group.Name?.value) systems.push(group.Name.value);
  }
  return systems;
}

// Resolves an element's material name via IfcRelAssociatesMaterial.
// RelatingMaterial can point directly at an IfcMaterial, or (as seen in
// real RIR pipe data) at an IfcMaterialLayerSetUsage, which needs two
// more hops: ForLayerSet -> MaterialLayers[0] -> Material -> Name.
function extractMaterial(api, modelID, expressID) {
  const relIds = vectorToArray(api.GetLineIDsWithType(modelID, WEBIFC.IFCRELASSOCIATESMATERIAL));
  for (const relId of relIds) {
    const rel = api.GetLine(modelID, relId);
    const related = Array.isArray(rel.RelatedObjects) ? rel.RelatedObjects : [];
    if (!related.some((h) => h.value === expressID)) continue;
    if (!rel.RelatingMaterial) return null;

    const material = api.GetLine(modelID, rel.RelatingMaterial.value);
    if (material.type === WEBIFC.IFCMATERIAL) return material.Name?.value ?? null;

    if (material.type === WEBIFC.IFCMATERIALLAYERSETUSAGE) {
      if (!material.ForLayerSet) return null;
      const layerSet = api.GetLine(modelID, material.ForLayerSet.value);
      return firstLayerMaterialName(api, modelID, layerSet);
    }
    if (material.type === WEBIFC.IFCMATERIALLAYERSET) {
      return firstLayerMaterialName(api, modelID, material);
    }
    return null;
  }
  return null;
}

function firstLayerMaterialName(api, modelID, layerSet) {
  const layers = Array.isArray(layerSet.MaterialLayers) ? layerSet.MaterialLayers : [];
  const firstLayerHandle = layers[0];
  if (!firstLayerHandle) return null;
  const layer = api.GetLine(modelID, firstLayerHandle.value);
  if (!layer.Material) return null;
  const material = api.GetLine(modelID, layer.Material.value);
  return material.Name?.value ?? null;
}

// Orchestrates the above into the shape the info panel renders. `guid`
// and `category` come from the already-fetched fragments-side element
// data (selectElementFrom) — not re-derived here.
export function extractElementIfcData(api, modelID, category, guid) {
  const ifcType = NAME_TO_TYPE[category?.toUpperCase()];
  if (ifcType === undefined) return null;
  const expressID = findExpressIdByGuid(api, modelID, ifcType, guid);
  if (expressID === null) return null;

  const mmPerUnit = getLengthUnitsFactorToMm(api, modelID);
  const { shape, diameter, width, height, length } = extractShapeAndLength(api, modelID, expressID, mmPerUnit);
  const systems = extractSystems(api, modelID, expressID);
  const material = extractMaterial(api, modelID, expressID);

  return { shape, diameter, width, height, length, systems, material };
}

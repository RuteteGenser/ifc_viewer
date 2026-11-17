import * as WEBIFC from "web-ifc";

// Builds 2D floor plans (horizontal section cuts) straight from an open
// raw web-ifc model — no containment lookup needed: each storey is cut at
// `elevation + cutHeight`, and every triangle crossing that plane becomes a
// line segment. Elements spanning several storeys (tall walls, stairs)
// therefore show up on each floor they cross, like a real section plan.
//
// Coordinates are IFC model coordinates in meters (x/y of the plan,
// z = up). Callers pass an already-open { api, modelID } so this module is
// usable both in the browser (rawIfcQuery.openRawIfcModel) and in node.

export const MAX_CUT_HEIGHT = 3.6;
export const DEFAULT_CUT_HEIGHT = 1.2;

const SKIP_TYPES = new Set([WEBIFC.IFCSPACE, WEBIFC.IFCOPENINGELEMENT, WEBIFC.IFCANNOTATION, WEBIFC.IFCGRID].filter((t) => t !== undefined));
const WALL_TYPES = new Set(
  [WEBIFC.IFCWALL, WEBIFC.IFCWALLSTANDARDCASE, WEBIFC.IFCCURTAINWALL, WEBIFC.IFCCOLUMN, WEBIFC.IFCMEMBER, WEBIFC.IFCBEAM, WEBIFC.IFCPLATE].filter((t) => t !== undefined),
);
const MEP_TYPES = new Set(
  [
    WEBIFC.IFCFLOWSEGMENT, WEBIFC.IFCFLOWFITTING, WEBIFC.IFCFLOWTERMINAL, WEBIFC.IFCFLOWCONTROLLER,
    WEBIFC.IFCFLOWTREATMENTDEVICE, WEBIFC.IFCFLOWMOVINGDEVICE, WEBIFC.IFCFLOWSTORAGEDEVICE,
    WEBIFC.IFCENERGYCONVERSIONDEVICE, WEBIFC.IFCDISTRIBUTIONELEMENT,
  ].filter((t) => t !== undefined),
);

// Segment "kinds", index = position in the arrays returned by cutStorey.
export const KINDS = ["wall", "door", "window", "mep", "other"];
const KIND_INDEX = Object.fromEntries(KINDS.map((k, i) => [k, i]));

function kindOf(type) {
  if (WALL_TYPES.has(type)) return KIND_INDEX.wall;
  if (type === WEBIFC.IFCDOOR) return KIND_INDEX.door;
  if (type === WEBIFC.IFCWINDOW) return KIND_INDEX.window;
  if (MEP_TYPES.has(type)) return KIND_INDEX.mep;
  return KIND_INDEX.other;
}

function vectorToArray(vector) {
  const out = [];
  for (let i = 0; i < vector.size(); i++) out.push(vector.get(i));
  return out;
}

function lengthUnitToMeters(api, modelID) {
  let metersPerUnit = 1;
  for (const id of vectorToArray(api.GetLineIDsWithType(modelID, WEBIFC.IFCUNITASSIGNMENT))) {
    const assignment = api.GetLine(modelID, id);
    for (const handle of Array.isArray(assignment.Units) ? assignment.Units : []) {
      const unit = api.GetLine(modelID, handle.value);
      if (unit.UnitType?.value !== "LENGTHUNIT") continue;
      let base = unit.Name?.value === "FOOT" ? 0.3048 : 1;
      const prefix = unit.Prefix?.value;
      if (prefix === "MILLI") base *= 1e-3;
      else if (prefix === "CENTI") base *= 1e-2;
      else if (prefix === "DECI") base *= 1e-1;
      metersPerUnit = base;
    }
  }
  return metersPerUnit;
}

// Bearing (degrees, clockwise from true north) of the plan's +Y axis, from
// IfcGeometricRepresentationContext.TrueNorth when the file has one.
function readPlanNorthBearing(api, modelID) {
  for (const id of vectorToArray(api.GetLineIDsWithType(modelID, WEBIFC.IFCGEOMETRICREPRESENTATIONCONTEXT))) {
    const ctx = api.GetLine(modelID, id);
    if (!ctx.TrueNorth?.value) continue;
    const dir = api.GetLine(modelID, ctx.TrueNorth.value);
    const ratios = (dir.DirectionRatios ?? []).map((r) => r.value);
    if (ratios.length >= 2 && (ratios[0] !== 0 || ratios[1] !== 0)) {
      const beta = (Math.atan2(ratios[1], ratios[0]) * 180) / Math.PI;
      return beta - 90;
    }
  }
  return null;
}

// Reads storeys and caches, per storey, the world-space triangles that lie
// within its vertical range (so the cut height can be changed afterwards
// without touching web-ifc again).
export function extractStoreys(api, modelID) {
  const toMeters = lengthUnitToMeters(api, modelID);

  const storeys = vectorToArray(api.GetLineIDsWithType(modelID, WEBIFC.IFCBUILDINGSTOREY))
    .map((id) => {
      const line = api.GetLine(modelID, id);
      return {
        expressID: id,
        name: line.Name?.value || line.LongName?.value || `Storey ${id}`,
        elevation: (line.Elevation?.value ?? 0) * toMeters,
      };
    })
    .sort((a, b) => a.elevation - b.elevation);

  if (storeys.length === 0) return { storeys: [], planNorthBearing: null };

  for (let i = 0; i < storeys.length; i++) {
    const next = storeys[i + 1];
    storeys[i].zLow = storeys[i].elevation - 0.01;
    storeys[i].zHigh = Math.min(storeys[i].elevation + MAX_CUT_HEIGHT, next ? next.elevation - 0.01 : Infinity);
    storeys[i].triangles = []; // flat: x0,y0,z0,x1,y1,z1,x2,y2,z2,kind
  }

  api.StreamAllMeshes(modelID, (mesh) => {
    const type = api.GetLineType(modelID, mesh.expressID);
    if (SKIP_TYPES.has(type)) return;
    const kind = kindOf(type);
    const placed = mesh.geometries;
    for (let g = 0; g < placed.size(); g++) {
      const pg = placed.get(g);
      const geom = api.GetGeometry(modelID, pg.geometryExpressID);
      const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const idx = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
      const m = pg.flatTransformation; // column-major 4x4
      const nVerts = verts.length / 6;
      const w = new Float64Array(nVerts * 3);
      for (let v = 0; v < nVerts; v++) {
        const x = verts[v * 6], y = verts[v * 6 + 1], z = verts[v * 6 + 2];
        // web-ifc places geometry in a Y-up frame (X, Y=up, Z=-north).
        // Convert back to IFC's Z-up (X, Y=north, Z=up) for plan coordinates.
        const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
        w[v * 3] = wx;
        w[v * 3 + 1] = -wz;
        w[v * 3 + 2] = wy;
      }
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
        const zmin = Math.min(w[a + 2], w[b + 2], w[c + 2]);
        const zmax = Math.max(w[a + 2], w[b + 2], w[c + 2]);
        for (const s of storeys) {
          if (zmax < s.zLow || zmin > s.zHigh) continue;
          s.triangles.push(w[a], w[a + 1], w[a + 2], w[b], w[b + 1], w[b + 2], w[c], w[c + 1], w[c + 2], kind);
        }
      }
      geom.delete?.();
    }
  });

  return {
    storeys: storeys.map((s) => ({
      name: s.name,
      elevation: s.elevation,
      height: Math.min(s.zHigh - s.elevation, MAX_CUT_HEIGHT),
      triangles: Float32Array.from(s.triangles),
    })),
    planNorthBearing: readPlanNorthBearing(api, modelID),
  };
}

function lerpPoint(out, p, q, h) {
  const t = (h - p[2]) / (q[2] - p[2]);
  out[0] = p[0] + (q[0] - p[0]) * t;
  out[1] = p[1] + (q[1] - p[1]) * t;
}

/**
 * Horizontal section of one storey at `elevation + cutHeight`.
 * Returns segments grouped per kind: Float32Array of x1,y1,x2,y2,... for
 * each entry of KINDS.
 */
export function cutStorey(storey, cutHeight) {
  const h = storey.elevation + cutHeight;
  const buckets = KINDS.map(() => []);
  const tri = storey.triangles;
  const P = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
  const hit = [[0, 0], [0, 0], [0, 0]];
  for (let i = 0; i + 9 < tri.length; i += 10) {
    for (let k = 0; k < 3; k++) {
      P[k][0] = tri[i + k * 3];
      P[k][1] = tri[i + k * 3 + 1];
      P[k][2] = tri[i + k * 3 + 2];
    }
    let n = 0;
    for (let k = 0; k < 3; k++) {
      const p = P[k], q = P[(k + 1) % 3];
      if ((p[2] < h) !== (q[2] < h) && p[2] !== q[2]) {
        lerpPoint(hit[n], p, q, h);
        n++;
      }
    }
    if (n === 2) buckets[tri[i + 9]].push(hit[0][0], hit[0][1], hit[1][0], hit[1][1]);
  }
  return buckets.map((b) => Float32Array.from(b));
}

export function segmentsBounds(segmentGroups) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const seg of segmentGroups) {
    for (let i = 0; i < seg.length; i += 2) {
      minX = Math.min(minX, seg[i]);
      maxX = Math.max(maxX, seg[i]);
      minY = Math.min(minY, seg[i + 1]);
      maxY = Math.max(maxY, seg[i + 1]);
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

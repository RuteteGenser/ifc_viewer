// The Clearance measure tool, pure part: geometry and text, no three.js and no DOM, so it is unit tested.
// Everything is in the model's own frame (modelsGroup-local), where up is +Y, like every other measurement.
// Vectors are plain [x, y, z] arrays.
import { formatLength } from "./formatLength.js";

export const DIRECTIONS = ["up", "down", "left", "right"];
export const DIRECTION_LABELS = { up: "Up", down: "Down", left: "Left", right: "Right" };
const ARROWS = { up: "↑", down: "↓", left: "←", right: "→" };
export const MODEL_UP = [0, 1, 0];
export const HIT_EPSILON = 0.005; // metres: a hit closer than this is the surface the ray starts on

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a) => {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : null;
};

export function boxCentre(min, max) {
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

// The box of an element's geometry: `chunks` are { positions: xyz triples, transform?: { elements: 16 numbers,
// column-major } } as getItemsGeometry returns them; `toLocal` is an optional column-major matrix applied after
// the chunk's own. Returns { min, max } or null when there is no geometry.
export function boxFromChunks(chunks, toLocal = null) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const chunk of chunks) {
    const p = chunk?.positions;
    if (!p || p.length < 3) continue;
    const m = chunk.transform?.elements ?? null;
    for (let i = 0; i + 2 < p.length; i += 3) {
      let v = [p[i], p[i + 1], p[i + 2]];
      if (m) v = applyMatrix(m, v);
      if (toLocal) v = applyMatrix(toLocal, v);
      if (!Number.isFinite(v[0] + v[1] + v[2])) continue;
      any = true;
      for (let k = 0; k < 3; k++) {
        if (v[k] < min[k]) min[k] = v[k];
        if (v[k] > max[k]) max[k] = v[k];
      }
    }
  }
  return any ? { min, max } : null;
}

function applyMatrix(e, v) {
  return [
    e[0] * v[0] + e[4] * v[1] + e[8] * v[2] + e[12],
    e[1] * v[0] + e[5] * v[1] + e[9] * v[2] + e[13],
    e[2] * v[0] + e[6] * v[1] + e[10] * v[2] + e[14],
  ];
}

// The four directions of a clearance, from the camera at the moment of the tap. `viewDir` and `camUp` are the
// camera's forward and up vectors in the model's frame. Up/down are the model's vertical. Left/right are the two
// horizontal directions perpendicular to the view: in plan the screen's left/right, in an elevation the visual
// left/right. Looking straight down or up the view has no horizontal part, so the camera's up vector decides.
export function viewDirections(viewDir, camUp, up = MODEL_UP) {
  const flat = (v) => {
    const k = dot(v, up);
    return [v[0] - up[0] * k, v[1] - up[1] * k, v[2] - up[2] * k];
  };
  const forward = unit(flat(viewDir));
  let right = forward ? unit(cross(forward, up)) : null;
  if (!right) {
    const f = unit(viewDir);
    right = f && camUp ? unit(flat(cross(f, camUp))) : null;
  }
  if (!right) right = unit(cross([0, 0, -1], up)); // no usable camera at all: the +X side
  return { up: [...up], down: scale(up, -1), left: scale(right, -1), right };
}

// The nearest hit that is not the measured element itself, at least `epsilon` from the origin and within
// `maxRange`. `hits` carry a numeric `distance`; `isSelf(hit)` says whether a hit belongs to the measured element.
export function nearestHit(hits, { isSelf = () => false, epsilon = HIT_EPSILON, maxRange = Infinity } = {}) {
  let best = null;
  for (const hit of hits ?? []) {
    const d = hit?.distance;
    if (!Number.isFinite(d) || d <= epsilon || d > maxRange) continue;
    if (isSelf(hit)) continue;
    if (!best || d < best.distance) best = hit;
  }
  return best;
}

// Where a ray from `origin` leaves the box: the length of the dashed "open" line.
export function rayExitDistance(origin, dir, min, max) {
  let exit = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(dir[k]) < 1e-9) continue;
    const t = ((dir[k] > 0 ? max[k] : min[k]) - origin[k]) / dir[k];
    if (t < exit) exit = t;
  }
  return Number.isFinite(exit) && exit > 0 ? exit : 0;
}

export const OPEN_TEXT = "Open";

// One direction's text: an arrow and the length (mm below 1 m, m above), or "Open" when nothing was hit.
export function clearanceValueText(distance) {
  return distance == null ? OPEN_TEXT : formatLength(distance);
}
export function clearanceLabelText(direction, distance) {
  return `${ARROWS[direction]} ${clearanceValueText(distance)}`;
}

// A clearance as plain data: { id, name, modelId, localId, centre, values: {up,down,left,right} (metres or null),
// dirs: { up, ... } (unit vectors), reach: { up, ... } (metres drawn, the hit or the dashed length) }.
export function makeClearance({ id, name, modelId, localId, centre, dirs, values, reach }) {
  return { id, name: name || "Element", modelId, localId, centre: [...centre], dirs, values, reach };
}

export function serializeClearance(c) {
  return JSON.stringify({
    v: 1,
    name: c.name,
    modelId: c.modelId,
    localId: c.localId,
    centre: c.centre,
    dirs: c.dirs,
    values: c.values,
    reach: c.reach,
  });
}

// The inverse of serializeClearance (without the id, which the scene assigns); null for anything malformed.
export function deserializeClearance(text) {
  try {
    const o = typeof text === "string" ? JSON.parse(text) : text;
    if (!o || o.v !== 1) return null;
    const vec = (a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
    if (!vec(o.centre)) return null;
    for (const d of DIRECTIONS) {
      if (!vec(o.dirs?.[d])) return null;
      const val = o.values?.[d];
      if (val !== null && !Number.isFinite(val)) return null;
      if (!Number.isFinite(o.reach?.[d])) return null;
    }
    return { name: String(o.name ?? "Element"), modelId: o.modelId, localId: o.localId, centre: o.centre, dirs: o.dirs, values: o.values, reach: o.reach };
  } catch {
    return null;
  }
}

// The row the Measurements tab and the hook's list show for a clearance.
export function clearanceSummary(c) {
  return { id: c.id, kind: "clearance", name: c.name, up: c.values.up, down: c.values.down, left: c.values.left, right: c.values.right };
}

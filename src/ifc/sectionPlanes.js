import * as THREE from "three";

// Pure geometry and policy for the section planes, kept apart from the
// renderer so it can be tested without a browser.

export const PHONE_MAX_PLANES = 2;
export const SHEET_MARGIN = 1.05; // 5 percent beyond the scene's cross-section
// Plane 1 uses the accent, plane 2 a second distinct hue.
export const PLANE_COLORS = [0x3b82f6, 0xf59e0b];
export const colorCss = (hex) => `#${hex.toString(16).padStart(6, "0")}`;
// Fill opacity of the 3D sheet: lighter when idle, darker when it is the active one.
// Single plane keeps the original faint look.
export const SHEET_OPACITY = { inactive: 0.12, active: 0.22 };

/** How many planes a new one may leave standing: the oldest go first on a phone. */
export function planesToDrop(count, phone) {
  return phone ? Math.max(0, count + 1 - PHONE_MAX_PLANES) : 0;
}

/** The plane after `removedId` goes: the active one stays, else the newest left. */
export function activeAfterRemove(ids, activeId, removedId) {
  const left = ids.filter((id) => id !== removedId);
  return left.includes(activeId) ? activeId : (left[left.length - 1] ?? null);
}

/** Axis of an axis-aligned normal, else null. */
export function axisOf(normal) {
  for (const a of ["x", "y", "z"]) if (Math.abs(Math.abs(normal[a]) - 1) < 1e-3) return a;
  return null;
}
export const KIND_BY_AXIS = { y: "plan", x: "side", z: "front" };

/** In-plane unit axes for a normal: u is horizontal where the plane is not flat. */
export function planeBasis(normal) {
  const n = normal.clone().normalize();
  const u = new THREE.Vector3();
  if (Math.abs(n.y) > 0.999) u.set(1, 0, 0);
  else u.crossVectors(new THREE.Vector3(0, 1, 0), n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  return { n, u, v };
}

/**
 * The sheet that shows a plane: the rectangle on the plane containing the
 * projection of all 8 corners of `box` (the whole scene, not a robust
 * subset), 5 percent larger, centred on the projection of the box centre.
 * `plane` is { normal, constant } in the same frame as `box`.
 * Returns { centre, u, v, n, halfU, halfV } or null.
 */
export function sheetRect(plane, box) {
  if (!box || box.isEmpty()) return null;
  const { n, u, v } = planeBasis(plane.normal);
  const c = box.getCenter(new THREE.Vector3());
  const centre = c.clone().addScaledVector(n, -(n.dot(c) + plane.constant / plane.normal.length()));
  let halfU = 0;
  let halfV = 0;
  const p = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c);
    halfU = Math.max(halfU, Math.abs(p.dot(u)));
    halfV = Math.max(halfV, Math.abs(p.dot(v)));
  }
  const floor = 0.05;
  return { centre, u, v, n, halfU: Math.max(halfU * SHEET_MARGIN, floor), halfV: Math.max(halfV * SHEET_MARGIN, floor) };
}

/** Do the sheet's bounds contain all 8 corners of the box projected on the plane? (tolerance as a fraction of the sheet) */
export function sheetCoversBox(rect, box, tol = 0.01) {
  const p = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(rect.centre);
    if (Math.abs(p.dot(rect.u)) > rect.halfU * (1 + tol)) return false;
    if (Math.abs(p.dot(rect.v)) > rect.halfV * (1 + tol)) return false;
  }
  return true;
}

/**
 * Four corners of a plane drawn inside a unit cube (-1..1 on each axis) for
 * the mini model. Axis-aligned planes span the cube at their position; a
 * tilted one is a generic slab through the same centre.
 */
export function miniSlab(plane, box) {
  const n = plane.normal.clone().normalize();
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const c = box.getCenter(new THREE.Vector3());
  const point = n.clone().multiplyScalar(-plane.constant);
  const norm = (a) => Math.max(-1, Math.min(1, half[a] > 1e-9 ? (point[a] - c[a]) / half[a] : 0));
  const axis = axisOf(n);
  if (axis) {
    const others = ["x", "y", "z"].filter((a) => a !== axis);
    const f = norm(axis);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ [axis]: f, [others[0]]: a, [others[1]]: b })).map((q) => [q.x, q.y, q.z]);
  }
  const { u, v } = planeBasis(n);
  // The point is the plane's foot from the origin; centre the slab on the cube's axis through it.
  const mid = new THREE.Vector3(norm("x"), norm("y"), norm("z")).multiplyScalar(0.5);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => mid.clone().addScaledVector(u, a * 0.9).addScaledVector(v, b * 0.9).toArray());
}

/** Isometric projection used by the mini model: x right-down, z left-down, y up. */
export const isoProject = ([x, y, z]) => [(x - z) * 0.866, (x + z) * 0.5 - y];

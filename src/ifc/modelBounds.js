import * as THREE from "three";

// Bounds of a model that ignore the few elements sitting far away from the
// rest. Real files often carry a stray proxy, a terrain slab or an element
// placed at the wrong coordinates (skolebygg has proxies 100 m outside a 90 m
// building); the plain union of every box then frames mostly empty space.
//
// Rule: take the 1st and 99th percentile of the element centres, pad that
// range by 35% of its longest side, and drop every element whose centre falls
// outside, or whose own box is more than 1.5x as long as the range (a ground
// plane). The elements stay in the scene; they just do not drive the framing.
// Small models (< MIN_ELEMENTS) are left alone.
const MIN_ELEMENTS = 30;
const TRIM = 0.01;
const SLACK = 0.35;
const MAX_SIZE_RATIO = 1.5;

function percentile(sorted, q) {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

/** boxes: THREE.Box3[] (empty/null entries ignored) -> { box: Box3 | null, dropped: number } */
export function robustUnion(boxes) {
  const valid = boxes.filter((b) => b && !b.isEmpty());
  const all = new THREE.Box3();
  for (const b of valid) all.union(b);
  if (valid.length < MIN_ELEMENTS) return { box: all.isEmpty() ? null : all, dropped: 0 };

  const centres = valid.map((b) => b.getCenter(new THREE.Vector3()));
  const lo = new THREE.Vector3();
  const hi = new THREE.Vector3();
  for (const axis of ["x", "y", "z"]) {
    const sorted = centres.map((c) => c[axis]).sort((a, b) => a - b);
    lo[axis] = percentile(sorted, TRIM);
    hi[axis] = percentile(sorted, 1 - TRIM);
  }
  const span = Math.max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z, 1e-6);
  const pad = span * SLACK;
  const maxSize = span * MAX_SIZE_RATIO;
  const kept = new THREE.Box3();
  let dropped = 0;
  const size = new THREE.Vector3();
  valid.forEach((b, i) => {
    const c = centres[i];
    b.getSize(size);
    const inside =
      c.x >= lo.x - pad && c.x <= hi.x + pad &&
      c.y >= lo.y - pad && c.y <= hi.y + pad &&
      c.z >= lo.z - pad && c.z <= hi.z + pad;
    if (inside && size.x <= maxSize && size.y <= maxSize && size.z <= maxSize) kept.union(b);
    else dropped++;
  });
  if (kept.isEmpty()) return { box: all, dropped: 0 };
  return { box: kept, dropped };
}

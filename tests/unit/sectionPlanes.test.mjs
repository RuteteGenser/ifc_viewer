import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { sheetRect, sheetCoversBox, planesToDrop, activeAfterRemove, miniSlab, axisOf } from "../../src/ifc/sectionPlanes.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const box = new THREE.Box3(V(-3, 0, 5), V(37, 12, 25)); // 40 x 12 x 20, off the origin
const plane = (n, point) => {
  const normal = n.clone().normalize();
  return { normal, constant: -normal.dot(point) };
};
const centre = box.getCenter(V(0, 0, 0));

test("sheet covers the whole box for Plan, Side, Front and tilted planes, before and after moving and flipping", () => {
  const tilted = V(1, 0.6, -0.4);
  for (const n of [V(0, -1, 0), V(-1, 0, 0), V(0, 0, -1), tilted, V(0, 1, 0)]) {
    for (const shift of [0, 7, -9]) {
      for (const flip of [1, -1]) {
        const p = plane(n.clone().multiplyScalar(flip), centre.clone().addScaledVector(n.clone().normalize(), shift));
        const rect = sheetRect(p, box);
        assert.ok(sheetCoversBox(rect, box, 0.01), `not covered: n=${n.toArray()} shift=${shift}`);
        // centred on the projection of the box centre, and on the plane
        assert.ok(Math.abs(p.normal.dot(rect.centre) + p.constant) < 1e-9);
        assert.ok(rect.centre.clone().sub(centre).cross(p.normal).length() < Math.abs(shift) + 1e-9);
      }
    }
  }
});

test("axis-aligned sheets are the box cross-section plus 5 percent", () => {
  const rect = sheetRect(plane(V(0, -1, 0), centre), box);
  assert.ok(Math.abs(rect.halfU * 2 - 40 * 1.05) < 1e-9 || Math.abs(rect.halfV * 2 - 40 * 1.05) < 1e-9);
  assert.ok(Math.abs(Math.max(rect.halfU, rect.halfV) * 2 - 42) < 1e-9);
  assert.ok(Math.abs(Math.min(rect.halfU, rect.halfV) * 2 - 21) < 1e-9);
});

test("a stray far element is part of the box and so of the sheet", () => {
  const wide = box.clone().expandByPoint(V(500, 3, 10));
  const rect = sheetRect(plane(V(0, -1, 0), centre), wide);
  assert.ok(sheetCoversBox(rect, wide));
  assert.ok(Math.max(rect.halfU, rect.halfV) > 250);
});

test("empty box: no sheet", () => assert.equal(sheetRect(plane(V(0, 1, 0), centre), new THREE.Box3()), null));

test("phone keeps two planes: the third makes the oldest go", () => {
  assert.equal(planesToDrop(0, true), 0);
  assert.equal(planesToDrop(1, true), 0);
  assert.equal(planesToDrop(2, true), 1);
  assert.equal(planesToDrop(5, false), 0);
});

test("active plane: stays when another goes, else the newest left", () => {
  assert.equal(activeAfterRemove(["a", "b"], "a", "b"), "a");
  assert.equal(activeAfterRemove(["a", "b"], "b", "b"), "a");
  assert.equal(activeAfterRemove(["a"], "a", "a"), null);
  assert.equal(activeAfterRemove(["a", "b", "c"], "a", "a"), "c");
});

test("mini slab: axis-aligned spans the cube at its position, tilted is a generic slab", () => {
  const plan = miniSlab(plane(V(0, -1, 0), V(0, 9, 0)), box); // y 0..12, centre 6 -> +0.5
  assert.equal(plan.length, 4);
  for (const q of plan) assert.ok(Math.abs(q[1] - 0.5) < 1e-9 && Math.abs(Math.abs(q[0]) - 1) < 1e-9);
  assert.equal(axisOf(V(0, 1, 0)), "y");
  assert.equal(axisOf(V(1, 1, 0).normalize()), null);
  const tilt = miniSlab(plane(V(1, 1, 0), centre), box);
  assert.equal(tilt.length, 4);
  assert.ok(tilt.some((q) => q[1] !== tilt[0][1]));
});

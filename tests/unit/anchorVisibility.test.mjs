import test from "node:test";
import assert from "node:assert/strict";
import { visibleByHit, stepVisibility, onScreen } from "../../src/ifc/anchorVisibility.js";

test("the anchor's own surface is visible, something clearly in front hides it", () => {
  assert.equal(visibleByHit(20, 20), true);
  assert.equal(visibleByHit(20, 19.8), true); // within 1.5 percent + 2 cm
  assert.equal(visibleByHit(20, 19.5), false); // a wall 0.5 m in front
  assert.equal(visibleByHit(20, 21), true); // behind the anchor: the anchor is the nearest
  assert.equal(visibleByHit(1, 0.95), false);
  assert.equal(visibleByHit(1, 0.99), true);
});
test("no answer changes nothing", () => {
  assert.equal(visibleByHit(5, null), null);
  assert.equal(visibleByHit(5, undefined), null);
  const s = { shown: true, agree: 1 };
  assert.equal(stepVisibility(s, null), s);
});
test("a state flips only after two agreeing results, a disagreeing one resets", () => {
  let s = { shown: true, agree: 0 };
  s = stepVisibility(s, false);
  assert.deepEqual(s, { shown: true, agree: 1 });
  s = stepVisibility(s, true); // flicker at a silhouette
  assert.deepEqual(s, { shown: true, agree: 0 });
  s = stepVisibility(s, false);
  s = stepVisibility(s, false);
  assert.deepEqual(s, { shown: false, agree: 0 });
  s = stepVisibility(s, true);
  s = stepVisibility(s, true);
  assert.equal(s.shown, true);
});
test("on-screen test rejects behind the camera and outside the view", () => {
  assert.equal(onScreen({ x: 0, y: 0, z: 0.5 }), true);
  assert.equal(onScreen({ x: 1.2, y: 0, z: 0.5 }), false);
  assert.equal(onScreen({ x: 0, y: 0, z: 1.2 }), false); // behind the camera projects beyond far
  assert.equal(onScreen({ x: 0.9, y: -0.9, z: 0.1 }), true);
});

import { visibleWithMargin, anchorTolerance } from "../../src/ifc/anchorVisibility.js";
test("margin band: shown hides only when the hit is clearly in front (2x tolerance), hidden shows again within 1x", () => {
  const d = 10, tol = anchorTolerance(d); // 0.17
  assert.ok(Math.abs(tol - 0.17) < 1e-9);
  // hit exactly on the surface or a hair in front: stays shown, and a hidden one comes back
  assert.equal(visibleWithMargin(d, d - 0.5 * tol, true), true);
  assert.equal(visibleWithMargin(d, d - 1.5 * tol, true), true); // dead band: still shown
  assert.equal(visibleWithMargin(d, d - 1.5 * tol, false), false); // dead band: still hidden
  assert.equal(visibleWithMargin(d, d - 2.5 * tol, true), false); // clearly in front
  assert.equal(visibleWithMargin(d, d - 0.9 * tol, false), true);
  assert.equal(visibleWithMargin(d, d + 3, false), true); // behind the anchor
  assert.equal(visibleWithMargin(d, null, true), null);
});
test("margin band: a wobbling depth on a surface never toggles", () => {
  let shown = true, flips = 0;
  for (const wob of [0, -0.1, 0.05, -0.2, -0.15, 0.1, -0.25, -0.1, 0]) {
    const next = visibleWithMargin(10, 10 + wob, shown);
    if (next !== shown) flips++;
    shown = next;
  }
  assert.equal(flips, 0);
});

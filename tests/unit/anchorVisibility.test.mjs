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

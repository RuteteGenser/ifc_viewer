import test from "node:test";
import assert from "node:assert/strict";
import { stackUp } from "../../src/ifc/labelStack.js";

const R = (l, t, w = 60, h = 30) => ({ l, r: l + w, t, b: t + h });
const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

test("separate labels do not move", () => {
  assert.deepEqual(stackUp([R(0, 0), R(100, 0), R(0, 100)]), [0, 0, 0]);
});

test("the first label never moves; an overlapping one hops above it with the gap", () => {
  const dy = stackUp([R(0, 100), R(10, 110)], 4);
  assert.equal(dy[0], 0);
  assert.equal(110 + 30 - dy[1], 100 - 4); // bottom of the second sits 4 px above the first
});

test("three on top of each other stack with no intersection", () => {
  const rects = [R(0, 100), R(5, 102), R(8, 99)];
  const dy = stackUp(rects);
  const moved = rects.map((r, i) => ({ ...r, t: r.t - dy[i], b: r.b - dy[i] }));
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.equal(hit(moved[i], moved[j]), false);
});

test("deterministic for the same input (no flicker between frames)", () => {
  const rects = [R(0, 50), R(20, 60), R(40, 55)];
  assert.deepEqual(stackUp(rects), stackUp(rects));
});

test("empty input", () => assert.deepEqual(stackUp([]), []));

import { legLabelFits } from "../../src/ifc/labelStack.js";
test("leg label: shows at 90 percent of its width, stays down to 70 percent", () => {
  assert.equal(legLabelFits(89, 100, false), false);
  assert.equal(legLabelFits(91, 100, false), true);
  assert.equal(legLabelFits(75, 100, true), true); // shown: kept inside the band
  assert.equal(legLabelFits(75, 100, false), false); // hidden: not shown inside the band
  assert.equal(legLabelFits(65, 100, true), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  boxCentre, boxFromChunks, viewDirections, faceDirections, nearestHit, rayExitDistance, clearanceValueText, clearanceLabelText,
  makeClearance, serializeClearance, deserializeClearance, clearanceSummary, DIRECTIONS,
} from "../../src/ifc/clearance.js";

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const vnear = (a, b) => a.forEach((x, i) => near(x, b[i]));

test("the centre of a box is the middle of its extremes", () => {
  assert.deepEqual(boxCentre([0, 0, 0], [2, 4, 6]), [1, 2, 3]);
  assert.deepEqual(boxCentre([-3, -1, 5], [-1, 1, 7]), [-2, 0, 6]);
});

test("a box from geometry chunks applies each chunk's transform", () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const moved = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1]; // +10 in x
  const chunks = [
    { positions: new Float32Array([0, 0, 0, 1, 2, 3]), transform: { elements: identity } },
    { positions: new Float32Array([0, 0, 0, 1, 1, 1]), transform: { elements: moved } },
  ];
  assert.deepEqual(boxFromChunks(chunks), { min: [0, 0, 0], max: [11, 2, 3] });
  assert.equal(boxFromChunks([]), null);
  assert.equal(boxFromChunks([{ positions: new Float32Array([]) }]), null);
});

test("looking along -Z: right is +X, left is -X, up is the model's up", () => {
  const d = viewDirections([0, 0, -1], [0, 1, 0]);
  vnear(d.right, [1, 0, 0]);
  vnear(d.left, [-1, 0, 0]);
  vnear(d.up, [0, 1, 0]);
  vnear(d.down, [0, -1, 0]);
});

test("a tilted view uses only its horizontal part, and left/right stay horizontal and perpendicular", () => {
  const view = [0.6, -0.5, -0.6245]; // looking down at an angle
  const d = viewDirections(view, [0, 1, 0]);
  near(d.right[1], 0);
  near(Math.hypot(...d.right), 1);
  near(d.right[0] * view[0] + d.right[2] * view[2], 0, 1e-9);
  vnear(d.left, d.right.map((x) => -x));
});

test("an elevation from the east: the visual right is north-ish", () => {
  const d = viewDirections([-1, 0, 0], [0, 1, 0]); // camera east of the model, looking west
  vnear(d.right, [0, 0, -1]);
});

test("a view straight down falls back to the camera's up vector (plan view)", () => {
  // top-down, screen up is model -Z: the screen's right is +X
  const d = viewDirections([0, -1, 0], [0, 0, -1]);
  vnear(d.right, [1, 0, 0]);
  vnear(d.left, [-1, 0, 0]);
  // top-down with screen up = +X: screen right is +Z
  vnear(viewDirections([0, -1, 0], [1, 0, 0]).right, [0, 0, 1]);
  // straight up from below
  const below = viewDirections([0, 1, 0], [0, 0, -1]);
  near(below.right[1], 0);
  near(Math.hypot(...below.right), 1);
});

test("no usable camera still gives four directions", () => {
  const d = viewDirections([0, -1, 0], null);
  near(Math.hypot(...d.right), 1);
  near(d.right[1], 0);
});

test("the nearest other hit wins: self, epsilon and range are ignored", () => {
  const hits = [
    { distance: 0.001, id: "skin" },
    { distance: 0.4, id: "self" },
    { distance: 2.5, id: "far" },
    { distance: 1.2, id: "slab" },
    { distance: 40, id: "toofar" },
  ];
  const opts = { isSelf: (h) => h.id === "self", epsilon: 0.005, maxRange: 20 };
  assert.equal(nearestHit(hits, opts).id, "slab");
  assert.equal(nearestHit([{ distance: 0.4, id: "self" }], opts), null);
  assert.equal(nearestHit([{ distance: 50, id: "x" }], opts), null);
  assert.equal(nearestHit([], opts), null);
  assert.equal(nearestHit(null, opts), null);
  assert.equal(nearestHit([{ distance: 0.005, id: "edge" }], opts), null, "exactly the epsilon is not past it");
  assert.equal(nearestHit([{ distance: NaN, id: "bad" }, { distance: 3, id: "ok" }], opts).id, "ok");
});

test("the dashed open line runs to the model bounds", () => {
  near(rayExitDistance([1, 1, 1], [0, 1, 0], [0, 0, 0], [4, 5, 6]), 4);
  near(rayExitDistance([1, 1, 1], [-1, 0, 0], [0, 0, 0], [4, 5, 6]), 1);
  near(rayExitDistance([1, 1, 1], [0, 0, 1], [0, 0, 0], [4, 5, 6]), 5);
  assert.equal(rayExitDistance([9, 9, 9], [1, 0, 0], [0, 0, 0], [4, 5, 6]), 0, "an origin outside the box");
});

test("label text switches from mm to m at one metre", () => {
  assert.equal(clearanceValueText(0.999), "999 mm");
  assert.equal(clearanceValueText(1), "1.00 m");
  assert.equal(clearanceValueText(2.7), "2.70 m");
  assert.equal(clearanceValueText(0.0004), "0 mm");
  assert.equal(clearanceValueText(null), "Open");
  assert.equal(clearanceLabelText("up", 2.4), "↑ 2.40 m");
  assert.equal(clearanceLabelText("left", null), "← Open");
  assert.ok(!/—|–/.test(clearanceLabelText("down", 0.5)), "no dashes of the em kind");
});

test("a clearance survives serialisation and rejects garbage", () => {
  const dirs = { up: [0, 1, 0], down: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0] };
  const c = makeClearance({
    id: "clearance-1", name: "Basic Wall", modelId: "m", localId: 7, centre: [1, 2, 3], dirs,
    values: { up: 1.5, down: 1.2, left: null, right: 0.3 }, reach: { up: 1.5, down: 1.2, left: 9, right: 0.3 },
  });
  const back = deserializeClearance(serializeClearance(c));
  assert.deepEqual(back, { name: "Basic Wall", modelId: "m", localId: 7, centre: [1, 2, 3], dirs, values: c.values, reach: c.reach });
  assert.equal(deserializeClearance("not json"), null);
  assert.equal(deserializeClearance(JSON.stringify({ v: 2 })), null);
  assert.equal(deserializeClearance(JSON.stringify({ v: 1, centre: [1, 2] })), null);
  const bad = JSON.parse(serializeClearance(c));
  bad.values.up = "x";
  assert.equal(deserializeClearance(bad), null);
  assert.deepEqual(DIRECTIONS, ["up", "down", "left", "right"]);
  assert.deepEqual(clearanceSummary(c), { id: "clearance-1", kind: "clearance", name: "Basic Wall", up: 1.5, down: 1.2, left: null, right: 0.3 });
});

test("faceDirections: on a wall facing +Z, up is vertical and left/right run along the wall", () => {
  const d = faceDirections([0, 0, 1], [0, 0, -1], [0, 1, 0]);
  vnear(d.up, [0, 1, 0]);
  vnear(d.right, [1, 0, 0]);
  vnear(d.left, [-1, 0, 0]);
});

test("faceDirections: a slanted wall (facing +X+Z) keeps all four directions in the wall plane, 90 degrees apart", () => {
  const n = [Math.SQRT1_2, 0, Math.SQRT1_2];
  const d = faceDirections(n, [-Math.SQRT1_2, 0, -Math.SQRT1_2], [0, 1, 0]);
  for (const k of ["up", "down", "left", "right"]) assert.ok(Math.abs(d[k][0] * n[0] + d[k][1] * n[1] + d[k][2] * n[2]) < 1e-9);
  assert.ok(Math.abs(d.up[0] * d.right[0] + d.up[1] * d.right[1] + d.up[2] * d.right[2]) < 1e-9);
  vnear(d.right, [Math.SQRT1_2, 0, -Math.SQRT1_2]);
});

test("faceDirections: a wall seen from behind is flipped toward the camera, so left/right still match the screen", () => {
  vnear(faceDirections([0, 0, -1], [0, 0, -1], [0, 1, 0]).right, [1, 0, 0]);
});

test("faceDirections: on a floor the camera's up decides", () => {
  const d = faceDirections([0, 1, 0], [0, -1, 0], [0, 0, -1]);
  vnear(d.up, [0, 0, -1]);
  vnear(d.right, [1, 0, 0]);
});

test("faceDirections: no normal gives null", () => {
  assert.equal(faceDirections(null), null);
  assert.equal(faceDirections([0, 0, 0]), null);
});

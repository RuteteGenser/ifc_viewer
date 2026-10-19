import test from "node:test";
import assert from "node:assert/strict";
import { rdpSimplify, arrowGeometry, clampToViewport, placeLabels, projectPathVisibleSegments, smoothPathD } from "../../src/annotations/geometry.js";

test("rdp keeps the ends and drops collinear points", () => {
  const line = Array.from({ length: 50 }, (_, i) => [i, i * 2]);
  assert.deepEqual(rdpSimplify(line, 0.5), [[0, 0], [49, 98]]);
});

test("rdp keeps a corner", () => {
  const pts = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10]];
  assert.deepEqual(rdpSimplify(pts, 0.5), [[0, 0], [10, 0], [10, 10]]);
});

test("rdp works in 3D and respects maxPoints by loosening the tolerance", () => {
  const wavy = Array.from({ length: 500 }, (_, i) => [i, Math.sin(i / 7) * 10, (i % 3) * 0.2]);
  const out = rdpSimplify(wavy, 0.1, 200);
  assert.ok(out.length <= 200 && out.length >= 2);
  assert.deepEqual(out[0], wavy[0]);
  assert.deepEqual(out[out.length - 1], wavy[499]);
  assert.equal(out[0].length, 3);
});

test("rdp on tiny and degenerate input", () => {
  assert.deepEqual(rdpSimplify([]), []);
  assert.deepEqual(rdpSimplify([[1, 1]]), [[1, 1]]);
  assert.deepEqual(rdpSimplify([[1, 1], [1, 1], [1, 1]], 1), [[1, 1], [1, 1]]);
});

test("rdp survives a very long stroke (no recursion)", () => {
  const pts = Array.from({ length: 600 }, (_, i) => [i, (i % 2) * 5]);
  assert.ok(rdpSimplify(pts, 1, 200).length <= 200);
});

test("arrow head: tip at the end, wings behind it, shaft stops inside the head", () => {
  const g = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 });
  assert.equal(g.length, 100);
  assert.deepEqual(g.head[1], { x: 100, y: 0 });
  assert.ok(g.head[0].x < 100 && g.head[2].x < 100);
  assert.ok(Math.abs(g.head[0].y + g.head[2].y) < 1e-9); // symmetric
  assert.ok(g.shaftEnd.x < 100 && g.shaftEnd.x > g.head[0].x);
});

test("a short arrow gets a smaller head; zero length does not produce NaN", () => {
  const g = arrowGeometry({ x: 0, y: 0 }, { x: 10, y: 0 });
  assert.ok(g.head[0].x >= 4);
  const z = arrowGeometry({ x: 5, y: 5 }, { x: 5, y: 5 });
  assert.equal(z.length, 0);
  assert.ok(z.head.every((p) => Number.isFinite(p.x)));
});

test("clampToViewport keeps boxes inside, including boxes larger than the viewport", () => {
  const size = { width: 300, height: 200 };
  assert.deepEqual(clampToViewport({ x: -50, y: 500, w: 100, h: 50 }, size, 4), { x: 4, y: 146 });
  assert.deepEqual(clampToViewport({ x: 250, y: 10, w: 100, h: 50 }, size, 4), { x: 196, y: 10 });
  const big = clampToViewport({ x: 100, y: 100, w: 900, h: 900 }, size, 4);
  assert.ok(Number.isFinite(big.x) && Number.isFinite(big.y));
});

test("placeLabels separates overlapping labels (uses stackUp)", () => {
  const R = (l, t) => ({ l, r: l + 60, t, b: t + 30 });
  const dy = placeLabels([R(0, 100), R(10, 105)]);
  assert.equal(dy[0], 0);
  assert.ok(dy[1] > 0);
});

test("visible segments split at hidden points and drop lone points", () => {
  const P = (x, visible = true) => ({ x, y: 0, visible });
  const runs = projectPathVisibleSegments([P(0), P(1), P(2, false), P(3), P(4, false), P(5), P(6), P(7)]);
  assert.deepEqual(runs.map((r) => r.map((p) => p.x)), [[0, 1], [5, 6, 7]]);
  assert.deepEqual(projectPathVisibleSegments([P(0, false)]), []);
});

test("smoothPathD: M/L for short paths, quadratic curves for longer, round numbers", () => {
  assert.equal(smoothPathD([]), "");
  assert.equal(smoothPathD([{ x: 1, y: 2 }, { x: 3, y: 4 }]), "M1 2L3 4");
  const d = smoothPathD([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 10 }]);
  assert.match(d, /^M0 0L5 5Q10 10 15 5Q20 0 25 5L30 10$/);
});

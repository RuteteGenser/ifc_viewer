import test from "node:test";
import assert from "node:assert/strict";
import { STANDARD_VIEWS, encodeViewHash, decodeViewHash, sameNames, screenshotFileName } from "../../src/ifc/viewHelpers.js";
import { formatLength } from "../../src/ifc/formatLength.js";
import { formatDimensionTag } from "../../src/ifc/dimensionTagFormat.js";

const view = { position: [1, 2, 3], target: [0, 0, 0], groupQuat: [0, 0, 0, 1], groupPos: [0.5, 0, -0.5], fov: 50, modelNames: ["a b.ifc", "c|d.ifc"] };

test("view link round-trips, including model names with spaces and bars", () => {
  const hash = encodeViewHash(view);
  assert.match(hash, /^#view=/);
  assert.deepEqual(decodeViewHash(hash), view);
});

test("view link rounds numbers to 4 decimals", () => {
  const hash = encodeViewHash({ ...view, position: [1.123456789, 2, 3] });
  assert.equal(decodeViewHash(hash).position[0], 1.1235);
});

test("bad view links decode to null, never throw", () => {
  for (const bad of ["", "#", "#view=", "#view=1,2,3", "#view=1,2,3,4,5,6,7,8,9,10,11,12,13,x", "#other=1", "#view=1,2,3,4,5,6,7,8,9,10,11,12,13,14&m=%E0%A4%A", null, undefined]) {
    assert.equal(decodeViewHash(bad), null, String(bad));
  }
});

test("a link without model names still decodes", () => {
  assert.deepEqual(decodeViewHash("#view=1,2,3,4,5,6,7,8,9,10,11,12,13,14").modelNames, []);
});

test("sameNames ignores order, not content", () => {
  assert.ok(sameNames(["a", "b"], ["b", "a"]));
  assert.ok(!sameNames(["a"], ["a", "a"]));
  assert.ok(!sameNames(["a", "b"], ["a", "c"]));
});

test("standard views: six, unique ids, non-zero directions", () => {
  assert.equal(STANDARD_VIEWS.length, 6);
  assert.equal(new Set(STANDARD_VIEWS.map((v) => v.id)).size, 6);
  for (const v of STANDARD_VIEWS) assert.ok(v.dir.some((n) => n !== 0));
});

test("screenshot file name", () => {
  assert.match(screenshotFileName(), /^argus-view-\d{8}-\d{4}\.png$/);
});

test("formatLength: metres from 1 m up, whole mm below", () => {
  assert.equal(formatLength(2.5), "2.50 m");
  assert.equal(formatLength(1), "1.00 m");
  assert.equal(formatLength(0.4567), "457 mm");
  assert.equal(formatLength(-3), "-3.00 m");
  assert.equal(formatLength(0), "0 mm");
});

test("dimension tags", () => {
  assert.equal(formatDimensionTag("IFCFLOWSEGMENT", null), null);
  assert.deepEqual(formatDimensionTag("x", { shape: "circular", diameter: 80 }), ["ø80mm"]);
  assert.deepEqual(formatDimensionTag("x", { shape: "circular", diameter: 110, wallThickness: 2 }), ["OD: ø110", "ID: 106.0mm"]);
  assert.deepEqual(formatDimensionTag("x", { shape: "rectangular", width: 300.4, height: 200 }), ["300×200mm"]);
  assert.equal(formatDimensionTag("x", { shape: "rectangular", width: 300 }), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readLevels, formatElevation } from "../../src/ifc/storeys.js";
import { fixtureBytes, fakeModelFromIfc } from "./helpers/fixtures.mjs";

async function levelsOf(file) {
  const bytes = fixtureBytes(file);
  const { model, close } = await fakeModelFromIfc(bytes);
  try {
    return await readLevels([["m1", { model, sourceBytes: bytes }]]);
  } finally {
    close();
  }
}
const summary = (levels) => levels.map((l) => [l.name, Number(l.elevation.toFixed(3))]);

test("mm file: elevations are converted to metres", async () => {
  const levels = await levelsOf("mm-ifc2x3.ifc");
  assert.deepEqual(summary(levels), [["Ground", 0], ["First", 3], ["Roof", 6.25]]);
});

test("metre file: elevations are kept", async () => {
  assert.deepEqual(summary(await levelsOf("m-ifc4.ifc")), [["Ground", 0], ["First", 3.2], ["Roof", 6.4]]);
});

test("feet file: 10 ft and 20 ft become 3.048 m and 6.096 m", async () => {
  assert.deepEqual(summary(await levelsOf("feet-ifc4.ifc")), [["Ground", 0], ["First", 3.048], ["Roof", 6.096]]);
});

test("units written at the end of the file still convert", async () => {
  assert.deepEqual(summary(await levelsOf("units-at-end-ifc2x3.ifc")), [["Ground", 0], ["Upper", 2.8]]);
});

test("each level lists the elements on it, keyed by model", async () => {
  const levels = await levelsOf("mm-ifc2x3.ifc");
  for (const level of levels) {
    assert.equal(level.keys.length, 2, `${level.name} has two walls`);
    assert.ok(level.keys.every((k) => k.startsWith("m1::")));
  }
  assert.equal(new Set(levels.flatMap((l) => l.keys)).size, 6, "no element is on two levels");
});

test("levels come back lowest first even if the file lists them upside down", async () => {
  const bytes = fixtureBytes("m-ifc4.ifc");
  const { model, close } = await fakeModelFromIfc(bytes);
  const tree = await model.getSpatialStructure();
  tree.children[0].children[0].children.reverse();
  const reversed = { ...model, getSpatialStructure: async () => tree };
  const levels = await readLevels([["m1", { model: reversed, sourceBytes: bytes }]]);
  close();
  assert.deepEqual(levels.map((l) => l.name), ["Ground", "First", "Roof"]);
});

test("same storey in two models is merged into one level", async () => {
  const bytes = fixtureBytes("m-ifc4.ifc");
  const a = await fakeModelFromIfc(bytes);
  const b = await fakeModelFromIfc(bytes);
  const levels = await readLevels([["a", { model: a.model, sourceBytes: bytes }], ["b", { model: b.model, sourceBytes: bytes }]]);
  a.close();
  b.close();
  assert.equal(levels.length, 3);
  assert.equal(levels[0].keys.length, 4);
});

test("a model whose spatial structure cannot be read is skipped, not fatal", async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    const bad = { getSpatialStructure: async () => { throw new Error("boom"); } };
    assert.deepEqual(await readLevels([["x", { model: bad, sourceBytes: null }]]), []);
  } finally {
    console.error = quiet;
  }
});

test("a storey without an elevation sorts as 0 and prints nothing", async () => {
  const model = {
    getSpatialStructure: async () => ({ category: "IFCPROJECT", children: [{ category: "IFCBUILDINGSTOREY", children: [{ localId: 7, children: [] }] }] }),
    getItemsData: async () => [{ Name: { value: "  " } }],
  };
  const levels = await readLevels([["m", { model, sourceBytes: null }]]);
  assert.equal(levels[0].name, "Level 1");
  assert.equal(levels[0].elevation, null);
  assert.equal(formatElevation(levels[0].elevation), "");
});

test("formatElevation: sign and two decimals", () => {
  assert.equal(formatElevation(0), "0.00 m");
  assert.equal(formatElevation(3), "+3.00 m");
  assert.equal(formatElevation(-2.5), "-2.50 m");
  assert.equal(formatElevation(11.4), "+11.40 m");
  assert.equal(formatElevation(0.001), "0.00 m");
  assert.equal(formatElevation(undefined), "");
});

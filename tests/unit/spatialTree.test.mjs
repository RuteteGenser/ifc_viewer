import test from "node:test";
import assert from "node:assert/strict";
import { buildTree, elementIds, hiddenCounts, categoryCounts, SPATIAL_CATEGORIES } from "../../src/ifc/spatialTree.js";

const inst = (localId, children = []) => ({ localId, category: null, children });
const cat = (category, children) => ({ category, localId: null, children });

// Project > Site > Building > two storeys; storey 1 has 3 walls + 1 slab, storey 2 has 1 wall.
const raw = cat("IFCPROJECT", [
  inst(1, [cat("IFCSITE", [inst(2, [cat("IFCBUILDING", [inst(3, [cat("IFCBUILDINGSTOREY", [
    inst(4, [cat("IFCWALL", [inst(10), inst(11), inst(12)]), cat("IFCSLAB", [inst(13)])]),
    inst(5, [cat("IFCWALL", [inst(20)])]),
  ])])])])])]),
]);

test("spatial categories are folded; other categories become groups", () => {
  const { root } = buildTree("m", raw);
  assert.equal(root.category, "IFCPROJECT");
  assert.equal(root.kind, "spatial");
  const storeys = root.children[0].children[0].children;
  assert.equal(storeys.length, 2);
  assert.ok(storeys.every((s) => s.kind === "spatial" && s.category === "IFCBUILDINGSTOREY"));
  const groups = storeys[0].children;
  assert.deepEqual(groups.map((g) => [g.kind, g.category, g.children.length]), [["group", "IFCWALL", 3], ["group", "IFCSLAB", 1]], "largest group first");
});

test("leaf counts add up", () => {
  const { root } = buildTree("m", raw);
  assert.equal(root.leafCount, 5);
  assert.deepEqual(categoryCounts(root), { byCategory: [["IFCWALL", 4], ["IFCSLAB", 1]], storeyCount: 2, elementCount: 5 });
});

test("elementIds returns every element under a node", () => {
  const { root } = buildTree("m", raw);
  assert.deepEqual(elementIds(root).sort((a, b) => a - b), [10, 11, 12, 13, 20]);
  const storey1 = root.children[0].children[0].children[0];
  assert.deepEqual(elementIds(storey1).sort((a, b) => a - b), [10, 11, 12, 13]);
});

test("hiddenCounts counts hidden elements per node in one pass", () => {
  const { root } = buildTree("m", raw);
  const counts = hiddenCounts(root, new Set([10, 20, 999]));
  assert.equal(counts.get(root.id), 2);
  const storey1 = root.children[0].children[0].children[0];
  assert.equal(counts.get(storey1.id), 1);
});

test("node ids are namespaced by model so two models never collide", () => {
  const a = buildTree("a", raw);
  const b = buildTree("b", raw);
  assert.ok([...a.nodes.keys()].every((k) => k.startsWith("a/")));
  assert.equal(new Set([...a.nodes.keys(), ...b.nodes.keys()]).size, a.nodes.size + b.nodes.size);
});

test("a tree without a project instance still builds a root; null/empty input does not throw", () => {
  const { root } = buildTree("m", cat("IFCPROJECT", [cat("IFCWALL", [inst(1)])]));
  assert.equal(root.id, "m/root");
  assert.equal(root.leafCount, 1);
  assert.equal(buildTree("m", null).root.leafCount, 0);
});

test("SPATIAL_CATEGORIES", () => {
  assert.deepEqual([...SPATIAL_CATEGORIES].sort(), ["IFCBUILDING", "IFCBUILDINGSTOREY", "IFCPROJECT", "IFCSITE"]);
});

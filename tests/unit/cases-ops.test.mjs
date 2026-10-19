import test from "node:test";
import assert from "node:assert/strict";
import { addSnapshot, updateSnapshot, removeSnapshot, moveSnapshot, indexAfter, caseBytes, importKind, CaseLimitError } from "../../src/cases/caseOps.js";
import { newCase, LIMITS } from "../../src/cases/schema.js";

const make = (n) => { let c = newCase({ name: "t" }); for (let i = 0; i < n; i++) c = addSnapshot(c, { title: "s" + i }).case; return c; };

test("addSnapshot appends and respects the limit", () => {
  const c = make(2);
  assert.deepEqual(c.snapshots.map((s) => s.title), ["s0", "s1"]);
  assert.throws(() => addSnapshot(make(LIMITS.snapshotsPerCase), {}), CaseLimitError);
});
test("update and remove are by id and do not mutate", () => {
  const c = make(3), id = c.snapshots[1].id;
  const u = updateSnapshot(c, id, { title: "x" });
  assert.equal(u.snapshots[1].title, "x"); assert.equal(c.snapshots[1].title, "s1");
  assert.deepEqual(removeSnapshot(u, id).snapshots.map((s) => s.title), ["s0", "s2"]);
});
test("moveSnapshot swaps neighbours and ignores the ends", () => {
  const c = make(3);
  assert.deepEqual(moveSnapshot(c, c.snapshots[2].id, -1).snapshots.map((s) => s.title), ["s0", "s2", "s1"]);
  assert.equal(moveSnapshot(c, c.snapshots[0].id, -1), c);
  assert.equal(moveSnapshot(c, c.snapshots[2].id, 1), c);
});
test("indexAfter keeps the snapshot or falls back to the nearest", () => {
  const c = make(3), id = c.snapshots[1].id;
  assert.equal(indexAfter(c, id), 1);
  assert.equal(indexAfter(removeSnapshot(c, id), id, 1), 1);
  assert.equal(indexAfter(removeSnapshot(removeSnapshot(c, id), c.snapshots[2].id), id, 5), 0);
});
test("caseBytes and importKind", () => {
  const c = make(1); c.snapshots[0].thumb = "abc"; c.snapshots[0].image = "defg";
  assert.equal(caseBytes(c), 7);
  assert.equal(importKind("x.bcf"), "bcf"); assert.equal(importKind("x.BCFzip"), "bcf"); assert.equal(importKind("a.argus-case.json"), "json");
});

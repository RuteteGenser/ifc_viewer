import test from "node:test";
import assert from "node:assert/strict";
import { matchModel, caseGuids, GUID_THRESHOLD } from "../../src/cases/match.js";
import { newCase, newSnapshot, newAnnotation } from "../../src/cases/schema.js";

const SHA = "a".repeat(64);
const cm = { name: "AC20.ifc", sha256: SHA, size: 100, projectGuid: "P1" };
const guids = (n) => Array.from({ length: n }, (_, i) => "g" + i);

test("exact: same sha256 wins over everything, case-insensitive", () => {
  const r = matchModel(cm, { name: "other.ifc", sha256: SHA.toUpperCase(), size: 1 });
  assert.equal(r.level, "exact"); assert.ok(r.reason);
});
test("name: same file name and size without hashes", () => {
  assert.equal(matchModel({ ...cm, sha256: null }, { name: "ac20.IFC", sha256: null, size: 100 }).level, "name");
});
test("name needs the size too", () => {
  assert.equal(matchModel({ ...cm, sha256: null, projectGuid: null }, { name: "AC20.ifc", size: 101 }).level, "none");
  assert.equal(matchModel({ ...cm, sha256: null, projectGuid: null, size: null }, { name: "AC20.ifc", size: null }).level, "none");
});
test("name level is refused when both checksums are known and differ", () => {
  const r = matchModel({ ...cm, projectGuid: null }, { name: "AC20.ifc", sha256: "b".repeat(64), size: 100 });
  assert.equal(r.level, "none"); assert.match(r.reason, /checksum/);
});
test("guid: same project GUID", () => {
  assert.equal(matchModel({ ...cm, sha256: null }, { name: "x", projectGuid: "P1" }).level, "guid");
});
test("guid: 80 percent of annotation GUIDs present passes (boundary 80/100)", () => {
  const r = matchModel({ name: "a" }, { name: "b" }, guids(100), new Set(guids(80)));
  assert.equal(r.level, "guid"); assert.equal(r.found, 80); assert.equal(r.missing.length, 20);
});
test("guid: 79 percent fails (boundary 79/100)", () => {
  const r = matchModel({ name: "a" }, { name: "b" }, guids(100), new Set(guids(79)));
  assert.equal(r.level, "none"); assert.equal(r.found, 79); assert.match(r.reason, /79 percent/);
});
test("guid threshold with small sets: 4 of 5 passes, 3 of 4 fails; array set accepted", () => {
  assert.equal(GUID_THRESHOLD, 0.8);
  assert.equal(matchModel({}, {}, guids(5), guids(4)).level, "guid");
  assert.equal(matchModel({}, {}, guids(4), guids(3)).level, "none");
});
test("duplicate and empty annotation guids are ignored", () => {
  const r = matchModel({}, {}, ["a", "a", "", null, "b"], new Set(["a", "b"]));
  assert.equal(r.level, "guid"); assert.equal(r.total, 2);
});
test("none: no info at all, missing guid set, empty guid list", () => {
  assert.equal(matchModel({}, {}).level, "none");
  assert.equal(matchModel(null, undefined).level, "none");
  assert.equal(matchModel({}, {}, guids(3), null).level, "none");
  assert.equal(matchModel({}, {}, [], new Set(["a"])).level, "none");
});
test("caseGuids collects anchors, targets, hidden and isolated", () => {
  const c = newCase(); const s = newSnapshot({ view: { hiddenGuids: ["h"], isolatedGuids: ["i", "a"] } });
  s.annotations.push(newAnnotation("arrow", { anchor: { point: [0, 0, 0], guid: "a" }, target: { point: [1, 1, 1], guid: "t" } }));
  c.snapshots.push(s);
  assert.deepEqual(caseGuids(c).sort(), ["a", "h", "i", "t"]);
});

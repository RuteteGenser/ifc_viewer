import test from "node:test";
import assert from "node:assert/strict";
import { SCHEMA, LIMITS, PALETTE, newCase, newSnapshot, newAnnotation, validateCase } from "../../src/cases/schema.js";
import { isId } from "../../src/cases/ids.js";

const JPG = "data:image/jpeg;base64,AAAA";
const cam = { position: [1, 2, 3], quaternion: [0, 0, 0, 1], fov: 60, target: [0, 0, 0], flat: false };
function sample() {
  const c = newCase({ name: "Fire doors", model: { name: "a.ifc", size: 10, ifcSchema: "IFC4" } });
  const s = newSnapshot({ title: "Door", note: "Rør æøå", thumb: JPG, image: JPG, view: { camera: cam } });
  s.annotations.push(newAnnotation("pin", { anchor: { point: [1, 2, 3], guid: "g1", storey: "L2" }, text: "hi" }));
  s.annotations.push(newAnnotation("arrow", { anchor: { point: [0, 0, 0] }, target: { point: [1, 1, 1], guid: "g2" } }));
  s.annotations.push(newAnnotation("freehand", { anchor: { point: [0, 0, 0] }, path: [[0, 0, 0], [1, 0, 0], [1, 1, 0]] }));
  c.snapshots.push(s);
  return c;
}
const clone = (o) => JSON.parse(JSON.stringify(o));

test("factories build a valid case that survives validation unchanged", () => {
  const c = sample();
  const v = validateCase(clone(c));
  assert.ok(v.ok, v.errors.join());
  assert.deepEqual(v.warnings, []);
  assert.deepEqual(v.case, c);
});
test("factories: schema constant, ids, palette of 6", () => {
  const c = newCase();
  assert.equal(c.schema, "argus.case/1"); assert.equal(SCHEMA, c.schema);
  assert.ok(isId(c.id) && isId(newSnapshot().id) && isId(newAnnotation("pin").id));
  assert.equal(PALETTE.length, 6);
  assert.deepEqual([LIMITS.snapshotsPerCase, LIMITS.annotationsPerSnapshot, LIMITS.textChars, LIMITS.freehandPoints], [50, 100, 2000, 200]);
});
test("rejects non objects and arrays", () => {
  for (const bad of [null, undefined, 5, "x", [], true]) assert.equal(validateCase(bad).ok, false);
});
test("rejects other or missing schema strings with a clear message", () => {
  const a = validateCase({ ...clone(sample()), schema: "argus.case/2" });
  assert.equal(a.ok, false); assert.match(a.errors[0], /argus\.case\/2/); assert.match(a.errors[0], /argus\.case\/1/);
  assert.match(validateCase({ name: "x" }).errors[0], /none/);
  assert.equal(validateCase({ ...sample(), schema: 1 }).ok, false);
});
test("snapshots must be a list", () => {
  assert.equal(validateCase({ ...clone(sample()), snapshots: {} }).ok, false);
});
test("unknown fields are dropped at every level", () => {
  const base = sample(), raw = clone(base);
  raw.evil = 1; raw.model.x = 1; raw.meta.y = 2; raw.snapshots[0].z = 3; raw.snapshots[0].view.q = 4; raw.snapshots[0].annotations[0].w = 5; raw.snapshots[0].annotations[0].anchor.v = 6;
  const c = validateCase(raw).case;
  assert.deepEqual(c, base);
  assert.ok(!("evil" in c) && !("z" in c.snapshots[0]) && !("w" in c.snapshots[0].annotations[0]));
});
test("strings are trimmed and clamped, empty name falls back", () => {
  const raw = clone(sample());
  raw.name = "  " + "n".repeat(500) + "  "; raw.snapshots[0].note = "x".repeat(5000); raw.snapshots[0].title = "  T  ";
  const c = validateCase(raw).case;
  assert.equal(c.name.length, LIMITS.nameChars); assert.equal(c.snapshots[0].note.length, 2000); assert.equal(c.snapshots[0].title, "T");
  assert.equal(validateCase({ ...clone(sample()), name: "   " }).case.name, "Untitled case");
  assert.equal(validateCase({ ...clone(sample()), name: 42 }).case.name, "Untitled case");
});
test("annotation text over 2000 chars is cut with a warning", () => {
  const raw = clone(sample()); raw.snapshots[0].annotations[0].text = "a".repeat(2500);
  const v = validateCase(raw);
  assert.equal(v.case.snapshots[0].annotations[0].text.length, 2000);
  assert.ok(v.warnings.some((w) => /2000/.test(w)));
});
test("limit: 51 snapshots -> 50 kept + warning", () => {
  const raw = clone(sample());
  raw.snapshots = Array.from({ length: 51 }, () => clone(sample().snapshots[0]));
  const v = validateCase(raw);
  assert.equal(v.case.snapshots.length, 50); assert.ok(v.warnings.length);
});
test("limit: 101 annotations -> 100 kept", () => {
  const raw = clone(sample());
  raw.snapshots[0].annotations = Array.from({ length: 101 }, () => newAnnotation("pin", { anchor: { point: [0, 0, 0] } }));
  assert.equal(validateCase(raw).case.snapshots[0].annotations.length, 100);
});
test("limit: freehand cut to 200 points; fewer than 2 valid points drops it", () => {
  const raw = clone(sample());
  raw.snapshots[0].annotations = [newAnnotation("freehand", { path: Array.from({ length: 300 }, (_, i) => [i, 0, 0]) }), newAnnotation("freehand", { path: [[0, 0, 0]] })];
  const v = validateCase(raw);
  assert.equal(v.case.snapshots[0].annotations.length, 1);
  assert.equal(v.case.snapshots[0].annotations[0].path.length, 200);
});
test("NaN / Infinity / strings in vec3 are rejected, never stored", () => {
  const raw = clone(sample());
  raw.snapshots[0].annotations = [
    { ...newAnnotation("pin"), anchor: { point: [NaN, 0, 0] } },
    { ...newAnnotation("pin"), anchor: { point: [1, 2] } },
    { ...newAnnotation("pin"), anchor: { point: ["1", 2, 3] } },
    { ...newAnnotation("pin"), anchor: { point: [Infinity, 2, 3] } },
    newAnnotation("pin", { anchor: { point: [1, 2, 3] } }),
  ];
  const v = validateCase(JSON.parse(JSON.stringify(raw, (k, x) => (typeof x === "number" && !Number.isFinite(x) ? null : x))));
  assert.equal(v.case.snapshots[0].annotations.length, 1);
  // direct (non-JSON) object with real NaN too
  const direct = validateCase({ ...sample(), snapshots: [{ ...sample().snapshots[0], annotations: [{ ...newAnnotation("pin"), anchor: { point: [NaN, 0, 0] } }] }] });
  assert.equal(direct.case.snapshots[0].annotations.length, 0);
  assert.ok(direct.warnings.length);
});
test("coordinates are clamped to +-1e9", () => {
  const raw = clone(sample()); raw.snapshots[0].annotations[0].anchor.point = [1e12, -1e12, 5];
  assert.deepEqual(validateCase(raw).case.snapshots[0].annotations[0].anchor.point, [1e9, -1e9, 5]);
});
test("fov is clamped, bad camera becomes null", () => {
  const raw = clone(sample()); raw.snapshots[0].view.camera.fov = 900;
  assert.equal(validateCase(raw).case.snapshots[0].view.camera.fov, 179);
  raw.snapshots[0].view.camera.fov = "x";
  assert.equal(validateCase(raw).case.snapshots[0].view.camera.fov, 60);
  raw.snapshots[0].view.camera.quaternion = [0, 0, 1];
  assert.equal(validateCase(raw).case.snapshots[0].view.camera, null);
});
test("unknown annotation type and arrow without end are dropped with warnings", () => {
  const raw = clone(sample());
  raw.snapshots[0].annotations = [{ ...newAnnotation("pin"), type: "laser" }, { ...newAnnotation("arrow"), anchor: { point: [0, 0, 0] }, target: null }, "junk", null];
  const v = validateCase(raw);
  assert.equal(v.case.snapshots[0].annotations.length, 0); assert.equal(v.warnings.length, 4);
});
test("colour must be in the palette, case-insensitive, else first colour", () => {
  const raw = clone(sample());
  raw.snapshots[0].annotations[0].color = PALETTE[2].toUpperCase();
  raw.snapshots[0].annotations[1].color = "#123456";
  const a = validateCase(raw).case.snapshots[0].annotations;
  assert.equal(a[0].color, PALETTE[2]); assert.equal(a[1].color, PALETTE[0]);
});
test("freehand without anchor gets its first point; non-freehand loses a stray path", () => {
  const raw = clone(sample());
  delete raw.snapshots[0].annotations[2].anchor;
  raw.snapshots[0].annotations[0].path = [[1, 1, 1], [2, 2, 2]];
  const a = validateCase(raw).case.snapshots[0].annotations;
  assert.deepEqual(a[2].anchor.point, [0, 0, 0]); assert.equal(a[0].path, null);
});
test("images must be image data urls, otherwise null", () => {
  const raw = clone(sample()); raw.snapshots[0].thumb = "https://evil/x.png"; raw.snapshots[0].image = "data:text/html;base64,AA";
  const s = validateCase(raw).case.snapshots[0];
  assert.equal(s.thumb, null); assert.equal(s.image, null);
});
test("bad ids are regenerated, duplicate snapshot ids made unique", () => {
  const raw = clone(sample()); raw.id = "nope"; raw.snapshots.push(clone(raw.snapshots[0]));
  const c = validateCase(raw).case;
  assert.ok(isId(c.id)); assert.notEqual(c.snapshots[0].id, c.snapshots[1].id);
});
test("model fingerprint: bad sha/schema/size become null, sha lowercased", () => {
  const raw = clone(sample());
  raw.model = { name: "m", sha256: "ZZ", size: -5, ifcSchema: "ifc9", projectGuid: " ", lengthUnit: "" };
  assert.deepEqual(validateCase(raw).case.model, { name: "m", sha256: null, size: null, ifcSchema: null, projectGuid: null, lengthUnit: "m" });
  raw.model = { sha256: "A".repeat(64), ifcSchema: "ifc4" , size: 12.7 };
  const m = validateCase(raw).case.model;
  assert.equal(m.sha256, "a".repeat(64)); assert.equal(m.ifcSchema, "IFC4"); assert.equal(m.size, 12);
});
test("meta: status falls back to open, tags capped", () => {
  const raw = clone(sample()); raw.meta = { status: "weird", tags: Array.from({ length: 40 }, (_, i) => "t" + i), author: " Me " };
  const m = validateCase(raw).case.meta;
  assert.equal(m.status, "open"); assert.equal(m.tags.length, 20); assert.equal(m.author, "Me");
});
test("sections: capped, invalid dropped, preset checked", () => {
  const raw = clone(sample());
  raw.snapshots[0].view.sections = [{ normal: [0, 1, 0], constant: 2, preset: "plan" }, { normal: [0, 1], constant: 0 }, { normal: [1, 0, 0], constant: 1, enabled: false, flipped: true, preset: "zzz" }];
  const s = validateCase(raw).case.snapshots[0].view.sections;
  assert.equal(s.length, 2); assert.equal(s[0].preset, "plan"); assert.equal(s[1].enabled, false); assert.equal(s[1].preset, null); assert.equal(s[1].flipped, true);
});
test("validator does not mutate its input", () => {
  const raw = clone(sample()); raw.snapshots[0].note = "  pad  "; const before = JSON.stringify(raw);
  validateCase(raw); assert.equal(JSON.stringify(raw), before);
});
test("isolatedGuids: null stays null, array stays array", () => {
  const raw = clone(sample());
  assert.equal(validateCase(raw).case.snapshots[0].view.isolatedGuids, null);
  raw.snapshots[0].view.isolatedGuids = ["a", "", 5, "b"];
  assert.deepEqual(validateCase(raw).case.snapshots[0].view.isolatedGuids, ["a", "b"]);
});

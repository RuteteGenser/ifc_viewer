import test from "node:test";
import assert from "node:assert/strict";
import { slugify, buildCaseExport, exportCaseFile, importCaseFile, MAX_FILE_BYTES, IMAGE_DROP_BYTES, CaseFileError } from "../../src/cases/files.js";
import { newCase, newSnapshot, newAnnotation } from "../../src/cases/schema.js";
import { createCasesController } from "../../src/cases/useCases.js";
import { createStore } from "../../src/cases/store.js";

const b64 = (n) => "data:image/jpeg;base64," + "A".repeat(n);
function mk(imgLen = 100, snaps = 2) {
  const c = newCase({ name: "Brannkonsept 2. etasje æøå", model: { name: "a.ifc", size: 5, sha256: "c".repeat(64) } });
  for (let i = 0; i < snaps; i++) {
    const s = newSnapshot({ title: "Dør " + i, note: "Rør ÆØÅ", thumb: b64(10), image: b64(imgLen), view: { hiddenGuids: ["x"] } });
    s.annotations.push(newAnnotation("text", { anchor: { point: [1, 2, 3], guid: "g" }, text: "Hei på deg" }));
    c.snapshots.push(s);
  }
  return c;
}

test("slugify documented rule: æ->ae ø->o å->a, lowercase, dashes", () => {
  assert.equal(slugify("Brannkonsept 2. etasje æøå"), "brannkonsept-2-etasje-aeoa");
  assert.equal(slugify("ÆØÅ Ærlig"), "aeoa-aerlig");
});
test("slugify edge cases: accents, symbols, empty, long, non-string", () => {
  assert.equal(slugify("Café  Müller!!"), "cafe-muller");
  assert.equal(slugify("  --  "), "case"); assert.equal(slugify(""), "case"); assert.equal(slugify(null), "case"); assert.equal(slugify("日本"), "case");
  const long = slugify("a".repeat(100) + " b"); assert.ok(long.length <= 60 && !long.endsWith("-"));
});
test("export: JSON blob, application/json, slug.argus-case.json filename", () => {
  const e = buildCaseExport(mk());
  assert.equal(e.blob.type, "application/json"); assert.equal(e.filename, "brannkonsept-2-etasje-aeoa.argus-case.json"); assert.deepEqual(e.warnings, []);
  assert.ok(exportCaseFile(mk()) instanceof Blob);
});
test("round trip: export -> import equals the original case (incl. unicode and images)", async () => {
  const c = mk();
  const { case: back, warnings } = await importCaseFile(exportCaseFile(c));
  assert.deepEqual(back, c); assert.deepEqual(warnings, []);
});
test("round trip via text and File", async () => {
  const c = mk(); const text = await exportCaseFile(c).text();
  assert.deepEqual((await importCaseFile(text)).case, c);
  assert.deepEqual((await importCaseFile(new File([text], "x.argus-case.json"))).case, c);
});
test("export merges an images map over the case", async () => {
  const c = mk(); const sid = c.snapshots[0].id; c.snapshots[0].image = null;
  const back = (await importCaseFile(exportCaseFile(c, { [sid]: { image: b64(7) } }))).case;
  assert.equal(back.snapshots[0].image, b64(7));
});
test("id clash: imported as a new copy with a warning, no clash -> id kept", async () => {
  const c = mk(); const blob = exportCaseFile(c);
  const clash = await importCaseFile(blob, { existingIds: [c.id, "other"] });
  assert.notEqual(clash.case.id, c.id); assert.match(clash.warnings.join(), /already exists/);
  assert.equal(clash.case.snapshots.length, 2);
  assert.equal((await importCaseFile(blob, { existingIds: new Set(["other"]) })).case.id, c.id);
});
test("size cap: >25 MB file rejected before reading (File/Blob size and string)", async () => {
  const fake = { size: MAX_FILE_BYTES + 1, text: async () => { throw new Error("must not read"); } };
  await assert.rejects(importCaseFile(fake), (e) => e instanceof CaseFileError && /25 MB/.test(e.message));
  await assert.rejects(importCaseFile("x".repeat(MAX_FILE_BYTES + 1)), /25 MB/);
});
test("a file exactly at the cap is not rejected for size (fails later as invalid JSON)", async () => {
  await assert.rejects(importCaseFile({ size: MAX_FILE_BYTES, text: async () => "{" }), /not valid JSON/);
});
test("import drops full images over ~15 MB, keeps thumbs, warns", async () => {
  const c = mk(IMAGE_DROP_BYTES / 2 + 10, 2); // 2 x ~7.5MB
  const text = JSON.stringify(c);
  assert.ok(text.length > IMAGE_DROP_BYTES && text.length < MAX_FILE_BYTES);
  const { case: back, warnings } = await importCaseFile(text);
  assert.ok(back.snapshots.every((s) => s.image === null && s.thumb));
  assert.match(warnings.join(), /15 MB/);
});
test("export drops full images over ~15 MB with a warning; below it keeps them", () => {
  const big = buildCaseExport(mk(IMAGE_DROP_BYTES / 2 + 10, 2));
  assert.match(big.warnings.join(), /15 MB/); assert.ok(big.blob.size < IMAGE_DROP_BYTES);
  assert.deepEqual(buildCaseExport(mk(1000, 2)).warnings, []);
});
test("import errors: junk, wrong schema, no input", async () => {
  await assert.rejects(importCaseFile("not json"), /not valid JSON/);
  await assert.rejects(importCaseFile(JSON.stringify({ schema: "argus.case/9" })), (e) => e instanceof CaseFileError && e.errors.length === 1 && /argus\.case\/9/.test(e.message));
  await assert.rejects(importCaseFile(null), /No file/);
  await assert.rejects(importCaseFile("[]"), CaseFileError);
});
test("import normalises: warnings from validator are surfaced", async () => {
  const c = mk(); c.snapshots[0].annotations[0].type = "bogus";
  const r = await importCaseFile(JSON.stringify(c));
  assert.equal(r.case.snapshots[0].annotations.length, 0); assert.ok(r.warnings.length);
});

// --- controller (hook logic without React) ---
function mem() { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; }
const settle = () => new Promise((r) => setTimeout(r, 10));
test("controller: create/rename/duplicate/export/import/remove drive the list and current id", async () => {
  const store = createStore({ indexedDB: null }); const ss = mem();
  const ctl = createCasesController(store, { sessionStorage: ss });
  const off = ctl.subscribe(() => {}); await settle();
  assert.equal(ctl.getState().loading, false); assert.deepEqual(ctl.getState().cases, []);
  const c = await ctl.actions.create("  First  ", { name: "m.ifc" });
  await settle();
  assert.equal(ctl.getState().cases[0].name, "First"); assert.equal(ctl.getState().currentId, c.id); assert.equal(ss.getItem("argus.cases.current"), c.id);
  await ctl.actions.rename(c.id, "Renamed"); await settle();
  assert.equal(ctl.getState().cases[0].name, "Renamed");
  const copy = await ctl.actions.duplicate(c.id); await settle();
  assert.notEqual(copy.id, c.id); assert.equal(copy.name, "Renamed (copy)"); assert.equal(ctl.getState().cases.length, 2);
  const exp = await ctl.actions.exportCase(c.id); assert.equal(exp.filename, "renamed.argus-case.json");
  const imp = await ctl.actions.importFile(exp.blob); await settle();
  assert.equal(ctl.getState().cases.length, 3); assert.notEqual(imp.id, c.id); assert.match(imp.warnings[0], /already exists/);
  await ctl.actions.remove(c.id); await settle();
  assert.equal(ctl.getState().cases.length, 2); assert.equal(ctl.getState().currentId, null); assert.equal(ss.getItem("argus.cases.current"), null);
  off();
});
test("controller: stale current id from sessionStorage is cleared; errors surface in state", async () => {
  const store = createStore({ indexedDB: null }); const ss = mem(); ss.setItem("argus.cases.current", "GONE");
  const ctl = createCasesController(store, { sessionStorage: ss }); ctl.subscribe(() => {}); await settle();
  assert.equal(ctl.getState().currentId, null);
  await assert.rejects(ctl.actions.rename("nope", "x"), /not found/);
  assert.match(ctl.getState().error, /not found/);
});
test("controller: broken sessionStorage never throws; persistent reflects the store", async () => {
  const bad = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); }, removeItem() { throw new Error("no"); } };
  const ctl = createCasesController(createStore({ indexedDB: null }), { sessionStorage: bad }); ctl.subscribe(() => {}); await settle();
  await ctl.actions.create("x"); await settle(); assert.equal(ctl.getState().persistent, false); assert.equal(ctl.getState().cases.length, 1);
});

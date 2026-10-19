import test from "node:test";
import assert from "node:assert/strict";
import { sortModels, filterModels, applyOrganize, optionsFor, fold, formatOf, disciplineCodeOf, dirLabel, loadState, saveState, DEFAULTS, matchesQuery } from "../../src/library/organize.js";

const M = (id, o = {}) => ({ id, name: `${id}.ifc`, size: 1, uploadedAt: "2026-01-01T00:00:00Z", lastOpenedAt: null, schema: "IFC4", note: "", tags: "", ...o });
const ids = (l) => l.map((i) => i.id);
const lib = [
  M("b", { name: "Bygg B - arc.ifc", size: 300, uploadedAt: "2026-03-01T00:00:00Z", lastOpenedAt: "2026-05-01T00:00:00Z", schema: "IFC2X3", tags: "skole" }),
  M("a", { name: "Anlegg A MEP.ifc", size: 100, uploadedAt: "2026-01-01T00:00:00Z", schema: "IFC4X3", note: "Rør og vann" }),
  M("c", { name: "Åsen STR.ifc", size: 200, uploadedAt: "2026-02-01T00:00:00Z", lastOpenedAt: "2026-06-01T00:00:00Z", schema: "IFC4" }),
  M("d", { name: "ærlig plan.ifc", size: 200, uploadedAt: "2026-02-01T00:00:00Z", schema: "" }),
];

test("name sort: both directions, Norwegian letters after z", () => {
  const asc = sortModels(lib, "name", "asc").map((i) => i.name);
  assert.deepEqual(asc, [...asc].sort(new Intl.Collator("nb", { numeric: true, sensitivity: "base" }).compare));
  assert.deepEqual(ids(sortModels(lib, "name", "desc")), ids(sortModels(lib, "name", "asc")).reverse());
});
test("name sort is numeric aware and ignores case", () => {
  const l = [M("x", { name: "m10.ifc" }), M("y", { name: "M2.ifc" })];
  assert.deepEqual(ids(sortModels(l, "name", "asc")), ["y", "x"]);
});
test("added: asc and desc; ties keep the original order (stable)", () => {
  assert.deepEqual(ids(sortModels(lib, "added", "desc")), ["b", "c", "d", "a"]);
  assert.deepEqual(ids(sortModels(lib, "added", "asc")), ["a", "c", "d", "b"]);
});
test("size: asc and desc, stable on ties", () => {
  assert.deepEqual(ids(sortModels(lib, "size", "asc")), ["a", "c", "d", "b"]);
  assert.deepEqual(ids(sortModels(lib, "size", "desc")), ["b", "c", "d", "a"]);
});
test("opened: never-opened models go last in both directions", () => {
  assert.deepEqual(ids(sortModels(lib, "opened", "desc")), ["c", "b", "a", "d"]);
  assert.deepEqual(ids(sortModels(lib, "opened", "asc")), ["b", "c", "a", "d"]);
});
test("format: by schema, missing schema last, name is not used as tie break (stable)", () => {
  assert.deepEqual(ids(sortModels(lib, "format", "asc")), ["b", "c", "a", "d"]);
  assert.deepEqual(ids(sortModels(lib, "format", "desc")), ["a", "c", "b", "d"]);
});
test("direction defaults per key and the input is not mutated", () => {
  const copy = [...lib];
  assert.deepEqual(ids(sortModels(lib, "added")), ["b", "c", "d", "a"]);
  assert.deepEqual(ids(sortModels(lib, "name")).slice(0, 1), ["a"]);
  assert.deepEqual(lib, copy);
});
test("missing and odd fields do not throw", () => {
  const odd = [{ id: 1 }, { id: 2, size: "x", uploadedAt: "nope" }, null && {}, { id: 3, size: 5 }].filter(Boolean);
  for (const k of ["name", "added", "opened", "size", "format"]) for (const d of ["asc", "desc"]) assert.equal(sortModels(odd, k, d).length, odd.length);
  assert.deepEqual(ids(sortModels(odd, "size", "asc")), [3, 1, 2]);
  assert.equal(filterModels(odd, { ...DEFAULTS, query: "x" }).length, 0);
});

test("fold: case, accents and Norwegian letters", () => {
  assert.equal(fold("ÅSEN Rør Ærlig Øst é"), "asen ror aerlig ost e");
});
test("search: name, note, tags; case and diacritics insensitive", () => {
  const f = (q) => ids(filterModels(lib, { ...DEFAULTS, query: q }));
  assert.deepEqual(f("anlegg"), ["a"]);
  assert.deepEqual(f("ASEN"), ["c"]);
  assert.deepEqual(f("åsen"), ["c"]);
  assert.deepEqual(f("aerlig"), ["d"]);
  assert.deepEqual(f("ror vann"), ["a"]); // note, words in any order
  assert.deepEqual(f("SKOLE"), ["b"]); // tags
  assert.deepEqual(f("  "), ["b", "a", "c", "d"]);
  assert.deepEqual(f("zzz"), []);
});
test("format filter: any of the chosen", () => {
  assert.deepEqual(ids(filterModels(lib, { ...DEFAULTS, formats: ["IFC4"] })), ["c"]);
  assert.deepEqual(ids(filterModels(lib, { ...DEFAULTS, formats: ["IFC4", "IFC2X3"] })), ["b", "c"]);
});
test("discipline filter and extraction", () => {
  assert.deepEqual(lib.map(disciplineCodeOf), ["ARC", "MEP", "STR", ""]);
  assert.deepEqual(ids(filterModels(lib, { ...DEFAULTS, disciplines: ["MEP", "STR"] })), ["a", "c"]);
  assert.equal(formatOf({ schema: " ifc4 " }), "IFC4");
});
test("open now uses the loaded names", () => {
  assert.deepEqual(ids(filterModels(lib, { ...DEFAULTS, openNow: true }, new Set(["Åsen STR.ifc"]))), ["c"]);
  assert.deepEqual(filterModels(lib, { ...DEFAULTS, openNow: true }, new Set()), []);
});
test("combined filters use AND between groups", () => {
  const s = { ...DEFAULTS, formats: ["IFC4", "IFC4X3"], disciplines: ["MEP"], query: "anlegg" };
  assert.deepEqual(ids(filterModels(lib, s)), ["a"]);
  assert.deepEqual(filterModels(lib, { ...s, formats: ["IFC2X3"] }), []);
});
test("optionsFor lists only what is present, in a fixed order", () => {
  assert.deepEqual(optionsFor(lib), { formats: ["IFC2X3", "IFC4", "IFC4X3"], disciplines: ["ARC", "MEP", "STR"] });
  assert.deepEqual(optionsFor([M("z", { name: "plain.ifc" })]), { formats: ["IFC4"], disciplines: [] });
  assert.deepEqual(optionsFor([]), { formats: [], disciplines: [] });
});
test("applyOrganize: sorts, counts, empties; stale chips are ignored", () => {
  const r = applyOrganize({ own: lib, state: { ...DEFAULTS, sort: "size", dir: "asc" } });
  assert.deepEqual(ids(r.own), ["a", "c", "d", "b"]);
  assert.equal(r.total, 4);
  assert.equal(r.count, 4);
  assert.equal(r.filtering, false);
  const stale = applyOrganize({ own: lib, state: { ...DEFAULTS, formats: ["IFC9"] } });
  assert.equal(stale.count, 4);
  const none = applyOrganize({ own: lib, state: { ...DEFAULTS, query: "nothing" } });
  assert.equal(none.count, 0);
  assert.equal(none.filtering, true);
  assert.equal(applyOrganize({ own: [] }).total, 0);
});
test("samples are not hidden by chips, only by a search that does not match", () => {
  const samples = [M("s1", { name: "Duplex MEP.ifc", owner: "samples", schema: "IFC2X3" })];
  const chips = applyOrganize({ own: lib, samples, state: { ...DEFAULTS, formats: ["IFC4"], openNow: true } });
  assert.equal(chips.samples.length, 1);
  assert.equal(chips.builtIn, true);
  const q = applyOrganize({ own: lib, samples, state: { ...DEFAULTS, query: "duplex" } });
  assert.equal(q.samples.length, 1);
  assert.equal(q.builtIn, false);
  assert.equal(applyOrganize({ own: lib, samples, state: { ...DEFAULTS, query: "sample building" } }).builtIn, true);
  assert.equal(applyOrganize({ own: lib, samples, state: { ...DEFAULTS, query: "åsen" } }).samples.length, 0);
});
test("labels", () => {
  assert.equal(dirLabel("added", "desc"), "Newest first");
  assert.equal(dirLabel("size", "asc"), "Smallest first");
  assert.equal(dirLabel("name", "desc"), "Z to A");
  assert.equal(matchesQuery(lib[0], ""), true);
});
test("remembered choice: round trip, junk, and blocked storage", () => {
  const mem = new Map();
  const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  saveState({ ...DEFAULTS, query: "not saved", sort: "size", dir: "asc", formats: ["IFC4"], disciplines: ["ARC"], openNow: true }, st);
  assert.deepEqual(loadState(st), { ...DEFAULTS, sort: "size", dir: "asc", formats: ["IFC4"], disciplines: ["ARC"], openNow: true });
  mem.set("argus.library.organize", "{bad");
  assert.deepEqual(loadState(st), DEFAULTS);
  mem.set("argus.library.organize", JSON.stringify({ sort: "nope", dir: 3, formats: "x" }));
  assert.deepEqual(loadState(st), DEFAULTS);
  const boom = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.deepEqual(loadState(boom), DEFAULTS);
  assert.doesNotThrow(() => saveState(DEFAULTS, boom));
});

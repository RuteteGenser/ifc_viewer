import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCasePdf } from "../../src/cases/pdf.js";
import { checkStructure } from "./helpers/pdfcheck.mjs";

const fx = JSON.parse(readFileSync(new URL("../fixtures/jpegs.json", import.meta.url), "utf8"));
const IMG = "data:image/jpeg;base64," + fx.scene;
const ann = (i, o = {}) => ({ id: "a" + i, type: ["comment", "pin", "arrow", "text", "freehand"][i % 5], color: "#d9480f", text: `Merknad ${i}: kontroller branndør`, author: "Kari", createdAt: "2026-10-19T12:30:00.000Z", anchor: { point: [0, 0, 0], guid: null, storey: i % 2 ? "Etasje 2" : null }, target: null, path: null, ...o });
const snap = (i, n = 3, o = {}) => ({ id: "s" + i, title: `Snapshot ${i}`, note: "", createdAt: "2026-10-19T12:00:00.000Z", thumb: null, image: IMG, annotations: Array.from({ length: n }, (_, k) => ann(k)), ...o });
const mkCase = (snapshots, o = {}) => ({ schema: "argus.case/1", id: "c1", name: "Fire doors level 2", createdAt: "2026-10-19T12:00:00.000Z", updatedAt: "2026-10-19T12:00:00.000Z", model: { name: "AC20-FZK-Haus.ifc", ifcSchema: "IFC4" }, snapshots, meta: { author: "Kari" }, ...o });
const NOW = new Date(Date.UTC(2026, 9, 19));
const tool = (cmd) => spawnSync("which", [cmd]).status === 0;
function tmpPdf(bytes) { const f = join(mkdtempSync(join(tmpdir(), "casespdf-")), "t.pdf"); writeFileSync(f, bytes); return f; }
const textOf = (bytes) => spawnSync("pdftotext", ["-layout", tmpPdf(bytes), "-"], { encoding: "utf8" }).stdout;

test("single snapshot: one page, no cover", () => {
  assert.equal(checkStructure(buildCasePdf(mkCase([snap(1)]), { now: NOW })).pages, 1);
});
test("two snapshots: cover + 2 pages; includeCover:false drops the cover", () => {
  const c = mkCase([snap(1), snap(2)]);
  assert.equal(checkStructure(buildCasePdf(c, { now: NOW })).pages, 3);
  assert.equal(checkStructure(buildCasePdf(c, { now: NOW, includeCover: false })).pages, 2);
});
test("12 snapshots: cover + 12 pages, contents lists page numbers", { skip: !tool("pdftotext") && "pdftotext not installed" }, () => {
  const bytes = buildCasePdf(mkCase(Array.from({ length: 12 }, (_, i) => snap(i + 1))), { now: NOW });
  assert.equal(checkStructure(bytes).pages, 13);
  const t = textOf(bytes);
  assert.match(t, /12\.\s+Snapshot 12\s+13/);
  assert.match(t, /Page 13 of 13/);
});
test("50 snapshots: contents flows onto a second cover page, numbers still point at the right pages", { skip: !tool("pdftotext") && "pdftotext not installed" }, () => {
  const bytes = buildCasePdf(mkCase(Array.from({ length: 50 }, (_, i) => snap(i + 1, 0, { image: null }))), { now: NOW });
  const { pages } = checkStructure(bytes);
  assert.equal(pages, 52);
  assert.match(textOf(bytes), /50\.\s+Snapshot 50\s+52/);
});
test("long annotation list overflows onto continuation pages that repeat the header", { skip: !tool("pdftotext") && "pdftotext not installed" }, () => {
  const c = mkCase([snap(1, 40, { note: "Slutt-notat. ".repeat(20) })]);
  const bytes = buildCasePdf(c, { now: NOW });
  const { pages } = checkStructure(bytes);
  assert.ok(pages >= 3 && pages <= 6, "pages " + pages);
  const t = textOf(bytes);
  assert.equal((t.match(/Fire doors level 2/g) || []).length, pages);
  assert.match(t, /Snapshot 1 \(continued\)/);
  assert.match(t, new RegExp(`Page ${pages} of ${pages}`));
  assert.match(t, /Merknad 39/);
  assert.match(t, /Slutt-notat/);
});
test("a single huge annotation text still produces a valid document", () => {
  const c = mkCase([snap(1, 0, { annotations: [ann(0, { text: "ord ".repeat(500) })] })]);
  assert.ok(checkStructure(buildCasePdf(c, { now: NOW })).pages >= 1);
});
test("bad or missing images do not abort the export; thumb is the fallback", () => {
  const c = mkCase([snap(1, 1, { image: "data:image/png;base64,iVBORw0KGgo=", thumb: IMG }), snap(2, 1, { image: null, thumb: null }), snap(3, 1, { image: "garbage" })]);
  const { text } = checkStructure(buildCasePdf(c, { now: NOW }));
  assert.equal((text.match(/\/Subtype \/Image/g) || []).length, 1);
});
test("empty case and Letter size", () => {
  assert.equal(checkStructure(buildCasePdf(mkCase([]), { now: NOW })).pages, 1);
  assert.match(checkStructure(buildCasePdf(mkCase([snap(1)]), { now: NOW, pageSize: "Letter" })).text, /\[0 0 612 792\]/);
});
test("Norwegian round trip: labels and æøå survive text extraction", { skip: !tool("pdftotext") && "pdftotext not installed, round trip not run" }, () => {
  const c = mkCase([snap(1, 5, { title: "Brannkonsept æøå ÆØÅ", note: "Notat: vi må sjekke røykventilasjon på tvers av etasjer – ferdig." }), snap(2)], { name: "Brannkonsept" });
  const t = textOf(buildCasePdf(c, { now: NOW, locale: "nb" }));
  for (const s of ["Brannkonsept", "æøå ÆØÅ", "Kommentar", "Merke", "Pil", "Tekst", "Frihånd", "Side 1 av 3", "Modell", "Etasje: Etasje 2", "Notat", "røykventilasjon på tvers", "–"]) assert.ok(t.includes(s), "missing: " + s + "\n" + t.slice(0, 600));
  const en = textOf(buildCasePdf(c, { now: NOW }));
  for (const s of ["Comment", "Pin", "Arrow", "Freehand", "Page 2 of 3", "Storey: Etasje 2"]) assert.ok(en.includes(s), "missing: " + s);
  assert.ok(!/[—]/.test(en.replace(/Brannkonsept[^\n]*/g, "")), "no em dash in generated strings");
});
test("external validators accept the output (pdfinfo / qpdf / mutool when installed)", (t) => {
  const f = tmpPdf(buildCasePdf(mkCase([snap(1), snap(2, 40)]), { now: NOW }));
  let ran = 0;
  for (const [cmd, args] of [["pdfinfo", [f]], ["qpdf", ["--check", f]], ["mutool", ["info", f]]]) {
    if (!tool(cmd)) continue;
    ran++;
    const r = spawnSync(cmd, args, { encoding: "utf8" });
    assert.equal(r.status, 0, cmd + ": " + r.stderr);
    assert.ok(!/error|warning/i.test(r.stderr), cmd + " stderr: " + r.stderr);
  }
  if (!ran) t.skip("no pdfinfo, qpdf or mutool installed");
});

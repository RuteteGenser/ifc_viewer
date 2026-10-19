import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { buildBcf, parseBcf, toGuid, quatToDirUp, parseXml, setIdFactory } from "../../src/cases/bcf.js";

setIdFactory(null);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 250, 251, 252, 0xff, 0xd9]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 4]);
const jpgUrl = "data:image/jpeg;base64," + JPG.toString("base64");
const pngUrl = "data:image/png;base64," + PNG.toString("base64");
const S = Math.SQRT1_2;
const IDS = ["01J9ZZZZZZZZZZZZZZZZZZZZ01", "01J9ZZZZZZZZZZZZZZZZZZZZ02", "01J9ZZZZZZZZZZZZZZZZZZZZ03", "01J9ZZZZZZZZZZZZZZZZZZZZ04", "01J9ZZZZZZZZZZZZZZZZZZZZ05", "01J9ZZZZZZZZZZZZZZZZZZZZ06"];
const ann = (id, o) => ({ id, type: "comment", color: "#d9480f", text: "x", author: "Hanna", createdAt: "2026-10-19T12:05:00.000Z", anchor: { point: [1, 2, 3], guid: null, storey: null }, target: null, path: null, ...o });
const mkSnap = (id, o = {}) => ({
  id, title: "Door D12", note: "Brannklasse EI30 mangler på dør i 2. etasje", createdAt: "2026-10-19T12:01:00.000Z", thumb: null, image: jpgUrl,
  view: { camera: { position: [4.5, 1.7, -8.25], quaternion: [0, S, 0, S], fov: 55, target: [0, 0, 0], flat: false },
    modelPose: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    sections: [{ normal: [0, 1, 0], constant: -2.5, enabled: true, flipped: false, preset: "plan" }],
    hiddenGuids: ["1abcDEF$ghijklmnop001", "2abcDEF$ghijklmnop002"], isolatedGuids: null, hiddenCategories: ["IFCSPACE"], storey: "Level 2" },
  annotations: [ann(IDS[3], { text: "Sjekk dør & vegg <EI30> «ok»", anchor: { point: [1, 2, 3], guid: "3abcDEF$ghijklmnop003", storey: "Level 2" } })], ...o });
const mkCase = (o = {}) => ({ schema: "argus.case/1", id: IDS[0], name: "Branndører nivå 2", createdAt: "2026-10-19T12:00:00.000Z", updatedAt: "2026-10-19T13:00:00.000Z",
  model: { name: "AC20-FZK-Haus.ifc", sha256: null, size: 1, ifcSchema: "IFC4", projectGuid: "0YvctVUKr0kugbFTf53O9L", lengthUnit: "m" },
  snapshots: [mkSnap(IDS[1]), mkSnap(IDS[2], { title: "Vindu", note: "", image: pngUrl, annotations: [] })], meta: { author: "Hanna Tronsen", status: "open", tags: [] }, ...o });
const near = (a, b, e = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= e);
const files = (z) => unzipSync(z);
const xml = (z, p) => parseXml(strFromU8(files(z)[p]));

test("zip layout: bcf.version, project and a GUID folder per snapshot", () => {
  const f = files(buildBcf(mkCase())); const g = toGuid(IDS[1]);
  for (const p of ["bcf.version", "project.bcfp", `${g}/markup.bcf`, `${g}/viewpoint.bcfv`, `${g}/snapshot.jpg`, `${toGuid(IDS[2])}/snapshot.png`]) assert.ok(f[p], p);
  const v = parseXml(strFromU8(f["bcf.version"]));
  assert.equal(v.attrs.VersionId, "2.1"); assert.equal(v.kids[0].text, "2.1");
});
test("markup references the viewpoint and snapshot files that exist", () => {
  const z = buildBcf(mkCase()); const g = toGuid(IDS[1]);
  const m = xml(z, `${g}/markup.bcf`); const vp = m.kids.find((k) => k.name === "Viewpoints");
  assert.equal(vp.kids[0].text, "viewpoint.bcfv"); assert.equal(vp.kids[1].text, "snapshot.jpg");
  const cm = m.kids.find((k) => k.name === "Comment");
  assert.equal(cm.kids.find((k) => k.name === "Viewpoint").attrs.Guid, vp.attrs.Guid);
  assert.equal(m.kids.find((k) => k.name === "Topic").attrs.Guid, g);
});
test("header carries model filename and IfcProject guid", () => {
  const m = xml(buildBcf(mkCase()), `${toGuid(IDS[1])}/markup.bcf`);
  const file = m.kids[0].kids[0];
  assert.equal(file.attrs.IfcProject, "0YvctVUKr0kugbFTf53O9L"); assert.equal(file.kids[0].text, "AC20-FZK-Haus.ifc");
});
test("round trip: case, titles, notes, authors, status, model", () => {
  const { case: c, warnings } = parseBcf(buildBcf(mkCase()));
  assert.deepEqual(warnings, []);
  assert.equal(c.schema, "argus.case/1"); assert.equal(c.id, IDS[0]); assert.equal(c.name, "Branndører nivå 2");
  assert.deepEqual(c.snapshots.map((s) => [s.id, s.title, s.note]), [[IDS[1], "Door D12", "Brannklasse EI30 mangler på dør i 2. etasje"], [IDS[2], "Vindu", ""]]);
  assert.equal(c.model.name, "AC20-FZK-Haus.ifc"); assert.equal(c.model.projectGuid, "0YvctVUKr0kugbFTf53O9L");
  assert.equal(c.meta.author, "Hanna Tronsen"); assert.equal(c.meta.status, "open");
});
test("round trip: resolved status", () => {
  assert.equal(parseBcf(buildBcf(mkCase({ meta: { author: "A", status: "resolved", tags: [] } }))).case.meta.status, "resolved");
});
test("round trip: comment text with escapes, author, date, guid and id", () => {
  const a = parseBcf(buildBcf(mkCase())).case.snapshots[0].annotations;
  assert.equal(a.length, 1);
  assert.equal(a[0].text, "Sjekk dør & vegg <EI30> «ok»"); assert.equal(a[0].author, "Hanna");
  assert.equal(a[0].createdAt, "2026-10-19T12:05:00.000Z"); assert.equal(a[0].id, IDS[3]);
  assert.equal(a[0].type, "comment"); assert.equal(a[0].anchor.guid, "3abcDEF$ghijklmnop003");
});
test("round trip: camera position, quaternion and fov within 1e-6", () => {
  const cam = parseBcf(buildBcf(mkCase())).case.snapshots[0].view.camera;
  assert.ok(near(cam.position, [4.5, 1.7, -8.25])); assert.ok(near(cam.quaternion, [0, S, 0, S])); assert.equal(cam.fov, 55);
});
test("round trip: arbitrary camera orientations", () => {
  let s = 5; const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 20; i++) {
    let q = [r() - .5, r() - .5, r() - .5, r() - .5]; const l = Math.hypot(...q); q = q.map((v) => v / l); if (q[3] < 0) q = q.map((v) => -v);
    const c = mkCase(); c.snapshots = [mkSnap(IDS[1])]; c.snapshots[0].view.camera.quaternion = q; c.snapshots[0].view.camera.position = [r() * 100, r() * 100, r() * 100];
    const cam = parseBcf(buildBcf(c)).case.snapshots[0].view.camera;
    assert.ok(near(cam.quaternion, q), `case ${i}`); assert.ok(near(cam.position, c.snapshots[0].view.camera.position));
  }
});
test("viewpoint stores the camera in BCF axes (Z up)", () => {
  const vi = xml(buildBcf(mkCase()), `${toGuid(IDS[1])}/viewpoint.bcfv`);
  const pc = vi.kids.find((k) => k.name === "PerspectiveCamera"); const v = (n) => pc.kids.find((k) => k.name === n).kids.map((k) => +k.text);
  assert.deepEqual(v("CameraViewPoint"), [4.5, 8.25, 1.7]);
  const dir = v("CameraDirection"), up = v("CameraUpVector");
  assert.ok(near(dir, [-1, 0, 0], 1e-12)); assert.ok(near(up, [0, 0, 1], 1e-12));
  assert.equal(+pc.kids.find((k) => k.name === "FieldOfView").text, 55);
});
test("round trip: sections", () => {
  const sec = parseBcf(buildBcf(mkCase())).case.snapshots[0].view.sections;
  assert.equal(sec.length, 1); assert.ok(near(sec[0].normal, [0, 1, 0])); assert.ok(Math.abs(sec[0].constant + 2.5) < 1e-9); assert.equal(sec[0].enabled, true);
});
test("sections: non-unit and tilted normals are normalised, disabled ones skipped", () => {
  const c = mkCase(); c.snapshots = [mkSnap(IDS[1])];
  c.snapshots[0].view.sections = [{ normal: [2, 0, 0], constant: 4, enabled: true }, { normal: [0, 0, 1], constant: 1, enabled: false }];
  const sec = parseBcf(buildBcf(c)).case.snapshots[0].view.sections;
  assert.equal(sec.length, 1); assert.ok(near(sec[0].normal, [1, 0, 0])); assert.ok(Math.abs(sec[0].constant - 2) < 1e-9);
});
test("round trip: hidden guid set and view-setup hints", () => {
  const v = parseBcf(buildBcf(mkCase())).case.snapshots[0].view;
  assert.deepEqual(v.hiddenGuids, ["1abcDEF$ghijklmnop001", "2abcDEF$ghijklmnop002"]); assert.equal(v.isolatedGuids, null); assert.deepEqual(v.hiddenCategories, ["IFCSPACE"]);
});
test("isolate => DefaultVisibility false with the isolated guids as exceptions, and back", () => {
  const c = mkCase(); c.snapshots = [mkSnap(IDS[1])]; c.snapshots[0].view.isolatedGuids = ["iso1", "iso2"];
  const vi = xml(buildBcf(c), `${toGuid(IDS[1])}/viewpoint.bcfv`);
  const vis = vi.kids[0].kids.find((k) => k.name === "Visibility");
  assert.equal(vis.attrs.DefaultVisibility, "false"); assert.deepEqual(vis.kids[0].kids.map((k) => k.attrs.IfcGuid), ["iso1", "iso2"]);
  const v = parseBcf(buildBcf(c)).case.snapshots[0].view;
  assert.deepEqual(v.isolatedGuids, ["iso1", "iso2"]); assert.deepEqual(v.hiddenGuids, []);
});
test("selection lists the annotation anchor guids", () => {
  const vi = xml(buildBcf(mkCase()), `${toGuid(IDS[1])}/viewpoint.bcfv`);
  const sel = vi.kids[0].kids.find((k) => k.name === "Selection");
  assert.deepEqual(sel.kids.map((k) => k.attrs.IfcGuid), ["3abcDEF$ghijklmnop003"]);
});
test("round trip: images byte-equal (jpeg and png)", () => {
  const c = parseBcf(buildBcf(mkCase())).case;
  assert.equal(c.snapshots[0].image, jpgUrl); assert.equal(c.snapshots[1].image, pngUrl);
  const f = files(buildBcf(mkCase()));
  assert.deepEqual(Buffer.from(f[`${toGuid(IDS[1])}/snapshot.jpg`]), JPG);
});
test("no image: no Snapshot element, import gives image null; thumb is used when image is missing", () => {
  const c = mkCase(); c.snapshots = [mkSnap(IDS[1], { image: null }), mkSnap(IDS[2], { image: null, thumb: pngUrl })];
  const r = parseBcf(buildBcf(c)).case;
  assert.equal(r.snapshots[0].image, null); assert.equal(r.snapshots[1].image, pngUrl);
});
test("arrow and freehand become descriptive comments, nothing is dropped", () => {
  const c = mkCase(); c.snapshots = [mkSnap(IDS[1], { annotations: [
    ann(IDS[3], { type: "arrow", text: "", anchor: { point: [0, 0, 0], guid: "gA", storey: "Level 1" }, target: { point: [1, 1, 1], guid: null } }),
    ann(IDS[4], { type: "freehand", text: "", anchor: { point: [0, 0, 0], guid: "gB", storey: null }, path: [[0, 0, 0]] }),
    ann(IDS[5], { type: "pin", text: "" })] })];
  const a = parseBcf(buildBcf(c)).case.snapshots[0].annotations;
  assert.deepEqual(a.map((x) => x.text), ["Arrow annotation near Level 1", "Freehand annotation near gB", "Pin"]);
});
test("untitled snapshot gets 'case name + index'", () => {
  const c = mkCase(); c.snapshots = [mkSnap(IDS[1], { title: "" }), mkSnap(IDS[2], { title: "" })];
  assert.deepEqual(parseBcf(buildBcf(c)).case.snapshots.map((s) => s.title), ["Branndører nivå 2 1", "Branndører nivå 2 2"]);
});
test("anchor point of imported comments is 3 m in front of the camera (three space)", () => {
  const c = parseBcf(buildBcf(mkCase())).case; const cam = c.snapshots[0].view.camera;
  const { dir } = quatToDirUp(cam.quaternion);
  assert.ok(near(c.snapshots[0].annotations[0].anchor.point, cam.position.map((p, i) => p + 3 * dir[i])));
});
test("non-ULID ids still export; import maps them to a stable ULID that matches the exported guid", () => {
  const c = mkCase({ id: "case-1" }); c.snapshots = [mkSnap("snap-1")];
  const r = parseBcf(buildBcf(c)).case;
  assert.match(r.snapshots[0].id, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/); assert.equal(toGuid(r.snapshots[0].id), toGuid("snap-1"));
});
test("empty case exports and re-imports with a warning", () => {
  const r = parseBcf(buildBcf(mkCase({ snapshots: [] })));
  assert.equal(r.case.snapshots.length, 0); assert.ok(r.warnings.some((w) => /No topics/.test(w)));
});
test("large case: 50 snapshots x 20 comments within the time budget", () => {
  const c = mkCase(); const big = "data:image/jpeg;base64," + Buffer.alloc(60000, 7).toString("base64");
  c.snapshots = Array.from({ length: 50 }, (_, i) => mkSnap(IDS[1].slice(0, 20) + String(i).padStart(6, "0"), { image: big,
    annotations: Array.from({ length: 20 }, (_, j) => ann(IDS[1].slice(0, 20) + String(1000 + i * 20 + j).padStart(6, "0"), { text: `n${j}` })) }));
  const t0 = performance.now(); const z = buildBcf(c); const r = parseBcf(z); const dt = performance.now() - t0;
  assert.equal(r.case.snapshots.length, 50); assert.equal(r.case.snapshots[49].annotations.length, 20); assert.equal(r.case.snapshots[49].image, big);
  assert.ok(dt < 5000, `took ${dt} ms`);
});

import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { parseBcf, quatToDirUp, setIdFactory } from "../../src/cases/bcf.js";

setIdFactory(null);
const T1 = "11111111-aaaa-4bbb-8ccc-000000000001", T2 = "22222222-aaaa-4bbb-8ccc-000000000002";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);
const markup = (guid, title, status, comments, extra = "") => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Header><File IfcProject="2gA3vXGd1Cd8aL90EkQ4Ks" IfcSpatialStructureElement="" isExternal="false"><Filename>Bygg A.ifc</Filename><Date>2024-01-01T10:00:00Z</Date><Reference>c:/x/Bygg A.ifc</Reference></File></Header>
  <Topic Guid="${guid}" TopicType="Error" TopicStatus="${status}">
    <Title>${title}</Title><Priority>High</Priority><Index>1</Index>
    <CreationDate>2024-01-02T09:30:00+01:00</CreationDate><CreationAuthor>per@firma.no</CreationAuthor>
    <ModifiedDate>2024-01-03T09:30:00+01:00</ModifiedDate><AssignedTo>kari@firma.no</AssignedTo>
    <Description>Kollisjon mellom r&#248;r og drager</Description>${extra}
  </Topic>
  ${comments}
  <Viewpoints Guid="vp-${guid}"><Viewpoint>Viewpoint_1.bcfv</Viewpoint><Snapshot>Snapshot_1.png</Snapshot><Index>0</Index></Viewpoints>
</Markup>`;
const comment = (g, who, text) => `<Comment Guid="${g}"><VerbalStatus/><Status>Unknown</Status><Date>2024-01-02T10:00:00+01:00</Date><Author>${who}</Author><Comment>${text}</Comment><Viewpoint Guid="vp-x"/></Comment>`;
const vpFile = `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="vp-1" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Components>
    <ViewSetupHints SpacesVisible="false" SpaceBoundariesVisible="false" OpeningsVisible="true"/>
    <Selection><Component IfcGuid="0abcDEF1234567890abcde"/><Component IfcGuid="1abcDEF1234567890abcde"/></Selection>
    <Visibility DefaultVisibility="true"><Exceptions><Component IfcGuid="hid1"><OriginatingSystem>Revit</OriginatingSystem></Component><Component IfcGuid="hid2"/></Exceptions></Visibility>
  </Components>
  <PerspectiveCamera>
    <CameraViewPoint><X>10</X><Y>20</Y><Z>1.5</Z></CameraViewPoint>
    <CameraDirection><X>0</X><Y>1</Y><Z>0</Z></CameraDirection>
    <CameraUpVector><X>0</X><Y>0</Y><Z>1</Z></CameraUpVector>
    <FieldOfView>45</FieldOfView>
  </PerspectiveCamera>
  <ClippingPlanes>
    <ClippingPlane><Location><X>0</X><Y>0</Y><Z>3</Z></Location><Direction><X>0</X><Y>0</Y><Z>1</Z></Direction></ClippingPlane>
    <ClippingPlane><Location><X>5</X><Y>0</Y><Z>0</Z></Location></ClippingPlane>
  </ClippingPlanes>
</VisualizationInfo>`;
function realZip(over = {}) {
  return zipSync({
    "bcf.version": strToU8('<?xml version="1.0" encoding="utf-8"?><Version VersionId="2.1" xsi:noNamespaceSchemaLocation="version.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><DetailedVersion>2.1</DetailedVersion></Version>'),
    [`${T1}/markup.bcf`]: strToU8(markup(T1, "Kollisjon r&#248;r &amp; drager", "Open", comment("c1", "per@firma.no", "Se &lt;her&gt; &amp; flytt") + comment("c2", "kari@firma.no", "Enig, fikser i morgen"))),
    [`${T1}/Viewpoint_1.bcfv`]: strToU8(vpFile), [`${T1}/Snapshot_1.png`]: PNG,
    [`${T2}/markup.bcf`]: strToU8(markup(T2, "Andre sak", "Closed", "")),
    [`${T2}/Viewpoint_1.bcfv`]: strToU8(vpFile), [`${T2}/Snapshot_1.png`]: PNG,
    "extras/readme.txt": strToU8("hi"), ...over });
}
const near = (a, b, e = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) <= e);

test("real-world style 2.1: topics, titles, descriptions, comments", () => {
  const { case: c, warnings } = parseBcf(realZip());
  assert.equal(c.snapshots.length, 2);
  const s = c.snapshots.find((x) => x.title.startsWith("Kollisjon"));
  assert.equal(s.title, "Kollisjon rør & drager"); assert.equal(s.note, "Kollisjon mellom rør og drager");
  assert.deepEqual(s.annotations.map((a) => [a.text, a.author, a.type]), [["Se <her> & flytt", "per@firma.no", "comment"], ["Enig, fikser i morgen", "kari@firma.no", "comment"]]);
  assert.equal(s.annotations[0].createdAt, "2024-01-02T10:00:00+01:00");
  assert.ok(warnings.some((w) => /extras\/readme\.txt/.test(w)), "unknown part reported");
});
test("real-world: model, author, case status (mixed => open), dates", () => {
  const { case: c } = parseBcf(realZip());
  assert.equal(c.model.name, "Bygg A.ifc"); assert.equal(c.model.projectGuid, "2gA3vXGd1Cd8aL90EkQ4Ks");
  assert.equal(c.meta.author, "per@firma.no"); assert.equal(c.meta.status, "open"); assert.equal(c.name, "Bygg A.ifc");
});
test("all topics closed => resolved", () => {
  const z = zipSync({ [`${T1}/markup.bcf`]: strToU8(markup(T1, "A", "Closed", "")), [`${T1}/Viewpoint_1.bcfv`]: strToU8(vpFile) });
  assert.equal(parseBcf(z).case.meta.status, "resolved");
});
test("real-world: camera converted from Z-up to Y-up", () => {
  const cam = parseBcf(realZip()).case.snapshots[0].view.camera;
  assert.ok(near(cam.position, [10, 1.5, -20])); assert.equal(cam.fov, 45);
  const { dir, up } = quatToDirUp(cam.quaternion);
  assert.ok(near(dir, [0, 0, -1])); assert.ok(near(up, [0, 1, 0]));
});
test("real-world: clipping plane converted, malformed plane skipped with a warning", () => {
  const { case: c, warnings } = parseBcf(realZip()); const sec = c.snapshots[0].view.sections;
  assert.equal(sec.length, 1);
  // BCF direction +Z (clipped side) => three keeps -Y side: normal (0,-1,0), plane at y = 3 => n.p + c = -y + c, c = 3
  assert.ok(near(sec[0].normal, [0, -1, 0])); assert.ok(Math.abs(sec[0].constant - 3) < 1e-9);
  assert.ok(warnings.some((w) => /clipping plane/.test(w)));
});
test("real-world: components, selection and hints", () => {
  const { case: c } = parseBcf(realZip()); const s = c.snapshots[0];
  assert.deepEqual(s.view.hiddenGuids, ["hid1", "hid2"]); assert.equal(s.view.isolatedGuids, null); assert.deepEqual(s.view.hiddenCategories, ["IFCSPACE"]);
  assert.equal(s.annotations[0].anchor.guid, "0abcDEF1234567890abcde");
});
test("real-world: snapshot image becomes a data URL with the right bytes", () => {
  const img = parseBcf(realZip()).case.snapshots[0].image;
  assert.equal(img, "data:image/png;base64," + PNG.toString("base64"));
});
test("ids for foreign BCF come from the id factory, not from the topic guid", () => {
  let n = 0; setIdFactory(() => "GEN" + ++n);
  try { const c = parseBcf(realZip()).case; assert.match(c.id, /^GEN/); assert.match(c.snapshots[0].id, /^GEN/); } finally { setIdFactory(null); }
});
test("BCF 3.0 style: comments and viewpoints nested in Topic", () => {
  const m3 = `<Markup><Topic Guid="${T1}" TopicType="Clash" TopicStatus="Open"><Title>Tre</Title><CreationDate>2024-02-01T00:00:00Z</CreationDate><CreationAuthor>a</CreationAuthor>
    <Comments><Comment Guid="c9" Date="2024-02-01T01:00:00Z" Author="b"><Comment>Hei</Comment></Comment></Comments>
    <Viewpoints><ViewPoint Guid="v"><Viewpoint>vp.bcfv</Viewpoint></ViewPoint></Viewpoints></Topic></Markup>`;
  const z = zipSync({ "bcf.version": strToU8('<Version VersionId="3.0"/>'), [`${T1}/markup.bcf`]: strToU8(m3), [`${T1}/vp.bcfv`]: strToU8(vpFile) });
  const { case: c, warnings } = parseBcf(z);
  assert.equal(c.snapshots[0].title, "Tre"); assert.equal(c.snapshots[0].annotations[0].text, "Hei"); assert.ok(near(c.snapshots[0].view.camera.position, [10, 1.5, -20]));
  assert.deepEqual(warnings.filter((w) => !/clipping plane/.test(w)), []);
});
test("project.bcfp name is used as the case name", () => {
  const z = realZip({ "project.bcfp": strToU8('<ProjectExtension><Project ProjectId="p1"><Name>Skolen</Name></Project></ProjectExtension>') });
  assert.equal(parseBcf(z).case.name, "Skolen");
});
test("extra viewpoints are ignored with a warning", () => {
  const m = markup(T1, "A", "Open", "").replace("</Markup>", '<Viewpoints Guid="v2"><Viewpoint>Viewpoint_2.bcfv</Viewpoint></Viewpoints></Markup>');
  const { warnings, case: c } = parseBcf(zipSync({ [`${T1}/markup.bcf`]: strToU8(m), [`${T1}/Viewpoint_1.bcfv`]: strToU8(vpFile) }));
  assert.ok(warnings.some((w) => /extra viewpoint/.test(w))); assert.equal(c.snapshots.length, 1);
});
test("orthogonal camera is read as a flat view with a warning", () => {
  const ortho = vpFile.replace(/PerspectiveCamera/g, "OrthogonalCamera").replace("<FieldOfView>45</FieldOfView>", "<ViewToWorldScale>3</ViewToWorldScale>");
  const { case: c, warnings } = parseBcf(realZip({ [`${T1}/Viewpoint_1.bcfv`]: strToU8(ortho) }));
  assert.equal(c.snapshots.find((s) => s.title.startsWith("Koll")).view.camera.flat, true); assert.ok(warnings.some((w) => /orthogonal/.test(w)));
});

test("garbage bytes => warning, empty case, no exception", () => {
  for (const b of [new Uint8Array(0), new Uint8Array([1, 2, 3, 4]), strToU8("PK\x03\x04 not really"), new Uint8Array(1000).fill(255)]) {
    const r = parseBcf(b); assert.ok(r.warnings.length > 0); assert.equal(r.case.snapshots.length, 0); assert.equal(r.case.schema, "argus.case/1");
  }
});
test("malformed markup XML => warning, other topics survive", () => {
  const { case: c, warnings } = parseBcf(realZip({ [`${T2}/markup.bcf`]: strToU8("<Markup><Topic>oops</Markup>") }));
  assert.equal(c.snapshots.length, 1); assert.ok(warnings.some((w) => w.includes(T2)));
});
test("malformed viewpoint XML => default camera, topic kept", () => {
  const { case: c, warnings } = parseBcf(realZip({ [`${T1}/Viewpoint_1.bcfv`]: strToU8("<VisualizationInfo><Components>") }));
  const s = c.snapshots.find((x) => x.title.startsWith("Koll"));
  assert.deepEqual(s.view.camera.position, [0, 0, 0]); assert.ok(warnings.length > 0);
});
test("missing viewpoint and snapshot files => warnings", () => {
  const z = zipSync({ [`${T1}/markup.bcf`]: strToU8(markup(T1, "A", "Open", "")) });
  const { case: c, warnings } = parseBcf(z);
  assert.equal(c.snapshots.length, 1); assert.equal(c.snapshots[0].image, null);
  assert.ok(warnings.some((w) => /missing viewpoint file/.test(w)));
});
test("topic without a Topic element or viewpoint does not throw", () => {
  const z = zipSync({ "a/markup.bcf": strToU8("<Markup/>"), "b/markup.bcf": strToU8('<Markup><Topic Guid="g"><Title>Nu</Title></Topic></Markup>') });
  const { case: c, warnings } = parseBcf(z);
  assert.equal(c.snapshots.length, 1); assert.ok(warnings.some((w) => /no Topic/.test(w)) && warnings.some((w) => /no viewpoint/.test(w)));
});
test("unsupported version is reported, not fatal", () => {
  const { warnings } = parseBcf(realZip({ "bcf.version": strToU8('<Version VersionId="9.9"/>') }));
  assert.ok(warnings.some((w) => /9\.9/.test(w)));
});
test("windows-style backslash paths in the zip are accepted", () => {
  const z = zipSync({ [`${T1}\\markup.bcf`]: strToU8(markup(T1, "A", "Open", "")), [`${T1}\\Viewpoint_1.bcfv`]: strToU8(vpFile), [`${T1}\\Snapshot_1.png`]: PNG });
  const { case: c } = parseBcf(z); assert.equal(c.snapshots[0].image.startsWith("data:image/png"), true); assert.ok(near(c.snapshots[0].view.camera.position, [10, 1.5, -20]));
});

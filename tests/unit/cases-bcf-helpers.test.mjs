import test from "node:test";
import assert from "node:assert/strict";
import { toGuid, fromGuid, toBcfAxes, fromBcfAxes, quatToDirUp, dirUpToQuat, rotateByQuat, xmlEscape, xmlUnescape, el, parseXml, bytesToB64, b64ToBytes, randomId, setIdFactory } from "../../src/cases/bcf.js";

const near = (a, b, e = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) <= e);
function rndQuat(r) { const q = [0, 0, 0, 0].map(() => r() * 2 - 1); const l = Math.hypot(...q); return q.map((v) => v / l); }
function rng(seed) { let s = seed; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }

test("axis conversion: three Y-up -> BCF Z-up", () => {
  assert.deepEqual(toBcfAxes([1, 2, 3]), [1, -3, 2]);
  assert.deepEqual(toBcfAxes([0, 1, 0]), [0, 0, 1]); // up stays up
  assert.deepEqual(toBcfAxes([0, 0, -1]), [0, 1, 0]); // three forward (-Z) is BCF north (+Y)
});
test("axis conversion round trips and keeps handedness", () => {
  const r = rng(1);
  for (let i = 0; i < 50; i++) { const v = [r() * 9, r() * 9, r() * 9]; assert.deepEqual(fromBcfAxes(toBcfAxes(v)), v.map((x) => x + 0)); }
  const c = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  assert.deepEqual(toBcfAxes(c([1, 0, 0], [0, 1, 0])), c(toBcfAxes([1, 0, 0]), toBcfAxes([0, 1, 0])));
});
test("identity quaternion looks down -Z with +Y up", () => {
  const { dir, up } = quatToDirUp([0, 0, 0, 1]);
  assert.ok(near(dir, [0, 0, -1]) && near(up, [0, 1, 0]));
});
test("quaternion -> dir/up -> quaternion for 100 random orientations", () => {
  const r = rng(7);
  for (let i = 0; i < 100; i++) {
    let q = rndQuat(r); if (q[3] < 0) q = q.map((v) => -v);
    const { dir, up } = quatToDirUp(q);
    const q2 = dirUpToQuat(dir, up);
    assert.ok(near(q, q2, 1e-9), `orientation ${i}: ${q} vs ${q2}`);
  }
});
test("dir/up -> quaternion -> dir/up for 100 random non-orthogonal pairs", () => {
  const r = rng(9);
  for (let i = 0; i < 100; i++) {
    const d = [r() - .5, r() - .5, r() - .5], u = [r() - .5, r() - .5, r() - .5];
    const q = dirUpToQuat(d, u), back = quatToDirUp(q);
    const l = Math.hypot(...d);
    assert.ok(near(back.dir, d.map((x) => x / l), 1e-9));
  }
});
test("dir parallel to up does not produce NaN", () => {
  const q = dirUpToQuat([0, 1, 0], [0, 1, 0]);
  assert.ok(q.every(Number.isFinite));
  assert.ok(near(quatToDirUp(q).dir, [0, 1, 0], 1e-9));
});
test("rotateByQuat: 90 degrees about Y turns -Z into -X", () => {
  const s = Math.SQRT1_2;
  assert.ok(near(rotateByQuat([0, s, 0, s], [0, 0, -1]), [-1, 0, 0]));
});

test("GUID: ULID ids convert reversibly", () => {
  const r = rng(3);
  for (let i = 0; i < 100; i++) {
    setIdFactory(null);
    const id = randomId();
    const g = toGuid(id);
    assert.match(g, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(fromGuid(g), id);
  }
  assert.equal(fromGuid(toGuid("7ZZZZZZZZZZZZZZZZZZZZZZZZZ")), "7ZZZZZZZZZZZZZZZZZZZZZZZZZ");
  assert.equal(fromGuid(toGuid("00000000000000000000000000")), "00000000000000000000000000");
});
test("GUID: non-ULID ids get a deterministic, distinct guid", () => {
  assert.equal(toGuid("snap-1"), toGuid("snap-1"));
  assert.notEqual(toGuid("snap-1"), toGuid("snap-2"));
  assert.match(toGuid("æøå"), /^[0-9a-f-]{36}$/);
});
test("fromGuid rejects junk", () => {
  assert.equal(fromGuid("nope"), null);
  assert.equal(fromGuid(undefined), null);
});
test("setIdFactory injects ids", () => {
  setIdFactory(() => "X");
  assert.equal(randomId(), "X");
  setIdFactory(null);
  assert.notEqual(randomId(), "X");
});

test("xmlEscape handles Norwegian chars and markup characters", () => {
  assert.equal(xmlEscape(`æøå ÆØÅ & < > " '`), `æøå ÆØÅ &amp; &lt; &gt; &quot; &apos;`);
});
test("xmlEscape strips illegal control chars but keeps newline and tab", () => {
  assert.equal(xmlEscape("a\u0001b\n\tc"), "ab\n\tc");
});
test("escape -> parse round trip incl. CR, quotes, emoji", () => {
  const s = `Rør & vann <b> "q" 'a'\r\nlinje2 ✓ 😀`;
  const n = parseXml(el("A", { t: s }, s));
  assert.equal(n.text, s);
  assert.equal(n.attrs.t, s);
});
test("xmlUnescape numeric entities and unknown entities", () => {
  assert.equal(xmlUnescape("&#xE6;&#248;&#229; &foo; &#x110000;"), "æøå &foo; ");
});
test("el writes self-closing and nested elements", () => {
  assert.equal(el("A", { x: "1", y: undefined }), '<A x="1"/>');
  assert.equal(el("A", null, [el("B", null, "t"), el("C")]), "<A><B>t</B><C/></A>");
});
test("parseXml: declaration, comments, CDATA, namespaces, single quotes", () => {
  const n = parseXml(`\uFEFF<?xml version="1.0"?><!-- hi --><x:Root xmlns:x='u' a:b='1'><x:K><![CDATA[a<b&c]]></x:K><E/></x:Root>`);
  assert.equal(n.name, "Root"); assert.equal(n.attrs.b, "1");
  assert.equal(n.kids[0].text, "a<b&c"); assert.equal(n.kids[1].name, "E");
});
test("parseXml throws on mismatched, unclosed, empty and multi-root input", () => {
  for (const bad of ["<a><b></a>", "<a>", "", "plain text", "<a/><b/>", "<a>x < y</a>"]) assert.throws(() => parseXml(bad), undefined, bad);
});
test("base64 helpers match Buffer for every length mod 3", () => {
  for (let n = 0; n < 40; n++) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
    assert.equal(bytesToB64(b), Buffer.from(b).toString("base64"));
    assert.deepEqual(b64ToBytes(bytesToB64(b)), b);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { blankComments, fileSchemaOf, hasIfcEntities, hasStepHeader, isZip, overwriteAscii, schemaCaseFix } from "../../src/ifc/stepHeader.js";
import { checkDownload, hasIfcOrZipMagic } from "../../src/reliability/integrity.js";

const enc = (s) => new Uint8Array(Buffer.from(s, "latin1"));
const KNOWN = ["IFC2X3", "IFC2X_FINAL", "IFC4", "IFC4X3", "IFC4X3_ADD2"];
const header = (schema = "IFC4", before = "", inside = "") =>
  `${before}ISO-10303-21;\r\nHEADER;${inside}FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');\r\nFILE_NAME('a.ifc','2024-01-01T00:00:00',(''),(''),'x','y','');\r\nFILE_SCHEMA(('${schema}'));\r\nENDSEC;\r\nDATA;\r\n#1=IFCPROJECT('0',$,$,$,$,$,$,$,$);\r\nENDSEC;\r\nEND-ISO-10303-21;\r\n`;

test("comments are blanked to the same length; quotes are respected", () => {
  const t = "a/* x */b'/* not a comment */'c/* open";
  const out = blankComments(t);
  assert.equal(out.length, t.length);
  assert.equal(out, "a       b'/* not a comment */'c       ");
  assert.equal(blankComments("'it''s /* in */ text'/*c*/"), "'it''s /* in */ text'     ");
});

test("the schema comes from the real header, not from a comment before it", () => {
  const bytes = enc(header("IFC4", "", "").replace("ISO-10303-21;\r\n", "ISO-10303-21;\r\n/* converted from FILE_SCHEMA(('IFC2X3')) */\r\n"));
  assert.equal(fileSchemaOf(bytes).name, "IFC4");
  // and not from a comment inside the header either
  assert.equal(fileSchemaOf(enc(header("IFC2X3", "", "/* FILE_SCHEMA(('IFC4X3')) */"))).name, "IFC2X3");
  // FILE_SCHEMA outside HEADER ... ENDSEC does not count
  assert.equal(fileSchemaOf(enc("ISO-10303-21;\r\nDATA;\r\n#1=X('FILE_SCHEMA((''IFC4''))');\r\nENDSEC;")), null);
  // odd spacing
  assert.equal(fileSchemaOf(enc(header("IFC4").replace("FILE_SCHEMA(('IFC4'))", "FILE_SCHEMA (( 'IFC4' ))"))).name, "IFC4");
});

test("the name's byte offsets point at the name", () => {
  const bytes = enc(header("ifc4"));
  const f = fileSchemaOf(bytes);
  assert.equal(Buffer.from(bytes.subarray(f.start, f.end)).toString("latin1"), "ifc4");
});

test("a known schema in lower case is upper-cased in place and can be restored", () => {
  const bytes = enc(header("ifc4"));
  const fix = schemaCaseFix(bytes, KNOWN);
  assert.deepEqual({ upper: fix.upper }, { upper: "IFC4" });
  const before = overwriteAscii(bytes, fix.start, fix.upper);
  assert.equal(fileSchemaOf(bytes).name, "IFC4");
  overwriteAscii(bytes, fix.start, before);
  assert.equal(fileSchemaOf(bytes).name, "ifc4");
  // nothing to do for an upper-case or an unknown name
  assert.equal(schemaCaseFix(enc(header("IFC4")), KNOWN), null);
  assert.equal(schemaCaseFix(enc(header("ifc9")), KNOWN), null);
  assert.equal(schemaCaseFix(enc(header("Ifc2x3")), KNOWN).upper, "IFC2X3");
});

test("the STEP magic may follow a BOM, whitespace and a long comment (past 4 KB)", () => {
  assert.ok(hasStepHeader(enc(header())));
  assert.ok(hasStepHeader(enc("\xEF\xBB\xBF" + header())));
  assert.ok(hasStepHeader(enc("\r\n\r\n   " + header())));
  assert.ok(hasStepHeader(enc("/*" + " ".repeat(5000) + "*/" + header())));
  assert.ok(hasStepHeader(enc("iso-10303-21;\r\nHEADER;")));
  assert.ok(!hasStepHeader(enc("<!doctype html><title>login</title>")));
  assert.ok(!hasStepHeader(enc("/* only a comment */ hello")));
  assert.ok(!hasStepHeader(enc("ISO-10303-214;"))); // a different standard number is not this one
  assert.ok(!hasStepHeader(enc("")));
});

test("zip magic", () => {
  assert.ok(isZip(new Uint8Array([0x50, 0x4b, 3, 4, 0])));
  assert.ok(isZip(new Uint8Array([0x50, 0x4b, 5, 6])));
  assert.ok(!isZip(new Uint8Array([0x50, 0x4b])));
  assert.ok(!isZip(enc("PKZ!")));
});

test("the library download check accepts a header after a 5 KB comment, split over small chunks", async () => {
  const text = "/*" + "x".repeat(5000) + "*/" + header();
  const bytes = enc(text);
  assert.ok(hasIfcOrZipMagic(bytes));
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 700) chunks.push(bytes.subarray(i, i + 700));
  assert.deepEqual(await checkDownload({ chunks, contentLength: bytes.length, recordSize: bytes.length, sha: null }), { ok: true });
});

test("the download check works without crypto.subtle (an insecure origin): size and header only", async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
  try {
    const bytes = enc(header());
    // a wrong checksum cannot be detected without subtle, and must not throw
    assert.deepEqual(await checkDownload({ chunks: [bytes], contentLength: bytes.length, recordSize: bytes.length, sha: "0".repeat(64) }), { ok: true });
    assert.equal((await checkDownload({ chunks: [bytes.subarray(0, 10)], contentLength: bytes.length, recordSize: bytes.length, sha: null })).ok, false);
  } finally {
    Object.defineProperty(globalThis, "crypto", saved);
  }
});

test("a DATA section without IFC entities is told apart from one Argus failed on", () => {
  assert.equal(hasIfcEntities(enc(header())), true);
  assert.equal(hasIfcEntities(enc("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n#1=GARBAGE(((;\nENDSEC;\n")), false);
  assert.equal(hasIfcEntities(enc("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\n")), false);
  // a commented-out entity does not count
  assert.equal(hasIfcEntities(enc("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n/* #1=IFCWALL( */ #2=FOO();\nENDSEC;")), false);
  // cannot tell: no DATA in what was read
  assert.equal(hasIfcEntities(enc("ISO-10303-21;\nHEADER;\n/*" + "x".repeat(70000) + "*/ENDSEC;\nDATA;\n#1=IFCPROJECT(")), null);
});

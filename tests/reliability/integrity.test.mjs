import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkDownload, expectedSha, hasIfcOrZipMagic } from "../../src/reliability/integrity.js";

const enc = (s) => new TextEncoder().encode(s);
const body = enc("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
const sha = createHash("sha256").update(body).digest("hex");
const split = (b, at) => [b.subarray(0, at), b.subarray(at)];

test("magic: STEP header or zip, nothing else", () => {
  assert.ok(hasIfcOrZipMagic(body));
  assert.ok(hasIfcOrZipMagic(new Uint8Array([0x50, 0x4b, 3, 4])));
  assert.ok(hasIfcOrZipMagic(enc("\n  ISO-10303-21;")));
  assert.ok(!hasIfcOrZipMagic(enc("<!doctype html><title>login</title>")));
});

test("a complete download passes, in any number of chunks", async () => {
  assert.deepEqual(await checkDownload({ chunks: split(body, 7), contentLength: body.length, recordSize: body.length, sha }), { ok: true });
});

test("truncated body is caught by content-length, record size and sha", async () => {
  const cut = body.subarray(0, 30);
  assert.equal((await checkDownload({ chunks: [cut], contentLength: body.length, recordSize: null, sha: null })).ok, false);
  assert.equal((await checkDownload({ chunks: [cut], contentLength: 0, recordSize: body.length, sha: null })).ok, false);
  assert.match((await checkDownload({ chunks: [cut], contentLength: 0, recordSize: null, sha })).reason, /checksum/);
});

test("same length, one flipped byte: only the checksum sees it", async () => {
  const bad = Uint8Array.from(body);
  bad[40] ^= 0xff;
  const r = await checkDownload({ chunks: [bad], contentLength: body.length, recordSize: body.length, sha });
  assert.deepEqual(r, { ok: false, reason: "checksum mismatch" });
});

test("a login page or empty body is rejected before the importer", async () => {
  const page = enc("<!doctype html><html></html>");
  assert.match((await checkDownload({ chunks: [page], contentLength: page.length, recordSize: null, sha: null })).reason, /not an IFC/);
  assert.equal((await checkDownload({ chunks: [], contentLength: 0, recordSize: null, sha: null })).ok, false);
});

test("expected sha comes from the record, else the ETag", () => {
  assert.equal(expectedSha({ sha256: sha.toUpperCase() }, null), sha);
  assert.equal(expectedSha({}, `"${sha}"`), sha);
  assert.equal(expectedSha({}, `W/"${sha}"`), sha);
  assert.equal(expectedSha({}, '"not-a-hash"'), null);
  assert.equal(expectedSha(null, null), null);
});

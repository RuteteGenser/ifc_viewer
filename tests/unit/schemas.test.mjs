import test from "node:test";
import assert from "node:assert/strict";
import { SchemaNames } from "web-ifc";
import { schemaIdOf } from "../../src/ifc/ifcSchemas.js";
import { fixtureBytes } from "./helpers/fixtures.mjs";

const head = (schema) => new TextEncoder().encode(`ISO-10303-21;\nHEADER;\nFILE_SCHEMA((${schema}));\nENDSEC;\nDATA;\n`);

test("web-ifc still names the three schema groups the app has chunks for", () => {
  assert.ok(SchemaNames[1].includes("IFC2X3"));
  assert.ok(SchemaNames[2].includes("IFC4"));
  assert.ok(SchemaNames[3].includes("IFC4X3"));
});

test("IFC2X3, IFC4 and IFC4X3 map to schema ids 1, 2 and 3", () => {
  assert.equal(schemaIdOf(head("'IFC2X3'")), 1);
  assert.equal(schemaIdOf(head("'IFC4'")), 2);
  assert.equal(schemaIdOf(head("'IFC4X3'")), 3);
  assert.equal(schemaIdOf(head("'IFC4X3_ADD2'")), 3);
});

test("case and spacing in the header do not matter", () => {
  assert.equal(schemaIdOf(head("'ifc4'")), 2);
  assert.equal(schemaIdOf(new TextEncoder().encode("FILE_SCHEMA ( ( 'IFC2X3' ) );")), 1);
});

test("only the first schema name counts", () => {
  assert.equal(schemaIdOf(head("'IFC4','IFC2X3'")), 2);
});

test("odd, empty or missing headers give null", () => {
  assert.equal(schemaIdOf(head("'IFC9000'")), null);
  assert.equal(schemaIdOf(head("")), null);
  assert.equal(schemaIdOf(new Uint8Array()), null);
  assert.equal(schemaIdOf(new TextEncoder().encode("hello world")), null);
  assert.equal(schemaIdOf(fixtureBytes("empty.ifc")), null);
  assert.equal(schemaIdOf(fixtureBytes("not-ifc.ifc")), null);
});

test("fixtures", () => {
  assert.equal(schemaIdOf(fixtureBytes("mm-ifc2x3.ifc")), 1);
  assert.equal(schemaIdOf(fixtureBytes("m-ifc4.ifc")), 2);
  assert.equal(schemaIdOf(fixtureBytes("truncated.ifc")), 1);
});

test("a header beyond the first 64 KB is not read", () => {
  const pad = new Uint8Array(70000).fill(32);
  const tail = head("'IFC4'");
  const all = new Uint8Array(pad.length + tail.length);
  all.set(pad);
  all.set(tail, pad.length);
  assert.equal(schemaIdOf(all), null);
});

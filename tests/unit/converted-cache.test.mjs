import test from "node:test";
import assert from "node:assert/strict";
import { convertedKey, readConverted, writeConverted, dropConverted, forgetConverted } from "../../src/ifc/convertedCache.js";

test("the key changes with the model, its size and the converter settings", () => {
  const a = convertedKey({ id: "x", size: 10, settings: { a: 1 } });
  assert.notEqual(a, convertedKey({ id: "y", size: 10, settings: { a: 1 } }));
  assert.notEqual(a, convertedKey({ id: "x", size: 11, settings: { a: 1 } }));
  assert.notEqual(a, convertedKey({ id: "x", size: 10, settings: { a: 2 } }));
  assert.equal(a, convertedKey({ id: "x", size: 10, settings: { a: 1 } }));
});

test("without Cache Storage nothing is read, written or thrown", async () => {
  const entry = { id: "x", size: 10, settings: {} };
  assert.equal(await readConverted(entry), null);
  await writeConverted(entry, new Uint8Array(4));
  await dropConverted(entry);
  await forgetConverted("x");
});

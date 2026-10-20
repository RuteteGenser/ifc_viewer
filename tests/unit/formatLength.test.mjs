import test from "node:test";
import assert from "node:assert/strict";
import { formatLength } from "../../src/ifc/formatLength.js";

test("below a metre is whole millimetres, from a metre is metres with two decimals", () => {
  assert.equal(formatLength(0.999), "999 mm");
  assert.equal(formatLength(1), "1.00 m");
  assert.equal(formatLength(1.0004), "1.00 m");
  assert.equal(formatLength(0.9996), "1.00 m"); // rounds up to a metre: metres, not "1000 mm"
  assert.equal(formatLength(0.9994), "999 mm");
  assert.equal(formatLength(0.0436), "44 mm");
  assert.equal(formatLength(12.454), "12.45 m");
  assert.equal(formatLength(123.4), "123.40 m");
  assert.equal(formatLength(0), "0 mm");
});
test("crossing the metre in either direction switches the unit each time", () => {
  const seq = [1.5, 0.7, 1.2, 0.4, 2];
  assert.deepEqual(seq.map(formatLength), ["1.50 m", "700 mm", "1.20 m", "400 mm", "2.00 m"]);
});

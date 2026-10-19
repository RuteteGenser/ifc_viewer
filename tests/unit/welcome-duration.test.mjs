import test from "node:test";
import assert from "node:assert/strict";
import { durationParts } from "../../src/access/state.js";

const H = 3600000;
test("durationParts rounds a trial seen seconds after it began to its set length", () => {
  assert.deepEqual(durationParts(24 * H - 3000), { key: "dur.hours", n: 24 });
  assert.deepEqual(durationParts(6 * H - 900), { key: "dur.hours", n: 6 });
  assert.deepEqual(durationParts(72 * H - 900), { key: "dur.days", n: 3 });
  assert.deepEqual(durationParts(30 * 24 * H), { key: "dur.days", n: 30 });
  assert.deepEqual(durationParts(H - 2000), { key: "dur.hours", n: 1 });
  assert.deepEqual(durationParts(40 * 60000), { key: "dur.minutes", n: 40 });
  assert.deepEqual(durationParts(-5), { key: "dur.minutes", n: 1 });
});

import test from "node:test";
import assert from "node:assert/strict";
import { cueStep } from "../../src/ifc/zoomCue.js";

const lim = { min: 1, max: 100 };
const zone = 6;

test("fires once on first contact and not again while pushing, however long", () => {
  let s = cueStep(null, "min", 1, lim, zone);
  assert.deepEqual(s, { latched: "min", fire: true });
  for (let i = 0; i < 100; i++) {
    s = cueStep(s.latched, "min", 1, lim, zone);
    assert.equal(s.fire, false);
  }
});

test("stays latched inside the soft zone, re-arms beyond it, then fires again", () => {
  let s = cueStep("min", null, 5, lim, zone);
  assert.equal(s.latched, "min");
  s = cueStep("min", null, 7.5, lim, zone);
  assert.equal(s.latched, null);
  assert.equal(cueStep(s.latched, "min", 1, lim, zone).fire, true);
});

test("max mirrors min, and a different limit fires immediately", () => {
  assert.equal(cueStep(null, "max", 100, lim, zone).fire, true);
  assert.equal(cueStep("max", null, 96, lim, zone).latched, "max");
  assert.equal(cueStep("max", null, 90, lim, zone).latched, null);
  assert.equal(cueStep("min", "max", 100, lim, zone).fire, true);
});

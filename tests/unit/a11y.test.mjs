import test from "node:test";
import assert from "node:assert/strict";
import { nextIndex, pageTitle } from "../../src/a11y.js";

test("nextIndex wraps and jumps to the ends", () => {
  assert.equal(nextIndex("ArrowRight", 2, 3), 0);
  assert.equal(nextIndex("ArrowLeft", 0, 3), 2);
  assert.equal(nextIndex("Home", 2, 3), 0);
  assert.equal(nextIndex("End", 0, 3), 2);
  assert.equal(nextIndex("a", 0, 3), -1);
  assert.equal(nextIndex("ArrowRight", 0, 0), -1);
});
test("nextIndex uses Up and Down for vertical lists", () => {
  assert.equal(nextIndex("ArrowDown", 0, 3, false), 1);
  assert.equal(nextIndex("ArrowUp", 0, 3, false), 2);
  assert.equal(nextIndex("ArrowRight", 0, 3, false), -1);
});
test("pageTitle names the open model", () => {
  assert.equal(pageTitle([]), "Argus, IFC viewer");
  assert.equal(pageTitle(["House.ifc"]), "House - Argus, IFC viewer");
  assert.equal(pageTitle(["A.ifc", "B.ifc", "C.ifc"]), "A and 2 more - Argus, IFC viewer");
});

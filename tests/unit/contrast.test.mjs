import test from "node:test";
import assert from "node:assert/strict";
import { parseColor, ratio, flatten, isLarge, over } from "../e2e/contrast.mjs";

test("black on white is 21:1, same colour is 1:1", () => {
  assert.equal(Math.round(ratio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })), 21);
  assert.equal(ratio({ r: 9, g: 9, b: 9 }, { r: 9, g: 9, b: 9 }), 1);
});
test("parseColor reads rgb, rgba and slash alpha", () => {
  assert.deepEqual(parseColor("rgb(1, 2, 3)"), { r: 1, g: 2, b: 3, a: 1 });
  assert.equal(parseColor("rgba(0, 0, 0, 0.5)").a, 0.5);
  assert.equal(parseColor("rgb(0 0 0 / 25%)").a, 0.25);
  assert.equal(parseColor("transparent"), null);
});
test("flatten composites translucent layers over the root", () => {
  const c = flatten(["rgba(0, 0, 0, 0.5)", "rgba(0, 0, 0, 0)", "rgb(255, 255, 255)"]);
  assert.equal(Math.round(c.r), 128);
});
test("over keeps the top colour when opaque", () => {
  assert.deepEqual(over({ r: 1, g: 2, b: 3, a: 1 }, { r: 9, g: 9, b: 9, a: 1 }), { r: 1, g: 2, b: 3, a: 1 });
});
test("large text threshold", () => {
  assert.ok(isLarge(24, 400));
  assert.ok(isLarge(19, 700));
  assert.ok(!isLarge(19, 400));
  assert.ok(!isLarge(14, 700));
});

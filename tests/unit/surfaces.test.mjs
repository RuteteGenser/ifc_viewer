import test from "node:test";
import assert from "node:assert/strict";
import { reduce, topmost, initialState, SHEETS } from "../../src/ui/surfaces.js";
import { dismisses } from "../../src/ui/useSheetSwipe.js";

const open = (s, id, snap, exclusive = true) => reduce(s, { type: "open", id, snap }, exclusive);

test("phone: opening a sheet replaces the one before, never stacks", () => {
  let s = initialState;
  for (const id of SHEETS) {
    s = open(s, id);
    assert.deepEqual(s.sheets, [id]);
  }
});

test("opening the open sheet returns the same state object", () => {
  const s = open(initialState, "models");
  assert.equal(open(s, "models"), s);
});

test("unknown ids are ignored", () => {
  assert.equal(open(initialState, "nope"), initialState);
});

test("details keeps a snap (half by default, full when asked) and loses it on close or replace", () => {
  let s = open(initialState, "details");
  assert.equal(s.snap.details, "half");
  s = reduce(s, { type: "snap", id: "details", snap: "full" }, true);
  assert.equal(s.snap.details, "full");
  assert.equal(open(s, "details").snap.details, "full", "re-opening keeps the snap");
  assert.equal(reduce(s, { type: "close", id: "details" }, true).snap.details, undefined);
  assert.equal(open(s, "models").snap.details, undefined);
  // a snap for a sheet that is not open changes nothing
  const closed = reduce(s, { type: "close", id: "details" }, true);
  assert.equal(reduce(closed, { type: "snap", id: "details", snap: "full" }, true), closed);
});

test("close of a sheet that is not open, closeAll when empty: same object", () => {
  assert.equal(reduce(initialState, { type: "close", id: "models" }, true), initialState);
  assert.equal(reduce(initialState, { type: "closeAll" }, true), initialState);
  assert.deepEqual(reduce(open(initialState, "cases"), { type: "closeAll" }, true), initialState);
});

test("desktop: sheets are not exclusive, except the Views and Share popovers", () => {
  let s = open(initialState, "details", undefined, false);
  s = open(s, "models", undefined, false);
  s = open(s, "cases", undefined, false);
  assert.deepEqual(s.sheets, ["details", "models", "cases"]);
  s = open(s, "views", undefined, false);
  s = open(s, "share", undefined, false);
  assert.deepEqual(s.sheets, ["details", "models", "cases", "share"]);
});

test("becoming a phone trims to the newest sheet and keeps its snap", () => {
  let s = open(initialState, "models", undefined, false);
  s = open(s, "details", "full", false);
  const t = reduce(s, { type: "trim" }, true);
  assert.deepEqual(t.sheets, ["details"]);
  assert.equal(t.snap.details, "full");
  assert.equal(reduce(open(initialState, "models"), { type: "trim" }, true).sheets[0], "models");
});

test("topmost: overlay, then sheet, then tool; newest of a kind first", () => {
  const ext = [
    { id: "measure", slot: "tool", seq: 1 },
    { id: "context", slot: "overlay", seq: 2 },
    { id: "legEdit", slot: "overlay", seq: 3 },
  ];
  assert.deepEqual(topmost(["models"], ext), { kind: "overlay", id: "legEdit" });
  assert.deepEqual(topmost(["models"], ext.slice(0, 1)), { kind: "sheet", id: "models" });
  assert.deepEqual(topmost([], ext.slice(0, 1)), { kind: "tool", id: "measure" });
  assert.equal(topmost([], []), null);
  assert.deepEqual(topmost(["menu", "cases"], []), { kind: "sheet", id: "cases" });
});

test("swipe: past 80 px or a fast flick dismisses, a short slow drag does not", () => {
  assert.equal(dismisses(81, 0), true);
  assert.equal(dismisses(30, 0.7), true);
  assert.equal(dismisses(30, 0.2), false);
  assert.equal(dismisses(80, 0.6), false);
});

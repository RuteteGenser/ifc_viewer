import test from "node:test";
import assert from "node:assert/strict";
import { annotationsReducer as R, initialState } from "../../src/annotations/reducer.js";
import { newAnnotation, LIMITS, validateCase, newCase, newSnapshot } from "../../src/cases/schema.js";

const mk = (text = "") => newAnnotation("comment", { text, anchor: { point: [0, 0, 0] } });

test("add, update and remove are immutable", () => {
  const s0 = initialState([]);
  const a = mk("one");
  const s1 = R(s0, { type: "add", annotation: a });
  assert.equal(s0.items.length, 0);
  assert.deepEqual(s1.items, [a]);
  const s2 = R(s1, { type: "update", id: a.id, patch: { text: "two" } });
  assert.equal(s1.items[0].text, "one");
  assert.equal(s2.items[0].text, "two");
  assert.equal(s2.items[0].id, a.id);
  const s3 = R(s2, { type: "remove", id: a.id });
  assert.equal(s3.items.length, 0);
  assert.equal(s2.items.length, 1);
});

test("unknown ids and no-op undo/redo return the same state object", () => {
  const s = initialState([mk()]);
  assert.equal(R(s, { type: "update", id: "nope", patch: {} }), s);
  assert.equal(R(s, { type: "remove", id: "nope" }), s);
  assert.equal(R(s, { type: "undo" }), s);
  assert.equal(R(s, { type: "redo" }), s);
});

test("undo and redo walk the history; a new edit clears redo", () => {
  const a = mk("a"), b = mk("b");
  let s = initialState([]);
  s = R(s, { type: "add", annotation: a });
  s = R(s, { type: "add", annotation: b });
  s = R(s, { type: "undo" });
  assert.deepEqual(s.items, [a]);
  s = R(s, { type: "undo" });
  assert.deepEqual(s.items, []);
  s = R(s, { type: "redo" });
  assert.deepEqual(s.items, [a]);
  s = R(s, { type: "update", id: a.id, patch: { color: "#c92a2a" } });
  assert.equal(s.future.length, 0);
  s = R(s, { type: "undo" });
  assert.equal(s.items[0].color, "#d9480f");
});

test("the per-snapshot limit holds", () => {
  let s = initialState([]);
  for (let i = 0; i < LIMITS.annotationsPerSnapshot + 5; i++) s = R(s, { type: "add", annotation: mk(String(i)) });
  assert.equal(s.items.length, LIMITS.annotationsPerSnapshot);
});

test("reset drops history", () => {
  let s = R(initialState([]), { type: "add", annotation: mk() });
  s = R(s, { type: "reset", items: [] });
  assert.deepEqual(s, initialState([]));
});

test("everything the tools build passes the case validator unchanged", () => {
  const anchor = { point: [1, 2, 3], guid: "G", storey: "L1" };
  const list = [
    newAnnotation("comment", { text: "hi", anchor }),
    newAnnotation("pin", { anchor }),
    newAnnotation("text", { text: "label", anchor }),
    newAnnotation("arrow", { anchor, target: { point: [4, 5, 6], guid: null } }),
    newAnnotation("freehand", { anchor, path: [[0, 0, 0], [1, 1, 1], [2, 0, 2]] }),
  ];
  const c = newCase();
  c.snapshots.push({ ...newSnapshot(), annotations: list });
  const v = validateCase(c);
  assert.equal(v.warnings.length, 0, v.warnings.join("; "));
  assert.equal(v.case.snapshots[0].annotations.length, 5);
});

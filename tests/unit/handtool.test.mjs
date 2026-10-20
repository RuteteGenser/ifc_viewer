import test from "node:test";
import assert from "node:assert/strict";
import { spaceBelongsToPage, hoverNamesOn, setHoverNames, subscribeHoverNames } from "../../src/handTool.js";

const el = (tagName, extra = {}) => ({ tagName, getAttribute: (k) => extra[k] ?? null, ...extra });

test("Space belongs to inputs, buttons, links and dialogs", () => {
  for (const t of ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A", "SUMMARY"]) assert.equal(spaceBelongsToPage(el(t), false), true, t);
  assert.equal(spaceBelongsToPage(el("DIV", { isContentEditable: true }), false), true);
  assert.equal(spaceBelongsToPage(el("DIV", { role: "button" }), false), true);
  assert.equal(spaceBelongsToPage(el("BUTTON"), false, true), false, "clicked button keeps no claim on Space");
  assert.equal(spaceBelongsToPage(el("BUTTON"), false, false), true, "keyboard-focused button does");
  assert.equal(spaceBelongsToPage(el("CANVAS"), false), false);
  assert.equal(spaceBelongsToPage(el("BODY"), false), false);
  assert.equal(spaceBelongsToPage(null, false), false);
  assert.equal(spaceBelongsToPage(el("CANVAS"), true), true);
});

test("hover names are off by default, switch, notify, and survive unavailable storage", () => {
  globalThis.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(hoverNamesOn(), false);
  const seen = [];
  const off = subscribeHoverNames((v) => seen.push(v));
  setHoverNames(true);
  assert.equal(hoverNamesOn(), true);
  setHoverNames(false);
  off();
  setHoverNames(true);
  assert.deepEqual(seen, [true, false]);
});

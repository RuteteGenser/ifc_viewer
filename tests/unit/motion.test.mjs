import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../src/motion.css", import.meta.url), "utf8");

test("motion tokens exist", () => {
  for (const t of ["--dur-1: 90ms", "--dur-2: 160ms", "--dur-3: 240ms", "--dur-4: 360ms", "cubic-bezier(0.2, 0, 0, 1)", "cubic-bezier(0.34, 1.4, 0.64, 1)"]) assert.ok(css.includes(t), t);
});

test("reduced motion collapses every duration and the press scale", () => {
  const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  for (const t of ["--dur-1: 0.01ms", "--dur-2: 0.01ms", "--dur-3: 0.01ms", "--dur-4: 0.01ms", "scale: 1"]) assert.ok(block.includes(t), t);
});

test("only compositor-friendly properties are animated by keyframes", () => {
  const frames = [...css.matchAll(/@keyframes [\w-]+ \{([^@]*?)\}\s*(?=@|\n\n|\.)/g)].map((m) => m[0]);
  assert.ok(frames.length >= 10);
  for (const f of frames) assert.doesNotMatch(f, /\b(width|height|top|left|margin|padding)\s*:/, f);
});

import { shouldBuzz } from "../../src/haptics.js";

test("haptics: only touch on a matching, enabled button, not too often, not with reduced motion", () => {
  const base = { enabled: true, reduced: false, pointerType: "touch", hit: {}, disabled: false, now: 1000, last: 0 };
  assert.equal(shouldBuzz(base), true);
  assert.equal(shouldBuzz({ ...base, enabled: false }), false);
  assert.equal(shouldBuzz({ ...base, reduced: true }), false);
  assert.equal(shouldBuzz({ ...base, pointerType: "mouse" }), false);
  assert.equal(shouldBuzz({ ...base, hit: null }), false);
  assert.equal(shouldBuzz({ ...base, disabled: true }), false);
  assert.equal(shouldBuzz({ ...base, now: 1050, last: 1000 }), false);
});

test("motion.css documents the tokens and the transform/opacity rule", () => {
  assert.match(css.slice(0, 1200), /animate only transform\/opacity/i);
  assert.match(css.slice(0, 1200), /--dur-1[\s\S]*--ease-spring/);
});

test("the sliding indicator and ghosts only use compositor properties", () => {
  const block = css.slice(css.indexOf(".element-panel__tab-indicator--ready"));
  assert.match(block, /transition: transform/);
  assert.doesNotMatch(css.slice(css.indexOf("/* ---- Part 2 ---- */")).match(/@keyframes[^}]*\{[^@]*?\}\s*\}/g)?.join("") ?? "", /\b(width|height|top|left|margin)\s*:/);
});

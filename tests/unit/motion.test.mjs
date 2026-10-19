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

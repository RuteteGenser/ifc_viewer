import test from "node:test";
import assert from "node:assert/strict";
import { RELOAD_GUARD_MS, canAutoReload, markAutoReload, parseBuildId, savePending, takePending } from "../../src/reliability/recovery.js";

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } };

test("loop guard: one automatic reload per minute", () => {
  const s = memory();
  assert.equal(canAutoReload(s, 1_000_000), true);
  markAutoReload(s, 1_000_000);
  assert.equal(canAutoReload(s, 1_000_000 + 1), false);
  assert.equal(canAutoReload(s, 1_000_000 + RELOAD_GUARD_MS - 1), false);
  assert.equal(canAutoReload(s, 1_000_000 + RELOAD_GUARD_MS), true);
});

test("loop guard refuses when storage is unavailable (cannot prove it is not a loop)", () => {
  assert.equal(canAutoReload(broken, 5), false);
  assert.doesNotThrow(() => markAutoReload(broken, 5));
});

test("a clock that went backwards does not unlock the guard", () => {
  const s = memory();
  markAutoReload(s, 2_000_000);
  assert.equal(canAutoReload(s, 1_000_000), false);
});

test("pending intent survives once, then expires", () => {
  const s = memory();
  savePending(s, { type: "library", id: "FZK" }, 1000);
  assert.deepEqual(takePending(s, 1000 + 5000), { type: "library", id: "FZK" });
  assert.equal(takePending(s, 1000 + 5000), null, "taken only once");
  savePending(s, { type: "sample" }, 1000);
  assert.equal(takePending(s, 1000 + 121_000), null, "expired");
  assert.equal(takePending(broken, 1), null);
  s.setItem("argus-pending-intent", "{not json");
  assert.equal(takePending(s, 1), null);
});

test("build id is read from the meta tag", () => {
  assert.equal(parseBuildId('<head><meta charset="UTF-8" />\n<meta name="argus-build" content="bf3981f9d5" /></head>'), "bf3981f9d5");
  assert.equal(parseBuildId('<meta content="x1" name="argus-build">'), "x1");
  assert.equal(parseBuildId("<html>no tag</html>"), null);
});

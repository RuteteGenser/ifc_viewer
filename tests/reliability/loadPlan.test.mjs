import test from "node:test";
import assert from "node:assert/strict";
import { LoadQueue, STALL_BUDGET_MS, buildLimitMs, fileKind, ifcEntries, mayRetryStall, queuedText } from "../../src/reliability/loadPlan.js";
import { stallLimitMs } from "../../src/reliability/retry.js";
import { BACKOFF_MS } from "../../src/reliability/retry.js";

test("accepted files: .ifc, .ifcZIP and .zip (opened as an archive), nothing else", () => {
  assert.equal(fileKind("a.ifc"), "ifc");
  assert.equal(fileKind("A.IFC"), "ifc");
  assert.equal(fileKind("a.ifcZIP"), "zip");
  assert.equal(fileKind("a.ifczip"), "zip");
  assert.equal(fileKind("plain.zip"), "zip");
  assert.equal(fileKind("PLAIN.ZIP"), "zip");
  for (const n of ["a.ifcxml", "a.txt", "a.rvt", "zip", "a.ifc.bak", "", undefined]) assert.equal(fileKind(n), null, String(n));
});

test("archive entries: .ifc files only, macOS metadata left out", () => {
  assert.deepEqual(ifcEntries(["a/b/m.ifc", "README.txt", "__MACOSX/a/._m.ifc", "._x.ifc", "X.IFC", "dir/"]), ["a/b/m.ifc", "X.IFC"]);
});

test("files picked while loading join the queue in order; Cancel empties it", () => {
  const q = new LoadQueue();
  assert.equal(q.add([{ name: "a.ifc" }]), 1);
  assert.equal(q.add([{ name: "b.ifc" }, { name: "c.ifc" }]), 2);
  assert.equal(q.size, 3);
  assert.equal(q.next().name, "a.ifc");
  assert.equal(q.clear(), 2);
  assert.equal(q.next(), null);
  assert.equal(q.add(null), 0);
});

test("queue toast names the file, or counts several", () => {
  assert.equal(queuedText([{ name: "b.ifc" }]), "Added to the queue: b.ifc");
  assert.equal(queuedText([{ name: "x", displayName: "Sample building" }]), "Added to the queue: Sample building");
  assert.equal(queuedText([{ name: "a" }, { name: "b" }]), "2 files added to the queue");
});

// Simulates the import loop's decisions for a file that stalls every time.
function totalStall(bytes) {
  const limit = stallLimitMs(bytes);
  let stalled = 0;
  for (let attempt = 1; ; attempt++) {
    stalled += limit;
    if (!(attempt < BACKOFF_MS.length && mayRetryStall(stalled, limit))) return { stalled, attempts: attempt };
  }
}

test("stall restarts are capped near 4 minutes in all, not 3 full stall limits (up to 15 min)", () => {
  assert.deepEqual(totalStall(1e6), { stalled: 3 * stallLimitMs(1e6), attempts: 3 }); // a small file: three tries of about a minute
  const mid = totalStall(20 * 1048576); // 2 min limit: two tries, 4 min
  assert.equal(mid.attempts, 2);
  assert.ok(mid.stalled <= STALL_BUDGET_MS);
  const huge = totalStall(400 * 1048576); // 5 min limit: one try, never 15 min
  assert.equal(huge.attempts, 1);
  assert.ok(huge.stalled <= 300_000);
});

test("the fragments build watchdog scales with size and is capped", () => {
  assert.equal(buildLimitMs(0), 30_000);
  assert.ok(buildLimitMs(10 * 1048576) > buildLimitMs(1048576));
  assert.equal(buildLimitMs(1e10), 180_000);
});

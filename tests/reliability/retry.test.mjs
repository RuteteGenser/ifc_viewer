import test from "node:test";
import assert from "node:assert/strict";
import { BACKOFF_MS, attemptText, stallLimitMs, withBackoff } from "../../src/reliability/retry.js";

const fakeSleep = () => {
  const waited = [];
  return { waited, sleep: async (ms) => void waited.push(ms) };
};

test("backoff is 0 s, 1 s, 3 s: three attempts", () => assert.deepEqual(BACKOFF_MS, [0, 1000, 3000]));

test("a transient failure ends in success with no help: waits 1 s then 3 s", async () => {
  const { waited, sleep } = fakeSleep();
  let calls = 0;
  const seen = [];
  const out = await withBackoff(
    async (attempt) => {
      calls++;
      if (attempt < 3) throw new Error("503");
      return "model";
    },
    { sleep, onRetry: (e, next, total) => seen.push(`${next}/${total}`) },
  );
  assert.equal(out, "model");
  assert.equal(calls, 3);
  assert.deepEqual(waited, [1000, 3000]);
  assert.deepEqual(seen, ["2/3", "3/3"]);
});

test("a permanent failure throws the last error after exactly three attempts", async () => {
  const { sleep } = fakeSleep();
  let calls = 0;
  await assert.rejects(withBackoff(async (n) => { calls++; throw new Error(`fail ${n}`); }, { sleep }), /fail 3/);
  assert.equal(calls, 3);
});

test("shouldRetry false stops at once (a 404 is an answer, not an accident)", async () => {
  const { waited, sleep } = fakeSleep();
  let calls = 0;
  await assert.rejects(withBackoff(async () => { calls++; throw Object.assign(new Error("nope"), { status: 404 }); }, { sleep, shouldRetry: (e) => e.status !== 404 }), /nope/);
  assert.equal(calls, 1);
  assert.deepEqual(waited, []);
});

test("a Retry-After style minimum wait stretches the delay", async () => {
  const { waited, sleep } = fakeSleep();
  await withBackoff(async (n) => { if (n === 1) throw Object.assign(new Error("429"), { after: 2500 }); }, { sleep, wait: (e) => e.after });
  assert.deepEqual(waited, [2500]);
});

test("progress text, and a watchdog limit that grows with the file but is capped", () => {
  assert.equal(attemptText("Loading", 2, 3), "Loading again, attempt 2 of 3");
  assert.equal(stallLimitMs(0), 60_000);
  assert.ok(stallLimitMs(70 * 1048576) > stallLimitMs(1048576));
  assert.equal(stallLimitMs(10 * 1024 * 1048576), 300_000);
});

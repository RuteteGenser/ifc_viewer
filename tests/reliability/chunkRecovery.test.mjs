import test from "node:test";
import assert from "node:assert/strict";
import { chunkFailureAction, recoverFromChunkFailure, registerOpenWork } from "../../src/reliability/recovery.js";
import { failedChunkUrl, importRetrying } from "../../src/reliability/retry.js";

test("a chunk failure reloads only a stale tab with nothing open", () => {
  assert.equal(chunkFailureAction({ stale: true, workOpen: false }), "reload");
  assert.equal(chunkFailureAction({ stale: true, workOpen: true }), "retry"); // never reload away an open model
  assert.equal(chunkFailureAction({ stale: false, workOpen: false }), "retry"); // a momentary failure
  assert.equal(chunkFailureAction({ stale: false, workOpen: true }), "retry");
});

test("with a model open, recoverFromChunkFailure does not even ask the server, and never reloads", async () => {
  let fetched = 0;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetched++;
    throw new Error("must not be called");
  };
  try {
    registerOpenWork(() => true);
    assert.equal(await recoverFromChunkFailure(), false);
    assert.equal(fetched, 0);
    // a check that throws counts as open work (keep the page)
    registerOpenWork(() => {
      throw new Error("x");
    });
    assert.equal(await recoverFromChunkFailure(), false);
  } finally {
    globalThis.fetch = savedFetch;
    registerOpenWork(() => false);
  }
});

test("the failed chunk's address is read from Chrome's and Firefox's messages, not Safari's", () => {
  assert.equal(
    failedChunkUrl(new TypeError("Failed to fetch dynamically imported module: http://h:3700/app/assets/web-ifc-B6n6m0eF.js")),
    "http://h:3700/app/assets/web-ifc-B6n6m0eF.js",
  );
  assert.equal(failedChunkUrl(new TypeError("error loading dynamically imported module: https://x/app/assets/a-1.js")), "https://x/app/assets/a-1.js");
  assert.equal(failedChunkUrl(new TypeError("Importing a module script failed.")), null);
});

test("importRetrying tries once more and stops there", async () => {
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls === 1) throw new TypeError("Importing a module script failed.");
    return { ok: true };
  };
  assert.deepEqual(await importRetrying(flaky, { delay: 1 }), { ok: true });
  assert.equal(calls, 2);
  calls = 0;
  const dead = async () => {
    calls++;
    throw new TypeError("Importing a module script failed.");
  };
  await assert.rejects(importRetrying(dead, { delay: 1 }));
  assert.equal(calls, 2);
});

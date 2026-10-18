import test from "node:test";
import assert from "node:assert/strict";
import { KIND, ImportError, classifyFailure, describeFailure, failureDetails, isRetryable, toImportError } from "../../src/reliability/importErrors.js";

const err = (message, name = "Error") => Object.assign(new Error(message), { name });

test("a chunk that did not download is an app asset failure, not an invalid file", () => {
  const msgs = [
    "Failed to fetch dynamically imported module: http://x/app/assets/iw-schema-2-abc.js",
    "failed to asynchronously prepare wasm: both async and sync fetching of the wasm failed",
    "WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 64 6f",
    "Failed to execute 'compile' on 'WebAssembly': Incorrect response MIME type",
    "NetworkError when attempting to fetch resource.",
    "Load failed",
  ];
  for (const m of msgs) for (const stage of ["schema", "parse", "build"]) assert.equal(classifyFailure(err(m), stage), KIND.APP_ASSET_FAILED, `${stage}: ${m}`);
});

test("memory exhaustion is out of memory at every stage", () => {
  assert.equal(classifyFailure(err("Array buffer allocation failed", "RangeError"), "parse"), KIND.OUT_OF_MEMORY);
  assert.equal(classifyFailure(err("Out of memory"), "build"), KIND.OUT_OF_MEMORY);
  assert.equal(classifyFailure(err("Cannot enlarge memory arrays"), "parse"), KIND.OUT_OF_MEMORY);
  // wordings of Chrome, Firefox and Safari/WebKit
  for (const m of [
    "RangeError: Array buffer allocation failed",
    "WebAssembly.Memory(): could not allocate memory",
    "Failed to allocate memory for the module",
    "RangeError: Out of memory",
    "Aborted(OOM). Build with -sASSERTIONS for more info.",
    "Invalid array length",
    "WebAssembly.Memory.grow(): Maximum memory size exceeded",
    "Unable to allocate 1073741824 bytes",
    "not enough memory",
  ]) assert.equal(classifyFailure(err(m), "parse"), KIND.OUT_OF_MEMORY, m);
});

test("only a failure after the importer started on the content is an invalid file", () => {
  assert.equal(classifyFailure(err("Unexpected token in STEP line 42"), "parse"), KIND.INVALID_FILE);
  assert.equal(classifyFailure(err("weird"), "schema"), KIND.APP_ASSET_FAILED);
  assert.equal(classifyFailure(err("NotReadableError"), "read"), KIND.FILE_UNREADABLE);
  assert.equal(classifyFailure(err("weird"), "build"), KIND.UNKNOWN);
  // a typed-array RangeError on a corrupt file is not an out-of-memory claim
  assert.equal(classifyFailure(err("offset is out of bounds", "RangeError"), "parse"), KIND.INVALID_FILE);
});

test("toImportError keeps kinds and recognises the page's own sentinels", () => {
  const e = new ImportError(KIND.WORKER_CRASHED, "boom");
  assert.equal(toImportError(e), e);
  assert.equal(toImportError(new Error("cancelled")).kind, KIND.CANCELLED);
  assert.equal(toImportError(new Error("timeout")).kind, KIND.TIMEOUT);
  assert.equal(toImportError(new Error("Failed to fetch dynamically imported module: x")).kind, KIND.APP_ASSET_FAILED);
});

test("asset failures, crashes and stalls are retried automatically; a rejected file never is", () => {
  for (const k of Object.values(KIND)) assert.equal(isRetryable(k), [KIND.APP_ASSET_FAILED, KIND.WORKER_CRASHED, KIND.TIMEOUT].includes(k), k);
});

test("'valid IFC' is only ever said for INVALID_FILE", () => {
  for (const kind of Object.values(KIND)) {
    for (const ctx of [{}, { reloading: true }, { retried: true }, { staleBuild: true }]) {
      const text = describeFailure({ kind, message: "x" }, { name: "a.ifc", ...ctx });
      assert.equal(/valid IFC|doesn't look like/i.test(text), kind === KIND.INVALID_FILE, `${kind} ${JSON.stringify(ctx)}: ${text}`);
      assert.ok(!/—/.test(text), "no em dashes");
    }
  }
});

test("messages are accurate and actionable", () => {
  const d = (kind, ctx) => describeFailure({ kind, message: "m" }, { name: "a.ifc", ...ctx });
  assert.match(d(KIND.APP_ASSET_FAILED, { reloading: true }), /^Updating Argus/);
  assert.match(d(KIND.APP_ASSET_FAILED, { staleBuild: true }), /Reload to continue/);
  assert.match(d(KIND.WORKER_CRASHED), /stopped unexpectedly\. Trying again/);
  assert.match(d(KIND.OUT_OF_MEMORY), /Not enough memory to open "a\.ifc"/);
  assert.match(d(KIND.DOWNLOAD_INCOMPLETE), /download keeps arriving incomplete/);
  assert.match(describeFailure({ kind: KIND.INVALID_FILE, message: "line 1: bad\nentity" }, { name: "a.ifc" }), /^"a\.ifc" is not a valid IFC file: line 1: bad entity\.$/);
});

test("no message tells the user to press Retry before every automatic attempt is spent", () => {
  // describeFailure is only shown after the attempts; it must still not promise buttons that are absent
  for (const kind of Object.values(KIND)) assert.ok(!/\bRetry\b/.test(describeFailure({ kind, message: "x" }, { name: "a.ifc" })), kind);
});

test("details carry kind, message, build and agent", () => {
  const t = failureDetails(new ImportError(KIND.APP_ASSET_FAILED, "404", { stage: "schema" }), { name: "a.ifc", buildId: "abc", userAgent: "UA" });
  for (const part of ["kind: APP_ASSET_FAILED", "stage: schema", "file: a.ifc", "message: 404", "build: abc", "agent: UA"]) assert.ok(t.includes(part), part);
});

import test from "node:test";
import assert from "node:assert/strict";
import { formatCrashDetails } from "../../src/reliability/crashDetails.js";

test("includes message, build, user agent and component stack", () => {
  const t = formatCrashDetails({ error: new Error("boom"), componentStack: "\n    at Foo\n    at App\n", buildId: "abc123", userAgent: "UA/1" });
  assert.equal(t, "Error: boom\nBuild: abc123\nUser agent: UA/1\nComponent stack:\n    at Foo\n    at App");
});

test("missing build, stack and user agent are stated, not blank", () => {
  const t = formatCrashDetails({ error: new Error("x") });
  assert.match(t, /Build: unknown/);
  assert.match(t, /User agent: unknown/);
  assert.doesNotMatch(t, /Component stack/);
});

test("non-Error throws (string, undefined, empty message) still format", () => {
  assert.match(formatCrashDetails({ error: "plain" }), /^Error: plain/);
  assert.match(formatCrashDetails({ error: undefined }), /^Error: Unknown error/);
  assert.match(formatCrashDetails({ error: new Error("") }), /^Error: \(no message\)/);
});

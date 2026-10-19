import test from "node:test";
import assert from "node:assert/strict";
import { listModels, getModel, renameModel, deleteModel, downloadModel, extensionOf, LibraryError, MAX_BYTES, ALLOWED } from "../../src/library/api.js";
import { formatSize, relativeDate } from "../../src/library/format.js";

const realFetch = globalThis.fetch;
const calls = [];
function mockFetch(handler) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
}
test.afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});
const json = (status, body, type = "application/json") => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });

test("listModels returns the array", async () => {
  mockFetch(() => json(200, [{ id: "a" }]));
  assert.deepEqual(await listModels(), [{ id: "a" }]);
  assert.equal(calls[0].url, "/api/models");
});

test("listModels: no library when the host answers 401/403/404/405, HTML or a non-array", async () => {
  for (const make of [() => json(401, {}), () => json(403, {}), () => json(404, {}), () => json(405, {}), () => json(200, "<html>", "text/html"), () => json(200, { not: "array" })]) {
    mockFetch(make);
    await assert.rejects(listModels(), (e) => e instanceof LibraryError && e.hidden === true);
  }
});

test("listModels: a 500 is an error, not 'no library'", async () => {
  mockFetch(() => json(500, {}));
  await assert.rejects(listModels(), (e) => e.hidden === false && e.status === 500 && /not available/.test(e.message));
});

test("network failure and abort are told apart", async () => {
  mockFetch(() => { throw new TypeError("fetch failed"); });
  await assert.rejects(listModels(), (e) => /Check your connection/.test(e.message) && !e.aborted);
  mockFetch(() => { throw Object.assign(new Error("x"), { name: "AbortError" }); });
  await assert.rejects(listModels(), (e) => e.aborted === true);
});

test("getModel encodes the id and maps 404 to a plain sentence", async () => {
  mockFetch(() => json(404, {}));
  await assert.rejects(getModel("a/b c"), (e) => e.status === 404 && e.message === "That model is not saved here any more.");
  assert.equal(calls[0].url, "/api/models/a%2Fb%20c");
});

test("a rejected file shows the server's own reason; other statuses use fixed text", async () => {
  mockFetch(() => json(400, { error: "not an IFC file" }));
  await assert.rejects(getModel("x"), (e) => e.message === "Not an IFC file.");
  mockFetch(() => json(413, { error: "whatever" }));
  await assert.rejects(getModel("x"), (e) => /too large/.test(e.message));
  mockFetch(() => json(507, "not json"));
  await assert.rejects(getModel("x"), (e) => /library is full/.test(e.message));
  mockFetch(() => json(502, ""));
  await assert.rejects(getModel("x"), (e) => /Something went wrong/.test(e.message));
});

test("renameModel sends a JSON PATCH with only the name", async () => {
  mockFetch(() => json(200, { id: "a", name: "New.ifc" }));
  assert.deepEqual(await renameModel("a", "New.ifc"), { id: "a", name: "New.ifc" });
  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(calls[0].init.body, '{"name":"New.ifc"}');
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
});

test("deleteModel: ok resolves, failure throws", async () => {
  mockFetch(() => new Response(null, { status: 204 }));
  await deleteModel("a");
  assert.equal(calls[0].init.method, "DELETE");
  mockFetch(() => json(404, {}));
  await assert.rejects(deleteModel("a"), (e) => e.status === 404);
});

test("downloadModel streams, reports progress up to 1 and returns a File with the model's name", async () => {
  mockFetch(() => new Response(new Uint8Array([1, 2, 3, 4, 5, 6]), { status: 200, headers: { "content-length": "6" } }));
  const seen = [];
  const file = await downloadModel({ id: "a", name: "m.ifc", size: 6 }, { onProgress: (p) => seen.push(p) });
  assert.equal(file.name, "m.ifc");
  assert.equal(file.size, 6);
  assert.equal(seen.at(-1), 1);
  assert.ok(seen.every((p) => p >= 0 && p <= 1));
  assert.equal(calls[0].url, "/api/models/a/file");
});

test("downloadModel: a broken stream is reported as interrupted", async () => {
  const body = new ReadableStream({ pull() { throw new Error("reset"); } });
  mockFetch(() => new Response(body, { status: 200 }));
  await assert.rejects(downloadModel({ id: "a", name: "m.ifc", size: 1 }, {}), (e) => /interrupted/.test(e.message));
});

test("extensionOf and limits", () => {
  assert.equal(extensionOf("a.IFC"), ".ifc");
  assert.equal(extensionOf("a.b.ifczip"), ".ifczip");
  assert.equal(extensionOf("noext"), "");
  assert.deepEqual(ALLOWED, [".ifc", ".ifczip", ".zip"]);
  assert.equal(MAX_BYTES, 250 * 1024 * 1024);
});

test("formatSize", () => {
  assert.equal(formatSize(0), "<0.1 MB");
  assert.equal(formatSize(undefined), "<0.1 MB");
  assert.equal(formatSize(50000), "<0.1 MB");
  assert.equal(formatSize(2570803), "2.5 MB");
  assert.equal(formatSize(17871432), "17 MB");
});

test("relativeDate", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  const ago = (s) => new Date(now - s * 1000).toISOString();
  assert.equal(relativeDate(ago(10), now), "just now");
  assert.equal(relativeDate(ago(60), now), "1 minute ago");
  assert.equal(relativeDate(ago(2 * 3600), now), "2 hours ago");
  assert.equal(relativeDate(ago(86400), now), "1 day ago");
  assert.equal(relativeDate(ago(40 * 86400), now), "1 month ago");
  assert.equal(relativeDate("garbage", now), "");
  assert.equal(relativeDate(ago(-500), now), "just now", "a clock-skewed future date is not negative");
});

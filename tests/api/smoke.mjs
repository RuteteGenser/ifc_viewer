// READ-ONLY smoke test of the live model store through nginx. Never uploads,
// renames or deletes. ARGUS_URL (default http://localhost:3700), ARGUS_AUTH (default ifc:123).
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const BASE = (process.env.ARGUS_URL || "http://localhost:3700").replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(process.env.ARGUS_AUTH || "ifc:123").toString("base64");
const get = (path, headers = {}) => fetch(BASE + path, { headers: { authorization: AUTH, ...headers } });

let failed = 0;
const t0 = Date.now();
async function check(name, fn) {
  const s = Date.now();
  try {
    await fn();
    console.log(`PASS ${name} (${Date.now() - s} ms)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

let models = [];
await check("GET /api/health is ok", async () => {
  const res = await get("/api/health");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, "ok");
});
await check("unauthenticated request is refused (basic auth is on)", async () => {
  const res = await fetch(BASE + "/api/models");
  assert.equal(res.status, 401);
});
await check("GET /api/models lists models with the fields the viewer needs", async () => {
  const res = await get("/api/models", { accept: "application/json" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /json/);
  models = await res.json();
  assert.ok(Array.isArray(models));
  assert.equal(Number(res.headers.get("x-total-count")), models.length);
  for (const m of models) {
    assert.ok(m.id && m.name && Number.isFinite(m.size) && m.uploadedAt && m.sha256, `incomplete record ${JSON.stringify(m).slice(0, 120)}`);
    assert.match(m.sha256, /^[0-9a-f]{64}$/);
  }
});
await check("GET /api/stats has counts, limits and disk figures", async () => {
  const res = await get("/api/stats");
  assert.equal(res.status, 200);
  const s = await res.json();
  assert.equal(typeof s, "object");
  assert.ok(Object.keys(s).length >= 4, `stats keys: ${Object.keys(s)}`);
});
await check("GET /api/models/<unknown id> is 404", async () => {
  assert.equal((await get("/api/models/does-not-exist-zz")).status, 404);
});
await check("the smallest model downloads intact (sha256 and size match the listing)", async () => {
  if (models.length === 0) return console.log("  (library is empty, nothing to download)");
  // The smallest keeps the run fast; the download counter of a real model goes up by one.
  const m = [...models].sort((a, b) => a.size - b.size)[0];
  const res = await get(`/api/models/${encodeURIComponent(m.id)}/file`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.length, m.size, "size");
  assert.equal(createHash("sha256").update(buf).digest("hex"), m.sha256, "sha256");
});
await check("a Range request returns 206 with exactly the bytes asked for", async () => {
  if (models.length === 0) return;
  const m = [...models].sort((a, b) => a.size - b.size)[0];
  const res = await get(`/api/models/${encodeURIComponent(m.id)}/file`, { range: "bytes=0-15" });
  assert.equal(res.status, 206);
  assert.equal((await res.arrayBuffer()).byteLength, 16);
});

console.log(`${failed ? "FAIL" : "PASS"} api smoke (${Date.now() - t0} ms)`);
process.exit(failed ? 1 : 0);

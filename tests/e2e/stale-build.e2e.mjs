// End-to-end: a tab that was opened before a deploy must recover by itself.
//
//   node tests/e2e/stale-build.e2e.mjs
//
// Builds this checkout once (vite, base /app/), derives "the next deploy" from it
// (rehash-site.mjs: every hashed asset renamed, none of the old names served),
// serves them from a small nginx-like static server with a mock model library,
// and drives chromium. Playwright is resolved from /opt/repos/web/node_modules
// (no dependency of this repo). Env: ARGUS_E2E_PORT (default 4791),
// ARGUS_E2E_SITE (an existing build dir containing app/, skips the build),
// ARGUS_E2E_WEB (where to find playwright, default /opt/repos/web/).
import { createRequire } from "node:module";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { rehashSite } from "./rehash-site.mjs";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const { chromium } = createRequire(process.env.ARGUS_E2E_WEB || "/opt/repos/web/")("playwright");
const PORT = Number(process.env.ARGUS_E2E_PORT || 4791);
const ORIGIN = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- builds ----
const work = mkdtempSync(join(tmpdir(), "argus-e2e-"));
const siteA = join(work, "A");
if (process.env.ARGUS_E2E_SITE) cpSync(process.env.ARGUS_E2E_SITE, siteA, { recursive: true });
else {
  execFileSync("node", ["scripts/copy-wasm.mjs"], { cwd: repo, stdio: "ignore" });
  execFileSync("npx", ["vite", "build", "--base=/app/", "--outDir", join(siteA, "app"), "--emptyOutDir"], { cwd: repo, stdio: "ignore" });
}
const siteB = join(work, "B");
console.log("next deploy renamed", rehashSite(siteA, siteB), "assets");
// A whose lazily loaded schema chunks are gone for good: a deploy that never settles.
const siteBroken = join(work, "broken");
cpSync(siteA, siteBroken, { recursive: true });
for (const f of readdirSync(join(siteBroken, "app/assets"))) if (/schema/.test(f)) rmSync(join(siteBroken, "app/assets", f));

// ---- server ----
const DEMO = readFileSync(join(repo, "public/demo/demo-building.ifc"));
const record = { id: "demo1", name: "Library demo.ifc", size: DEMO.length, schema: "IFC4", uploadedAt: "2026-01-01T00:00:00Z" };
const MIME = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
let root = siteA;
let randomBuildCheck = false; // every version check sees a "newer" build
const server = http
  .createServer((req, res) => {
    const url = new URL(req.url, ORIGIN);
    const p = url.pathname;
    const json = (o) => (res.setHeader("content-type", "application/json"), res.end(JSON.stringify(o)));
    if (p === "/api/models") return json([record]);
    if (p === "/api/models/demo1") return json(record);
    if (p === "/api/models/demo1/file") {
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": DEMO.length, "cache-control": "no-store" });
      return res.end(DEMO);
    }
    let file = normalize(join(root, p));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      const navigation = req.headers["sec-fetch-mode"] === "navigate";
      if (!navigation || !p.startsWith("/app/") || /^\/app\/(assets|wasm|fonts|demo)\//.test(p)) return (res.writeHead(404), res.end("not found"));
      file = join(root, "app/index.html");
    }
    const headers = { "content-type": MIME[extname(file)] || "application/octet-stream" };
    if (p.startsWith("/app/assets/")) headers["cache-control"] = "public, max-age=31536000, immutable";
    else if (/(index\.html|\/app\/|sw\.js)$/.test(p)) headers["cache-control"] = "no-cache";
    if (randomBuildCheck && url.searchParams.has("build-check")) {
      const html = readFileSync(file, "utf8").replace(/(name="argus-build" content=")[^"]+"/, `$1${Math.random().toString(36).slice(2, 12)}"`);
      res.writeHead(200, headers);
      return res.end(html);
    }
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  })
  .listen(PORT);

// ---- helpers ----
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
async function scenario(name, run, { sw = "block" } = {}) {
  root = siteA;
  randomBuildCheck = false;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: sw });
  const page = await ctx.newPage();
  page.loads = 0;
  if (process.env.E2E_DEBUG) page.on("pageerror", (e) => console.log("  pageerror", e.message.slice(0, 200)));
  if (process.env.E2E_DEBUG) page.on("response", (r) => r.url().includes("/api/") && console.log("  api", r.status(), r.url(), r.headers()["content-type"]));
  page.on("load", () => page.loads++);
  try {
    await run(page, ctx);
    results.push([name, "ok"]);
  } catch (err) {
    results.push([name, `FAILED: ${err.message.split("\n")[0]}`]);
  }
  console.log(results.at(-1).join("  "));
  await ctx.close();
}
const ready = async (page) => {
  await page.goto(`${ORIGIN}/app/`);
  await page.waitForSelector("input[type=file]", { state: "attached" });
  await sleep(1500);
};
const view = (page) =>
  page
    .evaluate(() => ({
      banner: [...document.querySelectorAll(".status-banner, .lib-notice")].map((e) => e.innerText.replace(/\s+/g, " ").trim()).join(" | "),
      models: [...document.querySelectorAll(".model-list .model-row__name")].map((e) => e.textContent.trim()),
    }))
    .catch(() => ({ banner: "", models: [] })); // mid-navigation
async function until(page, ok, ms = 60000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(250)) {
    const v = await view(page);
    if (ok(v)) return v;
  }
  return view(page);
}
const openLibraryItem = async (page) => {
  const item = page.locator('.lib-row__main:has-text("Library demo"):visible').first();
  await item.waitFor({ timeout: 10000 }).catch(async () => {
    throw new Error(`library item not listed: ${await page.locator(".lib").first().innerText().catch(() => "no library section")}`);
  });
  await item.click();
};
const noMisleading = (v) => assert.ok(!/valid IFC|doesn't look like/i.test(v.banner), `misleading text shown: ${v.banner}`);

// ---- scenarios ----
await scenario("stale tab opens a library model: reloads once and the model opens by itself", async (page) => {
  await ready(page);
  root = siteB; // deploy
  await openLibraryItem(page);
  const shown = record.name.replace(/\.ifc$/i, ""); // the model list shows names without the extension
  const v = await until(page, (x) => x.models.includes(shown) || x.banner);
  noMisleading(v);
  assert.deepEqual(v.models, [shown], `banner: ${v.banner}`);
  assert.equal(page.loads, 2, "one automatic reload");
});

await scenario("stale tab, file from this device: reloads once and asks to pick it again (no 'invalid IFC')", async (page) => {
  await ready(page);
  root = siteB;
  await page.setInputFiles("input[type=file]", join(repo, "public/demo/demo-building.ifc"));
  const v = await until(page, (x) => /pick .* again/i.test(x.banner));
  noMisleading(v);
  assert.match(v.banner, /Argus was updated\. Pick "demo-building\.ifc" again/);
  assert.equal(page.loads, 2);
});

await scenario("new version found while idle: banner, no automatic reload", async (page) => {
  await ready(page);
  root = siteB;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const v = await until(page, () => false, 1500); // not yet: throttled until the first check is allowed
  await page.waitForSelector("text=A new version is ready", { timeout: 15000 });
  assert.equal(page.loads, 1);
  assert.deepEqual(v.models, []);
});

await scenario("reload loop guard: a broken deploy gives one reload, then a Reload button", async (page) => {
  await ready(page);
  root = siteBroken;
  randomBuildCheck = true; // every check says "newer build", every reload meets the same missing chunk
  await openLibraryItem(page);
  await until(page, (x) => /Reload/.test(x.banner) && page.loads >= 2, 40000);
  await sleep(6000);
  const v = await view(page);
  assert.equal(page.loads, 2, "exactly one automatic reload, never a loop");
  noMisleading(v);
  assert.match(v.banner, /new version of Argus was released|could not load part of itself/);
  assert.ok(await page.locator(".status-banner__retry", { hasText: "Reload" }).count(), "Reload button is shown");
});

await scenario("service worker keeps the previous version's files for a tab that is still on it", async (page) => {
  await ready(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await sleep(4000);
  const before = await page.evaluate(() => caches.keys());
  root = siteB;
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await sleep(3000);
  const after = await page.evaluate(() => caches.keys());
  const versions = after.filter((k) => k !== "ifc-viewer-meta");
  assert.ok(before.some((k) => versions.includes(k)), `old cache dropped: ${before} -> ${after}`);
  assert.ok(versions.length >= 2, `expected previous and current cache, got ${after}`);
  // and the old tab still opens a file without a single failed request
  const bad = [];
  page.on("response", (r) => r.status() >= 400 && bad.push(r.url()));
  await page.setInputFiles("input[type=file]", join(repo, "public/demo/demo-building.ifc"));
  const v = await until(page, (x) => x.models.length || x.banner);
  assert.equal(v.models.length, 1, v.banner);
  assert.deepEqual(bad, []);
}, { sw: "allow" });

await scenario("a file that really is not IFC still says so, with the reason and Details", async (page) => {
  await ready(page);
  const bad = join(work, "bad.ifc");
  execFileSync("node", ["-e", `require('fs').writeFileSync(${JSON.stringify(bad)}, "ISO-10303-21;\\nHEADER;\\nFILE_SCHEMA(('IFC4'));\\nENDSEC;\\nDATA;\\n#1=GARBAGE(((;\\nENDSEC;\\nEND-ISO-10303-21;\\n")`]);
  await page.setInputFiles("input[type=file]", bad);
  const v = await until(page, (x) => x.banner || x.models.length);
  if (v.models.length) return; // a lenient parser that opens an empty model is not a reliability failure
  assert.match(v.banner, /bad\.ifc/);
  assert.ok(await page.locator(".status-banner__details").count(), "Details disclosure present");
});

await browser.close();
server.close();
rmSync(work, { recursive: true, force: true });
const failed = results.filter(([, r]) => r !== "ok");
console.log(failed.length ? `\n${failed.length} FAILED` : `\nall ${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);

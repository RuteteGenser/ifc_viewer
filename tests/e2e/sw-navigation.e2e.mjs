// End-to-end: the service worker serves the page network-first.
//
//   node tests/e2e/sw-navigation.e2e.mjs        (about 1 min)
//
// A returning visitor whose service worker cached the page must get the NEW
// index.html on the first visit after a deploy (a stale one asks for the
// previous build's files), and the cached page only when offline.
// (The service worker exists only on a secure origin: localhost here, HTTPS in
// production. Users on http://<ip>:3700 never have one.)
// Builds this checkout (or ARGUS_E2E_SITE=<dir containing app/>), derives the
// next deploy with rehash-site.mjs, playwright from /opt/repos/web
// (ARGUS_E2E_WEB), port ARGUS_E2E_PORT (default 4794).
import { createRequire } from "node:module";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { rehashSite } from "./rehash-site.mjs";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const { chromium } = createRequire(process.env.ARGUS_E2E_WEB || "/opt/repos/web/")("playwright");
const PORT = Number(process.env.ARGUS_E2E_PORT || 4794);
const ORIGIN = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const work = mkdtempSync(join(tmpdir(), "argus-e2e-sw-"));
const siteA = join(work, "A");
if (process.env.ARGUS_E2E_SITE) cpSync(process.env.ARGUS_E2E_SITE, siteA, { recursive: true });
else {
  execFileSync("node", ["scripts/copy-wasm.mjs"], { cwd: repo, stdio: "ignore" });
  execFileSync("npx", ["vite", "build", "--base=/app/", "--outDir", join(siteA, "app"), "--emptyOutDir"], { cwd: repo, stdio: "ignore" });
}
const siteB = join(work, "B");
rehashSite(siteA, siteB);
const buildId = (site) => /name="argus-build" content="([^"]+)"/.exec(readFileSync(join(site, "app/index.html"), "utf8"))[1];

const MIME = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
let root = siteA;
const server = http
  .createServer((req, res) => {
    const p = new URL(req.url, ORIGIN).pathname;
    if (p.startsWith("/api/")) return (res.writeHead(404), res.end());
    let file = normalize(join(root, p));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) return (res.writeHead(404), res.end("not found"));
    const headers = { "content-type": MIME[extname(file)] || "application/octet-stream" };
    if (p.startsWith("/app/assets/")) headers["cache-control"] = "public, max-age=31536000, immutable";
    else headers["cache-control"] = "no-cache";
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  })
  .listen(PORT, "127.0.0.1");

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "allow" });
const page = await ctx.newPage();
const running = () => page.evaluate(() => document.querySelector('meta[name="argus-build"]')?.content);
let failed = 0;
const check = (name, fn) =>
  fn().then(
    () => console.log(`${name}  ok`),
    (err) => (failed++, console.log(`${name}  FAILED: ${err.message.split("\n")[0]}`)),
  );

await page.goto(`${ORIGIN}/app/`);
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload(); // now controlled by the worker, which has the page in its cache
await page.waitForFunction(() => !!navigator.serviceWorker.controller);
await sleep(2000);

await check("first visit after a deploy gets the new page, not the cached one", async () => {
  assert.equal(await running(), buildId(siteA));
  root = siteB; // deploy
  await page.goto(`${ORIGIN}/app/`);
  assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true, "the page was not served through the worker");
  assert.equal(await running(), buildId(siteB), "the service worker served the previous build's page");
});
await check("offline: the cached page is served", async () => {
  await sleep(1500);
  await ctx.setOffline(true);
  await page.goto(`${ORIGIN}/app/`);
  assert.ok(await running(), "no page offline");
  await ctx.setOffline(false);
});

await browser.close();
server.close();
rmSync(work, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);

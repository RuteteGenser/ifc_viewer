// End-to-end: loading a model never needs a button in normal conditions.
//
//   node tests/e2e/auto-recovery.e2e.mjs
//
// Transient faults (a chunk or wasm that fails once, a worker that is killed
// mid-import, a library download that is cut once or twice, 429/503 answers,
// an incomplete body, a memory error) must end with the model loaded and NO
// button pressed. Permanent faults must end with an accurate message (never
// "valid IFC") and, only then, buttons. A rejected file gets no Retry.
// Same setup as stale-build.e2e.mjs: builds this checkout (or ARGUS_E2E_SITE=<dir
// containing app/>), nginx-like scratch server with fault injection, playwright from
// /opt/repos/web (ARGUS_E2E_WEB), port ARGUS_E2E_PORT (default 4792).
import { createRequire } from "node:module";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const { chromium } = createRequire(process.env.ARGUS_E2E_WEB || "/opt/repos/web/")("playwright");
const PORT = Number(process.env.ARGUS_E2E_PORT || 4792);
const ORIGIN = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const work = mkdtempSync(join(tmpdir(), "argus-e2e-"));
const site = join(work, "A");
if (process.env.ARGUS_E2E_SITE) cpSync(process.env.ARGUS_E2E_SITE, site, { recursive: true });
else {
  execFileSync("node", ["scripts/copy-wasm.mjs"], { cwd: repo, stdio: "ignore" });
  execFileSync("npx", ["vite", "build", "--base=/app/", "--outDir", join(site, "app"), "--emptyOutDir"], { cwd: repo, stdio: "ignore" });
}

// ---- server with fault injection ----
const DEMO = readFileSync(join(repo, "public/demo/demo-building.ifc"));
const record = { id: "demo1", name: "Library demo.ifc", size: DEMO.length, schema: "IFC4", uploadedAt: "2026-01-01T00:00:00Z" };
const MIME = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
let faults = []; // { re, mode, times }  mode: a status code | "html" | "cut" | "short"
const fault = (re, mode, times = 1) => faults.push({ re, mode, times });
const server = http
  .createServer((req, res) => {
    const url = new URL(req.url, ORIGIN);
    const p = url.pathname;
    const hit = faults.find((f) => f.times > 0 && f.re.test(p));
    let corrupt = null;
    if (hit) {
      hit.times--;
      if (hit.mode === "cut") {
        res.writeHead(200, { "content-type": "application/octet-stream", "content-length": DEMO.length });
        res.write(DEMO.subarray(0, 3000));
        return setTimeout(() => req.socket.destroy(), 30);
      }
      if (hit.mode === "short") corrupt = DEMO.subarray(0, 3000);
      else if (hit.mode === "html") (res.writeHead(200, { "content-type": "text/html" }), res.end("<!doctype html>"));
      else return (res.writeHead(Number(hit.mode), { "content-type": "text/plain" }), res.end("fault"));
      if (!corrupt) return;
    }
    const json = (o) => (res.setHeader("content-type", "application/json"), res.end(JSON.stringify(o)));
    if (p === "/api/models") return json([record]);
    if (p === "/api/models/demo1") return json(record);
    if (p === "/api/models/demo1/file") {
      const body = corrupt || DEMO;
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": body.length, "cache-control": "no-store" });
      return res.end(body);
    }
    let file = normalize(join(site, p));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      const navigation = req.headers["sec-fetch-mode"] === "navigate";
      if (!navigation || !p.startsWith("/app/") || /^\/app\/(assets|wasm|fonts|demo)\//.test(p)) return (res.writeHead(404), res.end("not found"));
      file = join(site, "app/index.html");
    }
    const headers = { "content-type": MIME[extname(file)] || "application/octet-stream" };
    if (p.startsWith("/app/assets/")) headers["cache-control"] = "public, max-age=31536000, immutable";
    else if (/(index\.html|\/app\/|sw\.js)$/.test(p)) headers["cache-control"] = "no-cache";
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  })
  .listen(PORT);

// ---- helpers ----
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
const DEMO_PATH = join(repo, "public/demo/demo-building.ifc");
const view = (page) =>
  page
    .evaluate(() => ({
      banner: [...document.querySelectorAll(".status-banner, .lib-notice")].map((e) => e.innerText.replace(/\s+/g, " ").trim()).join(" | "),
      buttons: [...document.querySelectorAll(".status-banner button, .lib-notice button")].map((b) => b.innerText.trim()).filter((t) => t && t !== "✕" && t !== "OK"),
      models: [...document.querySelectorAll(".model-list .model-row__name")].map((e) => e.textContent.trim()),
    }))
    .catch(() => ({ banner: "", buttons: [], models: [] }));
async function until(page, ok, ms = 60000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(250)) {
    const v = await view(page);
    if (ok(v)) return v;
  }
  return view(page);
}
const settled = (v) => v.models.length > 0 || v.banner;
// Opens the app, optionally installs a page-side patch before it boots, then starts the action.
async function scenario(name, { patch, action }, run) {
  faults = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  if (patch) await ctx.addInitScript(patch);
  const page = await ctx.newPage();
  const pressed = [];
  await page.exposeFunction("__pressed", (t) => pressed.push(t));
  try {
    await page.goto(`${ORIGIN}/app/`);
    await page.waitForSelector("input[type=file]", { state: "attached" });
    await sleep(1500);
    await run(page, { pressed });
    results.push([name, "ok"]);
  } catch (err) {
    results.push([name, `FAILED: ${err.message.split("\n")[0]}`]);
  }
  console.log(results.at(-1).join("  "));
  await ctx.close();
}
const pickLocal = (page) => page.setInputFiles("input[type=file]", DEMO_PATH);
const openLibrary = async (page) => {
  const item = page.locator('.lib-row__main:has-text("Library demo"):visible').first();
  await item.waitFor({ timeout: 10000 });
  await item.click();
};
const loadedWithoutHelp = async (page, ms = 60000) => {
  const v = await until(page, settled, ms);
  assert.equal(v.models.length, 1, `not loaded; banner: ${v.banner}`);
  assert.equal(v.banner, "", `an error was shown: ${v.banner}`);
  assert.deepEqual(v.buttons, [], "a button was shown");
};
const accurate = (v) => assert.ok(!/valid IFC|doesn't look like/i.test(v.banner), `misleading text: ${v.banner}`);

// Page-side patches (run before the app boots).
const patchWorkers = () => {
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(...a) {
      super(...a);
      (window.__ws ||= []).push(this);
    }
  };
};
// The first import hits an out-of-memory error inside the worker (or every one, with __oomAlways).
const patchOom = () => {
  const W = window.Worker;
  window.Worker = class extends W {
    postMessage(m, t) {
      if (m && (m.file || m.bytes) && (window.__oomAlways || (window.__oom = (window.__oom || 0) + 1) === 1)) {
        setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: { type: "error", kind: "OUT_OF_MEMORY", stage: "parse", message: "RangeError: Array buffer allocation failed" } })), 50);
        return;
      }
      super.postMessage(m, t);
    }
  };
};

// ---- transient: the model must open with no button ----
await scenario("schema chunk 404 once", {}, async (page) => {
  fault(/web-ifc-schema/, 404);
  await pickLocal(page);
  await loadedWithoutHelp(page);
});
await scenario("schema chunk 404 twice (needs a fresh worker)", {}, async (page) => {
  fault(/iw-_virtual_web-ifc-schema/, 404, 2);
  await pickLocal(page);
  await loadedWithoutHelp(page);
});
await scenario("wasm 500 once", {}, async (page) => {
  fault(/web-ifc\.wasm/, 500, 2); // streaming compile, then its ArrayBuffer fallback
  await pickLocal(page);
  await loadedWithoutHelp(page);
});
await scenario("worker killed mid-import (no event at all)", { patch: patchWorkers }, async (page) => {
  await pickLocal(page);
  await sleep(200);
  await page.evaluate(() => window.__ws.forEach((w) => w.terminate()));
  const t0 = Date.now();
  await loadedWithoutHelp(page, 40000);
  assert.ok(Date.now() - t0 < 30000, `took ${Date.now() - t0} ms, the old wait was about 70 s`);
});
// Without Web Locks (older browsers) only the progress watchdog can notice: slow (60 s minimum), so last.
const noLocks = () => {
  Object.defineProperty(navigator, "locks", { value: undefined });
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(...a) {
      super(...a);
      (window.__ws ||= []).push(this);
    }
  };
};
await scenario("out of memory once: frees memory and retries", { patch: patchOom }, async (page) => {
  await pickLocal(page);
  await loadedWithoutHelp(page);
});
await scenario("library body cut once", {}, async (page) => {
  fault(/\/file$/, "cut", 1);
  await openLibrary(page);
  await loadedWithoutHelp(page);
});
await scenario("library body cut twice", {}, async (page) => {
  fault(/\/file$/, "cut", 2);
  await openLibrary(page);
  await loadedWithoutHelp(page);
});
await scenario("library 429 once, then 503 once", {}, async (page) => {
  fault(/\/file$/, 429, 1);
  fault(/\/file$/, 503, 1);
  await openLibrary(page);
  await loadedWithoutHelp(page);
});
await scenario("library body incomplete (shorter than the record) once", {}, async (page) => {
  fault(/\/file$/, "short", 1);
  await openLibrary(page);
  await loadedWithoutHelp(page);
});
await scenario("?model deep link while the library API answers 503 once", {}, async (page) => {
  fault(/\/api\/models\/demo1$/, 503, 1);
  await page.goto(`${ORIGIN}/app/?model=demo1`);
  await loadedWithoutHelp(page);
});
await scenario("sample: first download fails", {}, async (page) => {
  fault(/demo-building\.ifc/, 503, 1);
  await page.goto(`${ORIGIN}/app/?demo=1`);
  await loadedWithoutHelp(page);
});

await scenario("worker silently dead, no Web Locks: the progress watchdog restarts the import", { patch: noLocks }, async (page) => {
  await pickLocal(page);
  await sleep(200);
  await page.evaluate(() => window.__ws.forEach((w) => w.terminate()));
  await loadedWithoutHelp(page, 120000);
});

// ---- permanent: accurate message, buttons only now ----
await scenario("schema chunk permanently missing: accurate message, then Retry/Reload and Details", {}, async (page) => {
  fault(/iw-_virtual_web-ifc-schema/, 404, 99);
  await pickLocal(page);
  const v = await until(page, (x) => x.banner, 60000);
  accurate(v);
  assert.match(v.banner, /could not load part of itself/);
  assert.ok(v.buttons.includes("Reload") && v.buttons.includes("Retry"), `buttons: ${v.buttons}`);
});
await scenario("library permanently down: message after the automatic attempts", {}, async (page) => {
  fault(/\/file$/, 503, 99);
  await openLibrary(page);
  const v = await until(page, (x) => x.banner, 60000);
  accurate(v);
  assert.match(v.banner, /Something went wrong|try once more/i);
});
await scenario("out of memory every time: accurate message", { patch: () => { window.__oomAlways = true; const W = window.Worker; window.Worker = class extends W { postMessage(m, t) { if (m && (m.file || m.bytes)) { setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: { type: "error", kind: "OUT_OF_MEMORY", stage: "parse", message: "Out of memory" } })), 50); return; } super.postMessage(m, t); } }; } }, async (page) => {
  await pickLocal(page);
  const v = await until(page, (x) => x.banner, 30000);
  accurate(v);
  assert.match(v.banner, /Not enough memory/);
});
await scenario("a rejected file: no Retry, offers Choose another file", {}, async (page) => {
  const bad = join(work, "bad.ifc");
  writeFileSync(bad, "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n#1=GARBAGE(((;\nENDSEC;\nEND-ISO-10303-21;\n");
  await page.setInputFiles("input[type=file]", bad);
  const v = await until(page, settled, 60000);
  if (v.models.length) return; // a lenient parser that opens it is not a reliability failure
  assert.match(v.banner, /bad\.ifc/);
  assert.ok(!v.buttons.includes("Retry"), `Retry offered for a rejected file: ${v.buttons}`);
  assert.ok(v.buttons.includes("Choose another file"), `buttons: ${v.buttons}`);
});

await browser.close();
server.close();
rmSync(work, { recursive: true, force: true });
const failed = results.filter(([, r]) => r !== "ok");
console.log(failed.length ? `\n${failed.length} FAILED` : `\nall ${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);

// End-to-end: opening files never loses work and never needs a button.
//
//   node tests/e2e/load-queue.e2e.mjs            (about 8 min; ARGUS_E2E_ONLY=<regex> runs some)
//
// Covers: a chunk failure with a model open never reloads (R1); a fragments
// worker that stops answering is restarted by the build watchdog (R2); files
// picked while another opens are queued, Cancel leaks nothing (F6); Retry
// opens only the files that failed (F7); a .zip holding an .ifc opens (F8);
// a failed Replace keeps the old model (F11); header variants open (F5/F10);
// an unexpected importer error is retried with every schema (R4); the library's
// offline copy and download checks (R3). Then the key scenarios again on an
// INSECURE origin (http://argus.test, mapped to 127.0.0.1 with
// --host-resolver-rules), where the service worker, Cache Storage,
// crypto.subtle and Web Locks do not exist, as for real users on http://<ip>:3700.
//
// Same setup as auto-recovery.e2e.mjs: builds this checkout (or
// ARGUS_E2E_SITE=<dir containing app/>), a scratch nginx-like server with a
// mock library and fault injection, playwright from /opt/repos/web
// (ARGUS_E2E_WEB), port ARGUS_E2E_PORT (default 4793).
import { createRequire } from "node:module";
import http from "node:http";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(process.env.ARGUS_E2E_WEB || "/opt/repos/web/");
const { chromium } = require("playwright");
const { zipSync } = createRequire(repo)("fflate");
const PORT = Number(process.env.ARGUS_E2E_PORT || 4793);
const ONLY = process.env.ARGUS_E2E_ONLY ? new RegExp(process.env.ARGUS_E2E_ONLY) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const work = mkdtempSync(join(tmpdir(), "argus-e2e-q-"));
const site = join(work, "A");
if (process.env.ARGUS_E2E_SITE) cpSync(process.env.ARGUS_E2E_SITE, site, { recursive: true });
else {
  execFileSync("node", ["scripts/copy-wasm.mjs"], { cwd: repo, stdio: "ignore" });
  execFileSync("npx", ["vite", "build", "--base=/app/", "--outDir", join(site, "app"), "--emptyOutDir"], { cwd: repo, stdio: "ignore" });
}

// ---- test files, all made from the bundled sample (IFC4) ----
const DEMO = readFileSync(join(repo, "public/demo/demo-building.ifc"));
const demoText = DEMO.toString("latin1");
const file = (name, data) => {
  const p = join(work, name);
  writeFileSync(p, typeof data === "string" ? Buffer.from(data, "latin1") : data);
  return p;
};
const F = {
  a: file("alpha.ifc", DEMO),
  b: file("beta.ifc", DEMO),
  c: file("gamma.ifc", DEMO),
  x2: file("old-schema.ifc", demoText.replace("FILE_SCHEMA(('IFC4'))", "FILE_SCHEMA(('IFC2X3'))")),
  comment: file("commentschema.ifc", demoText.replace("ISO-10303-21;\n", "ISO-10303-21;\n/* converted from FILE_SCHEMA(('IFC2X3')) */\n")),
  lower: file("lowerschema.ifc", demoText.replace("FILE_SCHEMA(('IFC4'))", "FILE_SCHEMA(('ifc4'))")),
  far: file("farheader.ifc", "/*" + " ".repeat(5000) + "*/" + demoText),
  zip: file("plain.zip", Buffer.from(zipSync({ "inner.ifc": new Uint8Array(DEMO) }))),
  zipNoIfc: file("notes.zip", Buffer.from(zipSync({ "readme.txt": new Uint8Array(Buffer.from("hello")) }))),
  fakeZip: file("fake.zip", "this is not a zip archive"),
};
const SHA = createHash("sha256").update(DEMO).digest("hex");
const record = { id: "demo1", name: "Library demo.ifc", size: DEMO.length, sha256: SHA, schema: "IFC4", uploadedAt: "2026-01-01T00:00:00Z" };

// ---- server with fault injection ----
const MIME = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
let faults = []; // { re, mode, times }  mode: a status code | "flip"
let newerBuild = false; // the version check sees a newer deploy
const fault = (re, mode, times = 1) => faults.push({ re, mode, times });
const server = http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    const hit = faults.find((f) => f.times > 0 && f.re.test(p));
    if (hit) hit.times--;
    const mode = hit?.mode;
    if (typeof mode === "number") return (res.writeHead(mode, { "content-type": "text/plain" }), res.end("fault"));
    const json = (o) => (res.setHeader("content-type", "application/json"), res.end(JSON.stringify(o)));
    if (p === "/api/models") return json([record]);
    if (p === "/api/models/demo1") return json(record);
    if (p === "/api/models/demo1/file") {
      let body = DEMO;
      if (mode === "flip") {
        body = Buffer.from(DEMO);
        body[body.length - 40] ^= 1; // same length, one bit off: only the checksum can tell
      }
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": body.length, "cache-control": "no-store" });
      return res.end(body);
    }
    let path = normalize(join(site, p));
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
    if (!existsSync(path)) {
      const navigation = req.headers["sec-fetch-mode"] === "navigate";
      if (!navigation || !p.startsWith("/app/") || /^\/app\/(assets|wasm|fonts|demo)\//.test(p)) return (res.writeHead(404), res.end("not found"));
      path = join(site, "app/index.html");
    }
    const headers = { "content-type": MIME[extname(path)] || "application/octet-stream" };
    if (p.startsWith("/app/assets/")) headers["cache-control"] = "public, max-age=31536000, immutable";
    else if (/(index\.html|\/app\/|sw\.js)$/.test(p)) headers["cache-control"] = "no-cache";
    let body = readFileSync(path);
    if (newerBuild && url.searchParams.has("build-check")) body = Buffer.from(body.toString("utf8").replace(/(name=["']argus-build["'][^>]*content=["'])[^"']+/, "$1newer-build"));
    res.writeHead(200, headers);
    res.end(body);
  })
  .listen(PORT, "127.0.0.1");

// ---- helpers ----
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--host-resolver-rules=MAP argus.test 127.0.0.1"] });
const results = [];
const view = (page) =>
  page
    .evaluate(() => ({
      banner: [...document.querySelectorAll(".status-banner--error")].map((e) => e.innerText.replace(/\s+/g, " ").trim()).join(" | "),
      notice: [...document.querySelectorAll(".lib-notice, .toast")].map((e) => e.innerText.replace(/\s+/g, " ").trim()).join(" | "),
      buttons: [...document.querySelectorAll(".status-banner button, .lib-notice button")].map((b) => b.innerText.trim()).filter((t) => t && t !== "✕" && t !== "OK" && t !== "Copy"),
      models: [...document.querySelectorAll(".model-list .model-row__name")].map((e) => e.textContent.trim()),
      loading: !!document.querySelector(".loading-overlay"),
      label: document.querySelector(".loading-overlay")?.innerText ?? "",
      confirm: !!document.querySelector(".confirm-dialog"),
      stats: window.__argusLoadStats?.() ?? null,
      secure: window.isSecureContext,
    }))
    .catch(() => ({ banner: "", notice: "", buttons: [], models: [], loading: false, label: "", confirm: false, stats: null }));
async function until(page, ok, ms = 60000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(250)) {
    const v = await view(page);
    if (ok(v)) return v;
  }
  return view(page);
}
const idle = (v) => !v.loading && !v.confirm;
async function scenario(name, { origin = `http://localhost:${PORT}`, patch } = {}, run) {
  if (ONLY && !ONLY.test(name)) return;
  faults = [];
  newerBuild = false;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  if (patch) await ctx.addInitScript(patch);
  const page = await ctx.newPage();
  page.loads = 0;
  page.errors = [];
  page.on("load", () => page.loads++);
  page.on("pageerror", (e) => page.errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text().slice(0, 200)));
  const t0 = Date.now();
  try {
    await page.goto(`${origin}/app/`);
    await page.waitForFunction(() => performance.getEntriesByName("viewer-ready").length, null, { timeout: 90000 });
    await run(page, ctx);
    results.push([name, `ok (${Math.round((Date.now() - t0) / 1000)} s)`]);
  } catch (err) {
    results.push([name, `FAILED: ${err.message.split("\n")[0]}`]);
  }
  console.log(results.at(-1).join("  "));
  await ctx.close();
}
const pick = (page, ...paths) => page.setInputFiles("input[type=file]", paths);
const openLibrary = async (page) => {
  const item = page.locator('.lib-row__main:has-text("Library demo"):visible').first();
  await item.waitFor({ timeout: 10000 });
  await item.click();
};
const opened = async (page, names, ms = 90000) => {
  const v = await until(page, (x) => idle(x) && x.models.length >= names.length, ms);
  // The list shows names without the .ifc extension.
  assert.deepEqual([...v.models].sort(), names.map((n) => n.replace(/\.ifc$/i, "")).sort(), `models ${JSON.stringify(v)}`);
  assert.equal(v.banner, "", `an error was shown: ${v.banner}`);
  assert.deepEqual(v.buttons, [], "a button was shown");
  return v;
};
const noConsoleErrors = (page) => assert.deepEqual(page.errors.filter((e) => !/Failed to load resource/.test(e)), [], "console errors");
const fireChunkFailure = (page) => page.evaluate(() => window.dispatchEvent(Object.assign(new Event("vite:preloadError", { cancelable: true }), { payload: new Error("Failed to fetch dynamically imported module: x") })));
const insecure = `http://argus.test:${PORT}`;

// The first `count` fragments workers (the 3D engine's, worker.min-*.js) are
// cut off from the page: the port the engine talks through is replaced by one
// that leads nowhere ("hang": a model build never finishes), or by a relay
// that delivers the model's data 3 s late ("slow").
const fragmentsWorkerPatch = (mode, count) => `(() => {
  const W = window.Worker;
  let made = 0;
  window.Worker = class extends W {
    constructor(url, opts) {
      super(url, opts);
      this.__cut = /worker\\.min-/.test(String(url)) && ++made <= ${count};
    }
    postMessage(m, t) {
      if (!this.__cut || !(m instanceof MessagePort)) return super.postMessage(m, t);
      const relay = new MessageChannel();
      if ("${mode}" === "slow") {
        const big = (d, n = 0) => !!d && n < 5 && ((d instanceof ArrayBuffer || ArrayBuffer.isView(d)) ? d.byteLength > 4096 : typeof d === "object" && Object.values(d).some((v) => big(v, n + 1)));
        m.onmessage = (e) => (big(e.data) ? setTimeout(() => relay.port1.postMessage(e.data), 3000) : relay.port1.postMessage(e.data));
        relay.port1.onmessage = (e) => m.postMessage(e.data);
      }
      window.__cutWorkers = (window.__cutWorkers || 0) + 1;
      return super.postMessage(relay.port2, [relay.port2]);
    }
  };
})()`;

// ---- R1: a chunk failure never reloads away an open model ----
await scenario("R1 chunk failure with a model open, newer build deployed: no reload, model stays", {}, async (page) => {
  await pick(page, F.a);
  await opened(page, ["alpha.ifc"]);
  newerBuild = true;
  await fireChunkFailure(page);
  await sleep(4000);
  assert.equal(page.loads, 1, "the page reloaded");
  assert.deepEqual((await view(page)).models, ["alpha"]);
});
await scenario("R1 chunk failure with nothing open, newer build deployed: one reload", {}, async (page) => {
  newerBuild = true;
  await fireChunkFailure(page);
  for (let i = 0; i < 40 && page.loads < 2; i++) await sleep(250);
  assert.equal(page.loads, 2, "the stale tab did not reload");
});
await scenario("R1 chunk failure with nothing open, same build: no reload", {}, async (page) => {
  await fireChunkFailure(page);
  await sleep(4000);
  assert.equal(page.loads, 1, "a momentary failure reloaded the page");
});

// ---- R2: the fragments worker stops answering ----
await scenario("R2 fragments worker hangs once: watchdog restarts it, model opens with no button", { patch: fragmentsWorkerPatch("hang", 1) }, async (page) => {
  const t0 = Date.now();
  await pick(page, F.a);
  const v = await opened(page, ["alpha.ifc"], 150000);
  assert.equal(await page.evaluate(() => window.__cutWorkers), 1, "the hang was not simulated");
  assert.ok(Date.now() - t0 > 25000, "the model opened before the build watchdog could have fired");
  assert.deepEqual({ engine: v.stats.engine, open: v.stats.open }, { engine: 1, open: 1 });
});
await scenario("R2 fragments worker hangs every time: accurate message after the attempts, Reload offered", { patch: fragmentsWorkerPatch("hang", 99) }, async (page) => {
  const t0 = Date.now();
  await pick(page, F.a);
  const v = await until(page, (x) => idle(x) && x.banner, 240000);
  assert.match(v.banner, /3D engine stopped responding/);
  assert.ok(v.buttons.includes("Reload"), `buttons: ${v.buttons}`);
  assert.ok(Date.now() - t0 < 200000, "took too long");
});

// ---- F6: overlapping loads ----
await scenario("F6 a second pick while the first is opening is queued; it replaces the first once that is in", {}, async (page) => {
  await pick(page, F.a);
  await sleep(300);
  await pick(page, F.b);
  const queued = await until(page, (x) => /Added to the queue/.test(x.notice), 5000);
  assert.match(queued.notice, /Added to the queue: beta\.ifc/);
  // Opening replaces: only the last pick is left, and nothing of the first stays in memory.
  const v = await opened(page, ["beta.ifc"]);
  assert.deepEqual({ engine: v.stats.engine, open: v.stats.open }, { engine: 1, open: 1 });
});
await scenario("F6 a library download and a local pick at once: the later one replaces the earlier, one model is left", {}, async (page) => {
  await openLibrary(page);
  await pick(page, F.c);
  const v = await until(page, (x) => idle(x) && x.models.length >= 1 && x.stats?.queued === 0, 90000);
  await sleep(1500);
  const end = await view(page);
  assert.equal(end.models.length, 1, `models ${JSON.stringify(end.models)}`);
  assert.ok(["Library demo", "gamma"].includes(end.models[0]), `models ${JSON.stringify(end.models)}`);
  assert.deepEqual({ engine: end.stats.engine, open: end.stats.open }, { engine: 1, open: 1 });
  assert.equal(end.banner, "");
  void v;
});
await scenario("F6 Add another model puts a second model next to the first", {}, async (page) => {
  await pick(page, F.a);
  await opened(page, ["alpha.ifc"]);
  const chooser = page.waitForEvent("filechooser", { timeout: 10000 });
  await page.getByRole("button", { name: "Add another model" }).click();
  await (await chooser).setFiles([F.b]);
  const v = await opened(page, ["alpha.ifc", "beta.ifc"]);
  assert.deepEqual({ engine: v.stats.engine, open: v.stats.open }, { engine: 2, open: 2 });
});
await scenario("F6 Cancel during the build leaks no model, and the next pick works", { patch: fragmentsWorkerPatch("slow", 1) }, async (page) => {
  await pick(page, F.a, F.b);
  await until(page, (x) => /Building/.test(x.label), 30000);
  await page.click(".loading-overlay__cancel");
  await sleep(5000);
  let v = await view(page);
  assert.deepEqual({ models: v.models, ...v.stats }, { models: [], engine: 0, open: 0, queued: 0 }, "a cancelled model stayed in memory or the queue went on");
  await pick(page, F.c);
  v = await opened(page, ["gamma.ifc"]);
  assert.equal(v.stats.engine, 1);
});
await scenario("F6 adding a file with the name of a loaded one asks; Cancel keeps the old model and removes nothing", {}, async (page) => {
  await pick(page, F.a);
  await opened(page, ["alpha.ifc"]);
  const chooser = page.waitForEvent("filechooser", { timeout: 10000 });
  await page.getByRole("button", { name: "Add another model" }).click();
  await (await chooser).setFiles([F.a]);
  await page.waitForSelector(".confirm-dialog");
  await page.click(".confirm-dialog__cancel");
  const v = await until(page, idle, 20000);
  assert.deepEqual(v.models, ["alpha"]);
  assert.equal(v.stats.engine, 1);
});

// ---- F7: Retry opens only what failed ----
// The import of one named file fails as if a file of Argus's own never arrived.
const patchFailOldSchema = () => {
  const W = window.Worker;
  window.Worker = class extends W {
    postMessage(m, t) {
      if (m?.file?.name === "old-schema.ifc") {
        setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: { type: "error", kind: "APP_ASSET_FAILED", stage: "schema", message: "Failed to fetch dynamically imported module" } })), 50);
        return;
      }
      super.postMessage(m, t);
    }
  };
};
await scenario("F7 one of two files fails for good: Retry reopens only that one, no Replace question", { patch: patchFailOldSchema }, async (page) => {
  await pick(page, F.a, F.x2);
  let v = await until(page, (x) => idle(x) && x.banner, 90000);
  assert.deepEqual(v.models, ["alpha"]);
  assert.match(v.banner, /could not load part of itself/);
  assert.ok(v.buttons.includes("Retry"), `buttons: ${v.buttons}`);
  await page.click('.status-banner button:has-text("Retry")');
  v = await until(page, (x) => x.confirm || (idle(x) && x.banner), 90000);
  assert.equal(v.confirm, false, "Retry asked to replace a model that had loaded");
  assert.deepEqual(v.models, ["alpha"]);
});

// ---- F8: .zip ----
await scenario("F8 a .zip holding an .ifc opens; other .zip files get an accurate message and no Retry", {}, async (page) => {
  await pick(page, F.zip);
  await opened(page, ["inner.ifc"]);
  await pick(page, F.zipNoIfc);
  let v = await until(page, (x) => idle(x) && x.banner, 30000);
  assert.match(v.banner, /"notes\.zip" does not contain an \.ifc file/);
  assert.ok(!v.buttons.includes("Retry") && v.buttons.includes("Choose another file"), `buttons: ${v.buttons}`);
  await pick(page, F.fakeZip);
  v = await until(page, (x) => idle(x) && /fake\.zip/.test(x.banner), 30000);
  assert.match(v.banner, /"fake\.zip" is not a ZIP archive/);
});

// ---- F11: a failed Replace keeps the old model ----
// From the second import on, the importer fails every time (Argus's own error).
const patchFailFromSecond = () => {
  const W = window.Worker;
  let imports = 0;
  window.Worker = class extends W {
    postMessage(m, t) {
      if (m && (m.file || m.bytes) && ++imports >= 2) {
        setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: { type: "error", kind: "UNKNOWN", stage: "parse", message: "RuntimeError: unreachable" } })), 50);
        return;
      }
      super.postMessage(m, t);
    }
  };
};
await scenario("F11 Replace whose new import fails: the old model is still there", { patch: patchFailFromSecond }, async (page) => {
  await pick(page, F.a);
  await opened(page, ["alpha.ifc"]);
  await pick(page, F.a); // replaces without a question; the import fails, so the old one stays
  const v = await until(page, (x) => idle(x) && x.banner, 90000);
  assert.equal(await page.locator(".confirm-dialog").count(), 0, "replace asks no question");
  assert.deepEqual(v.models, ["alpha"], "the old model was removed");
  assert.equal(v.stats.engine, 1);
  assert.match(v.banner, /Argus hit an unexpected error opening "alpha\.ifc", even after trying again/);
  assert.doesNotMatch(v.banner, /valid IFC/);
});

// ---- F5 / F10: header variants of a valid file ----
await scenario("F5/F10 a schema named in a comment, a lower-case schema, a header after a 5 KB comment: all open", {}, async (page) => {
  await pick(page, F.comment, F.lower, F.far);
  await opened(page, ["commentschema.ifc", "lowerschema.ifc", "farheader.ifc"]);
  noConsoleErrors(page);
});

// ---- R4: an unexpected importer error is retried with every schema ----
const patchTypeErrorOnce = () => {
  const W = window.Worker;
  window.__imports = [];
  window.Worker = class extends W {
    postMessage(m, t) {
      if (m && (m.file || m.bytes)) {
        window.__imports.push({ allSchemas: !!m.allSchemas });
        if (window.__imports.length === 1) {
          setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: { type: "error", kind: "UNKNOWN", stage: "parse", message: "Cannot convert undefined or null to object" } })), 50);
          return;
        }
      }
      super.postMessage(m, t);
    }
  };
};
await scenario("R4 a TypeError inside the importer: retried with every schema, opens, never 'not valid'", { patch: patchTypeErrorOnce }, async (page) => {
  await pick(page, F.a);
  await opened(page, ["alpha.ifc"]);
  assert.deepEqual(await page.evaluate(() => window.__imports), [{ allSchemas: false }, { allSchemas: true }]);
});

// ---- R3: the library's offline copy and download checks ----
await scenario("R3 library: a corrupted download (checksum) is fetched again by itself", {}, async (page) => {
  fault(/\/api\/models\/demo1\/file$/, "flip", 1);
  await openLibrary(page);
  await opened(page, ["Library demo.ifc"]);
});
await scenario("R3 library: a model opened before reopens from the offline copy when the server is down", {}, async (page, ctx) => {
  await openLibrary(page);
  await opened(page, ["Library demo.ifc"]);
  await sleep(1000); // the copy is written after the open
  const page2 = await ctx.newPage();
  await page2.goto(`http://localhost:${PORT}/app/`);
  await page2.waitForFunction(() => performance.getEntriesByName("viewer-ready").length, null, { timeout: 90000 });
  fault(/\/api\/models\/demo1\/file$/, 503, 999);
  await openLibrary(page2);
  await opened(page2, ["Library demo.ifc"]);
});

// ---- the same on an insecure origin (what real users on http://<ip>:3700 run) ----
await scenario("INSECURE origin: no service worker, caches, crypto.subtle or Web Locks", { origin: insecure }, async (page) => {
  const env = await page.evaluate(() => ({ secure: isSecureContext, caches: typeof caches, subtle: typeof crypto.subtle, locks: typeof navigator.locks, sw: "serviceWorker" in navigator }));
  assert.deepEqual(env, { secure: false, caches: "undefined", subtle: "undefined", locks: "undefined", sw: false });
});
await scenario("INSECURE local pick, queued second pick, header variants: all open, no console errors", { origin: insecure }, async (page) => {
  await pick(page, F.a);
  await sleep(300);
  await pick(page, F.b, F.zip, F.comment, F.lower, F.far);
  // the second pick replaces the first: its five files are all open, alpha is gone
  await opened(page, ["beta.ifc", "inner.ifc", "commentschema.ifc", "lowerschema.ifc", "farheader.ifc"], 150000);
  noConsoleErrors(page);
});
await scenario("INSECURE library open (plain download, no checksum, no offline copy)", { origin: insecure }, async (page) => {
  await openLibrary(page);
  await opened(page, ["Library demo.ifc"]);
  noConsoleErrors(page);
});
await scenario("INSECURE worker silently killed: the stall watchdog (no Web Locks) restarts the import", { origin: insecure, patch: () => {
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(...a) {
      super(...a);
      (window.__ws ||= []).push(this);
    }
  };
} }, async (page) => {
  await pick(page, F.a);
  await sleep(300);
  await page.evaluate(() => window.__ws.forEach((w) => w.terminate()));
  await opened(page, ["alpha.ifc"], 150000);
});
await scenario("INSECURE fragments worker hangs once: model opens with no button", { origin: insecure, patch: fragmentsWorkerPatch("hang", 1) }, async (page) => {
  await pick(page, F.a);
  await opened(page, ["alpha.ifc"], 150000);
});
await scenario("INSECURE chunk failure with a model open, newer build: no reload", { origin: insecure }, async (page) => {
  await pick(page, F.a);
  await opened(page, ["alpha.ifc"]);
  newerBuild = true;
  await fireChunkFailure(page);
  await sleep(4000);
  assert.equal(page.loads, 1, "the page reloaded");
});

await browser.close();
server.close();
rmSync(work, { recursive: true, force: true });
const failed = results.filter(([, r]) => !r.startsWith("ok"));
console.log(failed.length ? `\n${failed.length} FAILED` : `\nall ${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);

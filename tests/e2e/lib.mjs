// Shared helpers for the Argus end-to-end tests (playwright via /opt/repos/web).
//
// A test file is a plain node script:
//
//   import { suite } from "./lib.mjs";
//   suite("first-open", [
//     { name: "empty state", fn: async ({ page, app }) => { ... } },
//   ]);
//
// Every case runs once per project (desktop, iphone13, ipad-mini unless the
// case narrows it), in a fresh browser context, with no retries. Console
// errors, page errors, failed requests and HTTP >= 400 answers fail the case
// unless the case lists them in allowErrors. One PASS/FAIL line is printed
// per case and project; the process exit code is non-zero if any case failed.
import { createRequire } from "node:module";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";

const require = createRequire("/opt/repos/web/");
export const { chromium, devices } = require("playwright");

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..", "..");
export const FIXTURES = join(ROOT, "tests", "fixtures");
export const OUT = join(here, "out");

export const BASE = (process.env.ARGUS_URL || "http://localhost:3700").replace(/\/$/, "");
const [USER, PASS] = (process.env.ARGUS_AUTH || "ifc:123").split(":");
export const AUTH_HEADER = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");
export const APP = `${BASE}/app/`;
export const LAUNCH_ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"];

// Where optional big inputs live (override with env; tests skip when absent).
const SCRATCH = "/tmp/claude-0/-root/4f24897c-48d0-4eff-b5a8-46f80d3bfbbf/scratchpad";
export const BIG_FILE = process.env.ARGUS_BIG_FILE || `${SCRATCH}/bigfile/big20.ifc`;
export const MODELS_DIR = process.env.ARGUS_MODELS_DIR || `${SCRATCH}/models`;
export const DEMO_FILE = join(ROOT, "public", "demo", "demo-building.ifc");

export const PROJECTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  iphone13: { ...devices["iPhone 13"] },
  "ipad-mini": { ...devices["iPad Mini"] },
  pixel7: { ...devices["Pixel 7"] }, // opt-in: a case lists it in `projects`
  small320: { ...devices["iPhone SE"], viewport: { width: 320, height: 568 } }, // opt-in: the smallest phone we support
};
const DEFAULT_PROJECTS = ["desktop", "iphone13", "ipad-mini"];
export const isTouch = (project) => project !== "desktop";
export const isPhone = (project) => project === "iphone13" || project === "pixel7" || project === "small320";

// ARGUS_TIMEOUT_SCALE=3 gives every wait and every case three times as long, for a busy runner.
export const TIME_SCALE = Number(process.env.ARGUS_TIMEOUT_SCALE) || Number(process.env.ARGUS_TIMEOUT_X) || 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { sleep };

// ---------------------------------------------------------------- app helpers

export const markCount = (page, name) => page.evaluate((n) => performance.getEntriesByName(n).length, name);

export async function waitForMark(page, name, above = 0, timeout = 60000 * TIME_SCALE) {
  await page.waitForFunction(([n, a]) => performance.getEntriesByName(n).length > a, [name, above], { timeout });
}

// The viewer engine is up (empty state is interactive).
export async function openApp(page, { query = "", hash = "" } = {}) {
  await page.goto(`${APP}${query}${hash}`, { waitUntil: "domcontentloaded" });
  await waitForMark(page, "viewer-ready", 0, 60000 * TIME_SCALE);
}

// Runs `action`, then waits until the viewer reports one more model on screen
// ("model-shown" mark) and the loading overlay is gone. Works on phones, where
// the sidebar rows are inside a closed drawer.
export async function waitForModelAfter(page, action, timeout = 60000 * TIME_SCALE) {
  const before = await markCount(page, "model-shown");
  await action();
  await waitForMark(page, "model-shown", before, timeout);
  await page.locator(".loading-overlay").waitFor({ state: "detached", timeout });
  await settle(page);
}

// Let the camera framing animation and streamed geometry finish.
export async function settle(page, ms = 600) {
  await page.waitForTimeout(ms);
}

export async function loadSample(page) {
  // The sample building lives in the dummy project (or is the one built-in row when there is no library).
  const dummy = page.getByRole("button", { name: "Try a dummy project" });
  const row = page.getByRole("button", { name: "Open Sample building" });
  await dummy.or(row).first().waitFor();
  if (await dummy.isVisible()) await dummy.click();
  await waitForModelAfter(page, () => row.click());
}

// Opens a local file through the file chooser input; resolves when the model shows.
export async function loadFile(page, path) {
  await waitForModelAfter(page, () => setFile(page, path));
}
export async function setFile(page, path) {
  await page.locator('input[type="file"]').first().setInputFiles(path);
}

// Shown error banner text ("" if none).
export async function bannerText(page) {
  const el = page.locator(".status-banner--error");
  return (await el.count()) ? (await el.first().innerText()).replace(/\s*(Retry)?\s*✕\s*$/, "").trim() : "";
}

export async function waitForBanner(page, pattern, timeout = 20000) {
  await page.locator(".status-banner--error", { hasText: pattern }).first().waitFor({ state: "visible", timeout });
  return bannerText(page);
}

export const canvasBox = async (page) => {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("no canvas on the page");
  return box;
};

// Pixel statistics of a screenshot clip (png decoded in the page). A scene with a
// model has many distinct colours; the empty background has almost one.
export async function canvasStats(page) {
  const png = await page.screenshot({ clip: await visibleViewportClip(page) });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const bins = new Set();
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 7) {
      const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
      sum += l;
      sum2 += l * l;
      n++;
      bins.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
    }
    const mean = sum / n;
    return { colours: bins.size, variance: sum2 / n - mean * mean };
  }, png.toString("base64"));
}
async function visibleViewportClip(page) {
  const b = await canvasBox(page);
  // the middle 60% of the canvas: clear of toolbars and panels
  return { x: b.x + b.width * 0.2, y: b.y + b.height * 0.25, width: b.width * 0.6, height: b.height * 0.4 };
}

// Click/tap the model at the middle of the canvas (the framed model sits there).
export async function tapModel(page, project, frac = { x: 0.5, y: 0.45 }) {
  const b = await canvasBox(page);
  const x = b.x + b.width * frac.x;
  const y = b.y + b.height * frac.y;
  if (isTouch(project)) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  return { x, y };
}

export async function hasHook(page) {
  return page.evaluate(() => !!window.__ifcDebug);
}

// Skips the case with a clear message when the page was not built with VITE_TEST_HOOK=1.
export async function requireHook(page, skip) {
  if (!(await hasHook(page))) skip("needs a build made with VITE_TEST_HOOK=1 (window.__ifcDebug); see tests/TESTING.md");
}

export const open_menu_if_phone = async (page, project) => {
  if (isPhone(project)) await page.getByRole("button", { name: "Open menu" }).click();
};

// ------------------------------------------------------------------- library API (node side)

const apiGet = (p, init = {}) => fetch(`${BASE}/api${p}`, { ...init, headers: { authorization: AUTH_HEADER, ...(init.headers || {}) } });
export const api = { get: apiGet };

// Uploads a unique throwaway model and returns its record. The name always starts
// with __test_ and the content is unique per call, so it can never be (or dedupe
// into) one of the real models. `remove` refuses to delete anything else.
export async function createThrowaway(buildIfc) {
  const tag = randomBytes(5).toString("hex");
  const name = `__test_${tag}.ifc`;
  const text = buildIfc(tag);
  let res = await apiGet(`/models?name=${encodeURIComponent(name)}`, { method: "POST", body: text });
  // The service allows 10 uploads a minute per client. Waiting out its Retry-After is
  // politeness to the rate limiter, not a retry of a flaky assertion.
  for (let i = 0; i < 2 && res.status === 429; i++) {
    await sleep((Number(res.headers.get("retry-after")) || 30) * 1000 + 500);
    res = await apiGet(`/models?name=${encodeURIComponent(name)}`, { method: "POST", body: text });
  }
  if (res.status !== 201) throw new Error(`throwaway upload expected 201, got ${res.status}`);
  const record = await res.json();
  if (!record.name.startsWith("__test_")) throw new Error(`refusing: uploaded record is named ${record.name}`);
  return record;
}
export async function removeThrowaway(record) {
  if (!record) return;
  // Re-read the record: it may have been renamed through the UI, but only our own ids are ever deleted.
  const res = await apiGet(`/models/${encodeURIComponent(record.id)}`);
  if (res.status === 404) return;
  const now = await res.json();
  if (!/^__test_/.test(now.name)) throw new Error(`refusing to delete ${now.id} (${now.name})`);
  const del = await apiGet(`/models/${encodeURIComponent(record.id)}`, { method: "DELETE" });
  if (![200, 204, 404].includes(del.status)) throw new Error(`delete answered ${del.status}`);
}
export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// ------------------------------------------------------------------- runner

const timeoutOf = (c) => (c.timeout ?? 90000) * TIME_SCALE;

function allowed(list, text) {
  return list.some((p) => (p instanceof RegExp ? p.test(text) : text.includes(p)));
}

class Skip extends Error {}

export async function suite(title, cases) {
  const only = process.env.ARGUS_PROJECTS?.split(",").map((s) => s.trim());
  const onlyCase = process.env.ARGUS_ONLY;
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  let failed = 0;
  let known = 0;
  let skipped = 0;
  let passed = 0;
  for (const c of cases) {
    if (onlyCase && !c.name.includes(onlyCase)) continue;
    for (const project of c.projects ?? DEFAULT_PROJECTS) {
      if (only && !only.includes(project)) continue;
      const label = `${title} / ${c.name} [${project}]`;
      const t0 = Date.now();
      const errors = [];
      const ctx = await browser.newContext({ ...PROJECTS[project], httpCredentials: { username: USER, password: PASS }, ...(c.context ?? {}) });
      // The welcome screen (src/access/Welcome.jsx) is the first screen on a device that has not seen it; every
      // suite except "welcome" starts as a device that has, so its flows begin at the viewer.
      if (title !== "welcome") await ctx.addInitScript(() => { try { localStorage.setItem("argus.welcome.v1", "1"); } catch { /* ignore */ } });
      const page = await ctx.newPage();
      // ARGUS_IGNORE_SESSION_404=1: a deployment without the access API answers /api/session with 404; the
      // browser logs that one line itself. Everything else still counts.
      const session404 = (url) => process.env.ARGUS_IGNORE_SESSION_404 && /\/api\/(session|folders)$/.test(url || "");
      page.on("console", (m) => m.type() === "error" && !session404(m.location()?.url) && errors.push(`console.error: ${m.text()}`));
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      // ERR_ABORTED is a request the browser itself cancelled (a navigation left the page, an
      // image scrolled away): not an app error. Real failures have other error texts.
      page.on("requestfailed", (r) => r.failure()?.errorText !== "net::ERR_ABORTED" && errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
      page.on("response", (r) => r.status() >= 400 && !(r.status() === 404 && session404(r.url())) && errors.push(`http ${r.status()}: ${r.url()}`));
      let outcome = "PASS";
      let detail = "";
      let timer;
      try {
        const skip = (why) => { throw Object.assign(new Skip(why)); };
        const run = c.fn({ page, ctx, project, browser, skip, errors, touch: isTouch(project), phone: isPhone(project) });
        const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${timeoutOf(c) / 1000} s`)), timeoutOf(c)); });
        await Promise.race([run, timeout]);
        const unexpected = errors.filter((e) => !allowed(c.allowErrors ?? [], e));
        if (unexpected.length) throw new Error(`unexpected browser errors:\n  ${unexpected.slice(0, 6).join("\n  ")}`);
      } catch (e) {
        if (e instanceof Skip) {
          outcome = "SKIP";
          detail = e.message;
        } else {
          outcome = "FAIL";
          detail = e.message.split("\n").slice(0, 8).join("\n    ");
          try {
            await page.screenshot({ path: join(OUT, `${title}-${c.name.slice(0, 50)}-${project}.png`.replace(/[^\w.\-]+/g, "_")) });
          } catch { /* page already gone */ }
        }
      } finally {
        clearTimeout(timer);
        await ctx.close().catch(() => {});
      }
      const ms = Date.now() - t0;
      if (outcome === "FAIL" && c.knownFailing && !process.env.ARGUS_STRICT) {
        outcome = "KNOWN-FAIL";
        known++;
        detail = `${detail}\n    (known bug: ${c.knownFailing})`;
      } else if (outcome === "PASS" && c.knownFailing) {
        detail = "passes now: remove knownFailing from this case";
      } else if (outcome === "FAIL") failed++;
      else if (outcome === "SKIP") skipped++;
      else passed++;
      console.log(`${outcome.padEnd(10)} ${label} (${(ms / 1000).toFixed(1)} s)${detail ? `\n    ${detail}` : ""}`);
    }
  }
  await browser.close();
  console.log(`${failed ? "FAIL" : "PASS"} ${title}: ${passed} passed, ${failed} failed, ${known} known-fail, ${skipped} skipped`);
  process.exit(failed ? 1 : 0);
}

export { existsSync };

// ---------------------------------------------------------------- more helpers

export const fx = (name) => join(FIXTURES, name);

// Opens the Views and levels panel and returns what the level chips say:
// [{ name: "First", elevation: "+3.00 m" }] highest first, as the panel lists them.
export async function readLevels(page) {
  await stableClick(page.getByRole("button", { name: "Views and levels" }));
  const dialog = page.getByRole("dialog", { name: "Views and levels" });
  await dialog.waitFor({ state: "visible" });
  const titles = await dialog.getByRole("group", { name: "Levels" }).locator("button[title]").evaluateAll((els) => els.map((e) => e.title));
  return titles.map((t) => {
    const i = t.lastIndexOf(", ");
    return { name: t.slice(0, i), elevation: t.slice(i + 2) };
  });
}
export async function closeViews(page) {
  const done = page.getByRole("dialog", { name: "Views and levels" }).getByRole("button", { name: "Done" });
  if (await done.isVisible().catch(() => false)) await done.click();
}

// Text of the properties panel (info tab), "" when nothing is selected.
export const panelText = (page) => page.locator(".element-panel").first().innerText();

// Downloads one library model by name pattern (read-only GET) to a temp file; returns the path or null.
export async function downloadLibraryModel(pattern) {
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const list = await (await api.get("/models")).json();
  const m = list.find((x) => pattern.test(x.name));
  if (!m) return null;
  const buf = Buffer.from(await (await api.get(`/models/${encodeURIComponent(m.id)}/file`)).arrayBuffer());
  const dir = mkdtempSync(join(tmpdir(), "argus-e2e-"));
  const path = join(dir, "FZK-test.ifc");
  writeFileSync(path, buf);
  return path;
}

// Clicks a control once its position has not moved for `quietMs`. The viewer
// re-lays out its floating controls while a model is being framed, and a click
// that lands mid-move hits the neighbour (seen once: Views -> Share tooltip).
export async function stableClick(locator, quietMs = 500) {
  let last = "";
  let since = Date.now();
  for (let i = 0; i < 100; i++) {
    const b = await locator.boundingBox();
    const key = b ? `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)}` : "";
    if (key !== last) {
      last = key;
      since = Date.now();
    } else if (key && Date.now() - since >= quietMs) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await locator.click();
}

// Mean absolute difference (0-255) between two PNG screenshots of the same size.
export async function pngDiff(page, a, b) {
  return page.evaluate(async ([x, y]) => {
    const load = async (b64) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    const [da, db] = await Promise.all([load(x), load(y)]);
    if (da.length !== db.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < da.length; i += 4) sum += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
    return sum / (da.length / 4) / 3;
  }, [a.toString("base64"), b.toString("base64")]);
}

// Screenshot of the middle of the 3D view (no toolbars, no panels).
export async function viewShot(page) {
  const b = await canvasBox(page);
  return page.screenshot({ clip: { x: b.x + b.width * 0.25, y: b.y + b.height * 0.25, width: b.width * 0.5, height: b.height * 0.4 } });
}

export const measureTab = (page) => page.locator(".element-panel__tab", { hasText: /^\s*Measure/ }).first();

// Records every toast that appears: window.__toasts = ["Closest zoom", ...].
export async function watchToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    const seen = (n) => {
      if (n.nodeType !== 1) return;
      for (const el of n.matches?.(".toast") ? [n] : n.querySelectorAll?.(".toast") ?? []) window.__toasts.push(el.textContent.trim());
    };
    new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach(seen))).observe(document.body, { childList: true, subtree: true });
  });
}
export const toastsNamed = (page, text) => page.evaluate((t) => window.__toasts.filter((x) => x === t).length, text);

// Raw touch input through the DevTools protocol (playwright's touchscreen can only tap).
export async function touchSession(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  const send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, id) => ({ x: p.x, y: p.y, id })) });
  return {
    async drag(from, to, steps = 12) {
      await send("touchStart", [from]);
      for (let i = 1; i <= steps; i++) await send("touchMove", [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
      await send("touchEnd", []);
    },
    // two fingers around `c`, moving from distance d0 apart to d1 apart
    async pinch(c, d0, d1, steps = 12) {
      const at = (d) => [{ x: c.x - d / 2, y: c.y }, { x: c.x + d / 2, y: c.y }];
      await send("touchStart", at(d0));
      for (let i = 1; i <= steps; i++) {
        await send("touchMove", at(d0 + ((d1 - d0) * i) / steps));
        await new Promise((r) => setTimeout(r, 16));
      }
      await send("touchEnd", []);
    },
  };
}

// Welcome screen (src/access/Welcome.jsx): starts its own scratch backend (/opt/repos/argus-api, ports 4231/4232 by
// default, never the live 4181/4183) and the scratch static+proxy server, then drives the first-visit flow.
// usage: WELCOME_DIST=<dir that contains app/> node tests/e2e/welcome.e2e.mjs   (vite build --base=/app/ --outDir <dir>/app)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API_PORT = Number(process.env.WELCOME_API_PORT || 4231), WEB_PORT = Number(process.env.WELCOME_WEB_PORT || 4232);
const DIST = process.env.WELCOME_DIST;
if (!DIST) throw new Error("set WELCOME_DIST to a dir that contains app/ (a vite build with --base=/app/)");
process.env.ARGUS_URL = `http://127.0.0.1:${WEB_PORT}`;
const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "welcome-"));
const kids = [
  spawn("node", ["--no-warnings", join(process.env.DEMO_API || "/opt/repos/argus-api", "server.mjs")], { stdio: "ignore", env: { ...process.env, PORT: String(API_PORT), DATA_DIR: dir, ARGUS_REQUIRE_SESSION: "1", TRUST_PROXY: "1", ARGUS_SECRET: "t", ARGUS_ADMIN_TOKEN: "t", BILLING_PROVIDER: "fake", COOKIE_SECURE: "0", MIN_FREE_BYTES: "0", ARGUS_SETTINGS_TTL_MS: "0" } }),
  spawn("node", [join(here, "serve-access.mjs"), DIST, String(WEB_PORT), String(API_PORT)], { stdio: "ignore", env: { ...process.env, SPREAD_IP: "1" } }),
];
process.on("exit", () => kids.forEach((k) => k.kill()));
for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${WEB_PORT}/api/health`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }

const { suite, openApp, OUT } = await import("./lib.mjs");
const SHOTS = process.env.ARGUS_SHOTS || `${OUT}/welcome`;
mkdirSync(SHOTS, { recursive: true });
const NOISE = [/Failed to load resource/, /api\//];
const admin = async (method, path, body) => fetch(`http://127.0.0.1:${API_PORT}/api/admin${path}`, { method, headers: { Authorization: "Bearer t", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const setHours = async (h) => assert.ok((await admin("PUT", "/settings/anonymous_trial_hours", { value: h })).ok, "set anonymous_trial_hours");
const welcome = (page) => page.getByTestId("welcome");
const shot = async (page, project, name) => { await page.waitForTimeout(450); return page.screenshot({ path: `${SHOTS}/${name}-${project}.png` }); };
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "horizontal overflow");
// A new device: no cookie, no stored flags.
const newDevice = async (page) => { await page.context().clearCookies(); await page.evaluate(() => localStorage.clear()).catch(() => {}); };
const openViewerBtn = (page) => welcome(page).getByRole("button", { name: /Open the viewer|Åpne viewer/ });

await suite("welcome", [
  {
    name: "first visit: welcome with trial length, one button, links; Open the viewer shows the viewer with samples; not again after reload",
    allowErrors: NOISE,
    fn: async ({ page, project }) => {
      await setHours(24);
      await openApp(page);
      await welcome(page).waitFor();
      assert.equal(await page.getByRole("heading", { level: 1, name: "Try Argus free for 24 hours" }).count(), 1);
      assert.match(await welcome(page).innerText(), /free time started when you opened Argus/);
      assert.match(await welcome(page).innerText(), /files stay on your device unless you save them/);
      assert.equal(await welcome(page).getByRole("button").count() - 2, 1, "one primary button plus the two text links");
      assert.equal(await welcome(page).getByRole("button", { name: "Start free trial" }).count(), 0);
      assert.equal(await page.getByText(/try a sample building/i).count(), 0, "no separate sample button");
      assert.equal(await welcome(page).getByRole("link", { name: "Terms" }).getAttribute("href"), "#/legal/terms");
      assert.equal(await welcome(page).getByRole("link", { name: "Privacy" }).getAttribute("href"), "#/legal/privacy");
      await shot(page, project, "welcome");
      await openViewerBtn(page).click();
      await welcome(page).waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Open Sample building" }).waitFor();
      assert.equal(await page.getByRole("heading", { name: "Samples" }).count() + (await page.getByText("Samples", { exact: true }).count()) > 0, true, "Samples group in the viewer's empty state");
      await page.getByRole("button", { name: "Open IFC file" }).waitFor();
      await shot(page, project, "viewer");
      await page.reload();
      await page.waitForTimeout(1200);
      assert.equal(await welcome(page).count(), 0, "welcome again after reload");
    },
  },
  {
    name: "trial length follows the backend setting: 6 hours, 72 hours is 3 days, 1 hour",
    projects: ["desktop"],
    allowErrors: NOISE,
    fn: async ({ page }) => {
      try {
        for (const [h, text] of [[6, "Try Argus free for 6 hours"], [72, "Try Argus free for 3 days"], [1, "Try Argus free for 1 hour"]]) {
          await setHours(h);
          await newDevice(page);
          await openApp(page);
          await welcome(page).waitFor();
          assert.equal(await welcome(page).getByRole("heading", { level: 1 }).innerText(), text);
        }
      } finally { await setHours(24); }
    },
  },
  {
    name: "access code 123 shows the granted 30 days, then the viewer",
    allowErrors: [...NOISE],
    fn: async ({ page }) => {
      await admin("POST", "/codes", { code: "123", durationDays: 30 }); // 409 when an earlier run made it
      await openApp(page);
      await welcome(page).waitFor();
      await welcome(page).getByRole("button", { name: "I have an access code" }).click();
      await page.getByRole("textbox", { name: "Access code" }).fill("123");
      await page.getByRole("button", { name: "Apply" }).click();
      await page.getByText(/30 days of access added/).waitFor();
      await welcome(page).waitFor({ state: "detached" });
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Open IFC file" }).waitFor();
    },
  },
  {
    name: "Log in opens the form; closing it returns to the welcome",
    allowErrors: NOISE,
    fn: async ({ page, project }) => {
      await openApp(page);
      await welcome(page).waitFor();
      await welcome(page).getByRole("button", { name: "Log in" }).click();
      const dlg = page.getByRole("dialog", { name: "Log in" });
      await dlg.waitFor();
      await page.waitForTimeout(450);
      await shot(page, project, "login");
      await dlg.getByRole("button", { name: "Close" }).click();
      await dlg.waitFor({ state: "detached" });
      await welcome(page).waitFor();
    },
  },
  {
    name: "legacy mode (/api/session 404): no welcome",
    allowErrors: NOISE,
    fn: async ({ page }) => {
      await page.route("**/api/session", (r) => r.fulfill({ status: 404, body: "not found", contentType: "text/plain" }));
      await openApp(page);
      await page.waitForTimeout(800);
      assert.equal(await welcome(page).count(), 0);
      await page.getByRole("heading", { name: "Open a building model" }).waitFor();
    },
  },
  {
    name: "?demo=1 and ?model= go straight to the viewer",
    allowErrors: NOISE,
    fn: async ({ page }) => {
      await page.goto(`${process.env.ARGUS_URL}/app/?demo=1`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      assert.equal(await welcome(page).count(), 0, "welcome over ?demo=1");
      await newDevice(page);
      await page.goto(`${process.env.ARGUS_URL}/app/?model=nothing-here`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      assert.equal(await welcome(page).count(), 0, "welcome over ?model=");
    },
  },
  {
    name: "a file opened while the welcome is up (drop or picker) removes it",
    projects: ["desktop"],
    allowErrors: NOISE,
    fn: async ({ page }) => {
      const { loadFile } = await import("./lib.mjs");
      await openApp(page);
      await welcome(page).waitFor();
      await loadFile(page, new URL("../fixtures/m-ifc4.ifc", import.meta.url).pathname);
      assert.equal(await welcome(page).count(), 0);
    },
  },
  {
    name: "320 px: no overflow, every target 44 px, nothing clipped",
    projects: ["iphone13"],
    allowErrors: NOISE,
    fn: async ({ page, project }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await openApp(page);
      await welcome(page).waitFor();
      await page.waitForTimeout(450);
      await noOverflow(page);
      const bad = await page.evaluate(() => [...document.querySelectorAll('[data-testid="welcome"] button, [data-testid="welcome"] a')].map((e) => ({ t: e.textContent.trim(), h: Math.round(e.getBoundingClientRect().height), r: Math.round(e.getBoundingClientRect().right) })).filter((x) => x.h < 44 || x.r > 320));
      assert.deepEqual(bad, []);
      await shot(page, project, "welcome-320");
    },
  },
  {
    name: "desktop targets are 44 px as well",
    projects: ["desktop"],
    allowErrors: NOISE,
    fn: async ({ page }) => {
      await openApp(page);
      await welcome(page).waitFor();
      await page.waitForTimeout(450);
      const bad = await page.evaluate(() => [...document.querySelectorAll('[data-testid="welcome"] button, [data-testid="welcome"] a')].map((e) => ({ t: e.textContent.trim(), h: Math.round(e.getBoundingClientRect().height) })).filter((x) => x.h < 44));
      assert.deepEqual(bad, []);
    },
  },
  {
    name: "keyboard: focus starts on Open the viewer; Tab walks code, log in, terms, privacy; the viewer behind is unreachable; Enter opens",
    projects: ["desktop"],
    allowErrors: NOISE,
    fn: async ({ page }) => {
      await openApp(page);
      await welcome(page).waitFor();
      const label = () => page.evaluate(() => document.activeElement?.textContent.trim());
      assert.equal(await label(), "Open the viewer");
      const seen = [];
      for (let i = 0; i < 4; i++) { await page.keyboard.press("Tab"); seen.push(await label()); }
      assert.deepEqual(seen.slice(0, 4), ["I have an access code", "Log in", "Terms", "Privacy"]);
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="welcome"]') || document.activeElement === document.body), true, "focus left the welcome for the inert viewer");
      await openViewerBtn(page).focus();
      await page.keyboard.press("Enter");
      await welcome(page).waitFor({ state: "detached" });
    },
  },
  {
    name: "Terms opens the legal page; closing returns to the welcome",
    projects: ["desktop"],
    allowErrors: NOISE,
    fn: async ({ page }) => {
      await openApp(page);
      await welcome(page).waitFor();
      await welcome(page).getByRole("link", { name: "Terms" }).click();
      await page.getByTestId("legal-page").waitFor();
      assert.equal(await welcome(page).count(), 0);
      await page.goBack();
      await welcome(page).waitFor();
    },
  },
  {
    name: "Norwegian browser: welcome in nb",
    projects: ["desktop"],
    context: { locale: "nb-NO" },
    allowErrors: NOISE,
    fn: async ({ page, project }) => {
      await openApp(page);
      await welcome(page).waitFor();
      assert.equal(await welcome(page).getByRole("heading", { level: 1 }).innerText(), "Prøv Argus gratis i 24 timer");
      await openViewerBtn(page).waitFor();
      assert.equal(await welcome(page).getByRole("button", { name: "Åpne viewer" }).count(), 1);
      assert.equal(await welcome(page).getByRole("button", { name: "Logg inn" }).count(), 1);
      await shot(page, project, "welcome-nb");
    },
  },
]);

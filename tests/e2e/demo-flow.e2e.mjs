// Demo journey end to end: starts its own scratch backend (ARGUS_DEMO=1, /opt/repos/argus-api) and the scratch static+proxy
// server, then drives trial, grace, paywall, sign-up, demo inbox, verify, fake card, declined card, magic link, code 123.
// usage: DEMO_API=/opt/repos/argus-api node tests/e2e/demo-flow.e2e.mjs   (dist built with: vite build --base=/app/ --outDir <DEMO_DIST>/app)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API_PORT = Number(process.env.DEMO_API_PORT || 4193), WEB_PORT = Number(process.env.DEMO_WEB_PORT || 4198);
const DIST = process.env.DEMO_DIST;
if (!DIST) throw new Error("set DEMO_DIST to a dir that contains app/ (a vite build with --base=/app/)");
process.env.ARGUS_URL = `http://127.0.0.1:${WEB_PORT}`;
const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "demo-flow-"));
const kids = [
  spawn("node", ["--no-warnings", join(process.env.DEMO_API || "/opt/repos/argus-api", "server.mjs")], { stdio: "ignore", env: { ...process.env, PORT: String(API_PORT), DATA_DIR: dir, ARGUS_DEMO: "1", ARGUS_REQUIRE_SESSION: "1", TRUST_PROXY: "1", ARGUS_SECRET: "t", ARGUS_ADMIN_TOKEN: "t", BILLING_PROVIDER: "fake", COOKIE_SECURE: "0", MIN_FREE_BYTES: "0", ARGUS_SETTINGS_TTL_MS: "0" } }),
  spawn("node", [join(here, "serve-access.mjs"), DIST, String(WEB_PORT), String(API_PORT)], { stdio: "ignore", env: { ...process.env, SPREAD_IP: "1" } }),
];
process.on("exit", () => kids.forEach((k) => k.kill()));
for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${WEB_PORT}/api/health`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }

const { suite, openApp, loadSample, OUT } = await import("./lib.mjs");
const SHOTS = process.env.ARGUS_SHOTS || `${OUT}/demo`;
mkdirSync(SHOTS, { recursive: true });
const shot = async (page, project, name) => { await page.waitForTimeout(450); return page.screenshot({ path: `${SHOTS}/${name}-${project}.png` }); }
const NOISE = [/Failed to load resource/, /api\//];
let n = 0;
const email = () => `demo${Date.now()}${n++}@example.com`;
const PW = "correct horse battery";
const dlg = (page, name) => page.getByRole("dialog", { name });
// On narrow screens "Demo tools" and "Have an access code?" live in the slim bar's "More" menu.
const bar = async (page, name) => {
  const more = page.getByRole("button", { name: "More", exact: true });
  if (await more.count()) { await more.click(); await page.getByRole("group", { name: "More" }).getByRole("button", { name }).click(); }
  else await page.getByRole("button", { name }).first().click();
};
const tools = async (page, label) => {
  await bar(page, "Demo tools");
  await dlg(page, "Demo tools").getByRole("button", { name: label }).click();
};
const openAccount = (page) => page.getByRole("button", { name: "Account" }).first().click();
const api = (page, path, body) => page.evaluate(async ([p, b]) => (await fetch("/api" + p, { method: b === undefined ? "GET" : "POST", headers: { "X-Argus-Client": "1", "Content-Type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) })).status, [path, body]);
const signupApi = async (page, mail) => {
  await openApp(page);
  assert.equal(await api(page, "/auth/signup", { email: mail, password: PW, acceptTerms: true, termsVersion: "2026-10-19-draft" }), 201);
  await page.reload();
};
const fillSignup = async (page, mail) => {
  await page.getByLabel("Email").fill(mail);
  await page.getByLabel("Password", { exact: true }).fill(PW);
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole("button", { name: "Create account" }).last().click();
};
const openInboxAndClick = async (page, subject) => {
  await page.getByRole("button", { name: "Open demo inbox" }).first().click();
  await dlg(page, "Demo inbox").getByRole("link", { name: subject }).first().click();
};
const subscribe = async (page) => {
  await page.getByRole("checkbox", { name: /I want my plan to start now/ }).check();
  await page.getByRole("button", { name: "Subscribe" }).click();
  await page.getByText("DEMO: no real card is used").waitFor();
};
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "horizontal overflow");
const smallTargets = async (page) => {
  const bad = await page.evaluate(() => [...document.querySelectorAll(".acc-dialog button, .acc-dialog a, .acc-demobar button")].filter((e) => e.offsetParent && !e.closest("label")).map((e) => ({ t: (e.textContent || "").trim().slice(0, 20), h: Math.round(e.getBoundingClientRect().height) })).filter((x) => x.h < 44));
  return bad;
};

await suite("demo-flow", [
  {
    name: "journey: trial, grace, paywall, sign up, inbox, verify, card pay, active",
    allowErrors: NOISE, timeout: 150000,
    fn: async ({ page, project, touch }) => {
      await openApp(page);
      await page.getByTestId("demo-bar").waitFor();
      const narrow = page.viewportSize().width <= 768;
      assert.match(await page.getByTestId("demo-bar").innerText(), narrow ? /^Demo$/ : /Demo mode: payments and emails are simulated/);
      assert.equal(await page.getByTestId("acc-banner").getAttribute("data-kind"), "trial");
      if (narrow) {
        assert.equal(await page.locator('[data-testid="acc-banner"], [data-testid="demo-bar"]').evaluateAll((l) => new Set(l.map((e) => e.closest(".acc-slim")?.className)).size), 1, "one slim bar");
        const b = await page.getByTestId("acc-banner").boundingBox(), h = await page.locator(".header").boundingBox();
        assert.ok(b.height <= 56, `demo+trial bar is ${b.height}px`);
        assert.ok(b.y >= h.y + h.height - 1, "bar overlaps the toolbar");
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "horizontal overflow");
        await page.getByRole("button", { name: "More", exact: true }).click();
        for (const n of ["Keep my work", "Have an access code?", "Demo tools"]) assert.ok(await page.getByRole("group", { name: "More" }).getByRole("button", { name: n }).count(), n);
        await page.keyboard.press("Escape");
      }
      await shot(page, project, "1-first-visit");
      await tools(page, "+1 day");
      await page.locator('[data-kind="grace"]').waitFor();
      await shot(page, project, "2-grace");
      await tools(page, "+7 days");
      await dlg(page, "Your free time has ended").waitFor();
      await shot(page, project, "3-paywall");
      await page.getByRole("checkbox", { name: /I want my plan to start now/ }).check();
      await page.getByRole("button", { name: "Subscribe" }).click(); // anonymous: asks for an account first
      const mail = email();
      await fillSignup(page, mail);
      await dlg(page, "Check your email").waitFor();
      await shot(page, project, "4-check-email");
      await openInboxAndClick(page, "Confirm your email for Argus");
      await page.getByText("Your email is confirmed.").waitFor();
      await subscribe(page);
      await shot(page, project, "5-fake-checkout");
      await page.getByRole("button", { name: "Pay", exact: true }).click();
      await page.getByText("You are all set.").waitFor();
      await openAccount(page);
      const acct = dlg(page, "Account");
      await acct.getByTestId("verified-badge").filter({ hasText: "Verified" }).waitFor();
      await acct.getByText("Your plan is active", { exact: false }).waitFor();
      await acct.getByTestId("acc-state").filter({ hasText: "Your plan is active" }).waitFor();
      assert.equal(await acct.getByText(/Subscription:/).count(), 0, "one plan line, no repeated Subscription line");
      await shot(page, project, "6-active");
      await noOverflow(page);
      if (touch) assert.deepEqual(await smallTargets(page), []);
    },
  },
  {
    name: "declined first card: nothing granted, 'did not go through' copy (never 'last payment'), another card fixes it",
    allowErrors: NOISE, timeout: 120000,
    fn: async ({ page, project }) => {
      await signupApi(page, email());
      await openAccount(page);
      await dlg(page, "Account").getByRole("button", { name: "See plans" }).click();
      await subscribe(page);
      await page.locator("#card").fill("4000 0000 0000 0002");
      await page.getByRole("button", { name: "Pay", exact: true }).click();
      await dlg(page, "Payment failed").waitFor();
      await shot(page, project, "7-declined");
      await page.getByRole("button", { name: "Try again" }).click();
      const sheet = dlg(page, "Payment did not go through");
      await sheet.waitFor();
      await sheet.getByText("Your payment did not go through. Try another card.").waitFor();
      assert.equal(await page.getByText(/last payment/i).count(), 0, "a never-paid account is not told about a last payment");
      await shot(page, project, "7-first-payment-failed");
      await page.keyboard.press("Escape");
      const bar = page.locator('[data-kind="first_payment_failed"]');
      await bar.waitFor();
      assert.match(await bar.innerText(), /Your payment did not go through\. Try another card\./);
      assert.equal(await page.locator('[data-kind="payment_failed"]').count(), 0);
      const s = await page.evaluate(() => fetch("/api/session").then((r) => r.json()));
      assert.equal(s.billing.paymentFailureReason, "first_payment_failed");
      assert.notEqual(s.entitlement.state, "active", "a declined first payment grants nothing");
      await openAccount(page);
      await dlg(page, "Account").getByTestId("acc-sub").getByText("Your payment did not go through. Try another card.").waitFor();
      await shot(page, project, "8-past-due");
      await dlg(page, "Account").getByRole("button", { name: "See plans" }).click();
      await subscribe(page);
      await page.getByRole("button", { name: "Pay", exact: true }).click();
      await page.getByText("You are all set.").waitFor();
      assert.equal(await page.locator('[data-kind="first_payment_failed"]').count(), 0);
    },
  },
  {
    name: "cancel on the card page returns with a friendly message",
    allowErrors: NOISE, timeout: 90000,
    fn: async ({ page }) => {
      await signupApi(page, email());
      await openAccount(page);
      await dlg(page, "Account").getByRole("button", { name: "See plans" }).click();
      await subscribe(page);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByText("Checkout cancelled. Nothing was charged.").waitFor();
    },
  },
  {
    name: "magic link login through the demo inbox",
    allowErrors: NOISE, timeout: 90000,
    fn: async ({ page, project }) => {
      const mail = email();
      await signupApi(page, mail);
      await api(page, "/auth/logout", {});
      await page.reload();
      await page.getByRole("button", { name: "Log in" }).first().click(); // logged out device has no trial: the paywall offers it
      await page.getByRole("button", { name: "Email me a sign-in link instead" }).click();
      await page.getByLabel("Email").fill(mail);
      await page.getByRole("button", { name: "Send sign-in link" }).click();
      await dlg(page, "Check your email").waitFor();
      await openInboxAndClick(page, "Your Argus sign-in link");
      await page.getByText("You are logged in.").waitFor();
      await shot(page, project, "9-magic-login");
      await openAccount(page);
      await dlg(page, "Account").getByText(mail).waitFor();
    },
  },
  {
    name: "access code 123 gives the code trial",
    allowErrors: [...NOISE, /redeem/], timeout: 60000,
    fn: async ({ page }) => {
      await openApp(page);
      await bar(page, "Have an access code?");
      await page.getByRole("textbox", { name: "Access code" }).fill("123");
      await page.getByRole("button", { name: "Apply" }).click();
      await page.getByText(/Access code active until/).first().waitFor();
    },
  },
  {
    name: "reset my demo starts a fresh trial",
    allowErrors: NOISE, timeout: 60000,
    fn: async ({ page }) => {
      await openApp(page);
      await tools(page, "+1 day");
      await page.locator('[data-kind="grace"]').waitFor();
      await bar(page, "Demo tools");
      await Promise.all([page.waitForEvent("load"), dlg(page, "Demo tools").getByRole("button", { name: "Reset my demo" }).click()]);
      await page.getByTestId("acc-banner").waitFor();
      assert.equal(await page.getByTestId("acc-banner").getAttribute("data-kind"), "trial");
    },
  },
  {
    name: "legacy mode (no /api/session) shows no demo or access UI",
    allowErrors: [/api\/(session|folders)/, /Failed to load resource/], timeout: 60000,
    fn: async ({ page }) => {
      await page.route("**/api/session", (r) => r.fulfill({ status: 404, body: "not found", contentType: "text/plain" }));
      await openApp(page);
      await loadSample(page);
      for (const sel of ['[data-testid="demo-bar"]', '[data-testid="acc-banner"]', ".acc-dialog", ".acc-account-btn"]) assert.equal(await page.locator(sel).count(), 0, sel);
    },
  },
]);

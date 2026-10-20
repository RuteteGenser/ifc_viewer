// Access system: legacy fallback and the real new backend.
// Needs ARGUS_URL to serve the build with /api piped to a scratch backend started with
// ARGUS_REQUIRE_SESSION=1 ARGUS_ADMIN_TOKEN=test (see tests/e2e/serve-access.mjs), and
// ARGUS_ADMIN=http://127.0.0.1:<backend port> for the admin API (time travel, code duration).
// The legacy cases fake the missing endpoint with a route and need no backend.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { suite, openApp, loadSample, loadFile, APP, DEMO_FILE, OUT } from "./lib.mjs";

const ADMIN = process.env.ARGUS_ADMIN || "http://127.0.0.1:4195";
const SHOTS = process.env.ARGUS_SHOTS || `${OUT}/access`;
mkdirSync(SHOTS, { recursive: true });
const H = 3600000;
const REAL = !!process.env.ARGUS_ADMIN && !!process.env.ARGUS_CLOCK;
const IGNORE_404 = [/api\/(session|folders)/, /Failed to load resource/];
// A wrong access code is answered with 404 on purpose.
const WRONG_CODE = [/api\/redeem-code/, /Failed to load resource/];
const WRONG_FORM = [/api\/(auth\/(signup|login)|billing\/checkout)/, /Failed to load resource/];

const admin = async (method, path, body) => {
  const r = await fetch(ADMIN + "/api/admin" + path, { method, headers: { Authorization: "Bearer test", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  assert.ok(r.ok, `admin ${method} ${path} -> ${r.status}`);
  return r.json();
};
// A fresh visitor: own IP so the per-IP caps never bite across cases.
let n = 0;
const fresh = async (page) => {
  clock("");
  n += 1;
  await page.context().setExtraHTTPHeaders({ "x-real-ip": `10.${Math.floor(Math.random() * 250)}.${Math.floor(n / 250)}.${n % 250}` });
};
const session = (page) => page.evaluate(() => fetch("/api/session", { credentials: "same-origin" }).then((r) => r.json()));
// Time travel with the backend's test clock (ARGUS_CLOCK is the file it reads; empty = real time).
const CLOCK = process.env.ARGUS_CLOCK;
const clock = (iso) => CLOCK && writeFileSync(CLOCK, iso);
process.on("exit", () => clock(""));
// Puts the clock `afterMs` after the end of this visitor's trial (negative: before it).
const setEnds = async (page, afterMs) => {
  const s = await session(page);
  clock(new Date(Date.parse(s.entitlement.endsAt) + afterMs).toISOString());
};
const banner = (page) => page.getByTestId("acc-banner");
// On narrow screens the banner actions live in the "More" menu; on desktop they are inline.
const viaMenu = async (page, name) => {
  const more = page.getByRole("button", { name: "More", exact: true });
  if (await more.count()) { await more.click(); await page.getByRole("group", { name: "More" }).getByRole("button", { name }).click(); }
  else await page.getByTestId("acc-banner").getByRole("button", { name }).click();
};
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "horizontal overflow");
const smallTargets = async (page, scope) => {
  await page.waitForTimeout(450); // dialogs scale in: measure once they have settled
  const bad = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} button, ${sel} input:not([type=checkbox]), ${sel} a`)].filter((e) => e.offsetParent).map((e) => ({ t: (e.textContent || e.getAttribute("aria-label") || e.id).trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height) })).filter((x) => x.h < 44), scope);
  assert.deepEqual(bad, [], `targets under 44px in ${scope}`);
};
const shot = async (page, project, name) => { await page.waitForTimeout(450); return page.screenshot({ path: `${SHOTS}/${name}-${project}.png` }); }
const requireReal = (skip) => { if (!REAL) skip("set ARGUS_ADMIN and ARGUS_CLOCK (scratch backend) to run"); };
const signup = async (page, email) => {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await page.getByRole("checkbox", { name: /I accept the Terms of Service/ }).check();
  await page.getByRole("button", { name: "Create account" }).last().click();
};

await suite("access", [
  {
    name: "legacy: /api/session 404 shows no access UI and the sample loads",
    allowErrors: IGNORE_404,
    fn: async ({ page }) => {
      await page.route("**/api/session", (r) => r.fulfill({ status: 404, body: "not found", contentType: "text/plain" }));
      await openApp(page);
      await page.getByRole("heading", { name: "Open a building model" }).waitFor();
      await loadSample(page);
      await page.waitForTimeout(500);
      for (const sel of ['[data-testid="acc-banner"]', ".acc-dialog", ".acc-codelink", ".acc-account-btn"]) assert.equal(await page.locator(sel).count(), 0, sel);
      assert.equal(await page.getByText("Have an access code?").count(), 0);
    },
  },
  {
    name: "countdown: trial and code sessions show it, a paid plan does not (mocked session)",
    allowErrors: IGNORE_404,
    fn: async ({ page, project }) => {
      const now = Date.now();
      const mock = (state, over = {}, banner = "none") => ({
        account: { id: "a1", kind: state === "anonymous_trial" ? "anonymous" : "registered", locale: "en", email: "p@example.com" },
        entitlement: { state, planKey: "pro", planName: "Pro", features: ["viewer", "samples", "export"], limits: { maxStoredModels: 50, maxBytesTotal: 1e9 }, endsAt: new Date(now + 12 * 86400000).toISOString(), flags: {}, ...over },
        usage: { storedModels: 0, bytes: 0 }, ui: { banner, paywall: false, canUseSamples: true }, billing: { providers: [] }, public: { signupsOpen: true }, serverTime: new Date(now).toISOString(), demo: false,
      });
      const cases = [
        ["anonymous_trial", mock("anonymous_trial", { planKey: "trial", reason: "anonymous_trial" }, "trial"), /Free trial\. \d+ (days|h) left\./],
        ["code_trial", mock("code_trial", { planKey: "code_trial", reason: "invite_code" }, "code_trial"), /Access code active\. \d+ days left\./],
        ["paid active", mock("active", { reason: "subscription" }, "trial"), null],
        ["paid cancels", mock("active", { reason: "subscription", flags: { cancelAtPeriodEnd: true } }, "plan_ending"), "plan_ending"],
        ["paid past_due", mock("active", { reason: "subscription", flags: { paymentFailed: true } }, "payment_failed"), "payment_failed"],
      ];
      for (const [label, body, expect] of cases) {
        await page.unroute("**/api/session").catch(() => {});
        await page.route("**/api/session", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }));
        await openApp(page);
        if (expect) await banner(page).waitFor({ timeout: 10000 });
        await page.waitForTimeout(600);
        const text = (await banner(page).count()) ? await banner(page).innerText() : "";
        const shown = await page.evaluate(() => /\bleft\b/.test(document.querySelector('[data-testid="acc-banner"]')?.textContent || ""));
        if (expect instanceof RegExp) assert.match(text, expect, label);
        else {
          assert.equal(shown, false, `${label}: no countdown, got "${text}"`);
          if (expect) assert.equal(await banner(page).getAttribute("data-kind"), expect, label);
          else assert.equal(await banner(page).count(), 0, `${label}: no banner`);
        }
      }
    },
  },
  {
    name: "legacy: 401 challenge, HTML answer and a hanging answer behave the same",
    projects: ["desktop"],
    allowErrors: IGNORE_404,
    fn: async ({ page }) => {
      const answers = [(r) => r.fulfill({ status: 401, body: "Unauthorized", headers: { "www-authenticate": 'Basic realm="x"' } }), (r) => r.fulfill({ status: 200, body: "<html>app</html>", contentType: "text/html" }), (r) => r.abort("failed"), (r) => setTimeout(() => r.fulfill({ status: 404, body: "" }).catch(() => {}), 6000)];
      for (const answer of answers) {
        await page.unroute("**/api/session").catch(() => {});
        await page.route("**/api/session", answer);
        const t0 = Date.now();
        await openApp(page);
        assert.ok(Date.now() - t0 < 5000, "viewer ready must not wait for the session answer");
        await page.waitForTimeout(300);
        assert.equal(await page.locator('[data-testid="acc-banner"], .acc-dialog, .acc-codelink, .acc-account-btn').count(), 0);
        await loadSample(page);
      }
    },
  },
  {
    name: "trial banner with countdown, dismiss, phone layout, code link",
    fn: async ({ page, project, skip, touch }) => {
      requireReal(skip);
      await fresh(page);
      await openApp(page);
      await banner(page).waitFor();
      assert.match(await banner(page).innerText(), /Free trial\. (2[0-4] h|\d+ min) left\./);
      const b = await banner(page).boundingBox();
      const h = await page.locator(".header").boundingBox();
      assert.ok(b.y >= h.y + h.height - 1, "banner sits under the header");
      await noOverflow(page);
      if (touch) await smallTargets(page, '[data-testid="acc-banner"]');
      const narrow = page.viewportSize().width <= 768;
      if (narrow) {
        assert.ok(b.height <= 56, `banner is ${b.height}px high`);
        const t = await banner(page).locator(".acc-slim__text").boundingBox();
        assert.ok(t.height < 24, "banner text wraps");
        const tb = await page.locator(".header").boundingBox();
        assert.ok(b.y >= tb.y + tb.height - 1, "banner overlaps the toolbar");
        assert.ok(b.x >= 0 && b.x + b.width <= page.viewportSize().width + 1, "banner overflows");
      }
      await shot(page, project, "banner");
      await viaMenu(page, "Dismiss");
      assert.equal(await banner(page).count(), 0);
      await shot(page, project, "empty-state-code-link");
      assert.ok(await page.getByRole("button", { name: "Have an access code?" }).count() >= 1);
      await loadSample(page);
    },
  },
  {
    name: "code entry: wrong code, then 123 shows about 30 days",
    allowErrors: WRONG_CODE,
    fn: async ({ page, project, skip, touch }) => {
      requireReal(skip);
      await fresh(page);
      await openApp(page);
      await banner(page).waitFor();
      await viaMenu(page, "Have an access code?");
      const dlg = page.getByRole("dialog");
      await dlg.getByLabel("Access code").fill("nope");
      await dlg.getByRole("button", { name: "Apply" }).click();
      await dlg.getByRole("alert").waitFor();
      assert.match(await dlg.getByRole("alert").innerText(), /does not work/);
      if (touch) await smallTargets(page, ".acc-dialog");
      await shot(page, project, "code-entry");
      await dlg.getByLabel("Access code").fill("123");
      await dlg.getByRole("button", { name: "Apply" }).click();
      await dlg.getByText(/Access code active until/).waitFor();
      await dlg.waitFor({ state: "detached", timeout: 6000 });
      await page.waitForFunction(() => /Access code active\. (29|30) days left/.test(document.querySelector('[data-testid="acc-banner"]')?.textContent || ""), null, { timeout: 8000 });
      await noOverflow(page);
    },
  },
  {
    name: "grace banner, then expired paywall; blocked upload; code 123 clears it",
    allowErrors: [/api\/models\?name=x\.ifc/, /Failed to load resource/],
    fn: async ({ page, project, skip, touch }) => {
      requireReal(skip);
      await fresh(page);
      await openApp(page);
      await banner(page).waitFor();
      await setEnds(page, H);
      await page.reload();
      await openApp(page);
      await banner(page).waitFor();
      assert.match(await banner(page).innerText(), /Your trial has ended\. You can still open and download your models until/);
      assert.equal(await page.getByRole("button", { name: "Keep my work" }).count(), 0, "no sign-up nudge in the grace banner");
      await shot(page, project, "grace-banner");
      await setEnds(page, 10 * 24 * H);
      await page.reload();
      const dlg = page.getByRole("dialog", { name: "Your free time has ended" });
      await dlg.waitFor();
      await dlg.getByRole("button", { name: "Subscribe" }).waitFor();
      for (const name of ["Download my models", "Subscribe", "Have an access code?", "Log in"]) assert.ok(await dlg.getByRole("button", { name }).count(), name);
      assert.match(await dlg.innerText(), /Price not final/);
      assert.ok(await dlg.getByRole("button", { name: "Subscribe" }).isDisabled(), "needs the consent tick");
      await noOverflow(page);
      if (touch) await smallTargets(page, ".acc-dialog");
      await shot(page, project, "paywall");
      const up = await page.evaluate(() => fetch("/api/models?name=x.ifc", { method: "POST", headers: { "X-Argus-Client": "1" }, body: new Blob(["ISO-10303-21;"]) }).then((r) => r.status));
      assert.equal(up, 402, "server refuses an upload while expired");
      await dlg.getByRole("button", { name: "Have an access code?" }).click();
      await dlg.getByLabel("Access code").fill("123");
      await dlg.getByRole("button", { name: "Apply" }).click();
      await dlg.waitFor({ state: "detached", timeout: 8000 });
      await banner(page).waitFor();
      assert.match(await banner(page).innerText(), /Access code active/);
    },
  },
  {
    name: "first visit: the library waits for the session, so no 401 on /api/folders or /api/models",
    projects: ["desktop"],
    fn: async ({ page, skip }) => {
      requireReal(skip);
      await fresh(page);
      const bad = [];
      page.on("response", (r) => /\/api\/(folders|models)/.test(r.url()) && r.status() >= 400 && bad.push(`${r.status()} ${r.url()}`));
      await openApp(page);
      await page.locator(".lib--empty").waitFor();
      await page.waitForTimeout(2200); // the old client retried after 1.5 s
      assert.deepEqual(bad, []);
    },
  },
  {
    name: "desktop: the banner stays clickable with the Properties panel open (1440, 1180, 1024)",
    projects: ["desktop"],
    fn: async ({ page, skip, project }) => {
      requireReal(skip);
      await fresh(page);
      await openApp(page);
      await banner(page).waitFor();
      await loadSample(page);
      for (const [w, h] of [[1440, 900], [1180, 820], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(400);
        const box = await page.locator("canvas").first().boundingBox();
        await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.5);
        await page.locator(".element-panel--open").waitFor();
        await page.waitForTimeout(500);
        const geo = await page.evaluate(() => ({ b: document.querySelector('[data-testid="acc-banner"]').getBoundingClientRect().bottom, p: document.querySelector(".element-panel").getBoundingClientRect().top }));
        assert.ok(geo.p >= geo.b - 1, `${w}px: panel top ${geo.p} must be under the banner bottom ${geo.b}`);
        for (const name of ["Keep my work", "Have an access code?"]) {
          const hit = await banner(page).getByRole("button", { name }).evaluate((el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el === top || el.contains(top); });
          assert.ok(hit, `${w}px: "${name}" is covered`);
        }
        if (w === 1440) await shot(page, project, "banner-with-panel-1440");
        await banner(page).getByRole("button", { name: "Keep my work" }).click();
        await page.getByRole("dialog", { name: "Create account" }).waitFor();
        await page.keyboard.press("Escape");
        await page.getByRole("dialog", { name: "Create account" }).waitFor({ state: "detached" });
      }
    },
  },
  {
    name: "expired: Delete my models (confirm focuses Cancel), download stays, local files still open, never a dead end",
    allowErrors: [/api\/models/, /Failed to load resource/],
    fn: async ({ page, project, skip, touch }) => {
      requireReal(skip);
      await fresh(page);
      await openApp(page);
      await banner(page).waitFor();
      const bytes = readFileSync(DEMO_FILE).toString("base64");
      const up = await page.evaluate((b64) => fetch("/api/models?name=del-me.ifc", { method: "POST", headers: { "X-Argus-Client": "1" }, body: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).then((r) => r.status), bytes);
      assert.ok(up === 200 || up === 201, `upload ${up}`);
      await setEnds(page, 10 * 24 * H);
      await page.reload();
      const dlg = page.getByRole("dialog", { name: "Your free time has ended" });
      await dlg.waitFor();
      assert.ok(await dlg.getByRole("button", { name: "Download my models" }).count(), "download stays");
      const mine = () => page.evaluate(() => fetch("/api/models").then((r) => r.json()).then((l) => l.filter((m) => m.owner === "me").length));
      await dlg.getByRole("button", { name: "Delete my models" }).click();
      const confirm = page.getByRole("dialog", { name: "Delete all your saved models?" });
      await confirm.waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Cancel", "confirm focuses Cancel");
      if (touch) await smallTargets(page, ".acc-dialog");
      await shot(page, project, "expired-delete-confirm");
      await confirm.getByRole("button", { name: "Cancel" }).click();
      await confirm.waitFor({ state: "detached" });
      assert.equal(await mine(), 1, "Cancel keeps the model");
      await shot(page, project, "expired-paywall-delete");
      await dlg.getByRole("button", { name: "Delete my models" }).click();
      await confirm.getByRole("button", { name: "Delete my models" }).click();
      await page.getByText("Your saved models are deleted.").waitFor();
      assert.equal(await mine(), 0, "models deleted");
      assert.equal(await dlg.getByRole("button", { name: "Delete my models" }).count(), 0, "nothing left to delete");
      // never a dead end: set the paywall aside, open a file from this device, it stays visible
      await dlg.getByRole("button", { name: "Open a file from this device" }).click();
      await dlg.waitFor({ state: "detached" });
      await loadFile(page, DEMO_FILE);
      await page.waitForTimeout(500);
      assert.equal(await page.locator(".acc-dialog").count(), 0, "a local file opens without the paywall");
      assert.ok(await page.locator("canvas").count());
    },
  },
  {
    name: "trial_limit: own message, viewer and samples stay usable, no paywall",
    projects: ["desktop"],
    fn: async ({ page, skip, project }) => {
      requireReal(skip);
      await admin("PUT", "/settings/trial_new_devices_per_ip_per_day", { value: 0 });
      try {
        await fresh(page);
        await openApp(page);
        const s = await session(page);
        assert.equal(s.entitlement.reason, "trial_limit");
        assert.equal(s.ui.canUseSamples, true);
        await banner(page).waitFor();
        assert.equal(await banner(page).getAttribute("data-kind"), "trial_limit");
        assert.match(await banner(page).innerText(), /Free trials from this network are used up today\. Enter an access code or log in\./);
        assert.equal(await page.getByRole("dialog").count(), 0, "no paywall");
        assert.equal(await page.getByText("Your free time has ended").count(), 0);
        await loadSample(page);
        await shot(page, project, "trial-limit");
        await banner(page).getByRole("button", { name: "Have an access code?" }).click();
        await page.getByRole("dialog").getByLabel("Access code").fill("123");
        await page.getByRole("dialog").getByRole("button", { name: "Apply" }).click();
        await page.waitForFunction(() => /Access code active/.test(document.querySelector('[data-testid="acc-banner"]')?.textContent || ""), null, { timeout: 8000 });
      } finally {
        await admin("PUT", "/settings/trial_new_devices_per_ip_per_day", { value: 20 });
      }
    },
  },
  {
    allowErrors: WRONG_FORM,
    name: "sign up keeps saved models, fake checkout makes it active, log out and in",
    fn: async ({ page, project, skip, touch }) => {
      requireReal(skip);
      await fresh(page);
      await openApp(page);
      await banner(page).waitFor();
      const bytes = readFileSync(DEMO_FILE).toString("base64");
      const saved = await page.evaluate((b64) => fetch("/api/models?name=keep-me.ifc", { method: "POST", headers: { "X-Argus-Client": "1" }, body: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).then((r) => r.status), bytes);
      assert.ok(saved === 200 || saved === 201, `upload ${saved}`);
      await setEnds(page, 10 * 24 * H);
      await page.reload();
      const dlg = page.getByRole("dialog", { name: "Your free time has ended" });
      await dlg.waitFor();
      // download still works while expired
      const dl = page.waitForEvent("download", { timeout: 15000 });
      await dlg.getByRole("button", { name: "Download my models" }).click();
      assert.match((await dl).suggestedFilename(), /keep-me/);
      // Subscribe as an anonymous visitor asks for an account first
      await dlg.getByRole("checkbox", { name: /I accept the Terms of Service/ }).check();
      await dlg.getByRole("checkbox", { name: /I ask for the service to start right away/ }).check();
      await dlg.getByRole("button", { name: "Subscribe" }).click();
      const auth = page.getByRole("dialog", { name: "Create account" });
      await auth.waitFor();
      if (touch) await smallTargets(page, ".acc-dialog");
      await shot(page, project, "signup");
      await page.getByLabel("Password", { exact: true }).fill("short");
      await page.getByLabel("Email").fill("t@example.com");
      await page.getByRole("checkbox", { name: /I accept the Terms of Service/ }).check();
      await page.getByRole("button", { name: "Create account" }).last().click();
      await page.getByRole("alert").waitFor();
      assert.match(await page.getByRole("alert").innerText(), /longer password/);
      await page.getByLabel("Password", { exact: true }).fill("qwertyuiop12");
      await page.getByRole("button", { name: "Create account" }).last().click();
      await page.getByRole("alert").filter({ hasText: "Choose a less common password." }).waitFor();
      const email = `t${Date.now()}${n}@example.com`;
      await signup(page, email);
      await page.getByRole("dialog", { name: "Create account" }).waitFor({ state: "detached", timeout: 8000 });
      const models = await page.evaluate(() => fetch("/api/models").then((r) => r.json()));
      assert.ok(models.some((m) => m.name === "keep-me.ifc" && m.owner === "me"), "saved model kept after sign-up");
      // checkout
      await page.getByRole("dialog", { name: "Your free time has ended" }).getByRole("checkbox", { name: /I accept the Terms of Service/ }).check();
      await page.getByRole("dialog", { name: "Your free time has ended" }).getByRole("checkbox", { name: /I ask for the service to start right away/ }).check();
      await page.getByRole("dialog", { name: "Your free time has ended" }).getByRole("button", { name: "Subscribe" }).click();
      await page.getByRole("button", { name: "Pay", exact: true }).click();
      await page.waitForURL(/\/app\//);
      await page.getByRole("dialog", { name: "Your free time has ended" }).waitFor({ state: "detached", timeout: 10000 });
      assert.equal(await banner(page).count(), 0, "no banner when active");
      // account panel
      await page.getByRole("button", { name: "Account" }).first().click();
      const acct = page.getByRole("dialog", { name: "Account" });
      await acct.getByText(email).waitFor();
      assert.match(await acct.getByTestId("acc-state").innerText(), /Your plan is active/);
      await shot(page, project, "account");
      await noOverflow(page);
      if (touch) await smallTargets(page, ".acc-dialog");
      // log out: no new trial, so expired
      await acct.getByRole("button", { name: "Log out" }).click();
      const again = page.getByRole("dialog", { name: "Your free time has ended" });
      await again.waitFor();
      await again.getByRole("button", { name: "Log in" }).click();
      const login = page.getByRole("dialog", { name: "Log in" });
      await login.getByLabel("Email").fill(email);
      await login.getByLabel("Password", { exact: true }).fill("correct horse battery");
      await login.getByLabel("Password", { exact: true }).press("Enter");
      await again.waitFor({ state: "detached", timeout: 10000 });
      // another login that offers to move device models is not covered here
    },
  },
  {
    name: "samples are read-only in the list; Account button and quota line",
    fn: async ({ page, skip, project }) => {
      requireReal(skip);
      await fresh(page);
      await openApp(page);
      await banner(page).waitFor();
      await page.locator(".lib--empty").waitFor();
      assert.ok(await page.locator(".lib--empty").getByText("Samples").count(), "Samples label");
      assert.match(await page.locator(".lib--empty").getByTestId("lib-quota").innerText(), /\d+ of 3 models, \d+ MB of 300 MB/);
      const row = page.locator(".lib--empty .lib-row").filter({ has: page.locator(".lib-badge", { hasText: "Sample" }) }).first();
      await row.waitFor();
      await row.getByRole("button", { name: /More actions/ }).click();
      const actions = row.locator(".lib-row__actions");
      assert.equal(await actions.getByRole("button", { name: "Rename" }).count(), 0);
      assert.equal(await actions.getByRole("button", { name: "Delete" }).count(), 0);
      await shot(page, project, "library-samples");
    },
  },
  {
    name: "admin changes a code's duration and a new device gets the new length",
    projects: ["desktop"],
    fn: async ({ page, skip }) => {
      requireReal(skip);
      const { codes } = await admin("GET", "/codes");
      const code = codes.find((c) => c.hint?.includes("123") || c.label?.toLowerCase().includes("seed")) || codes[0];
      const original = code.durationDays;
      try {
        await admin("PATCH", `/codes/${code.id}`, { durationDays: 10 });
        await fresh(page);
        await openApp(page);
        await banner(page).waitFor();
        await page.getByRole("button", { name: "Have an access code?" }).first().click();
        await page.getByRole("dialog").getByLabel("Access code").fill("123");
        await page.getByRole("dialog").getByRole("button", { name: "Apply" }).click();
        await page.waitForFunction(() => /Access code active\. (9|10) days left/.test(document.querySelector('[data-testid="acc-banner"]')?.textContent || ""), null, { timeout: 8000 });
      } finally {
        await admin("PATCH", `/codes/${code.id}`, { durationDays: original });
      }
    },
  },
]);

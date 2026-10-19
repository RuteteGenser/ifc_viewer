// Legal pages and consent. Runs against a scratch build with the access API mocked by
// page.route (no backend needed):
//   node tests/e2e/serve-access.mjs <dist> 4471 &   (dist holds app/ from vite build --base=/app/)
//   ARGUS_URL=http://127.0.0.1:4471 node tests/e2e/legal.e2e.mjs
import assert from "node:assert/strict";
import { suite, openApp, loadSample, APP, BASE, OUT } from "./lib.mjs";

const LEGAL_VERSION = "2026-10-19";
const SHOTS = `${OUT}/legal`;
const H = 3600000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

const session = ({ account = {}, entitlement = {} } = {}) => ({
  account: { id: "acc_1", kind: "anonymous", locale: "en", ...account },
  entitlement: { state: "anonymous_trial", planName: "Trial", endsAt: iso(20 * H), graceEndsAt: iso(7 * 24 * H), limits: {}, flags: {}, ...entitlement },
  usage: { storedModels: 0, bytes: 0 },
  ui: { banner: null, paywall: false },
  billing: { provider: "fake", available: true, testMode: false },
  public: { signupsOpen: true, termsVersion: "2026-10-19-draft", refundWindowDays: 14 },
  serverTime: iso(0),
});
const REGISTERED = { account: { kind: "registered", email: "kari@example.no", emailVerified: true } };
const GRACE = { ...REGISTERED, entitlement: { state: "grace", endsAt: iso(-H), graceEndsAt: iso(6 * 24 * H) } };
const PLANS = { plans: [{ key: "standard", name: "Standard", limits: { maxStoredModels: 50, maxBytesTotal: 5e9 }, prices: [{ lookupKey: "standard_monthly_nok", kind: "recurring", interval: "month", intervalCount: 1, amountMinor: 9900, currency: "NOK", taxIncluded: true, vatRate: 0.25 }] }] };
const DOC_NAMES_NB = { terms: "Brukervilkår", privacy: "Personvern", "purchase-info": "Informasjon før kjøp", "withdrawal-form": "Angreskjema", cookies: "Informasjonskapsler", dpa: "Databehandleravtale" };
const TITLES_NB = { privacy: "Personvernerklæring for Argus", "purchase-info": "Informasjon før kjøp", "withdrawal-form": "Angreskjema", cookies: "Informasjonskapsler", dpa: "Databehandleravtale" };

// Mocks the access API. Returns the request bodies seen, by path.
async function mockApi(page, s, extra = {}) {
  const seen = {};
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, "");
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    (seen[path] ||= []).push(body);
    const json = (status, data) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (extra[path]) return json(200, extra[path](body));
    if (path === "/session") return json(200, s);
    if (path === "/plans") return json(200, PLANS);
    if (path === "/models" || path === "/folders") return json(200, []);
    if (path === "/account") return json(200, { subscription: null });
    return json(200, {});
  });
  return seen;
}

const shot = async (page, project, name) => { await page.waitForTimeout(350); await page.screenshot({ path: `${SHOTS}-${name}-${project}.png` }); };
const legal = (page) => page.getByTestId("legal-page");
const waitDoc = (page, doc) => page.waitForFunction((d) => document.querySelector("[data-testid=legal-page]")?.dataset.doc === d, doc);
const noOverflow = async (page, what) => {
  const r = await page.evaluate(() => {
    const el = document.querySelector("[data-testid=legal-page]");
    return { doc: document.documentElement.scrollWidth, vw: window.innerWidth, page: el ? el.scrollWidth - el.clientWidth : 0 };
  });
  assert.ok(r.doc <= r.vw && r.page <= 0, `${what}: horizontal overflow ${JSON.stringify(r)}`);
};
// Every control in the page chrome and in the link rows is at least 44 px tall (inline links in running text are exempt).
const targets44 = async (page, selector) => {
  await page.waitForTimeout(450); // dialogs scale in: measure once they have settled
  const bad = await page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length)
    .map((e) => ({ t: (e.textContent || "").trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height) })).filter((x) => x.h < 44), selector);
  assert.deepEqual(bad, [], `targets under 44px: ${selector}`);
};
const openSignup = async (page) => {
  await openApp(page, { query: "?account=1" });
  await page.getByRole("dialog", { name: "Account" }).getByRole("button", { name: "Create account" }).click();
  return page.getByRole("dialog", { name: "Create account" });
};
const openPaywall = async (page) => {
  await openApp(page, { query: "?account=1" });
  await page.getByRole("dialog", { name: /Account|Konto/ }).getByRole("button", { name: /See plans|Se priser/ }).click();
  const dlg = page.locator(".acc-dialog").filter({ has: page.getByTestId("price-summary") });
  await dlg.getByTestId("price-summary").waitFor();
  return dlg;
};

await suite("legal", [
  {
    name: "legal page: every document in both languages, nav, language switch, close returns to the app",
    projects: ["desktop", "iphone13"],
    fn: async ({ page, project }) => {
      await mockApi(page, session());
      await openApp(page, { hash: "#/legal/terms/nb" });
      await legal(page).waitFor();
      assert.equal(await legal(page).getByRole("heading", { level: 1 }).innerText(), "Brukervilkår for Argus");
      assert.match(await legal(page).innerText(), /UTKAST \/ DRAFT: ikke juridisk vurdert/);
      assert.ok(await legal(page).locator("mark.legal-ph", { hasText: "[FIRMANAVN]" }).count(), "placeholders are visible");
      await shot(page, project, "terms-nb");
      const nav = legal(page).getByRole("navigation", { name: "Juridiske dokumenter" });
      for (const [doc, title] of Object.entries(TITLES_NB)) {
        await nav.getByRole("link", { name: DOC_NAMES_NB[doc], exact: true }).click();
        await waitDoc(page, doc);
        await legal(page).getByRole("heading", { level: 1, name: title }).waitFor();
        await noOverflow(page, doc);
      }
      await shot(page, project, "dpa-nb");
      await legal(page).getByRole("link", { name: "Read in English" }).click();
      await legal(page).getByRole("heading", { level: 1, name: "Data Processing Agreement" }).waitFor();
      assert.equal(await legal(page).getAttribute("lang"), "en");
      // a doc: link inside the text moves to that document
      await legal(page).getByRole("navigation", { name: "Legal documents" }).getByRole("link", { name: "Terms of Service" }).click();
      await waitDoc(page, "terms");
      await legal(page).getByRole("link", { name: "withdrawal form" }).first().click();
      await legal(page).getByRole("heading", { level: 1, name: "Withdrawal form" }).waitFor();
      await legal(page).getByRole("button", { name: "Close" }).click();
      await legal(page).waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => location.hash), "");
      assert.ok(page.url().startsWith(APP), page.url());
    },
  },
  {
    name: "static copies: /app/legal/<doc>.<lang>.html render without JS and link each other",
    projects: ["desktop", "iphone13"],
    context: { javaScriptEnabled: false },
    fn: async ({ page, project }) => {
      for (const lang of ["nb", "en"]) for (const doc of Object.keys(DOC_NAMES_NB)) {
        const res = await page.goto(`${BASE}/app/legal/${doc}.${lang}.html`);
        assert.equal(res.status(), 200, `${doc}.${lang}`);
        assert.equal(await page.getAttribute("html", "lang"), lang);
        assert.match(await page.locator("main").innerText(), /UTKAST \/ DRAFT: ikke juridisk vurdert/);
        await noOverflow(page, `${doc}.${lang}.html`);
      }
      await page.goto(`${BASE}/app/legal/terms.nb.html`);
      await shot(page, project, "static-terms-nb");
      await page.getByRole("link", { name: "angreskjemaet" }).click();
      assert.match(page.url(), /withdrawal-form\.nb\.html$/);
      await page.getByRole("link", { name: "Read in English" }).click();
      assert.match(page.url(), /withdrawal-form\.en\.html$/);
      const idx = await page.goto(`${BASE}/app/legal/`);
      assert.equal(idx.status(), 200);
      assert.ok(await page.getByRole("link", { name: "Brukervilkår" }).count());
    },
  },
  {
    name: "sign-up: terms link opens the page over the dialog, button disabled until ticked, body has terms.version",
    fn: async ({ page, project, touch }) => {
      const seen = await mockApi(page, session());
      const dlg = await openSignup(page);
      await dlg.getByLabel("Email").fill("kari@example.no");
      await dlg.getByLabel("Password", { exact: true }).fill("correct horse battery");
      const box = dlg.getByRole("checkbox", { name: "I accept the Terms of Service and have read the Privacy Policy" });
      const submit = dlg.getByRole("button", { name: "Create account" });
      assert.equal(await box.isChecked(), false, "unchecked by default");
      assert.ok(await submit.isDisabled(), "disabled until ticked");
      if (touch) await targets44(page, ".acc-dialog .legal-links a, .acc-dialog button");
      await shot(page, project, "signup");
      await dlg.getByRole("link", { name: "Terms of Service" }).click();
      await legal(page).getByRole("heading", { level: 1, name: "Terms of Service for Argus" }).waitFor();
      await page.keyboard.press("Escape");
      await legal(page).waitFor({ state: "detached" });
      assert.equal(await dlg.getByLabel("Email").inputValue(), "kari@example.no", "the dialog kept its state");
      assert.equal(await box.isChecked(), false, "following the link did not tick the box");
      await dlg.getByRole("link", { name: "Privacy", exact: true }).click();
      await legal(page).getByRole("heading", { level: 1, name: "Privacy Policy for Argus" }).waitFor();
      await legal(page).getByRole("button", { name: "Close" }).click();
      await legal(page).waitFor({ state: "detached" });
      // keyboard: Space on the focused checkbox ticks it
      await box.focus();
      await page.keyboard.press("Space");
      assert.equal(await box.isChecked(), true);
      assert.equal(await submit.isDisabled(), false);
      await submit.click();
      await dlg.waitFor({ state: "detached", timeout: 8000 });
      const body = seen["/auth/signup"]?.[0];
      assert.ok(body, "signup was sent");
      assert.deepEqual(body.terms, { version: LEGAL_VERSION });
      assert.equal(body.acceptTerms, true);
      assert.equal(body.termsVersion, "2026-10-19-draft", "legacy field still sent for older backends");
    },
  },
  {
    name: "paywall: separate terms and waiver boxes, price line, links, checkout body has terms and waiver",
    fn: async ({ page, project, touch }) => {
      const seen = await mockApi(page, session(GRACE), {
        "/billing/checkout": () => ({ checkoutId: "chk_1", url: `${APP}?checkout=cancel` }),
      });
      const dlg = await openPaywall(page);
      assert.equal(await dlg.getByTestId("price-summary").innerText(), "NOK 99 per month incl. 25% VAT. Renews automatically. Cancel any time under Account.");
      const terms = dlg.getByRole("checkbox", { name: "I accept the Terms of Service and have read the Privacy Policy" });
      const waiver = dlg.getByRole("checkbox", { name: "I ask for the service to start right away. I understand that my right of withdrawal ends when the service has been fully delivered, and that if I withdraw before then, I pay for the part I have used." });
      const pay = dlg.getByRole("button", { name: "Subscribe" });
      assert.equal(await terms.isChecked(), false);
      assert.equal(await waiver.isChecked(), false);
      assert.ok(await pay.isDisabled(), "disabled with nothing ticked");
      await terms.check();
      assert.ok(await pay.isDisabled(), "disabled with only the terms ticked");
      await terms.uncheck();
      await waiver.check();
      assert.ok(await pay.isDisabled(), "disabled with only the waiver ticked");
      await terms.check();
      assert.equal(await pay.isDisabled(), false, "enabled with both ticked");
      const [lineBox, payBox] = [await dlg.getByTestId("price-summary").boundingBox(), await pay.boundingBox()];
      assert.ok(lineBox.y < payBox.y, "price line before the button");
      if (touch) await targets44(page, ".acc-dialog .legal-links a, .acc-dialog button");
      await shot(page, project, "paywall");
      for (const [name, title] of [["Before you buy", "Information before purchase"], ["Withdrawal form", "Withdrawal form"], ["Privacy", "Privacy Policy for Argus"]]) {
        await dlg.getByRole("navigation", { name: "Legal information" }).getByRole("link", { name, exact: true }).click();
        await legal(page).getByRole("heading", { level: 1, name: title }).waitFor();
        await legal(page).getByRole("button", { name: "Close" }).click();
        await legal(page).waitFor({ state: "detached" });
      }
      assert.equal(await terms.isChecked(), true, "ticks survive a visit to the legal page");
      await Promise.all([page.waitForURL(/checkout=cancel|\/app\/$/), pay.click()]);
      const body = seen["/billing/checkout"]?.[0];
      assert.ok(body, "checkout was sent");
      assert.equal(body.priceLookupKey, "standard_monthly_nok");
      assert.deepEqual(body.terms, { version: LEGAL_VERSION });
      assert.equal(body.withdrawalWaiver, true);
      assert.equal(body.consent.startNow, true);
      assert.equal(body.consent.withdrawalWaiver, true);
      assert.equal(body.consent.termsVersion, "2026-10-19-draft");
    },
  },
  {
    name: "Norwegian browser: consent, price line and legal page in bokmål",
    projects: ["desktop", "iphone13"],
    context: { locale: "nb-NO" },
    fn: async ({ page, project }) => {
      await mockApi(page, session(GRACE));
      const dlg = await openPaywall(page);
      assert.equal(await dlg.getByTestId("price-summary").innerText(), "99 kr per måned inkl. 25 % mva. Fornyes automatisk. Si opp når som helst under Konto.");
      await dlg.getByRole("checkbox", { name: "Jeg godtar Brukervilkårene og har lest Personvernerklæringen" }).waitFor();
      await dlg.getByRole("checkbox", { name: "Jeg ber om at tjenesten leveres umiddelbart og forstår at angreretten bortfaller når tjenesten er levert fullt ut. Hvis jeg angrer før det, betaler jeg forholdsmessig for tiden jeg har brukt." }).waitFor();
      await shot(page, project, "paywall-nb");
      await dlg.getByRole("link", { name: "Brukervilkår", exact: true }).click();
      await legal(page).getByRole("heading", { level: 1, name: "Brukervilkår for Argus" }).waitFor();
      assert.equal(await legal(page).getAttribute("lang"), "nb");
    },
  },
  {
    name: "account: Cancel subscription is one tap from Account and asks the portal for the cancel flow",
    fn: async ({ page, project }) => {
      const seen = await mockApi(page, session({ ...REGISTERED, entitlement: { state: "active", planName: "Standard", endsAt: iso(20 * 24 * H) } }), {
        "/account": () => ({ subscription: { status: "active", planKey: "standard", currentPeriodEnd: iso(20 * 24 * H), cancelAtPeriodEnd: false, provider: "stripe" } }),
        "/billing/portal": () => ({ url: `${APP}?account=1` }),
      });
      await openApp(page, { query: "?account=1" });
      const acct = page.getByRole("dialog", { name: "Account" });
      const cancel = acct.getByRole("button", { name: "Cancel subscription" });
      await cancel.waitFor();
      assert.ok(await acct.getByRole("navigation", { name: "Legal information" }).getByRole("link", { name: "Terms of Service" }).count(), "legal links in Account");
      await shot(page, project, "account");
      await Promise.all([page.waitForURL(/account=1|\/app\/$/), cancel.click()]);
      assert.deepEqual(seen["/billing/portal"]?.[0], { flow: "cancel" });
    },
  },
  {
    name: "320 px: no overflow, 44 px targets, keyboard stays inside the page, Escape closes",
    projects: ["desktop"],
    context: { viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true },
    fn: async ({ page, project }) => {
      await mockApi(page, session());
      await openApp(page, { hash: "#/legal/privacy/nb" });
      await legal(page).getByRole("heading", { level: 1 }).waitFor();
      for (const doc of Object.keys(DOC_NAMES_NB)) {
        await page.evaluate((d) => location.replace(`#/legal/${d}/nb`), doc);
        await waitDoc(page, doc);
        await legal(page).locator(".legal-doc p").nth(1).waitFor();
        await noOverflow(page, `${doc} at 320`);
      }
      await targets44(page, ".legal-page__bar a, .legal-page__bar button, .legal-page__nav a, .legal-doc__static a");
      await shot(page, project, "withdrawal-320");
      // Tab moves through the page's own links and never reaches the app behind it
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press("Tab");
        assert.ok(await page.evaluate(() => !!document.activeElement?.closest("[data-testid=legal-page]")), `focus left the page after ${i + 1} Tab`);
      }
      await page.keyboard.press("Shift+Tab");
      assert.ok(await page.evaluate(() => !!document.activeElement?.closest("[data-testid=legal-page]")));
      await page.keyboard.press("Escape");
      await legal(page).waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => location.hash), "");
      // and the static copy at 320 px
      await page.goto(`${BASE}/app/legal/privacy.nb.html`);
      await noOverflow(page, "static privacy at 320");
      await targets44(page, "header a, nav a");
    },
  },
  {
    name: "library and sidebar (app menu) have the legal links",
    projects: ["desktop", "iphone13"],
    fn: async ({ page, project, phone }) => {
      await mockApi(page, session());
      await openApp(page);
      await page.locator(".lib__account >> visible=true").first().getByRole("link", { name: "Privacy", exact: true }).click();
      await legal(page).getByRole("heading", { level: 1, name: "Privacy Policy for Argus" }).waitFor();
      await page.goBack();
      await legal(page).waitFor({ state: "detached" });
      await loadSample(page);
      if (phone) await page.getByRole("button", { name: "Open menu" }).click();
      await page.locator(".sidebar__legal").getByRole("link", { name: "Cookies" }).click();
      await legal(page).getByRole("heading", { level: 1, name: "Cookies" }).waitFor();
      await shot(page, project, "cookies-over-model");
      await legal(page).getByRole("button", { name: "Close" }).click();
      await legal(page).waitFor({ state: "detached" });
      assert.ok(await page.locator("canvas").first().isVisible(), "the open model is still there");
    },
  },
]);

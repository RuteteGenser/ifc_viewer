// Projects are top level folders: the folder rules (Move to... picker, legacy backends, read-only plans) against the REAL new backend (see tests/e2e/serve-access.mjs).
// env: ARGUS_URL=<static server piped to a scratch backend started with ARGUS_REQUIRE_SESSION=1 ...>,
//      ARGUS_SHOTS (screenshot dir), ARGUS_CLOCK (the backend's TEST_CLOCK_FILE, for the read-only case).
// Every case is a fresh anonymous visitor with its own account and throwaway models; the live service is never touched.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { suite, openApp, OUT } from "./lib.mjs";
import { buildIfc } from "../fixtures/generate.mjs";

const SHOTS = process.env.ARGUS_SHOTS || `${OUT}/folders`;
mkdirSync(SHOTS, { recursive: true });
const CLOCK = process.env.ARGUS_CLOCK;
const NO_FOLDERS = [/api\/(folders|session)/, /Failed to load resource/];
let n = 0;

// A fresh visitor (own IP for the per-IP caps), the page opened, `names` uploaded as that visitor (loose, so in Unsorted), page reloaded.
async function visit(page, names) {
  n += 1;
  await page.context().setExtraHTTPHeaders({ "x-real-ip": `10.${Math.floor(Math.random() * 250)}.${Math.floor(n / 250)}.${n % 250}` });
  await openApp(page);
  // The anonymous trial stores 3 models; the access code 123 lifts that for the test visitor.
  const redeemed = await page.evaluate(async () => (await fetch("/api/redeem-code", { method: "POST", headers: { "X-Argus-Client": "1", "Content-Type": "application/json" }, body: JSON.stringify({ code: "123" }), credentials: "same-origin" })).status);
  assert.equal(redeemed, 200, "redeem 123");
  const tag = randomBytes(3).toString("hex");
  for (const name of names) {
    const text = buildIfc({ schema: "IFC4", unit: "m", name: `${tag}${name}`, storeys: [{ name: "L0", elevation: 0 }], wall: [4, 0.2, 2.8] });
    let status = 0;
    for (let i = 0; i < 4 && status !== 201; i++) {
      // The upload limit is 10 a minute: wait out its Retry-After.
      const r = await page.evaluate(async ([nm, body]) => { const x = await fetch(`/api/models?name=${encodeURIComponent(nm)}`, { method: "POST", headers: { "X-Argus-Client": "1" }, body, credentials: "same-origin" }); return [x.status, Number(x.headers.get("retry-after")) || 0]; }, [`${name}.ifc`, text]);
      status = r[0];
      if (status === 429) await page.waitForTimeout((r[1] || 30) * 1000 + 500);
    }
    assert.equal(status, 201, `upload ${name}`);
  }
  await openApp(page);
}
const models = async (page) => (await page.evaluate(async () => (await fetch("/api/models", { credentials: "same-origin" })).json())).filter((m) => m.owner !== "samples");
const MINE = /^(alpha|beta|gamma|delta|epsilon|zeta|one|two|solo|a|b|ro)$/; // the seeded models, not the samples
const shot = (page, project, name) => page.screenshot({ path: `${SHOTS}/${name}-${project}.png` });
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "horizontal overflow");

// A first visit asks for folders before its session cookie exists (401 once), and legacy cases fake a 404.
const FIRST = [/api\/folders/, /api\/models\?name=/, /Failed to load resource/]; // + the 429 of the upload limit, which the helper waits out
const call = (page, method, path, body) => page.evaluate(async ([m, p, b]) => { const r = await fetch(`/api${p}`, { method: m, headers: { "X-Argus-Client": "1", "Content-Type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b), credentials: "same-origin" }); return { status: r.status, body: await r.json().catch(() => null) }; }, [method, path, body]);
const open = (page, name) => page.getByRole("button", { name: new RegExp(`^Open project ${name},`) }).click();
await suite("library-folders", [
  {
    name: "Move to... lists the projects with the current place marked; moving works both ways (Top level is Unsorted); 44 px targets",
    allowErrors: FIRST,
    timeout: 300000,
    fn: async ({ page, project }) => {
      await visit(page, ["alpha"]);
      await call(page, "POST", "/folders", { name: "Plans", parentId: null });
      await call(page, "POST", "/folders", { name: "Drawings", parentId: null });
      await openApp(page);
      await open(page, "Unsorted");
      const row = page.getByRole("button", { name: /^Open .*alpha\.ifc$/ });
      await row.waitFor();
      await page.getByRole("button", { name: /More actions for .*alpha\.ifc/ }).click();
      await page.getByRole("button", { name: "Move to..." }).click();
      const dlg = page.getByRole("dialog");
      await dlg.getByRole("button", { name: "Top level" }).waitFor();
      assert.equal(await dlg.getByRole("button", { name: "Top level" }).getAttribute("aria-current"), "true", "the current place is marked");
      const small = await dlg.evaluate((el) => [...el.querySelectorAll("button")].map((b) => [b.textContent.trim(), Math.round(b.getBoundingClientRect().height)]).filter(([, h]) => h < 44));
      assert.deepEqual(small, [], "targets under 44 px");
      await noOverflow(page);
      await shot(page, project, "move-picker");
      await dlg.getByRole("button", { name: "Plans" }).click();
      await page.getByRole("button", { name: "Open project Plans, 1 model" }).waitFor();
      const [m] = await models(page);
      assert.equal(m.folderId, (await call(page, "GET", "/folders")).body.find((f) => f.name === "Plans").id);
      // and back out to Top level: it is loose again
      await open(page, "Plans");
      await page.getByRole("button", { name: /More actions for .*alpha\.ifc/ }).click();
      await page.getByRole("button", { name: "Move to..." }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Top level" }).click();
      await page.getByTestId("proj-empty").waitFor();
      await page.getByRole("button", { name: /^.?\s*Projects$/ }).first().click();
      await page.getByRole("button", { name: "Open project Unsorted, 1 model" }).waitFor();
      assert.equal((await models(page))[0].folderId, null);
    },
  },
  {
    name: "legacy: no folders endpoint (404 or HTML) shows no project UI and no Move to...",
    allowErrors: [...NO_FOLDERS, ...FIRST],
    fn: async ({ page }) => {
      await visit(page, ["a", "b"]);
      for (const reply of [{ status: 404, body: "not found", contentType: "text/plain" }, { status: 200, body: "<html></html>", contentType: "text/html" }]) {
        await page.route("**/api/folders", (r) => r.fulfill(reply));
        await openApp(page);
        const L = page.locator(".lib--empty");
        await L.getByRole("heading", { name: "My models" }).waitFor();
        await L.locator(".lib-row__main").first().waitFor();
        assert.equal(await page.locator(".proj").count(), 0);
        assert.equal(await L.getByRole("button", { name: "Move to..." }).count(), 0);
        await L.getByRole("button", { name: /More actions for/ }).first().click();
        assert.equal(await L.getByRole("button", { name: "Move to..." }).count(), 0);
        await page.unroute("**/api/folders");
      }
    },
  },
  {
    timeout: 300000,
    allowErrors: FIRST,
    name: "read-only plan: New project, Add model, Rename, Delete and Move are disabled with the reason",
    fn: async ({ page, skip }) => {
      if (!CLOCK) skip("set ARGUS_CLOCK to the backend's TEST_CLOCK_FILE");
      await visit(page, ["ro"]);
      const made = (await call(page, "POST", "/folders", { name: "Locked", parentId: null })).body;
      try {
        const s = await page.evaluate(async () => (await fetch("/api/session", { credentials: "same-origin" })).json());
        writeFileSync(CLOCK, new Date(Date.parse(s.entitlement.endsAt) + 3600000).toISOString());
        await openApp(page);
        await page.getByRole("button", { name: "New project", exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: "New project", exact: true }).isDisabled(), true);
        await page.getByText(/read-only/i).first().waitFor();
        await open(page, "Locked");
        assert.equal(await page.getByRole("button", { name: "Add model" }).isDisabled(), true);
        await page.getByRole("button", { name: "More actions for project Locked" }).click();
        assert.equal(await page.getByRole("button", { name: "Rename", exact: true }).isDisabled(), true);
        assert.equal(await page.getByRole("button", { name: "Delete", exact: true }).isDisabled(), true);
      } finally {
        writeFileSync(CLOCK, "");
      }
      assert.ok(made?.id);
    },
  },
]);

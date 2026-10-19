// Library folders against the REAL new backend (see tests/e2e/serve-access.mjs).
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

// A fresh visitor (own IP for the per-IP caps), the page opened, `names` uploaded as that visitor, page reloaded.
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
  return page.locator(".lib--empty");
}
const models = (page) => page.evaluate(async () => (await fetch("/api/models", { credentials: "same-origin" })).json());
const MINE = /^(alpha|beta|gamma|delta|epsilon|zeta|one|two|solo|a|b|ro)$/; // the seeded models, not the samples
const names = (L) => L.locator(".lib-row__main[aria-label^='Open ']:not(.lib-folder__main)").evaluateAll((els, re) => els.map((e) => e.getAttribute("aria-label").replace(/^Open /, "").replace(/\.ifc$/, "")).filter((x) => new RegExp(re).test(x)), MINE.source);
const folderRow = (L, name) => L.locator(`.lib-folder[data-folder="${name}"]`);
const newFolder = async (L, name) => {
  await L.getByRole("button", { name: "+ New folder" }).click();
  await L.getByLabel("Name of the new folder").fill(name);
  await L.getByLabel("Name of the new folder").press("Enter");
};
const crumbs = (L) => L.getByRole("navigation", { name: "Folder path" });
const shot = (page, project, name) => page.screenshot({ path: `${SHOTS}/${name}-${project}.png` });
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "horizontal overflow");

// A first visit asks for folders before its session cookie exists (401 once), and legacy cases fake a 404.
const FIRST = [/api\/folders/, /api\/models\?name=/, /Failed to load resource/]; // + the 429 of the upload limit, which the helper waits out
await suite("library-folders", [
  {
    name: "create, nest, rename, move a model, breadcrumb, search all folders, delete moves contents up",
    timeout: 300000,
    allowErrors: FIRST,
    fn: async ({ page, project }) => {
      const L = await visit(page, ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]);
      await L.getByRole("button", { name: "+ New folder" }).waitFor();
      assert.equal(await L.locator(".lib-folder").count(), 0);

      // create + name_taken
      await newFolder(L, "Project A");
      await folderRow(L, "Project A").waitFor();
      await L.getByRole("button", { name: "Open folder Project A, 0 models" }).waitFor();
      await newFolder(L, "project a");
      await L.getByRole("alert").filter({ hasText: "already exists" }).waitFor();
      await L.getByLabel("Name of the new folder").press("Escape");
      assert.equal(await L.getByLabel("Name of the new folder").count(), 0, "Escape cancels");
      assert.equal(await L.locator(".lib-folder").count(), 1);

      // nested: Project A / Drawings / Deep; the third level cannot hold another
      await L.getByRole("button", { name: /Open folder Project A/ }).click();
      await crumbs(L).getByText("Project A").waitFor();
      await newFolder(L, "Drawings");
      await L.getByRole("button", { name: /Open folder Drawings/ }).click();
      await newFolder(L, "Deep");
      await L.getByRole("button", { name: /Open folder Deep/ }).click();
      assert.equal(await L.getByRole("button", { name: "+ New folder" }).isDisabled(), true, "no 4th level");
      await L.getByText("Folders can only go 3 levels deep.").waitFor();
      assert.equal((await crumbs(L).innerText()).replace(/\s+/g, " "), "My models / Project A / Drawings / Deep");
      await shot(page, project, "breadcrumb");

      // breadcrumb navigation back, then rename Drawings
      await crumbs(L).getByRole("button", { name: "Project A" }).click();
      await folderRow(L, "Drawings").waitFor();
      await folderRow(L, "Drawings").getByRole("button", { name: "More actions for folder Drawings" }).click();
      await folderRow(L, "Drawings").getByRole("button", { name: "Rename" }).click();
      const rn = L.getByLabel("New name for Drawings");
      await rn.fill("Plans");
      await rn.press("Enter");
      await folderRow(L, "Plans").waitFor();
      await crumbs(L).getByRole("button", { name: "My models" }).click();
      await L.getByTestId("lib-count").getByText("6 models").waitFor();
      await folderRow(L, "Project A").scrollIntoViewIfNeeded();
      await shot(page, project, "folder-list");

      // move alpha into Project A / Plans via the picker
      const alphaRow = L.locator(".lib-row", { has: page.locator("[aria-label$='alpha.ifc']") });
      await alphaRow.getByRole("button", { name: /More actions for/ }).click();
      await alphaRow.getByRole("button", { name: "Move to..." }).click();
      const dlg = page.getByRole("dialog");
      await dlg.getByRole("button", { name: "Top level" }).waitFor();
      assert.equal(await dlg.locator("[aria-current='true']").innerText().then((t) => t.includes("Top level")), true, "current place marked");
      await shot(page, project, "move-picker");
      await dlg.getByRole("button", { name: "Plans" }).click();
      await dlg.waitFor({ state: "detached" });
      assert.ok(!(await names(L)).includes("alpha"), "alpha left the top level");
      const alpha = (await models(page)).find((m) => m.name === "alpha.ifc");
      const folders = await page.evaluate(async () => (await fetch("/api/folders")).json());
      assert.equal(alpha.folderId, folders.find((f) => f.name === "Plans").id);

      // search finds it from the top, flat, with its folder path; Clear returns to the folder view
      await L.getByLabel("Search my models").fill("alph");
      await L.getByText("Search results from all folders").waitFor();
      await shot(page, project, "search");
      assert.deepEqual(await names(L), ["alpha"]);
      assert.equal(await L.getByTestId("lib-path").innerText(), "in Project A / Plans");
      assert.equal(await L.locator(".lib-folder").count(), 0, "folders hidden while searching");
      await L.getByRole("button", { name: "Clear", exact: true }).click();
      await L.getByRole("button", { name: /Open folder Project A/ }).waitFor();
      assert.equal((await names(L)).length, 5);

      // delete Plans: its model and its folder move up one level, nothing is deleted
      await L.getByRole("button", { name: /Open folder Project A/ }).click();
      await folderRow(L, "Plans").getByRole("button", { name: "More actions for folder Plans" }).click();
      await folderRow(L, "Plans").getByRole("button", { name: "Delete" }).click();
      const confirm = page.getByRole("dialog");
      await confirm.getByText(/Models inside move up one level/).waitFor();
      await confirm.getByRole("button", { name: "Delete folder" }).click();
      await folderRow(L, "Deep").waitFor();
      await L.getByRole("button", { name: /alpha\.ifc/ }).first().waitFor();
      assert.equal(await folderRow(L, "Plans").count(), 0);
      assert.equal((await models(page)).filter((m) => MINE.test(m.name.replace(/\.ifc$/, ""))).length, 6, "no model deleted");
      await noOverflow(page);
    },
  },
  {
    timeout: 300000,
    allowErrors: FIRST,
    name: "drag a model row onto a folder row (desktop)",
    projects: ["desktop"],
    fn: async ({ page }) => {
      const L = await visit(page, ["one", "two"]);
      await newFolder(L, "Target");
      await folderRow(L, "Target").waitFor();
      const row = L.locator(".lib-row[draggable='true']").first();
      const label = await row.locator(".lib-row__main").getAttribute("aria-label");
      await row.dragTo(folderRow(L, "Target"));
      await L.getByRole("button", { name: "Open folder Target, 1 model" }).waitFor();
      assert.ok(!(await names(L)).includes(label.replace(/^Open /, "").replace(/\.ifc$/, "")));
    },
  },
  {
    timeout: 300000,
    allowErrors: FIRST,
    name: "picker disables illegal targets, 44px targets, phone sheet",
    fn: async ({ page, project, phone }) => {
      const L = await visit(page, ["solo"]);
      await newFolder(L, "A");
      await L.getByRole("button", { name: /Open folder A/ }).click();
      await newFolder(L, "B");
      await crumbs(L).getByRole("button", { name: "My models" }).click();
      await folderRow(L, "A").getByRole("button", { name: "More actions for folder A" }).click();
      await folderRow(L, "A").getByRole("button", { name: "Move to..." }).click();
      const dlg = page.getByRole("dialog");
      assert.equal(await dlg.getByRole("button", { name: "B" }).isDisabled(), true, "not into its own child");
      assert.equal(await dlg.getByRole("button", { name: /^A/ }).isDisabled(), true, "not into itself");
      const small = await page.evaluate(() => [...document.querySelectorAll(".lib--empty button, .fpick button")].filter((e) => e.offsetParent).map((e) => ({ t: (e.textContent || e.getAttribute("aria-label")).trim().slice(0, 24), h: Math.round(e.getBoundingClientRect().height) })).filter((x) => x.h < 44));
      assert.deepEqual(small, [], "targets under 44px");
      if (phone) {
        const box = await dlg.boundingBox();
        assert.ok(box.y + box.height > page.viewportSize().height - 20, "bottom sheet");
      }
      await page.keyboard.press("Escape");
      await dlg.waitFor({ state: "detached" });
      await shot(page, project, "folder-more");
    },
  },
  {
    name: "legacy: no folders endpoint (404 or HTML) shows no folder UI",
    allowErrors: [...NO_FOLDERS, ...FIRST],
    fn: async ({ page }) => {
      const first = await visit(page, ["a", "b"]);
      await first.locator(".lib-row__main").first().waitFor();
      for (const reply of [{ status: 404, body: "not found", contentType: "text/plain" }, { status: 200, body: "<html></html>", contentType: "text/html" }]) {
        await page.route("**/api/folders", (r) => r.fulfill(reply));
        await openApp(page);
        const L = page.locator(".lib--empty");
        await L.getByRole("heading", { name: "My models" }).waitFor();
        await L.locator(".lib-row__main").first().waitFor();
        for (const sel of [".lib-folderbar", ".lib-folder", ".lib-crumbs"]) assert.equal(await L.locator(sel).count(), 0, sel);
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
    name: "read-only plan: New folder and Move are disabled with the reason",
    fn: async ({ page, skip }) => {
      if (!CLOCK) skip("set ARGUS_CLOCK to the backend's TEST_CLOCK_FILE");
      const L = await visit(page, ["ro"]);
      try {
        const s = await page.evaluate(async () => (await fetch("/api/session", { credentials: "same-origin" })).json());
        writeFileSync(CLOCK, new Date(Date.parse(s.entitlement.endsAt) + 3600000).toISOString());
        await openApp(page);
        const btn = L.getByRole("button", { name: "+ New folder" });
        await btn.waitFor();
        assert.equal(await btn.isDisabled(), true);
        await L.getByText(/read-only/i).first().waitFor();
      } finally {
        writeFileSync(CLOCK, "");
      }
    },
  },
]);

// Flow 4: the saved-models library. Read-only against the real models; every write
// goes to a throwaway __test_<random>.ifc that is deleted in a finally block (by its own id only).
import assert from "node:assert/strict";
import { suite, openApp, APP, api, createThrowaway, removeThrowaway, waitForMark, markCount, canvasStats, waitForModelAfter } from "./lib.mjs";
import { buildIfc } from "../fixtures/generate.mjs";

const makeIfc = (tag) => buildIfc({ schema: "IFC4", unit: "m", name: tag, storeys: [{ name: "Ground", elevation: 0 }, { name: "First", elevation: 3 }], wall: [4, 0.2, 2.8] });
const row = (page, name) => page.getByRole("button", { name: `Open ${name}`, exact: true });
// Models saved without a project sit in the virtual Unsorted project; its page lists them with the same rows as always.
const openUnsortedPage = async (page) => page.getByRole("button", { name: /^Open project Unsorted/ }).click();
const exists = async (id) => (await api.get(`/models/${encodeURIComponent(id)}`)).status === 200;

async function withThrowaway(fn) {
  const rec = await createThrowaway(makeIfc);
  try {
    return await fn(rec);
  } finally {
    await removeThrowaway(rec);
  }
}

await suite("library", [
  {
    name: "saved models without a project are listed under Unsorted; the sample building is in the dummy project",
    fn: async ({ page }) => withThrowaway(async (rec) => {
      await openApp(page);
      await openUnsortedPage(page);
      await row(page, rec.name).waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: /^Projects$/ }).first().click();
      await page.getByRole("button", { name: "Try a dummy project" }).click();
      await page.getByRole("button", { name: "Open Sample building" }).waitFor();
    }),
  },
  {
    name: "?model=<id> opens that library model",
    projects: ["desktop", "iphone13"], // uploads are rate limited (10 a minute): throwaways only where they add coverage
    timeout: 120000,
    fn: async ({ page }) => withThrowaway(async (rec) => {
      await page.goto(`${APP}?model=${encodeURIComponent(rec.id)}`, { waitUntil: "domcontentloaded" });
      await waitForMark(page, "model-shown", 0, 60000);
      await page.locator(".loading-overlay").waitFor({ state: "detached" });
      const s = await canvasStats(page);
      assert.ok(s.variance > 100, "model did not render");
      assert.ok(page.url().includes("model="), "the deep link stays in the address bar for a model that exists");
    }),
  },
  {
    name: "opening a library row in the UI loads it",
    projects: ["desktop", "ipad-mini"],
    timeout: 120000,
    fn: async ({ page }) => withThrowaway(async (rec) => {
      await openApp(page);
      await openUnsortedPage(page);
      await waitForModelAfter(page, () => row(page, rec.name).click());
      assert.ok((await canvasStats(page)).variance > 100, "model did not render");
    }),
  },
  {
    name: "rename and delete a throwaway model through the UI",
    projects: ["desktop", "iphone13"],
    timeout: 120000,
    fn: async ({ page }) => withThrowaway(async (rec) => {
      await openApp(page);
      await openUnsortedPage(page);
      const newName = rec.name.replace(".ifc", "_renamed.ifc");
      await page.getByRole("button", { name: `More actions for ${rec.name}` }).click();
      await page.getByRole("button", { name: "Rename", exact: true }).click();
      const input = page.getByLabel(`New name for ${rec.name}`);
      await input.fill(newName);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await row(page, newName).waitFor({ timeout: 10000 });
      assert.equal((await (await api.get(`/models/${encodeURIComponent(rec.id)}`)).json()).name, newName, "server has the new name");

      await page.getByRole("button", { name: `More actions for ${newName}` }).click();
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      const dlg = page.getByRole("dialog", { name: "Delete this model?" });
      await dlg.waitFor();
      await dlg.getByRole("button", { name: "Delete", exact: true }).click();
      await row(page, newName).waitFor({ state: "detached", timeout: 10000 });
      assert.equal(await exists(rec.id), false, "model is gone on the server");
    }),
  },
  {
    name: "deep link to a missing id shows the notice and a clean URL",
    allowErrors: [/http 404/, /Failed to load resource/],
    fn: async ({ page }) => {
      await page.goto(`${APP}?model=zzzz-not-a-real-id`, { waitUntil: "domcontentloaded" });
      await page.getByText("That model is no longer saved.").waitFor({ timeout: 15000 });
      assert.ok(!page.url().includes("model="), `address bar still has ${page.url()}`);
      assert.equal(await page.locator(".loading-overlay").count(), 0, "no stuck spinner");
      await page.getByRole("heading", { name: "No projects yet" }).or(page.getByRole("heading", { name: "Projects", level: 1 })).first().waitFor();
    },
  },
  {
    name: "a dropped connection while downloading a library model ends loaded or with a message, never a stuck spinner",
    projects: ["iphone13"],
    allowErrors: [/requestfailed/, /Failed to load resource/, /Could not|interrupted|download/i],
    timeout: 120000,
    fn: async ({ page }) => withThrowaway(async (rec) => {
      await openApp(page);
      await openUnsortedPage(page);
      let dropped = 0;
      await page.route("**/api/models/*/file", (route) => (dropped++ === 0 ? route.abort("connectionreset") : route.continue()));
      const before = await markCount(page, "model-shown");
      await row(page, rec.name).click();
      await page.waitForFunction((n) => performance.getEntriesByName("model-shown").length > n || document.querySelector(".status-banner--error, .lib-notice, [role=alert]"), before, { timeout: 60000 });
      await page.locator(".loading-overlay").waitFor({ state: "detached", timeout: 60000 });
      // the app is still usable: opening it again (when the first try failed) works
      if ((await markCount(page, "model-shown")) === before) {
        await waitForModelAfter(page, () => row(page, rec.name).click());
      }
      assert.ok((await canvasStats(page)).variance > 100, "model did not render");
      assert.ok(dropped >= 1, "the injected failure never happened");
    }),
  },
]);

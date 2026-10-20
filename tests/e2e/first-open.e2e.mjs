// Flow 1: first open. Empty state, file chooser, sample building.
import assert from "node:assert/strict";
import { suite, openApp, loadSample, canvasStats, bannerText } from "./lib.mjs";

await suite("first-open", [
  {
    name: "first screen is the project browser (no projects yet) and Open a file without saving opens a file chooser",
    fn: async ({ page }) => {
      await openApp(page);
      await page.getByRole("heading", { name: "No projects yet" }).waitFor();
      await page.getByRole("button", { name: "New project", exact: true }).waitFor();
      await page.getByRole("button", { name: "Try a dummy project" }).waitFor();
      assert.match(await page.title(), /Argus/);
      assert.match(await page.locator(".header__title").innerText(), /^Argus$/);
      const chooser = page.waitForEvent("filechooser", { timeout: 10000 });
      await page.getByRole("button", { name: "Open a file without saving" }).click();
      const fc = await chooser;
      assert.equal(fc.isMultiple(), true, "several files can be picked");
      assert.equal(await bannerText(page), "");
    },
  },
  {
    name: "sample building loads, renders, no errors",
    fn: async ({ page }) => {
      await openApp(page);
      await loadSample(page);
      assert.equal(await page.getByRole("heading", { name: "No projects yet" }).count(), 0, "empty state is gone");
      assert.match(await page.locator(".header__title").innerText(), /^Argus$/);
      const s = await canvasStats(page);
      assert.ok(s.variance > 200, `canvas looks empty (variance ${s.variance.toFixed(1)})`);
      assert.equal(await bannerText(page), "");
      assert.equal(await page.locator(".loading-overlay").count(), 0, "no spinner left");
    },
  },
  {
    name: "?demo=1 opens the sample without any click",
    fn: async ({ page }) => {
      await page.goto(`${(await import("./lib.mjs")).APP}?demo=1`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => performance.getEntriesByName("model-shown").length > 0, null, { timeout: 60000 });
      await page.locator(".loading-overlay").waitFor({ state: "detached" });
      const s = await canvasStats(page);
      assert.ok(s.variance > 200, `canvas looks empty (variance ${s.variance.toFixed(1)})`);
    },
  },
]);

// Motion polish: reduced motion kills transitions; a sheet is clickable the moment it opens; its exit unmounts.
import assert from "node:assert/strict";
import { suite, loadSample, openApp } from "./lib.mjs";

suite("motion", [
  {
    name: "sheet is hit-testable at once and unmounts after exit",
    fn: async ({ page }) => {
      await openApp(page);
      await loadSample(page);
      const chip = page.locator(".models-chip");
      if (!(await chip.isVisible())) return;
      await chip.click();
      const hit = await page.evaluate(() => {
        const b = document.querySelector(".models-sheet__close"), r = b.getBoundingClientRect();
        return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) && getComputedStyle(b.closest(".models-sheet")).pointerEvents !== "none";
      });
      assert.ok(hit, "sheet button hit-testable immediately");
      await page.locator(".models-sheet__close").click();
      await page.waitForSelector(".models-sheet", { state: "detached", timeout: 2000 });
    },
  },
  {
    name: "reduced motion: durations are ~0",
    fn: async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openApp(page);
      await loadSample(page);
      const d = await page.evaluate(() => [...document.querySelectorAll("button")].slice(0, 12).map((b) => parseFloat(getComputedStyle(b).transitionDuration.split(",")[0]) * 1000));
      assert.ok(d.length && d.every((x) => x < 1), `transition ms ${d}`);
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--dur-3").trim()), ".01ms");
    },
  },
]);

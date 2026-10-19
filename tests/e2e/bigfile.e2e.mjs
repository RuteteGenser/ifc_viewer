// Flow 11: a 17 MB file must not freeze the page (longest main-thread gap < 1.5 s).
import assert from "node:assert/strict";
import { suite, openApp, setFile, waitForMark, markCount, BIG_FILE, existsSync, canvasStats } from "./lib.mjs";

await suite("bigfile", [
  {
    name: "17 MB model loads with no main-thread gap over 1.5 s",
    projects: ["desktop", "iphone13"],
    timeout: 170000,
    fn: async ({ page, skip }) => {
      if (!existsSync(BIG_FILE)) skip(`${BIG_FILE} not found (set ARGUS_BIG_FILE)`);
      await openApp(page);
      await page.evaluate(() => {
        window.__gap = { max: 0, last: performance.now() };
        setInterval(() => {
          const now = performance.now();
          window.__gap.max = Math.max(window.__gap.max, now - window.__gap.last - 25);
          window.__gap.last = now;
        }, 25);
      });
      const before = await markCount(page, "model-shown");
      await setFile(page, BIG_FILE);
      await waitForMark(page, "model-shown", before, 160000);
      await page.locator(".loading-overlay").waitFor({ state: "detached", timeout: 60000 });
      await page.waitForTimeout(2000);
      const gap = await page.evaluate(() => window.__gap.max);
      assert.ok(gap < 1500, `main thread was blocked for ${Math.round(gap)} ms`);
      assert.ok((await canvasStats(page)).variance > 50, "big model did not render");
    },
  },
]);

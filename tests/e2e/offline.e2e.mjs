// Flow 8: after one visit the app still starts with the network off.
import assert from "node:assert/strict";
import { suite, openApp, APP, waitForMark, loadSample, canvasStats, sleep } from "./lib.mjs";

async function warmUp(page) {
  await openApp(page, { query: "?demo=1" });
  await waitForMark(page, "model-shown", 0, 60000);
  await page.evaluate(() => navigator.serviceWorker.ready);
  // wait until the service worker has put the shell and the engine in its cache
  await page.waitForFunction(async () => {
    let n = 0;
    for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).length;
    return n >= 8;
  }, null, { timeout: 60000 });
  await sleep(1500);
}

const offlineNoise = [/requestfailed/, /Failed to load resource/, /net::ERR/, /Could not reach/];

await suite("offline", [
  {
    name: "reload with the network off still opens the sample (?demo=1)",
    allowErrors: offlineNoise,
    timeout: 120000,
    fn: async ({ page, ctx }) => {
      await warmUp(page);
      await ctx.setOffline(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForMark(page, "model-shown", 0, 60000);
      await page.locator(".loading-overlay").waitFor({ state: "detached" });
      const s = await canvasStats(page);
      assert.ok(s.variance > 200, "offline sample did not render");
    },
  },
  {
    name: "reload offline, then pick the sample by hand (no library needed)",
    allowErrors: offlineNoise,
    timeout: 120000,
    fn: async ({ page, ctx }) => {
      await warmUp(page);
      await ctx.setOffline(true);
      await page.goto(APP, { waitUntil: "domcontentloaded" });
      await waitForMark(page, "viewer-ready", 0, 60000);
      await loadSample(page);
      const s = await canvasStats(page);
      assert.ok(s.variance > 200, "offline sample did not render");
    },
  },
]);

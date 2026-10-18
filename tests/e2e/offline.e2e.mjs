// Flow 8: after one visit the app still starts with the network off.
import assert from "node:assert/strict";
import { suite, APP, waitForMark, loadSample, canvasStats, sleep } from "./lib.mjs";

async function warmUp(page) {
  // sign in once (the browser then remembers the credentials), then use the plain address
  await page.goto(withAuth(APP), { waitUntil: "domcontentloaded" });
  await page.goto(`${APP}?demo=1`, { waitUntil: "domcontentloaded" });
  await waitForMark(page, "viewer-ready", 0, 60000);
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

// httpCredentials make playwright switch the browser cache off, which makes every request
// look like cache:"no-store" to the service worker (it then deliberately bypasses its caches).
// So these cases sign in through user:pass@ in the URL (Chrome remembers it for the origin and
// the service worker's own fetches reuse it), which is how a real browser behaves.
const realCache = { httpCredentials: undefined };
const withAuth = (url) => url.replace("://", `://${process.env.ARGUS_AUTH || "ifc:123"}@`);
const offlineNoise = [/requestfailed/, /Failed to load resource/, /net::ERR/, /Could not reach/];

await suite("offline", [
  {
    name: "reload with the network off still opens the sample (?demo=1)",
    allowErrors: offlineNoise,
    context: realCache,
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
    context: realCache,
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

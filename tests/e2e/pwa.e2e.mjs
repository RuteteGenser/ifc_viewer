// Flow 9: installability basics. Manifest, icons, service worker.
import assert from "node:assert/strict";
import { suite, openApp, APP } from "./lib.mjs";

await suite("pwa", [
  {
    name: "manifest is valid JSON named Argus and every icon answers 200 as an image",
    projects: ["desktop"],
    fn: async ({ page }) => {
      await openApp(page);
      const href = await page.locator("link[rel=manifest]").getAttribute("href");
      assert.ok(href, "no <link rel=manifest>");
      const manifestUrl = new URL(href, page.url()).href;
      const res = await page.request.get(manifestUrl);
      assert.equal(res.status(), 200);
      const m = JSON.parse(await res.text());
      assert.equal(m.name, "Argus");
      assert.equal(m.short_name, "Argus");
      assert.equal(m.display, "standalone");
      assert.ok(Array.isArray(m.icons) && m.icons.length >= 2);
      assert.ok(m.icons.some((i) => i.sizes === "192x192") && m.icons.some((i) => i.sizes === "512x512"));
      assert.ok(m.icons.some((i) => /maskable/.test(i.purpose || "")), "a maskable icon is needed for Android");
      for (const icon of m.icons) {
        const r = await page.request.get(new URL(icon.src, manifestUrl).href);
        assert.equal(r.status(), 200, icon.src);
        assert.match(r.headers()["content-type"], /^image\//, icon.src);
      }
      for (const sel of ["link[rel=apple-touch-icon]", "meta[name=theme-color]"]) assert.equal(await page.locator(sel).count(), 1, sel);
    },
  },
  {
    name: "the service worker registers and becomes active",
    projects: ["desktop"],
    fn: async ({ page }) => {
      await openApp(page);
      const state = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        return { scope: reg.scope, state: reg.active?.state };
      });
      assert.equal(state.state, "activated");
      assert.equal(state.scope, APP);
    },
  },
]);

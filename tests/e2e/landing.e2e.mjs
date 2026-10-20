// Flow 10: the landing page at / (served by nginx next to the app).
import assert from "node:assert/strict";
import { suite, BASE, APP, waitForMark } from "./lib.mjs";

async function gotoLanding(page, skip) {
  const res = await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  if (!res || res.status() === 404) skip(`no landing page at ${BASE}/ (a scratch build serves only /app/)`);
}
const overflow = (page) => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));

await suite("landing", [
  {
    name: "loads with exactly one header and two sections, titled Argus",
    fn: async ({ page, skip }) => {
      await gotoLanding(page, skip);
      assert.match(await page.title(), /Argus/);
      assert.equal(await page.locator("header").count(), 1);
      assert.equal(await page.locator("section").count(), 2);
      assert.equal(await page.locator("h1").count(), 1);
    },
  },
  {
    name: "the call to action points at /app/ (the landing has one button; the demo link is optional)",
    projects: ["desktop"],
    fn: async ({ page, skip }) => {
      await gotoLanding(page, skip);
      const hrefs = await page.locator("a[href^='/app/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      assert.ok(hrefs.includes("/app/"), `hrefs: ${hrefs}`);
    },
  },
  {
    name: "the /app/ link opens the empty viewer",
    fn: async ({ page, skip }) => {
      await gotoLanding(page, skip);
      await page.locator("a[href='/app/']").first().click();
      await page.waitForURL(/\/app\/$/);
      await waitForMark(page, "viewer-ready");
      // The first screen is the project browser on a backend with folders, the plain start card without one.
      await page.getByRole("heading", { name: /^(Open a building model|No projects yet)$/ }).waitFor();
    },
  },
  {
    name: "the /app/?demo=1 link opens the sample building",
    fn: async ({ page, skip }) => {
      await gotoLanding(page, skip);
      // The landing may carry only the one /app/ button; the demo address itself is what links elsewhere point at.
      const link = page.locator("a[href='/app/?demo=1']").first();
      if (await link.count()) await link.click();
      else await page.goto(`${APP}?demo=1`, { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/app\/\?demo=1/);
      await waitForMark(page, "model-shown", 0, 60000);
      await page.locator(".loading-overlay").waitFor({ state: "detached" });
    },
  },
  ...[375, 768, 1440].map((w) => ({
    name: `no horizontal overflow at ${w} px`,
    projects: ["desktop"],
    fn: async ({ page, skip }) => {
      await page.setViewportSize({ width: w, height: 900 });
      await gotoLanding(page, skip);
      await page.waitForLoadState("load");
      const { scroll, inner } = await overflow(page);
      assert.ok(scroll <= inner, `page is ${scroll}px wide in a ${inner}px window`);
    },
  })),
  {
    name: "no horizontal overflow on the phone and tablet profiles",
    projects: ["iphone13", "ipad-mini"],
    fn: async ({ page, skip }) => {
      await gotoLanding(page, skip);
      await page.waitForLoadState("load");
      const { scroll, inner } = await overflow(page);
      assert.ok(scroll <= inner, `page is ${scroll}px wide in a ${inner}px window`);
    },
  },
]);
void APP;

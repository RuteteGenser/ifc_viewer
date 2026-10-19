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
    name: "the two calls to action point at /app/ and /app/?demo=1",
    projects: ["desktop"],
    fn: async ({ page, skip }) => {
      await gotoLanding(page, skip);
      const hrefs = await page.locator("a[href^='/app/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      assert.ok(hrefs.includes("/app/"), `hrefs: ${hrefs}`);
      assert.ok(hrefs.includes("/app/?demo=1"), `hrefs: ${hrefs}`);
    },
  },
  {
    name: "the /app/ link opens the empty viewer",
    fn: async ({ page, skip }) => {
      await gotoLanding(page, skip);
      await page.locator("a[href='/app/']").first().click();
      await page.waitForURL(/\/app\/$/);
      await waitForMark(page, "viewer-ready");
      await page.getByRole("heading", { name: "Open a building model" }).waitFor();
    },
  },
  {
    name: "the /app/?demo=1 link opens the sample building",
    fn: async ({ page, skip }) => {
      await gotoLanding(page, skip);
      await page.locator("a[href='/app/?demo=1']").first().click();
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

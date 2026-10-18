// Flow 7: the Back button / swipe-back guard.
import assert from "node:assert/strict";
import { suite, BASE, APP, openApp, isTouch } from "./lib.mjs";

const dialog = (page) => page.getByRole("dialog", { name: "Leave the viewer?" });
const back = (page) => page.evaluate(() => history.back());

// A previous page to go back to, then the viewer, then a first gesture (arms the guard).
async function start(page, touch) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await openApp(page);
  const title = page.locator(".header__title");
  if (touch) await title.tap(); else await title.click();
  await page.waitForTimeout(300);
}

await suite("back-guard", [
  {
    name: "Back shows the leave dialog, Stay keeps the app, Back again asks again",
    fn: async ({ page, touch }) => {
      await start(page, touch);
      await back(page);
      await dialog(page).waitFor({ state: "visible", timeout: 5000 });
      assert.match(page.url(), /\/app\//);
      await page.getByRole("button", { name: "Stay" }).click();
      await dialog(page).waitFor({ state: "hidden" });
      await back(page);
      await dialog(page).waitFor({ state: "visible", timeout: 5000 });
      assert.match(page.url(), /\/app\//);
    },
  },
  {
    name: "a second Back while the dialog is open does not leave without confirmation",
    fn: async ({ page, touch }) => {
      await start(page, touch);
      await back(page);
      await dialog(page).waitFor({ state: "visible", timeout: 5000 });
      await back(page);
      await page.waitForTimeout(1200);
      assert.match(page.url(), /\/app\//, "second Back left the viewer without asking");
      assert.ok(await dialog(page).isVisible(), "dialog disappeared on the second Back");
    },
  },
  {
    name: "Leave goes to the previous page",
    fn: async ({ page, touch }) => {
      await start(page, touch);
      await back(page);
      await dialog(page).waitFor({ state: "visible", timeout: 5000 });
      await page.getByRole("button", { name: "Leave" }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/app/"), { timeout: 10000 });
    },
  },
  {
    name: "a change of the #hash (view link) does not open the dialog",
    fn: async ({ page, touch }) => {
      await start(page, touch);
      await page.evaluate(() => { location.hash = "#view=1,2,3,0,0,0,0,0,0,1,0,0,0,50&m="; });
      await page.waitForTimeout(500);
      await page.evaluate(() => { location.hash = ""; });
      await page.waitForTimeout(800);
      assert.equal(await dialog(page).count(), 0);
      assert.match(page.url(), /\/app\//);
    },
  },
]);
void APP; void isTouch;

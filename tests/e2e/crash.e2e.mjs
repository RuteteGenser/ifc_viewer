// Crash screen: a render crash shows a plain screen with Reload and Details, not a white page.
// Needs a build made with VITE_TEST_HOOK=1 (?__crash=1 forces the crash); skipped otherwise.
import assert from "node:assert/strict";
import { suite, APP } from "./lib.mjs";

await suite("crash", [
  {
    name: "a render crash shows the crash screen; Details has the build and message; Reload reloads",
    allowErrors: [/forced crash/, /viewer crashed/, /The above error occurred/],
    fn: async ({ page, skip }) => {
      await page.goto(`${APP}?__crash=1`, { waitUntil: "domcontentloaded" });
      const screen = page.getByTestId("crash-screen");
      try {
        await screen.waitFor({ state: "visible", timeout: 15000 });
      } catch {
        return skip("needs a build made with VITE_TEST_HOOK=1; see tests/TESTING.md");
      }
      await page.getByRole("heading", { name: "Something went wrong" }).waitFor();
      const reload = page.getByRole("button", { name: "Reload" });
      const box = await reload.boundingBox();
      assert.ok(box.height >= 43.9 && box.width >= 43.9, `Reload is ${box.width}x${box.height}`);
      const pre = page.getByLabel("Error details");
      assert.equal(await pre.isVisible(), false, "Details starts collapsed");
      await page.getByText("Details", { exact: true }).click();
      const text = await pre.innerText();
      assert.match(text, /forced crash/);
      assert.match(text, /Build: \S+/);
      assert.match(text, /User agent: .*\S/);
      assert.match(text, /Component stack:/);
      await page.evaluate(() => { window.__beforeReload = true; });
      await Promise.all([page.waitForEvent("load"), reload.click()]);
      assert.equal(await page.evaluate(() => window.__beforeReload), undefined, "the page reloaded");
      await screen.waitFor({ state: "visible" }); // the flag is still in the URL, so it crashes again
    },
  },
  {
    name: "without the crash flag the app renders normally and no crash screen exists",
    fn: async ({ page }) => {
      await page.goto(APP, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: /^(Open a building model|No projects yet)$/ }).waitFor({ timeout: 30000 });
      assert.equal(await page.getByTestId("crash-screen").count(), 0);
    },
  },
]);

// Flow 5: measure, section, hide with undo/redo, isolate, level filter.
import assert from "node:assert/strict";
import { suite, openApp, loadSample, tapModel, canvasBox, stableClick, viewShot, pngDiff, measureTab, isTouch } from "./lib.mjs";

const toggleMeasure = (page) => page.getByRole("button", { name: "Toggle measure mode" });
async function pointAt(page, project, fx, fy) {
  const b = await canvasBox(page);
  const x = b.x + b.width * fx;
  const y = b.y + b.height * fy;
  if (isTouch(project)) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}
async function startMeasure(page) {
  await stableClick(toggleMeasure(page));
  // A phone's icon opens the Measure menu; Distance is the tool these cases are about.
  const distance = page.getByRole("menuitemradio", { name: /Distance/ });
  if (await distance.isVisible().catch(() => false)) await distance.click();
  await page.locator(".tool-hint").waitFor({ state: "visible" });
}
const views = (page) => page.getByRole("dialog", { name: "Views and levels" });
const openViews = async (page) => {
  if (!(await views(page).isVisible())) await stableClick(page.getByRole("button", { name: "Views and levels" }));
  await views(page).waitFor({ state: "visible" });
};
const isolatingCount = async (page) => {
  const el = page.locator(".search-bar__isolate-banner");
  if (!(await el.isVisible().catch(() => false))) return 0;
  return Number(/Isolating (\d+)/.exec(await el.innerText())?.[1] ?? 0);
};

await suite("tools", [
  {
    name: "measure: two taps make a measurement with a sane length; Done leaves the tool",
    fn: async ({ page, project }) => {
      await openApp(page);
      await loadSample(page);
      await startMeasure(page);
      await pointAt(page, project, 0.4, 0.5);
      await page.waitForTimeout(400);
      await pointAt(page, project, 0.55, 0.62);
      await page.waitForTimeout(600);
      await page.locator(".tool-hint__done").click();
      await page.locator(".tool-hint").waitFor({ state: "detached" });
      // On a touch screen the list sits behind the "Show details" button; on desktop the tab is already there.
      const fab = page.getByRole("button", { name: /^Show details/ });
      if (await fab.isVisible()) await fab.click();
      else await measureTab(page).click();
      await page.getByText(/Length:/).first().waitFor({ state: "visible", timeout: 10000 });
      const text = await page.locator(".element-panel").first().innerText();
      const m = /Length:\s*([\d.]+)\s*(mm|m)\b/.exec(text);
      assert.ok(m, `no measurement in the panel:\n${text.slice(0, 300)}`);
      const metres = m[2] === "mm" ? Number(m[1]) / 1000 : Number(m[1]);
      assert.ok(metres > 0.3 && metres < 40, `length ${metres} m is not plausible for an 8 m building`);
    },
  },
  {
    name: "measure: Esc leaves the tool",
    projects: ["desktop"],
    fn: async ({ page }) => {
      await openApp(page);
      await loadSample(page);
      await startMeasure(page);
      await page.keyboard.press("Escape");
      await page.locator(".tool-hint").waitFor({ state: "detached", timeout: 5000 });
    },
  },
  {
    name: "section preset creates a plane and Undo removes it",
    fn: async ({ page }) => {
      await openApp(page);
      await loadSample(page);
      await openViews(page);
      await page.getByRole("button", { name: "Cut a horizontal plan section through the middle" }).click();
      await openViews(page);
      await page.getByRole("slider", { name: "Move the section plane" }).waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Done" }).click();
      await page.getByRole("button", { name: "Undo" }).click();
      await page.waitForTimeout(500);
      await openViews(page);
      assert.equal(await page.getByRole("slider", { name: "Move the section plane" }).count(), 0, "section plane is still there after Undo");
    },
  },
  {
    name: "hide an element, Undo brings it back, Redo hides it again",
    fn: async ({ page, project }) => {
      await openApp(page);
      await loadSample(page);
      await tapModel(page, project);
      await page.getByRole("button", { name: "Hide this element" }).click();
      await page.waitForTimeout(800);
      const hidden = await viewShot(page);
      await page.getByRole("button", { name: "Undo" }).click();
      await page.waitForTimeout(800);
      const back = await viewShot(page);
      assert.ok((await pngDiff(page, hidden, back)) > 0.5, "Undo changed nothing on screen");
      await page.getByRole("button", { name: "Redo" }).click();
      await page.waitForTimeout(800);
      const again = await viewShot(page);
      const d = await pngDiff(page, hidden, again);
      assert.ok(d < (await pngDiff(page, back, again)), `Redo does not look like the hidden state (diff ${d})`);
    },
  },
  {
    name: "isolate through search, then Show all",
    fn: async ({ page, phone }) => {
      await openApp(page);
      await loadSample(page);
      await page.getByRole("combobox", { name: "Search elements" }).or(page.getByLabel("Search elements")).first().fill("wall");
      const isolate = page.getByRole("button", { name: /^Isolate (all|these) \d+/ });
      await isolate.first().waitFor({ state: "visible", timeout: 10000 });
      await isolate.first().click();
      const n = await isolatingCount(page);
      assert.ok(n > 0 && n < 43, `isolating ${n} elements`);
      await page.locator(".search-bar__isolate-banner").getByRole("button", { name: "Show all" }).click();
      assert.equal(await isolatingCount(page), 0);
      void phone;
    },
  },
  {
    name: "levels: Only a floor isolates that floor's elements; All restores",
    fn: async ({ page }) => {
      await openApp(page);
      await loadSample(page);
      await openViews(page);
      await page.getByRole("button", { name: "Only Ground floor" }).click();
      await page.waitForTimeout(800);
      const ground = await isolatingCount(page);
      assert.ok(ground > 5 && ground <= 20, `Ground floor isolates ${ground} elements (expected the 14 on that level)`);
      await openViews(page);
      await page.getByRole("button", { name: "Only Second floor" }).click();
      await page.waitForTimeout(800);
      const second = await isolatingCount(page);
      assert.notEqual(second, 0);
      await openViews(page);
      await page.getByRole("group", { name: "Levels" }).getByRole("button", { name: "All" }).click();
      await page.waitForTimeout(500);
      assert.equal(await isolatingCount(page), 0);
    },
  },
]);

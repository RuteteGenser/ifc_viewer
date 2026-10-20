// The Measure menu and the Clearance tool. Needs a build made with VITE_TEST_HOOK=1 (window.__ifcDebug.clearances).
import assert from "node:assert/strict";
import { suite, openApp, loadSample, canvasBox, stableClick, measureTab, readLevels, closeViews, requireHook, isTouch } from "./lib.mjs";

const mainButton = (page) => page.getByRole("button", { name: /^(Toggle measure mode|Measure tools)$/ });
const caret = (page) => page.getByRole("button", { name: "Choose a measure tool" });
const menu = (page) => page.getByRole("menu", { name: "Measure tools" });
const item = (page, name) => menu(page).getByRole("menuitemradio", { name });
const hint = (page) => page.locator(".tool-hint__text");

// Opens the menu the way the device does it: the arrow on a desktop, a tap on the icon on a phone.
async function openMenu(page, phone) {
  await stableClick(phone ? mainButton(page) : caret(page));
  await menu(page).waitFor({ state: "visible" });
}
async function armClearance(page, phone) {
  await openMenu(page, phone);
  await item(page, /Clearance/).click();
  await menu(page).waitFor({ state: "detached" });
  await hint(page).filter({ hasText: /clearance/i }).waitFor({ state: "visible" });
}
const clearances = (page) => page.evaluate(() => window.__ifcDebug.clearances());

async function tapAt(page, project, fx, fy) {
  const b = await canvasBox(page);
  const x = b.x + b.width * fx;
  const y = b.y + b.height * fy;
  if (isTouch(project)) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

// Taps around the framed building until an element has floor below and a ceiling above it.
const WALLS = [[0.5, 0.5], [0.45, 0.55], [0.55, 0.45], [0.4, 0.6], [0.6, 0.55], [0.5, 0.65], [0.35, 0.5], [0.65, 0.5]];
const ROOF = [[0.5, 0.22], [0.45, 0.2], [0.6, 0.25], [0.5, 0.3]];
async function measureSomething(page, project, want = (c) => c.values.up != null && c.values.down != null, spots = WALLS) {
  for (const [fx, fy] of spots) {
    const before = (await clearances(page)).length;
    await tapAt(page, project, fx, fy);
    try {
      await page.waitForFunction((n) => window.__ifcDebug.clearances().length > n, before, { timeout: 15000 });
    } catch {
      continue; // empty space: the tool left, arm again
    }
    const all = await clearances(page);
    const last = all[all.length - 1];
    if (want(last)) return last;
    await page.keyboard.press("Escape").catch(() => {});
  }
  return null;
}

async function openMeasurementsList(page) {
  const fab = page.getByRole("button", { name: /^Show details/ });
  if (await fab.isVisible().catch(() => false)) await fab.click();
  else await measureTab(page).click();
}

const metres = (text) => {
  const m = /([\d.]+)\s*(mm|m)\b/.exec(text);
  return m ? (m[2] === "mm" ? Number(m[1]) / 1000 : Number(m[1])) : null;
};

await suite("clearance", [
  {
    name: "the Measure menu lists every measure tool and Distance is the default",
    fn: async ({ page, phone, skip }) => {
      await openApp(page);
      await requireHook(page, skip);
      await loadSample(page);
      await openMenu(page, phone);
      const items = await menu(page).getByRole("menuitemradio").allInnerTexts();
      assert.equal(items.length, 2, items.join(" | "));
      assert.match(items[0], /Distance/);
      assert.match(items[0], /Two points/);
      assert.match(items[1], /Clearance/);
      assert.match(items[1], /four directions/);
      assert.equal(await item(page, /Distance/).getAttribute("aria-checked"), "true");
      assert.equal(await item(page, /Clearance/).getAttribute("aria-checked"), "false");
    },
  },
  {
    name: "menu keyboard: arrows move, Esc closes and gives focus back, Enter chooses",
    projects: ["desktop"],
    fn: async ({ page, skip }) => {
      await openApp(page);
      await requireHook(page, skip);
      await loadSample(page);
      await caret(page).focus();
      await page.keyboard.press("Enter");
      await menu(page).waitFor({ state: "visible" });
      const focused = () => page.evaluate(() => document.activeElement?.getAttribute("data-tool"));
      assert.equal(await focused(), "distance", "focus starts on the chosen tool");
      await page.keyboard.press("ArrowDown");
      assert.equal(await focused(), "clearance");
      await page.keyboard.press("ArrowDown");
      assert.equal(await focused(), "distance", "wraps");
      await page.keyboard.press("End");
      assert.equal(await focused(), "clearance");
      await page.keyboard.press("Home");
      assert.equal(await focused(), "distance");
      await page.keyboard.press("Escape");
      await menu(page).waitFor({ state: "detached" });
      assert.ok(await caret(page).evaluate((el) => el === document.activeElement), "focus returns to the arrow");
      assert.equal(await page.locator(".tool-hint").count(), 0, "Esc on the menu must not arm or disarm a tool");
      // Enter on the arrow, Down, Enter: Clearance is armed and focus is back on the arrow.
      await page.keyboard.press("Enter");
      await menu(page).waitFor({ state: "visible" });
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await hint(page).filter({ hasText: /clearance/i }).waitFor({ state: "visible" });
      assert.ok(await caret(page).evaluate((el) => el === document.activeElement), "focus returns to the arrow after choosing");
      // Esc with the menu closed leaves the tool.
      await page.keyboard.press("Escape");
      await page.locator(".tool-hint").waitFor({ state: "detached", timeout: 5000 });
    },
  },
  {
    name: "desktop: the icon arms the tool used last, the arrow only opens the menu",
    projects: ["desktop"],
    fn: async ({ page, skip }) => {
      await openApp(page);
      await requireHook(page, skip);
      await loadSample(page);
      await stableClick(mainButton(page));
      await hint(page).filter({ hasText: /two points/i }).waitFor({ state: "visible" });
      await page.locator(".tool-hint__done").click();
      await page.locator(".tool-hint").waitFor({ state: "detached" });
      await openMenu(page, false);
      assert.equal(await page.locator(".tool-hint").count(), 0, "opening the menu does not arm anything");
      await item(page, /Clearance/).click();
      await hint(page).filter({ hasText: /clearance/i }).waitFor({ state: "visible" });
    },
  },
  {
    name: "clearance: a tap measures four directions; values are plausible, listed, undoable and deletable",
    fn: async ({ page, project, phone, skip }) => {
      await openApp(page);
      await requireHook(page, skip);
      await loadSample(page);
      const levels = await readLevels(page);
      await closeViews(page);
      const elevations = levels.map((l) => Number(/[-+]?[\d.]+/.exec(l.elevation)?.[0])).filter(Number.isFinite).sort((a, b) => a - b);
      const storey = elevations.length > 1 ? elevations[1] - elevations[0] : 3;
      await armClearance(page, phone);
      const c = await measureSomething(page, project);
      assert.ok(c, "no tap produced an element with a floor below and a ceiling above");
      assert.ok(c.values.up > 0 && c.values.down > 0, JSON.stringify(c.values));
      const sum = c.values.up + c.values.down;
      assert.ok(sum > 0.5 * storey && sum <= storey + 0.05, `up + down = ${sum.toFixed(2)} m against a storey of ${storey} m`);
      for (const dir of ["left", "right"]) assert.ok(c.values[dir] === null || c.values[dir] > 0, `${dir} ${c.values[dir]}`);
      assert.ok(c.name && c.name !== "Element", "the element is named");

      // The Measurements tab: one entry "Clearance: <name>" with Up/Down/Left/Right.
      await page.locator(".tool-hint__done").click();
      await openMeasurementsList(page);
      const row = page.locator('[data-kind="clearance"]').first();
      await row.waitFor({ state: "visible", timeout: 10000 });
      const text = await row.innerText();
      assert.ok(text.includes(`Clearance: ${c.name}`), text);
      for (const dir of ["Up", "Down", "Left", "Right"]) assert.match(text, new RegExp(`${dir}: (\\d|Open)`), text);
      const upShown = metres(await row.locator('[data-dir="up"]').innerText());
      assert.ok(Math.abs(upShown - c.values.up) < 0.006, `list says ${upShown}, scene says ${c.values.up}`);

      // Undo removes it, Redo brings it back, the delete button removes it, Undo restores that.
      await page.getByRole("button", { name: "Undo" }).click();
      await page.waitForFunction(() => window.__ifcDebug.clearances().length === 0);
      await page.getByRole("button", { name: "Redo" }).click();
      await page.waitForFunction(() => window.__ifcDebug.clearances().length === 1);
      const again = (await clearances(page))[0];
      assert.deepEqual(again.values, c.values, "redo restores the same numbers");
      await openMeasurementsList(page).catch(() => {});
      await page.locator('[data-kind="clearance"]').first().getByRole("button", { name: "Remove measurement" }).click();
      await page.waitForFunction(() => window.__ifcDebug.clearances().length === 0);
      await page.getByRole("button", { name: "Undo" }).click();
      await page.waitForFunction(() => window.__ifcDebug.clearances().length === 1);
    },
  },
  {
    name: "clearance: nothing above the roof reads Open, and Esc leaves the tool",
    projects: ["desktop"],
    fn: async ({ page, project, skip }) => {
      await openApp(page);
      await requireHook(page, skip);
      await loadSample(page);
      await armClearance(page, false);
      // The roof is the top of the building: a tap on it measures up into the open.
      const c = await measureSomething(page, project, (m) => m.values.up === null && m.values.down != null, ROOF);
      assert.ok(c, "no tap measured an element with open sky above it");
      assert.equal(c.values.up, null);
      assert.ok(c.reach.up > 0, "the dashed line still has a length");
      await page.keyboard.press("Escape");
      await page.locator(".tool-hint").waitFor({ state: "detached", timeout: 5000 });
      assert.equal((await clearances(page)).length, 1, "leaving the tool keeps the measurement");
    },
  },
  {
    name: "the last used tool is remembered after a reload",
    fn: async ({ page, phone, skip }) => {
      await openApp(page);
      await requireHook(page, skip);
      await loadSample(page);
      await openMenu(page, phone);
      await item(page, /Clearance/).click();
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => performance.getEntriesByName("viewer-ready").length > 0, null, { timeout: 60000 });
      await loadSample(page);
      if (phone) {
        await openMenu(page, true);
        assert.equal(await item(page, /Clearance/).getAttribute("aria-checked"), "true");
      } else {
        await stableClick(mainButton(page)); // the icon arms what was used last
        await hint(page).filter({ hasText: /clearance/i }).waitFor({ state: "visible" });
      }
    },
  },
  {
    name: "320 px: the menu fits, every item is a 44 px target, nothing scrolls sideways",
    projects: ["small320"],
    fn: async ({ page, phone, skip }) => {
      await openApp(page);
      await requireHook(page, skip);
      await loadSample(page);
      await openMenu(page, phone);
      const box = await menu(page).boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 320, JSON.stringify(box));
      for (const el of await menu(page).getByRole("menuitemradio").all()) {
        const b = await el.boundingBox();
        assert.ok(b.height >= 44 && b.width >= 44, `target ${b.width}x${b.height}`);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
      const main = await mainButton(page).boundingBox();
      assert.ok(main.height >= 44 && main.width >= 44, `Measure button ${main.width}x${main.height}`);
    },
  },
  {
    name: "a phone tap with the tool armed measures; without it a long press still opens the element menu",
    projects: ["iphone13"],
    fn: async ({ page, project, phone, skip }) => {
      await openApp(page);
      await requireHook(page, skip);
      await loadSample(page);
      await armClearance(page, phone);
      const c = await measureSomething(page, project);
      assert.ok(c, "the tap did not measure");
      await page.locator(".tool-hint__done").click();
      await page.locator(".tool-hint").waitFor({ state: "detached" });
      // Not armed: a press and hold on the model opens the element menu, as before.
      const b = await canvasBox(page);
      const x = b.x + b.width * 0.5;
      const y = b.y + b.height * 0.5;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await page.waitForTimeout(900);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.locator(".context-menu").waitFor({ state: "visible", timeout: 5000 });
    },
  },
]);

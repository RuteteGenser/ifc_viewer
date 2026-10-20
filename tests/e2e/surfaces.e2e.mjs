// Surfaces: one sheet at a time, one armed tool, a toast budget, Back/Esc order (docs/SURFACES.md).
// Needs a build made with VITE_TEST_HOOK=1 (window.__surfaces counts two-sheets violations); see tests/TESTING.md.
import assert from "node:assert/strict";
import { suite, openApp, loadSample, tapModel, canvasBox, requireHook, sleep } from "./lib.mjs";

const PHONES = ["iphone13", "pixel7", "small320"];
const ALL = [...PHONES, "desktop"];
const click = (loc) => loc.dispatchEvent("click"); // bypasses hit-testing: what a shortcut or assistive tech does

const views = (page) => page.getByRole("button", { name: "Views and levels" });
const share = (page) => page.getByRole("button", { name: "Save image or copy view link" });
const helpBtn = (page) => page.getByRole("button", { name: "Help: how to move around" });
// The toolbar has no room for Help on the narrowest phones: it is in the menu drawer there.
async function openHelp(page) {
  if (!(await helpBtn(page).count())) await click(menu(page));
  await click(helpBtn(page));
}
const menu = (page) => page.getByRole("button", { name: /^(Open|Close) menu$/ });
const casesBtn = (page) => page.getByRole("button", { name: /^Cases/ });
const measure = (page) => page.getByRole("button", { name: "Toggle measure mode" });
const tag = (page) => page.getByRole("button", { name: "Toggle tag tool" });
const clip = (page) => page.getByRole("button", { name: "Toggle camera clip" });
const armed = (loc) => loc.evaluate((el) => el.classList.contains("top-bar__icon-button--active"));

// Sheets on screen right now (not exiting, not a ghost, laid out).
const visibleSheets = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-surface-sheet]")]
      .filter((e) => e.getAttribute("data-state") !== "closed" && !e.closest("[inert]") && e.getClientRects().length > 0)
      .map((e) => e.getAttribute("data-surface-sheet")),
  );
const settleSheets = async (page, ms = 500) => {
  await sleep(ms);
  return visibleSheets(page);
};
// Waits (up to 6 s: a slow runner, an exit animation) until exactly `want` are on screen, then returns what is.
async function sheetsAre(page, want) {
  const end = Date.now() + 6000;
  let now = await visibleSheets(page);
  while (Date.now() < end && JSON.stringify(now) !== JSON.stringify(want)) {
    await sleep(120);
    now = await visibleSheets(page);
  }
  return now;
}
const rectOf = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

// A tap that a slow runner stretches into a long press opens the context menu instead; close it and tap again.
async function select(page, project, frac) {
  for (let i = 0; i < 4; i++) {
    await tapModel(page, project, frac);
    await sleep(700);
    if ((await visibleSheets(page)).includes("details")) return;
    if (await page.locator(".context-menu").count()) {
      await page.keyboard.press("Escape");
      await sleep(300);
    }
  }
}

async function ready(page, skip) {
  await openApp(page);
  await requireHook(page, skip);
  await loadSample(page);
}
const sheetBox = (page, id) => rectOf(page.locator(`[data-surface-sheet="${id}"]:not([data-state="closed"])`).first());

// Share the visible floating controls' boxes.
const floating = (page) =>
  page.evaluate(() => {
    const sel = [".view-tools__button", ".history-buttons__button", ".compass", ".details-fab", ".plane-switch", ".tool-hint", ".camera-clip-popover", ".first-run", ".toast"];
    const out = [];
    for (const s of sel) {
      for (const el of document.querySelectorAll(s)) {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (cs.visibility === "hidden" || cs.display === "none" || r.width < 2 || r.height < 2 || el.closest("[inert]")) continue;
        out.push({ name: s, x: r.x, y: r.y, w: r.width, h: r.height });
      }
    }
    return out;
  });
function overlaps(boxes) {
  const bad = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i];
    const b = boxes[j];
    if (inter({ x: a.x, y: a.y, w: a.w, h: a.h }, { x: b.x, y: b.y, w: b.w, h: b.h }) > 4) bad.push(`${a.name} x ${b.name}`);
  }
  return bad;
}

await suite("surfaces", [
  {
    name: "phone: opening every sheet in turn never shows two (Esc then the next)",
    projects: PHONES,
    timeout: 150000,
    fn: async ({ page, skip, project }) => {
      await ready(page, skip);
      await select(page, project);
      assert.deepEqual(await sheetsAre(page, ["details"]), ["details"], "a selection opens the details sheet");
      await click(menu(page));
      assert.deepEqual(await sheetsAre(page, ["menu"]), ["menu"], "the menu replaces details");
      await click(views(page));
      assert.deepEqual(await sheetsAre(page, ["views"]), ["views"]);
      await click(share(page));
      assert.deepEqual(await sheetsAre(page, ["share"]), ["share"]);
      await openHelp(page);
      assert.deepEqual(await sheetsAre(page, ["help"]), ["help"]);
      await click(menu(page));
      assert.deepEqual(await sheetsAre(page, ["menu"]), ["menu"]);
      await click(casesBtn(page));
      assert.deepEqual(await sheetsAre(page, ["cases"]), ["cases"], "Cases replaces the menu");
      assert.equal(await page.evaluate(() => window.__surfaces?.violations ?? 0), 0, "the test-build assertion saw two sheets at once");
      const dialogs = await page.evaluate(() =>
        [...document.querySelectorAll('[role="dialog"], [role="menu"], aside[aria-label="Details"]')]
          .filter((e) => e.getAttribute("data-state") !== "closed" && !e.closest("[inert], [aria-hidden=true]") && (() => { const r = e.getBoundingClientRect(); return r.width > 0 && r.top < innerHeight - 4 && r.bottom > 4 && r.left < innerWidth - 4; })())
          .map((e) => e.getAttribute("aria-label") || e.className));
      assert.ok(dialogs.length <= 1, `dialogs/menus on screen by role: ${dialogs.join(" | ")}`);
    },
  },
  {
    name: "phone: a bottom sheet leaves at least 40 percent of the canvas unobscured",
    projects: PHONES,
    timeout: 150000,
    fn: async ({ page, skip, project }) => {
      await ready(page, skip);
      const canvas = await canvasBox(page);
      const area = canvas.width * canvas.height;
      const covered = async (id) => inter({ x: canvas.x, y: canvas.y, w: canvas.width, h: canvas.height }, await sheetBox(page, id)) / area;
      await select(page, project);
      await settleSheets(page);
      assert.ok((await covered("details")) <= 0.6 + 0.01, `details half covers ${(await covered("details")).toFixed(2)} of the canvas`);
      await click(menu(page));
      await settleSheets(page);
      await click(casesBtn(page));
      await settleSheets(page);
      assert.ok((await covered("cases")) <= 0.61, `Cases covers ${(await covered("cases")).toFixed(2)}`);
      await page.keyboard.press("Escape");
      await settleSheets(page);
      await openHelp(page);
      await settleSheets(page);
      assert.ok((await covered("help")) <= 0.61, `Help covers ${(await covered("help")).toFixed(2)}`);
      await page.keyboard.press("Escape");
      await settleSheets(page);
      await click(views(page));
      await settleSheets(page);
      assert.ok((await covered("views")) <= 0.61, `Views covers ${(await covered("views")).toFixed(2)}`);
    },
  },
  {
    name: "phone: arming a tool disarms the other, closes the sheet; opening a sheet disarms the tool",
    projects: PHONES,
    fn: async ({ page, skip }) => {
      await ready(page, skip);
      await click(measure(page));
      assert.ok(await armed(measure(page)));
      await click(tag(page));
      assert.ok(!(await armed(measure(page))) && (await armed(tag(page))), "Tag replaced Measure");
      await click(clip(page));
      await sleep(300);
      assert.ok(!(await armed(tag(page))), "Camera clip disarmed Tag");
      assert.equal(await page.locator(".tool-hint").count(), 0, "one compact bar: no tool pill beside the slider");
      await click(menu(page));
      await sleep(400);
      assert.deepEqual(await sheetsAre(page, ["menu"]), ["menu"]);
      assert.equal(await page.locator(".camera-clip-popover").count(), 0, "a sheet disarmed the tool");
      await click(measure(page));
      await sleep(400);
      assert.deepEqual(await sheetsAre(page, []), [], "arming a tool closed the sheet");
      assert.ok(await armed(measure(page)));
    },
  },
  {
    name: "one toast at a time, the newest wins",
    projects: ALL,
    fn: async ({ page, skip }) => {
      await ready(page, skip);
      await page.keyboard.press("f"); // nothing selected: "Select an element first, then press F..."
      await sleep(100);
      await page.keyboard.press("i"); // ... "then press I to isolate it"
      await sleep(250);
      assert.equal(await page.locator(".toast").count(), 1, "two toasts on screen");
      assert.match(await page.locator(".toast").innerText(), /press I/);
    },
  },
  {
    name: "phone: floating controls do not overlap each other nor the sheet",
    projects: PHONES,
    timeout: 120000,
    fn: async ({ page, skip, project }) => {
      await ready(page, skip);
      assert.deepEqual(overlaps(await floating(page)), [], "idle");
      await click(measure(page));
      await sleep(500);
      assert.deepEqual(overlaps(await floating(page)), [], "measure pill and buttons");
      await click(measure(page));
      await select(page, project);
      await settleSheets(page, 700);
      const sheet = await sheetBox(page, "details");
      const boxes = await floating(page);
      assert.deepEqual(overlaps(boxes), [], "details half");
      const hit = boxes.filter((b) => inter(b, sheet) > 4).map((b) => b.name);
      assert.deepEqual(hit, [], `controls under the details sheet: ${hit}`);
      // Full height: the controls step aside rather than sit on the sheet.
      await page.locator(".element-panel__grabber").click();
      await sleep(500);
      const full = await floating(page);
      const fullSheet = await sheetBox(page, "details");
      assert.deepEqual(full.filter((b) => inter(b, fullSheet) > 4).map((b) => b.name), [], "details full");
    },
  },
  {
    name: "phone: Esc closes the sheet; Back closes the topmost surface, then asks about leaving",
    projects: PHONES,
    fn: async ({ page, skip }) => {
      await page.goto("about:blank");
      await ready(page, skip);
      await page.touchscreen.tap(8, 8); // the first gesture arms the guard
      await sleep(300);
      await click(menu(page));
      assert.deepEqual(await sheetsAre(page, ["menu"]), ["menu"]);
      await page.keyboard.press("Escape");
      assert.deepEqual(await sheetsAre(page, []), [], "Esc closed the menu");
      // Back with a sheet open closes it, no question
      await click(menu(page));
      await settleSheets(page);
      await page.evaluate(() => history.back());
      assert.deepEqual(await sheetsAre(page, []), [], "Back closed the menu");
      assert.equal(await page.getByRole("dialog", { name: "Leave the viewer?" }).count(), 0, "closing a sheet asked about leaving");
      // Back with an armed tool disarms it, no question
      await click(measure(page));
      await sleep(300);
      await page.evaluate(() => history.back());
      await sleep(600);
      assert.ok(!(await armed(measure(page))), "Back disarmed Measure");
      assert.equal(await page.getByRole("dialog", { name: "Leave the viewer?" }).count(), 0);
      assert.match(page.url(), /\/app\//);
      // Nothing open: Back asks
      await page.evaluate(() => history.back());
      await page.getByRole("dialog", { name: "Leave the viewer?" }).waitFor({ state: "visible", timeout: 5000 });
      assert.match(page.url(), /\/app\//);
    },
  },
  {
    name: "phone: a tap on the canvas dismisses the details sheet and the Views panel; a tool tap does not",
    projects: PHONES,
    timeout: 120000,
    fn: async ({ page, skip, project }) => {
      await ready(page, skip);
      const c = await canvasBox(page);
      const empty = { x: c.x + 30, y: c.y + 100 }; // empty sky, clear of the floating buttons
      await select(page, project);
      assert.deepEqual(await sheetsAre(page, ["details"]), ["details"]);
      await page.touchscreen.tap(empty.x, empty.y);
      assert.deepEqual(await sheetsAre(page, []), [], "tap on empty canvas closed the details sheet");
      await click(views(page));
      await settleSheets(page);
      // The Views panel fills a 320 px wide screen: tap the strip of empty canvas under it.
      await page.touchscreen.tap(c.x + c.width / 2, c.y + c.height - 12);
      assert.deepEqual(await sheetsAre(page, []), [], "tap on the canvas closed Views");
      await click(measure(page));
      await tapModel(page, project); // the first measure point: the tool's tap, not a dismissal
      await sleep(600);
      assert.ok(await armed(measure(page)), "a tap on the model in a tool is the tool's, it stays armed");
    },
  },
  {
    name: "desktop: details panel and sidebar stay side by side, Views opens beside them",
    projects: ["desktop"],
    fn: async ({ page, skip, project }) => {
      await ready(page, skip);
      await select(page, project);
      await sleep(500);
      const side = await rectOf(page.locator("aside.sidebar"));
      const panel = await rectOf(page.locator('aside[aria-label="Details"]'));
      assert.ok(side.w > 100 && panel.w > 100, "sidebar and details panel both on screen");
      assert.ok(side.x + side.w <= panel.x + 1, "side by side, not stacked");
      await views(page).click();
      await page.getByRole("dialog", { name: "Views and levels" }).waitFor({ state: "visible" });
      assert.ok((await rectOf(page.locator('aside[aria-label="Details"]'))).w > 100, "opening Views did not close the details panel");
      await share(page).click();
      assert.equal(await page.getByRole("dialog", { name: "Views and levels" }).count(), 0, "Views and Share still exclude each other");
    },
  },
]);

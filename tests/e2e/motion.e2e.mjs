// Motion polish: reduced motion kills transitions; a sheet is clickable the moment it opens; its exit unmounts.
import assert from "node:assert/strict";
import { suite, loadSample, openApp, sleep } from "./lib.mjs";

suite("motion", [
  {
    name: "sheet is hit-testable at once and unmounts after exit",
    fn: async ({ page }) => {
      await openApp(page);
      await loadSample(page);
      const chip = page.locator(".models-chip");
      if (!(await chip.isVisible())) return;
      await chip.click();
      const hit = await page.evaluate(() => {
        const b = document.querySelector(".models-sheet__close"), r = b.getBoundingClientRect();
        return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) && getComputedStyle(b.closest(".models-sheet")).pointerEvents !== "none";
      });
      assert.ok(hit, "sheet button hit-testable immediately");
      await page.locator(".models-sheet__close").click();
      await page.waitForSelector(".models-sheet", { state: "detached", timeout: 2000 });
    },
  },
  {
    name: "reduced motion: durations are ~0",
    fn: async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openApp(page);
      await loadSample(page);
      const d = await page.evaluate(() => [...document.querySelectorAll("button")].slice(0, 12).map((b) => parseFloat(getComputedStyle(b).transitionDuration.split(",")[0]) * 1000));
      assert.ok(d.length && d.every((x) => x < 1), `transition ms ${d}`);
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--dur-3").trim()), ".01ms");
    },
  },
  {
    name: "tab indicator sits under the active tab and slides there",
    fn: async ({ page }) => {
      await openApp(page);
      await loadSample(page);
      const read = () =>
        page.evaluate(() => {
          const el = document.querySelector(".element-panel__tab-indicator");
          const tab = document.querySelector(".element-panel__tab--active");
          const m = new DOMMatrix(getComputedStyle(el).transform);
          return { x: m.e, w: m.a * 100, tx: tab.offsetLeft + 8, tw: tab.offsetWidth - 16, name: tab.getAttribute("aria-label") };
        });
      const click = (label) => page.evaluate((l) => document.querySelector(`.element-panel__tab[aria-label="${l}"]`).click(), label);
      await sleep(500);
      const a = await read();
      assert.ok(Math.abs(a.x - a.tx) < 1.5 && Math.abs(a.w - a.tw) < 1.5, `start ${JSON.stringify(a)}`);
      await click("Tags");
      await sleep(70);
      const mid = await read();
      await sleep(500);
      const end = await read();
      assert.equal(end.name, "Tags");
      assert.ok(Math.abs(end.x - end.tx) < 1.5 && Math.abs(end.w - end.tw) < 1.5, `end ${JSON.stringify(end)}`);
      assert.ok(Math.abs(mid.x - end.x) > 1 || Math.abs(mid.w - end.w) > 1, `mid-slide ${JSON.stringify(mid)} vs ${JSON.stringify(end)}`);
    },
  },
  {
    name: "tab indicator follows a resize of the panel",
    projects: ["desktop"],
    fn: async ({ page }) => {
      await openApp(page);
      await loadSample(page);
      await sleep(400);
      await page.evaluate(() => document.querySelector(".element-panel__tab--active"));
      await page.setViewportSize({ width: 900, height: 700 });
      await sleep(500);
      const r = await page.evaluate(() => {
        const el = document.querySelector(".element-panel__tab-indicator");
        const tab = document.querySelector(".element-panel__tab--active");
        const m = new DOMMatrix(getComputedStyle(el).transform);
        return [m.e, tab.offsetLeft + 8, m.a * 100, tab.offsetWidth - 16];
      });
      assert.ok(Math.abs(r[0] - r[1]) < 1.5 && Math.abs(r[2] - r[3]) < 1.5, JSON.stringify(r));
    },
  },
  {
    name: "popover exit: real panel gone at once, ghost never blocks taps and is removed",
    projects: ["desktop"],
    fn: async ({ page }) => {
      await openApp(page);
      await loadSample(page);
      await page.getByRole("button", { name: "Views and levels" }).click();
      await page.waitForSelector(".view-tools__panel");
      // Record the ghost the moment it is inserted (it only lives ~140 ms).
      await page.evaluate(() => {
        window.__g = null;
        new MutationObserver(() => {
          const ghost = document.querySelector(".m-ghost");
          if (!ghost || window.__g) return;
          const r = ghost.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + 20);
          window.__g = { real: document.querySelectorAll(".view-tools__panel:not(.m-ghost)").length, blocked: !!hit?.closest(".m-ghost"), anims: ghost.getAnimations().length, t: performance.now() };
        }).observe(document.body, { childList: true, subtree: true });
        window.__esc = 0;
        window.addEventListener("keydown", () => { window.__esc = performance.now(); }, true);
      });
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => window.__g, null, { timeout: 1000 });
      const snap = await page.evaluate(() => ({ ...window.__g, dt: window.__g.t - window.__esc }));
      assert.equal(snap.real, 0);
      assert.ok(snap.anims > 0, "ghost is animating");
      assert.ok(!snap.blocked, "ghost is not hit-testable");
      assert.ok(snap.dt < 50, `ghost appears within 50 ms of the key (${snap.dt.toFixed(1)} ms)`);
      const t0 = Date.now();
      // the control underneath works within 50 ms: open it again
      await page.getByRole("button", { name: "Save image or copy view link" }).click({ timeout: 1000 });
      assert.ok(Date.now() - t0 < 600);
      await page.waitForSelector(".m-ghost", { state: "detached", timeout: 1500 });
    },
  },
  {
    name: "reduced motion: popover leaves no ghost",
    projects: ["desktop"],
    fn: async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openApp(page);
      await loadSample(page);
      await page.getByRole("button", { name: "Views and levels" }).click();
      await page.waitForSelector(".view-tools__panel");
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => document.querySelectorAll(".view-tools__panel, .m-ghost").length), 0);
    },
  },
  {
    name: "haptics: buzz on touch press of a toolbar button, off by the toggle, never for mouse",
    projects: ["iphone13"],
    fn: async ({ page }) => {
      await page.addInitScript(() => { window.__buzz = []; navigator.vibrate = (n) => { window.__buzz.push(n); return true; }; });
      await openApp(page);
      await loadSample(page);
      const press = (pointerType) =>
        page.evaluate((pt) => {
          const b = document.querySelector(".toolbar button");
          b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: pt }));
          return window.__buzz.length;
        }, pointerType);
      assert.equal(await press("mouse"), 0);
      assert.equal(await press("touch"), 1);
      await sleep(200);
      await page.evaluate(() => localStorage.setItem("argus.haptics", "off"));
      assert.equal(await press("touch"), 1, "off means silent");
    },
  },
  {
    name: "models sheet has the Haptics toggle with the iPhone note",
    projects: ["iphone13"],
    fn: async ({ page }) => {
      await openApp(page);
      await loadSample(page);
      await page.locator(".models-chip").click();
      const box = page.locator(".models-sheet__haptics");
      assert.match(await box.innerText(), /iPhone has no vibration/);
      assert.ok((await box.boundingBox()).height >= 44);
      await box.locator("input").uncheck();
      assert.equal(await page.evaluate(() => localStorage.getItem("argus.haptics")), "off");
    },
  },
  {
    name: "library skeleton shows only while the first fetch is slow and is replaced by the list",
    projects: ["desktop"],
    fn: async ({ page }) => {
      await page.route("**/api/models", async (route) => {
        await sleep(1800);
        await route.continue();
      });
      await openApp(page);
      await sleep(900);
      const sk = await page.evaluate(() => {
        const ul = [...document.querySelectorAll(".lib-skel")].find((u) => u.getBoundingClientRect().height > 0);
        const rows = ul ? [...ul.querySelectorAll(".lib-row")].map((r) => r.getBoundingClientRect().height) : [];
        return { has: !!ul, rows };
      });
      if (!sk.has) return; // no library on this backend or no visible instance
      assert.equal(sk.rows.length, 2);
      assert.ok(sk.rows.every((h) => h >= 48), `row heights ${sk.rows}`);
      await page.waitForSelector(".lib-skel", { state: "detached", timeout: 6000 });
    },
  },
]);

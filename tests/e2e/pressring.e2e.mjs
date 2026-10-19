// Long press: a ring charges at the finger, then a ring stays pinned to the pressed 3D point until the menu closes.
// Needs a hook build (VITE_TEST_HOOK=1, see tests/e2e/hook-build.sh):
//   ARGUS_URL=http://localhost:<port> node tests/e2e/pressring.e2e.mjs      (PRESS_SHOTS=<dir> saves screenshots)
// Emulated touch (CDP) is not a real phone: it checks geometry and timing, not finger feel.
import assert from "node:assert/strict";
import { suite, openApp, loadSample, requireHook, isTouch } from "./lib.mjs";

const ring = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return { on: el.classList.contains("is-on"), hidden: el.classList.contains("is-hidden"), opacity: +cs.opacity, pe: cs.pointerEvents, w: r.width, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }, sel);
const hitPoint = (page) =>
  page.evaluate(async () => {
    const r = document.querySelector("canvas").getBoundingClientRect();
    for (let j = 2; j < 9; j++) for (let i = 2; i < 9; i++) {
      const x = r.left + (r.width * i) / 10, y = r.top + (r.height * j) / 10;
      if (document.elementFromPoint(x, y)?.tagName === "CANVAS" && (await window.__ifcDebug.raycast(x, y))) return [x, y];
    }
    return null;
  });
const shot = (page, name) => process.env.PRESS_SHOTS && page.screenshot({ path: `${process.env.PRESS_SHOTS}/${name}.png` });
const menuOpen = (page) => page.getByRole("menu").first().isVisible().catch(() => false);

await suite("pressring", [
  {
    name: "touch: a ring charges at the finger, then stays pinned to the pressed point and follows the model until the menu closes",
    projects: ["iphone13", "ipad-mini"],
    timeout: 150000,
    fn: async ({ page, ctx, project, skip }) => {
      // Software GL draws a frame in 0.3 to 1 s, which would let the 500 ms press fire before the test could look at the
      // charging ring: stretch only that timer to 3 s (15 s on the iPad profile, which renders 4x the pixels) (the ring's own animation keeps its 500 ms).
      await ctx.addInitScript((ms) => { const st = window.setTimeout; window.setTimeout = (f, d, ...a) => st(f, d === 500 ? ms : d, ...a); }, project === "ipad-mini" ? 15000 : 3000);
      await openApp(page);
      await loadSample(page);
      await requireHook(page, skip);
      await page.waitForTimeout(1500);
      const [x, y] = await hitPoint(page);
      const cdp = await ctx.newCDPSession(page);
      const send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, id) => ({ x: p.x, y: p.y, id })) });
      const local = await page.evaluate(async ([x, y]) => { const d = window.__ifcDebug; const h = await d.raycast(x, y); window.__local = d.group.worldToLocal(h.point.clone()).toArray(); return window.__local; }, [x, y]);
      await send("touchStart", [{ x, y }]);
      await page.waitForFunction(() => +getComputedStyle(document.querySelector(".press-ring--charge")).opacity > 0.5, null, { timeout: 12000, polling: 20 });
      const charging = await ring(page, ".press-ring--charge");
      await shot(page, `${project}-1-charging`);
      console.log(`  charging: ${JSON.stringify(charging)} finger ${Math.round(x)},${Math.round(y)}`);
      assert.ok(charging.on, "charge ring on while held");
      assert.ok(charging.opacity > 0.5, `charge ring drawn (opacity ${charging.opacity})`);
      assert.ok(charging.w >= 44 && charging.w <= 56, `ring size ${charging.w}`);
      assert.ok(Math.hypot(charging.cx - x, charging.cy - y) <= 1.5, "charge ring centred on the finger");
      assert.equal(charging.pe, "none");
      await page.waitForFunction(() => document.querySelector(".press-ring--pin.is-on"), null, { timeout: 8000 });
      await page.waitForFunction(() => +getComputedStyle(document.querySelector(".press-ring--pin")).opacity > 0.9, null, { timeout: 10000, polling: 20 });
      const pin = await ring(page, ".press-ring--pin");
      const gone = await ring(page, ".press-ring--charge");
      await shot(page, `${project}-2-pinned`);
      console.log(`  pinned: ${JSON.stringify(pin)}; charge after fire on=${gone.on}`);
      assert.ok(!gone.on, "charge ring gone once the long press fired");
      assert.ok(pin.opacity > 0.9 && Math.hypot(pin.cx - x, pin.cy - y) <= 2, "pin ring at the pressed point");
      assert.equal(pin.pe, "none");
      await send("touchEnd", []);
      await page.waitForTimeout(300);
      assert.ok((await ring(page, ".press-ring--pin")).on, "pin stays after the finger lifts, while the menu is open");
      // turn the model: the pin follows the 3D point
      const expect = await page.evaluate((l) => {
        const d = window.__ifcDebug; d.group.rotateY(0.35); d.group.updateMatrixWorld(true); d.controls.dispatchEvent({ type: "change" });
        const p = d.group.localToWorld(new d.THREE.Vector3(...l)).project(d.camera); const r = document.querySelector("canvas").getBoundingClientRect();
        return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height };
      }, local);
      await page.waitForTimeout(800);
      const moved = await ring(page, ".press-ring--pin");
      await shot(page, `${project}-3-turned`);
      console.log(`  after turning the model: pin ${Math.round(moved.cx)},${Math.round(moved.cy)} point ${Math.round(expect.x)},${Math.round(expect.y)} hidden=${moved.hidden}`);
      assert.ok(Math.hypot(moved.cx - expect.x, moved.cy - expect.y) <= 2, "pin follows the 3D point");
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector(".press-ring--pin.is-on"), null, { timeout: 5000 });
    },
  },
  {
    name: "touch: lifting before the long press cancels the charge ring",
    projects: ["iphone13"],
    timeout: 100000,
    fn: async ({ page, ctx, skip }) => {
      // the early lift must come before the 500 ms timer even when software GL stalls the page: stretch only that timer
      await ctx.addInitScript(() => { const st = window.setTimeout; window.setTimeout = (f, d, ...a) => st(f, d === 500 ? 60000 : d, ...a); });
      await openApp(page);
      await loadSample(page);
      await requireHook(page, skip);
      await page.waitForTimeout(1500);
      const [x, y] = await hitPoint(page);
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0 }] });
      await page.waitForTimeout(200);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(300);
      assert.ok(!(await ring(page, ".press-ring--charge")).on, "charge ring gone after an early lift");
      assert.ok(!(await ring(page, ".press-ring--pin")).on, "no pin after an early lift");
    },
  },
  {
    name: "desktop: right-click puts the ring at the pointer while the context menu is open",
    projects: ["desktop"],
    timeout: 100000,
    fn: async ({ page, project, skip }) => {
      await openApp(page);
      await loadSample(page);
      await requireHook(page, skip);
      await page.waitForTimeout(1500);
      const [x, y] = await hitPoint(page);
      await page.mouse.click(x, y, { button: "right" });
      await page.waitForFunction(() => document.querySelector(".press-ring--pin.is-on"), null, { timeout: 8000 });
      await page.waitForTimeout(400);
      const pin = await ring(page, ".press-ring--pin");
      await shot(page, `${project}-1-rightclick`);
      console.log(`  right-click pin: ${JSON.stringify(pin)} pointer ${Math.round(x)},${Math.round(y)}`);
      assert.ok(Math.hypot(pin.cx - x, pin.cy - y) <= 2 && pin.opacity > 0.9);
      void menuOpen; void isTouch;
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector(".press-ring--pin.is-on"), null, { timeout: 5000 });
    },
  },
]);

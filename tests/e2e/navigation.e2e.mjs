// Flow 6: zoom limits and their toasts, Home, pinch, one-finger orbit pivot.
import assert from "node:assert/strict";
import { suite, openApp, loadSample, canvasBox, viewShot, pngDiff, watchToasts, toastsNamed, touchSession, requireHook, stableClick } from "./lib.mjs";

// Pushes toward a zoom limit until it is reached (bounded), then keeps pushing `extraMs`
// more so a repeated cue would be caught. Condition-based: a slow machine only takes
// longer, it does not change the outcome. Wheel (mouse): the limit shows a toast.
// Buttons (touch): the button greys out (aria-disabled) at its limit.
async function zoomToLimit(page, { touch, direction, toast, extraMs = 3000, maxMs = 70000 }) {
  const b = await canvasBox(page);
  if (!touch) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  const button = page.getByRole("button", { name: direction < 0 ? "Zoom in" : "Zoom out" });
  const atLimit = async () => (touch ? (await button.getAttribute("aria-disabled")) === "true" : (await toastsNamed(page, toast)) > 0);
  const push = async () => {
    if (touch) await button.click();
    else await page.mouse.wheel(0, direction * 300);
    await page.waitForTimeout(touch ? 60 : 30);
  };
  const t0 = Date.now();
  while (!(await atLimit())) {
    if (Date.now() - t0 > maxMs) throw new Error(`never reached the limit (${touch ? "button still enabled" : `"${toast}" did not show`} after ${maxMs / 1000} s)`);
    await push();
  }
  if (touch) return;
  const end = Date.now() + extraMs;
  while (Date.now() < end) await push();
}

await suite("navigation", [
  {
    name: "zoom in reaches the closest limit, toast shows once; zoom out reaches the furthest limit, toast once; Home recovers",
    projects: ["desktop", "iphone13"], // the iPad profile renders ~4x the pixels in software GL: too slow for wheel loops
    timeout: 180000,
    fn: async ({ page }) => {
      const touch = false; // the wheel works on every profile and is much faster than tapping the buttons
      await openApp(page);
      await loadSample(page);
      const initial = await viewShot(page);
      await watchToasts(page);
      await zoomToLimit(page, { touch, direction: -1, toast: "Closest zoom" });
      if (!touch) {
        assert.equal(await toastsNamed(page, "Closest zoom"), 1, "Closest zoom toast count");
        assert.equal(await toastsNamed(page, "Furthest zoom"), 0);
      }
      await zoomToLimit(page, { touch, direction: 1, toast: "Furthest zoom" });
      if (!touch) assert.equal(await toastsNamed(page, "Furthest zoom"), 1, "Furthest zoom toast count");
      await page.waitForTimeout(500);
      await stableClick(page.getByRole("button", { name: /^Home/ }));
      await page.waitForTimeout(1500);
      const home = await viewShot(page);
      const d = await pngDiff(page, initial, home);
      assert.ok(d < 4, `Home did not bring the view back (diff ${d.toFixed(2)})`);
    },
  },
  {
    name: "zoom keeps the camera inside its limits (state hook)",
    projects: ["desktop", "iphone13"],
    timeout: 120000,
    fn: async ({ page, skip }) => {
      const touch = false;
      await openApp(page);
      await loadSample(page);
      await requireHook(page, skip);
      await watchToasts(page);
      await zoomToLimit(page, { touch, direction: -1, toast: "Closest zoom", extraMs: 500 });
      const near = await page.evaluate(() => {
        const d = window.__ifcDebug, m = d.zoomMetrics();
        return { dist: d.camera.position.distanceTo(d.controls.target), min: m.min, max: m.max, L: m.L };
      });
      assert.ok(near.dist >= near.min * 0.5 && near.dist < near.L, `near distance ${near.dist} (min ${near.min}, L ${near.L})`);
      await zoomToLimit(page, { touch, direction: 1, toast: "Furthest zoom", extraMs: 500 });
      const far = await page.evaluate(() => {
        const d = window.__ifcDebug, m = d.zoomMetrics();
        return { dist: d.camera.position.distanceTo(m.center), max: m.max };
      });
      assert.ok(far.dist <= far.max * 1.02, `far distance ${far.dist} beyond max ${far.max}`);
      assert.ok(Number.isFinite(far.dist) && far.dist > 0);
    },
  },
  {
    name: "the zoom buttons move the camera in and out and grey out at the limit",
    projects: ["iphone13"],
    timeout: 120000,
    fn: async ({ page }) => {
      await openApp(page);
      await loadSample(page);
      const before = await viewShot(page);
      const zin = page.getByRole("button", { name: "Zoom in" });
      for (let i = 0; i < 3; i++) await zin.click();
      await page.waitForTimeout(800);
      assert.ok((await pngDiff(page, before, await viewShot(page))) > 3, "Zoom in did not change the view");
      for (let i = 0; i < 40 && (await zin.getAttribute("aria-disabled")) !== "true"; i++) await zin.click();
      assert.equal(await zin.getAttribute("aria-disabled"), "true", "Zoom in never reached its limit");
      assert.notEqual(await page.getByRole("button", { name: "Zoom out" }).getAttribute("aria-disabled"), "true");
    },
  },
  {
    name: "touch pinch clamps at both limits and the model stays on screen",
    projects: ["iphone13", "ipad-mini"],
    timeout: 120000,
    fn: async ({ page, ctx }) => {
      await openApp(page);
      await loadSample(page);
      await watchToasts(page);
      const b = await canvasBox(page);
      const c = { x: b.x + b.width / 2, y: b.y + b.height * 0.45 };
      const touch = await touchSession(ctx, page);
      for (let i = 0; i < 14 && (await toastsNamed(page, "Closest zoom")) === 0; i++) await touch.pinch(c, 80, 320);
      assert.ok((await toastsNamed(page, "Closest zoom")) >= 1, "pinch out never hit the closest limit");
      for (let i = 0; i < 25 && (await toastsNamed(page, "Furthest zoom")) === 0; i++) await touch.pinch(c, 320, 60);
      assert.ok((await toastsNamed(page, "Furthest zoom")) >= 1, "pinch in never hit the furthest limit");
      await stableClick(page.getByRole("button", { name: /^Home/ }));
      await page.waitForTimeout(1500);
      assert.ok((await pngDiff(page, await viewShot(page), await viewShot(page))) < 1, "view is still moving");
    },
  },
  {
    name: "one-finger / mouse drag orbits around the touched point (it stays under its start position)",
    timeout: 120000,
    fn: async ({ page, ctx, project, skip }) => {
      await openApp(page);
      await loadSample(page);
      await requireHook(page, skip);
      const b = await canvasBox(page);
      const start = { x: b.x + b.width * 0.42, y: b.y + b.height * 0.45 };
      const end = { x: start.x + b.width * 0.18, y: start.y + b.height * 0.04 };
      const local = await page.evaluate(async ({ x, y }) => {
        const d = window.__ifcDebug;
        window.__q0 = d.group.quaternion.clone();
        window.__c0 = d.camera.position.clone();
        const hit = await d.raycast(x, y);
        if (!hit) return null;
        const p = d.group.worldToLocal(hit.point.clone());
        return [p.x, p.y, p.z];
      }, start);
      assert.ok(local, "no surface under the chosen start point");
      if (project === "desktop") {
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        for (let i = 1; i <= 12; i++) await page.mouse.move(start.x + ((end.x - start.x) * i) / 12, start.y + ((end.y - start.y) * i) / 12);
        await page.mouse.up();
      } else {
        await (await touchSession(ctx, page)).drag(start, end);
      }
      await page.waitForTimeout(800);
      const after = await page.evaluate(([lx, ly, lz]) => {
        const d = window.__ifcDebug;
        d.camera.updateMatrixWorld(true);
        d.group.updateWorldMatrix(true, false);
        const v = new d.THREE.Vector3(lx, ly, lz).applyMatrix4(d.group.matrixWorld).project(d.camera);
        const r = document.querySelector("canvas").getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      }, local);
      const turned = await page.evaluate(() => {
        const d = window.__ifcDebug;
        return { model: d.group.quaternion.angleTo(window.__q0), camera: d.camera.position.distanceTo(window.__c0) };
      });
      assert.ok(turned.model > 0.05 || turned.camera > 0.05, `the drag did not orbit anything (${JSON.stringify(turned)})`);
      const movedFinger = Math.hypot(end.x - start.x, end.y - start.y);
      const off = Math.hypot(after.x - start.x, after.y - start.y);
      assert.ok(off < 25, `the touched point drifted ${off.toFixed(0)} px from where it was grabbed (finger moved ${movedFinger.toFixed(0)} px)`);
    },
  },
]);

// Section planes: the sheet covers the whole scene; on a phone two planes at most with an explicit active one.
// Needs a build made with VITE_TEST_HOOK=1 (window.__ifcDebug.sections / .clip).
import assert from "node:assert/strict";
import { suite, openApp, loadSample, requireHook, stableClick, canvasBox, OUT } from "./lib.mjs";
import { join } from "node:path";

const views = (page) => page.getByRole("dialog", { name: "Views and levels" });
const openViews = async (page) => {
  if (!(await views(page).isVisible())) await stableClick(page.getByRole("button", { name: "Views and levels" }));
  await views(page).waitFor({ state: "visible" });
};
const PRESET = { plan: "Cut a horizontal plan section through the middle", side: "Cut a vertical section from left to right", front: "Cut a vertical section from front to back" };
async function preset(page, kind) {
  await openViews(page);
  await page.getByRole("button", { name: PRESET[kind] }).click();
  await page.waitForTimeout(500);
}
const sections = (page) => page.evaluate(() => window.__ifcDebug.sections());

// Largest overshoot of the 8 projected box corners beyond the sheet, as a fraction of the sheet half-side (<= 0.01 passes).
const overshoot = ({ box, planes }) => {
  let worst = -1;
  for (const p of planes) {
    const c = p.rect.centre;
    for (let i = 0; i < 8; i++) {
      const q = [0, 1, 2].map((a) => ((i >> a) & 1 ? box.max[a] : box.min[a]) - c[a]);
      const du = Math.abs(q[0] * p.rect.u[0] + q[1] * p.rect.u[1] + q[2] * p.rect.u[2]);
      const dv = Math.abs(q[0] * p.rect.v[0] + q[1] * p.rect.v[1] + q[2] * p.rect.v[2]);
      worst = Math.max(worst, du / p.rect.halfU - 1, dv / p.rect.halfV - 1);
    }
  }
  return worst;
};

await suite("sections", [
  {
    name: "the sheet covers all 8 projected scene corners: Plan, Side, Front, a tilted plane, moved, flipped (state hook)",
    projects: ["desktop"],
    fn: async ({ page, skip }) => {
      await openApp(page);
      await loadSample(page);
      await requireHook(page, skip);
      for (const kind of ["plan", "side", "front"]) {
        await preset(page, kind);
        const s = await sections(page);
        assert.equal(s.planes.length, 1, `${kind}: ${s.planes.length} planes`);
        assert.ok(overshoot(s) <= 0.01, `${kind}: corner outside the sheet by ${overshoot(s)}`);
      }
      // tilted plane, then moved along its normal, then flipped
      await page.evaluate(() => {
        const { clip, THREE } = window.__ifcDebug;
        clip.add(new THREE.Vector3(1, 0.6, -0.4).normalize(), new THREE.Vector3(1, 1, 0));
      });
      let s = await sections(page);
      assert.ok(overshoot(s) <= 0.01, `tilted: outside by ${overshoot(s)}`);
      await page.evaluate(() => window.__ifcDebug.clip.setConstant(window.__ifcDebug.clip.list().at(-1).id, 3));
      s = await sections(page);
      assert.ok(overshoot(s) <= 0.01, `tilted moved: outside by ${overshoot(s)}`);
      await page.evaluate(() => window.__ifcDebug.clip.flip(window.__ifcDebug.clip.list().at(-1).id));
      s = await sections(page);
      assert.ok(overshoot(s) <= 0.01, `tilted flipped: outside by ${overshoot(s)}`);
      // the sheet is the FULL box, so it is at least the box's longest side
      const side = Math.max(...s.planes.map((p) => p.rect.halfU * 2));
      assert.ok(side >= Math.max(...[0, 1, 2].map((a) => s.box.max[a] - s.box.min[a])) * 0.5);
    },
  },

  {
    name: "phone: two planes show a mini model and a switch; the active one is darker and the only one a drag moves; a third replaces the oldest",
    projects: ["iphone13", "pixel7"],
    fn: async ({ page, project, skip }) => {
      await openApp(page);
      await loadSample(page);
      await requireHook(page, skip);
      await preset(page, "plan");
      assert.equal(await page.locator(".plane-switch").count(), 1, "mini model shows for one plane");
      await page.evaluate(() => {
        const { THREE } = window.__ifcDebug;
        window.__ifcDebug.addPlane(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 0));
      });
      const sw = page.locator(".plane-switch");
      await sw.waitFor({ state: "visible" });
      const pills = sw.getByRole("button");
      assert.equal(await pills.count(), 2);
      for (let i = 0; i < 2; i++) {
        const b = await pills.nth(i).boundingBox();
        assert.ok(b.height >= 44 && b.width >= 44, `pill ${i + 1} is ${b.width}x${b.height}`);
      }
      assert.equal(await pills.nth(1).getAttribute("aria-pressed"), "true", "newest plane is active");
      assert.match((await sw.getAttribute("aria-label")) ?? "", /Active cut plane: Plane 2/);
      // 3D: active is darker and more opaque than the inactive one, hues differ
      let s = await sections(page);
      const [p1, p2] = s.planes;
      assert.ok(p2.active && !p1.active && p2.opacity > p1.opacity, `opacity ${p1.opacity} vs ${p2.opacity}`);
      assert.notEqual(p1.color, p2.color);
      // no overlap with the other corner controls, nothing off screen
      const vp = page.viewportSize();
      const box = await sw.boundingBox();
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height, "widget outside the viewport");
      for (const sel of [".compass", ".history-buttons", ".tool-hint", ".details-fab", ".element-panel"]) {
        const el = page.locator(sel).first();
        if (!(await el.isVisible().catch(() => false))) continue;
        const o = await el.boundingBox();
        const hit = box.x < o.x + o.width && o.x < box.x + box.width && box.y < o.y + o.height && o.y < box.y + box.height;
        assert.ok(!hit, `${sel} overlaps the plane switch`);
      }
      await page.screenshot({ path: join(OUT, `sections-two-planes-${project}.png`) });
      // switch active plane
      await pills.nth(0).click();
      s = await sections(page);
      assert.ok(s.planes[0].active && !s.planes[1].active);
      assert.equal(await pills.nth(0).getAttribute("aria-pressed"), "true");
      assert.match((await sw.getAttribute("aria-label")) ?? "", /Active cut plane: Plane 1/);
      // Move section: a drag on any sheet moves only the active one
      const dragOnSheets = async (planeIndex) => {
        const pt = await page.evaluate((i) => {
          const d = window.__ifcDebug;
          const p = d.sections().planes[i];
          const v = new d.THREE.Vector3(...p.rect.centre).addScaledVector(new d.THREE.Vector3(...p.rect.u), p.rect.halfU * 0.3);
          d.group.updateMatrixWorld(true);
          v.applyMatrix4(d.group.matrixWorld).project(d.camera);
          const r = document.querySelector("canvas").getBoundingClientRect();
          return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
        }, planeIndex);
        const cdp = await page.context().newCDPSession(page);
        const send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
        await send("touchStart", [{ x: pt.x, y: pt.y, id: 0 }]);
        for (let k = 1; k <= 8; k++) await send("touchMove", [{ x: pt.x, y: pt.y - k * 8, id: 0 }]);
        await send("touchEnd", []);
        await page.waitForTimeout(300);
      };
      const consts = async () => (await sections(page)).planes.map((p) => p.constant);
      await page.locator(".tool-hint__done", { hasText: "Move section" }).click();
      assert.match(await page.locator(".tool-hint__text").innerText(), /Moving Plane 1/);
      const before = await consts();
      await dragOnSheets(1); // touch lands on the INACTIVE sheet
      const after = await consts();
      assert.ok(Math.abs(after[0] - before[0]) > 1e-3, `active plane did not move (${before} -> ${after})`);
      assert.equal(after[1], before[1], "the inactive plane moved");
      // third plane replaces the oldest, with a toast
      await page.evaluate(() => {
        const { THREE } = window.__ifcDebug;
        window.__ifcDebug.addPlane(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 0));
      });
      s = await sections(page);
      assert.equal(s.planes.length, 2, "more than two planes on a phone");
      assert.ok(s.planes.every((p) => p.id !== "clip-1"), "the oldest plane is still there");
      await page.getByText("Two sections at most on a phone").waitFor({ state: "visible", timeout: 3000 });
      assert.equal(await pills.count(), 2);
    },
  },
  {
    name: "phone: the plane switch fits a 320 px screen without sideways scroll",
    projects: ["iphone13"],
    fn: async ({ page, skip }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await openApp(page);
      await loadSample(page);
      await requireHook(page, skip);
      await preset(page, "plan");
      await page.evaluate(() => window.__ifcDebug.addPlane(new window.__ifcDebug.THREE.Vector3(-1, 0, 0), new window.__ifcDebug.THREE.Vector3(0, 0, 0)));
      await page.locator(".plane-switch").waitFor({ state: "visible" });
      const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(o <= 0, `page scrolls sideways by ${o}px`);
      const b = await page.locator(".plane-switch").boundingBox();
      assert.ok(b.x + b.width <= 320, `widget ends at ${b.x + b.width}`);
      await page.screenshot({ path: join(OUT, "sections-two-planes-320.png") });
    },
  },
]);

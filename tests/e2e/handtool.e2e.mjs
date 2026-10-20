// Desktop hand tool (hold Space, left-drag pans) and "names on hover" (off by default).
// Needs a hook build (VITE_TEST_HOOK=1, see tests/e2e/hook-build.sh):
//   ARGUS_URL=http://localhost:<port> ARGUS_IGNORE_SESSION_404=1 node tests/e2e/handtool.e2e.mjs
// The "pointer" is a real Playwright mouse; the cursor is read as the canvas's computed style.
import assert from "node:assert/strict";
import { suite, openApp, loadSample, requireHook, stableClick, measureTab } from "./lib.mjs";

const pose = () => {
  const d = window.__ifcDebug;
  const r = document.querySelector("canvas").getBoundingClientRect();
  const p = d.group.getWorldPosition(new d.THREE.Vector3()).project(d.camera);
  return { cam: d.camera.position.toArray(), camQ: d.camera.quaternion.toArray(), groupQ: d.group.quaternion.toArray(), sx: r.left + (p.x * 0.5 + 0.5) * r.width, sy: r.top + (-p.y * 0.5 + 0.5) * r.height };
};
const qDiff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const cursor = (page) => page.evaluate(() => getComputedStyle(document.querySelector("canvas")).cursor);
const hoverUi = (page) => page.evaluate(() => { const n = document.querySelector(".hover-label"); return !!n && !n.hidden && n.textContent.trim().length > 0; });

async function prepare(page, skip) {
  await openApp(page);
  await loadSample(page);
  await requireHook(page, skip);
  await page.waitForTimeout(1500);
  await page.mouse.move(5, 300); // away from any control
}
// A point on the model, and the element hit there.
const modelPoint = (page) => page.evaluate(async () => {
  const r = document.querySelector("canvas").getBoundingClientRect();
  for (let j = 2; j < 9; j++) for (let i = 2; i < 9; i++) {
    const x = r.left + (r.width * i) / 10, y = r.top + (r.height * j) / 10;
    if (document.elementFromPoint(x, y)?.tagName === "CANVAS" && (await window.__ifcDebug.raycast(x, y))) return [x, y];
  }
  return null;
});
// Two or more distinct model points (first and last hit of a coarse scan).
const modelPoints = (page) => page.evaluate(async () => {
  const r = document.querySelector("canvas").getBoundingClientRect();
  const out = [];
  for (let j = 2; j < 9; j++) for (let i = 2; i < 9; i++) {
    const x = r.left + (r.width * i) / 10, y = r.top + (r.height * j) / 10;
    if (document.elementFromPoint(x, y)?.tagName === "CANVAS" && (await window.__ifcDebug.raycast(x, y))) out.push([x, y]);
  }
  return out;
});
async function drag(page, [x, y], [dx, dy], { steps = 12, releaseSpaceAt = null } = {}) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps);
    if (releaseSpaceAt === i) await page.keyboard.up("Space");
  }
  const mid = await cursor(page);
  await page.mouse.up();
  await page.waitForTimeout(300);
  return mid;
}

const DESKTOP = ["desktop"];
await suite("handtool", [
  {
    name: "Space + left drag pans 1:1 in the screen plane, no rotation; cursor grab / grabbing; plain drag still rotates",
    projects: DESKTOP,
    timeout: 120000,
    fn: async ({ page, skip }) => {
      await prepare(page, skip);
      const start = await modelPoint(page);
      assert.ok(start, "no model point");
      const scroll0 = await page.evaluate(() => window.scrollY);
      const p0 = await page.evaluate(pose);
      assert.equal(await cursor(page), "auto");
      await page.keyboard.down("Space");
      await page.mouse.move(...start);
      assert.equal(await cursor(page), "grab", "cursor while Space is held");
      const mid = await drag(page, start, [90, 40]);
      assert.equal(mid, "grabbing", "cursor while dragging");
      assert.equal(await cursor(page), "grab", "cursor after the drag, Space still held");
      await page.keyboard.up("Space");
      assert.equal(await cursor(page), "auto", "cursor after Space is released");
      const p1 = await page.evaluate(pose);
      const moved = [p1.sx - p0.sx, p1.sy - p0.sy];
      console.log(`  pan: dragged (90, 40), model centre moved (${moved.map((v) => v.toFixed(1)).join(", ")}); cam quat diff ${qDiff(p0.camQ, p1.camQ).toExponential(1)}, model quat diff ${qDiff(p0.groupQ, p1.groupQ).toExponential(1)}`);
      // The model centre sits at a different depth than the grabbed point, so the match is to the pan unit
      // (OrbitControls pans 1:1 at the orbit target), within 35 percent.
      assert.ok(Math.abs(moved[0] - 90) < 32 && Math.abs(moved[1] - 40) < 18, `model moved ${moved} for a (90,40) drag`);
      assert.ok(qDiff(p0.camQ, p1.camQ) < 1e-6 && qDiff(p0.groupQ, p1.groupQ) < 1e-6, "pan rotated something");
      assert.equal(await page.evaluate(() => window.scrollY), scroll0, "page scrolled");
      assert.match(await page.locator(".element-panel").first().innerText(), /No element selected/i, "a pan drag selected an element");
      // no pivot dot while panning
      assert.equal(await page.evaluate(() => window.__ifcDebug.pivotState().visible), false);
      // plain drag rotates, does not pan the camera
      await drag(page, start, [120, 0]);
      const p2 = await page.evaluate(pose);
      assert.ok(qDiff(p1.groupQ, p2.groupQ) > 0.01, "plain left drag no longer rotates");
    },
  },
  {
    name: "releasing Space mid-drag keeps panning until pointer up (no jump, no rotation)",
    projects: DESKTOP,
    timeout: 120000,
    fn: async ({ page, skip }) => {
      await prepare(page, skip);
      const start = await modelPoint(page);
      const p0 = await page.evaluate(pose);
      await page.keyboard.down("Space");
      await drag(page, start, [100, 0], { steps: 10, releaseSpaceAt: 4 });
      const p1 = await page.evaluate(pose);
      console.log(`  model centre moved ${(p1.sx - p0.sx).toFixed(1)} px for a 100 px drag`);
      assert.ok(Math.abs(p1.sx - p0.sx - 100) < 36, "drag did not continue as a pan after Space was released");
      assert.ok(qDiff(p0.groupQ, p1.groupQ) < 1e-6 && qDiff(p0.camQ, p1.camQ) < 1e-6, "rotated after Space release");
      assert.equal(await cursor(page), "auto");
    },
  },
  {
    name: "Space does not scroll, is ignored in the search field, and does not press a focused button",
    projects: DESKTOP,
    timeout: 120000,
    fn: async ({ page, skip }) => {
      await prepare(page, skip);
      // the canvas focused or nothing focused: the hand appears and the key's default (scroll) is prevented
      const prevented = await page.evaluate(() => new Promise((res) => {
        const ev = new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true, cancelable: true });
        document.body.dispatchEvent(ev);
        res(ev.defaultPrevented);
      }));
      assert.equal(prevented, true, "Space default not prevented on the page");
      await page.keyboard.up("Space");
      assert.equal(await cursor(page), "auto");
      // key repeat does not toggle
      await page.keyboard.down("Space");
      await page.keyboard.down("Space");
      await page.keyboard.down("Space");
      assert.equal(await cursor(page), "grab", "repeat toggled the hand");
      await page.keyboard.up("Space");
      // search field types a space and never turns the hand on
      const search = page.getByRole("combobox", { name: "Search elements" });
      await search.focus();
      await page.keyboard.type("a b");
      assert.equal(await search.inputValue(), "a b");
      await page.keyboard.down("Space");
      assert.equal(await cursor(page), "auto", "hand turned on while typing");
      await page.keyboard.up("Space");
      await search.fill("");
      // a focused button keeps Space: it opens the Views panel instead of showing the hand
      const views = page.getByRole("button", { name: "Views and levels" });
      await views.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab"); // keyboard focus on a button
      assert.equal(await page.evaluate(() => document.activeElement.tagName), "BUTTON");
      await page.keyboard.down("Space");
      assert.equal(await cursor(page), "auto", "hand turned on over a focused button");
      await page.keyboard.up("Space");
      await page.getByRole("dialog", { name: "Views and levels" }).waitFor({ state: "visible", timeout: 5000 });
      // blur releases the hand
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.mouse.click(...(await modelPoint(page))); // focus moves to the page
      await page.waitForFunction(() => document.activeElement === document.body, null, { timeout: 5000 });
      await page.keyboard.down("Space");
      assert.equal(await cursor(page), "grab");
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      assert.equal(await cursor(page), "auto", "blur kept the hand");
      await page.keyboard.up("Space");
    },
  },
  {
    name: "measure tool armed: Space + drag pans without placing a point; a plain click still places one",
    projects: DESKTOP,
    timeout: 120000,
    fn: async ({ page, skip }) => {
      await prepare(page, skip);
      await stableClick(page.getByRole("button", { name: "Toggle measure mode" }));
      await page.locator(".tool-hint").waitFor({ state: "visible" });
      const [start, other] = await modelPoints(page);
      const p0 = await page.evaluate(pose);
      await page.keyboard.down("Space");
      await page.mouse.move(...start);
      assert.equal(await cursor(page), "grab", "hand beats the crosshair while Space is held");
      await drag(page, start, [20, 10]);
      await page.keyboard.up("Space");
      assert.equal(await cursor(page), "crosshair");
      const p1 = await page.evaluate(pose);
      assert.ok(Math.hypot(p1.sx - p0.sx, p1.sy - p0.sy) > 12, "no pan");
      // one plain click after the pan: if the pan had placed a point this would complete a measurement
      const [again] = await modelPoints(page);
      await page.mouse.click(...again);
      await page.waitForTimeout(600);
      await page.locator(".tool-hint__done").click();
      await measureTab(page).click();
      assert.equal(await page.getByText(/Length:/).count(), 0, "the pan drag placed a measure point");
      // a plain click still places points: two clicks make a measurement
      await stableClick(page.getByRole("button", { name: "Toggle measure mode" }));
      await page.locator(".tool-hint").waitFor({ state: "visible" });
      const pts = await modelPoints(page);
      await page.mouse.click(...pts[0]);
      await page.waitForTimeout(500);
      await page.mouse.click(...pts[pts.length - 1]);
      await page.waitForTimeout(600);
      await page.locator(".tool-hint__done").click();
      await measureTab(page).click();
      await page.getByText(/Length:/).first().waitFor({ state: "visible", timeout: 10000 });
      void other;
    },
  },
  {
    name: "hover shows no name, no pointer cursor and no tint by default; the Views switch turns names on, and it persists",
    projects: DESKTOP,
    timeout: 120000,
    fn: async ({ page, skip }) => {
      await prepare(page, skip);
      const pt = await modelPoint(page);
      const before = await page.screenshot({ clip: { x: 0, y: 0, width: 10, height: 10 } }); // warm-up
      void before;
      await page.mouse.move(pt[0] - 3, pt[1]);
      await page.mouse.move(...pt, { steps: 4 });
      await page.waitForTimeout(1500);
      assert.equal(await hoverUi(page), false, "a name label shows by default");
      assert.equal(await page.locator(".hover-label:not([hidden])").count(), 0);
      assert.equal(await cursor(page), "auto", "pointer cursor hints at an element by default");
      assert.equal(await page.locator("[role=tooltip]:visible").count(), 0, "a tooltip shows by default");
      // click selection is unchanged
      await page.mouse.click(...pt);
      await page.locator(".element-panel").first().waitFor({ state: "visible", timeout: 15000 });
      // the switch
      await page.mouse.click(5, 300);
      await stableClick(page.getByRole("button", { name: "Views and levels" }));
      const sw = page.getByRole("checkbox", { name: "Show names on hover" });
      assert.equal(await sw.isChecked(), false, "switch is on by default");
      await sw.check();
      await page.keyboard.press("Escape");
      await page.mouse.move(5, 300);
      await page.mouse.move(pt[0] - 3, pt[1]);
      await page.mouse.move(...pt, { steps: 4 });
      await page.waitForFunction(() => { const n = document.querySelector(".hover-label"); return n && !n.hidden && n.textContent.trim(); }, null, { timeout: 8000 });
      assert.equal(await cursor(page), "pointer");
      // persists across a reload
      await page.reload();
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => localStorage.getItem("ifcViewer.hoverNames")), "1");
      await loadSample(page);
      await stableClick(page.getByRole("button", { name: "Views and levels" }));
      assert.equal(await page.getByRole("checkbox", { name: "Show names on hover" }).isChecked(), true);
    },
  },
  {
    name: "tips and help mention the hand tool",
    projects: DESKTOP,
    fn: async ({ page }) => {
      await openApp(page);
      await loadSample(page);
      const tips = page.locator(".first-run");
      await tips.waitFor({ state: "visible", timeout: 10000 });
      assert.match(await tips.innerText(), /Space \+ drag moves/);
      await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
      assert.match(await page.locator(".shortcuts-help__popover").innerText(), /Space \+ drag/);
    },
  },
  {
    name: "touch: no hand tool, no hover UI, tips unchanged",
    projects: ["iphone13"],
    timeout: 120000,
    fn: async ({ page, skip }) => {
      await openApp(page);
      await loadSample(page);
      await requireHook(page, skip);
      await page.keyboard.down("Space");
      assert.equal(await cursor(page), "auto");
      await page.keyboard.up("Space");
      assert.equal(await page.locator(".hover-label:not([hidden])").count(), 0);
      const tips = page.locator(".first-run");
      if (await tips.isVisible().catch(() => false)) assert.doesNotMatch(await tips.innerText(), /Space/);
      await stableClick(page.getByRole("button", { name: "Views and levels" }));
      assert.equal(await page.getByRole("checkbox", { name: "Show names on hover" }).count(), 0);
    },
  },
]);

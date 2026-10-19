// Section planes: the sheet covers the whole scene; on a phone two planes at most with an explicit active one.
// Needs a build made with VITE_TEST_HOOK=1 (window.__ifcDebug.sections / .clip).
import assert from "node:assert/strict";
import { suite, openApp, loadSample, requireHook, stableClick } from "./lib.mjs";

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
]);

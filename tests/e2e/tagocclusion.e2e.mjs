// Tags are shown only while their anchor is visible from the camera: tag a wall, turn the building so the wall
// faces away and the tag hides; turn it back and it shows again. Needs a hook build (VITE_TEST_HOOK=1):
//   ARGUS_URL=http://localhost:<port> node tests/e2e/tagocclusion.e2e.mjs     (TAG_SHOTS=<dir> saves screenshots)
// Emulated touch (CDP) is not a real phone: it checks geometry and timing, not finger feel.
import assert from "node:assert/strict";
import { suite, openApp, loadSample, requireHook, isTouch } from "./lib.mjs";

const state = (page) => page.evaluate(() => window.__ifcDebug.tagState());
const shot = (page, name) => process.env.TAG_SHOTS && page.screenshot({ path: `${process.env.TAG_SHOTS}/${name}.png` });
const settle = (page, pred, label, timeout = 15000) =>
  page.waitForFunction(pred, null, { timeout, polling: 50 }).catch(async () => { throw new Error(`${label}: ${JSON.stringify(await state(page))}`); });
// a point on a wall (falls back to any element) that the tag tool can pin
const wallPoint = (page) =>
  page.evaluate(async () => {
    const d = window.__ifcDebug, r = document.querySelector("canvas").getBoundingClientRect();
    let any = null;
    for (let j = 3; j < 9; j++) for (let i = 2; i < 9; i++) {
      const x = r.left + (r.width * i) / 10, y = r.top + (r.height * j) / 10;
      if (document.elementFromPoint(x, y)?.tagName !== "CANVAS") continue;
      const h = await d.raycast(x, y);
      if (!h) continue;
      const [data] = await h.fragments.getItemsData([h.localId], { attributesDefault: true });
      any ??= [x, y];
      if (/WALL/i.test(data?._category?.value ?? "")) return [x, y];
    }
    return any;
  });

await suite("tag occlusion", [
  {
    name: "a tag hides when its wall faces away from the camera and shows again when it faces the camera; V still toggles",
    timeout: 150000,
    fn: async ({ page, project, skip }) => {
      await openApp(page);
      await loadSample(page);
      await requireHook(page, skip);
      await page.waitForTimeout(1500);
      const [x, y] = await wallPoint(page);
      await page.getByRole("button", { name: "Toggle tag tool" }).click();
      if (isTouch(project)) await page.touchscreen.tap(x, y); else { await page.mouse.move(x, y); await page.waitForTimeout(600); await page.mouse.click(x, y); }
      await settle(page, () => window.__ifcDebug.tagState().length === 1, "wall tag pinned", 20000);
      await settle(page, () => window.__ifcDebug.tagState()[0].visible, "tag shows while its wall faces the camera");
      await shot(page, `${project}-1-facing`);
      console.log(`  facing the camera: ${JSON.stringify(await state(page))}`);
      // turn the building half a turn: the wall now faces away, the tag must go
      const turn = (a) => page.evaluate((a) => { const d = window.__ifcDebug; d.group.rotateY(a); d.group.updateMatrixWorld(true); d.controls.dispatchEvent({ type: "change" }); }, a);
      await turn(Math.PI);
      await settle(page, () => !window.__ifcDebug.tagState()[0].visible, "tag hidden after the wall turned away", 25000);
      await shot(page, `${project}-2-turned-away`);
      const away = await state(page);
      console.log(`  wall facing away: ${JSON.stringify(away)}`);
      assert.equal(away[0].shown, false);
      assert.equal(await page.locator('[role="tab"]', { hasText: /^\s*Tags/ }).count() > 0, true, "the Tags tab is still there");
      await turn(-Math.PI);
      await settle(page, () => window.__ifcDebug.tagState()[0].visible, "tag back after turning the wall to the camera", 25000);
      await shot(page, `${project}-3-turned-back`);
      console.log(`  turned back: ${JSON.stringify(await state(page))}`);
      if (!isTouch(project)) {
        await page.keyboard.press("v");
        await settle(page, () => !window.__ifcDebug.tagState()[0].visible, "V hides the tags");
        await page.keyboard.press("v");
        await settle(page, () => window.__ifcDebug.tagState()[0].visible, "V shows the tags again");
      }
    },
  },
]);

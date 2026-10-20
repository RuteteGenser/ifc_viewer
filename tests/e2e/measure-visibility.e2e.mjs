// Measurement labels: (1) the text on screen is always the CURRENT length, in the right unit, drawn the same as a
// fresh upload (a label whose canvas changes size must not keep the old GPU storage: remnants / stale text);
// crossing 1 m in either direction switches m <-> mm live. (2) Leg labels do not flicker while orbiting a little.
// Needs a hook build (VITE_TEST_HOOK=1) in legacy mode:
//   ARGUS_URL=http://localhost:<port> ARGUS_IGNORE_SESSION_404=1 node tests/e2e/measure-visibility.e2e.mjs
import assert from "node:assert/strict";
import { suite, openApp, loadSample, requireHook, canvasBox, stableClick, isTouch } from "./lib.mjs";

async function twoPoints(page, project) {
  await stableClick(page.getByRole("button", { name: "Toggle measure mode" }));
  // A phone's icon opens the Measure menu; Distance is the tool these cases are about.
  const distance = page.getByRole("menuitemradio", { name: /Distance/ });
  if (await distance.isVisible().catch(() => false)) await distance.click();
  await page.locator(".tool-hint").waitFor({ state: "visible" });
  const b = await canvasBox(page);
  for (const [fx, fy] of [[0.4, 0.5], [0.55, 0.62]]) {
    const x = b.x + b.width * fx, y = b.y + b.height * fy;
    if (isTouch(project)) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
    await page.waitForTimeout(500);
  }
  await page.waitForFunction(() => window.__ifcDebug.measureState().length === 1, null, { timeout: 15000 });
}
// Put B at `len` metres from A along the current direction.
const setLength = async (page, len) => {
  await page.evaluate((len) => {
    const d = window.__ifcDebug, [a, b] = d.measurePoints()[0];
    const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], n = Math.hypot(...v);
    d.moveMeasureMarker(0, "B", a[0] + (v[0] / n) * len, a[1] + (v[1] / n) * len, a[2] + (v[2] / n) * len);
  }, len);
  await page.waitForTimeout(1200); // a few frames on the software renderer
};
// Screenshot of the total label's box, as RGBA data, decoded in the page.
const labelPixels = async (page) => {
  const box = await page.evaluate(() => {
    const d = window.__ifcDebug, [a, b] = d.measurePoints()[0];
    const v = new d.THREE.Vector3(...a).add(new d.THREE.Vector3(...b)).multiplyScalar(0.5);
    d.group.localToWorld(v).project(d.camera);
    const r = document.querySelector("canvas").getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
  });
  const vp = page.viewportSize();
  const clip = { x: Math.max(0, Math.round(box.x - 90)), y: Math.max(0, Math.round(box.y - 60)), width: 180, height: 80 };
  clip.width = Math.min(clip.width, vp.width - clip.x); clip.height = Math.min(clip.height, vp.height - clip.y);
  const png = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(img.width, img.height), g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(0, 0, img.width, img.height).data);
  }, png.toString("base64"));
};
const diffCount = (p, q) => { let n = 0; for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 60) n++; return n; };

await suite("measure visibility", [
  {
    name: "editing a measurement across 1 m switches m <-> mm live, and the pixels equal a fresh upload",
    projects: ["desktop"], // pixel comparison; a phone at 3x is too slow on the software renderer
    timeout: 300000,
    allowErrors: [/api\/models/, /Failed to load resource/], // the legacy-mode scratch server answers 404
    fn: async ({ page, project, skip }) => {
      await openApp(page);
      await loadSample(page);
      await requireHook(page, skip);
      await page.waitForTimeout(1500);
      await twoPoints(page, project);
      const text = async () => (await page.evaluate(() => window.__ifcDebug.measureState()))[0].total.text;
      // the exact boundary and both directions, with sizes that differ every time
      for (const [len, want] of [[2.5, "2.50 m"], [0.4, "400 mm"], [1.0, "1.00 m"], [0.999, "999 mm"], [12.45, "12.45 m"], [0.05, "50 mm"]]) {
        await setLength(page, len);
        assert.equal(await text(), want, `label text after editing to ${len} m`);
        const edited = await labelPixels(page);
        await page.evaluate(() => window.__ifcDebug.reuploadMeasureLabels());
        await page.waitForTimeout(1000);
        const fresh = await labelPixels(page);
        const n = diffCount(edited, fresh);
        assert.ok(n < 40, `${want}: the label on screen differs from a fresh upload in ${n} px (stale storage / second border)`);
      }
    },
  },
  {
    name: "leg labels do not flicker while orbiting a small angle",
    projects: ["desktop", "iphone13"],
    timeout: 240000,
    allowErrors: [/api\/models/, /Failed to load resource/], // the legacy-mode scratch server answers 404
    fn: async ({ page, project, skip }) => {
      await openApp(page);
      await loadSample(page);
      await requireHook(page, skip);
      await page.waitForTimeout(1500);
      await twoPoints(page, project);
      await setLength(page, 6);
      const seq = [];
      for (let i = 0; i < 16; i++) {
        await page.evaluate((a) => { const d = window.__ifcDebug; d.group.rotateY(a); d.group.updateMatrixWorld(true); d.controls.dispatchEvent({ type: "change" }); }, 0.012);
        await page.waitForTimeout(100);
        const s = (await page.evaluate(() => window.__ifcDebug.measureState()))[0];
        seq.push([s.total.visible, ...s.legs.map((l) => l.visible)]);
      }
      assert.ok(seq.every((v) => v[0]), "the total label stays visible");
      for (let k = 1; k < 4; k++) {
        const col = seq.map((v) => v[k]);
        let toggles = 0;
        for (let i = 1; i < col.length; i++) if (col[i] !== col[i - 1]) toggles++;
        assert.ok(toggles <= 1, `leg label ${k} toggled ${toggles} times: ${col.map(Number).join("")}`);
      }
    },
  },
]);

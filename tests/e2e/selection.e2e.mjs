// Selecting an element never moves the camera or the model, whichever way it is selected.
// Needs a hook build (VITE_TEST_HOOK=1, see tests/e2e/hook-build.sh):
//   ARGUS_URL=http://localhost:<port> node tests/e2e/selection.e2e.mjs
// Emulated touch (CDP) is not a real phone: it checks geometry, not finger feel.
import assert from "node:assert/strict";
import { suite, openApp, loadSample, requireHook, isTouch } from "./lib.mjs";

const pose = () =>
  window.__ifcDebug && [
    ...window.__ifcDebug.camera.position.toArray(), ...window.__ifcDebug.camera.quaternion.toArray(),
    ...window.__ifcDebug.group.position.toArray(), ...window.__ifcDebug.group.quaternion.toArray(),
    ...window.__ifcDebug.camera.projectionMatrix.elements,
  ];
const maxDiff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

async function prepare(page, skip) {
  await openApp(page);
  await loadSample(page);
  await requireHook(page, skip);
  await page.waitForTimeout(1500); // the first-load framing has settled
}
async function expectSelected(page) {
  await page.locator(".element-panel").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(1500); // anything that was going to ease would have started and moved by now
}
const same = async (page, before, how) => {
  const after = await page.evaluate(pose);
  const d = maxDiff(before, after);
  if (d > 1e-6) console.log("  moved at", before.map((v, i) => (Math.abs(v - after[i]) > 1e-6 ? `${i}:${(after[i] - v).toFixed(3)}` : "")).filter(Boolean).join(" "));
  console.log(`  ${how}: max pose difference ${d.toExponential(2)}`);
  assert.ok(d <= 1e-6, `${how} moved the camera or the model (${d})`);
};
const canvasHit = (page) => page.evaluate(async () => {
  const r = document.querySelector("canvas").getBoundingClientRect();
  for (let j = 2; j < 9; j++) for (let i = 2; i < 9; i++) {
    const x = r.left + (r.width * i) / 10, y = r.top + (r.height * j) / 10;
    if (document.elementFromPoint(x, y)?.tagName === "CANVAS" && (await window.__ifcDebug.raycast(x, y))) return [x, y];
  }
  return null;
});

await suite("selection", [
  {
    name: "tap / click on an element keeps the camera and the model exactly where they were",
    timeout: 120000,
    fn: async ({ page, project, skip }) => {
      await prepare(page, skip);
      const before = await page.evaluate(pose);
      const [x, y] = await canvasHit(page);
      if (isTouch(project)) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
      await expectSelected(page);
      await same(page, before, "tap");
    },
  },
  {
    name: "a search result keeps the camera and the model exactly where they were",
    timeout: 120000,
    fn: async ({ page, skip }) => {
      await prepare(page, skip);
      const before = await page.evaluate(pose);
      await page.getByRole("combobox", { name: "Search elements" }).or(page.getByLabel("Search elements")).first().fill("wall");
      await page.getByRole("button", { name: "Individual items" }).click();
      const go = page.locator(".sb-go").first();
      await go.waitFor({ state: "attached", timeout: 15000 });
      await go.click({ force: true });
      await expectSelected(page);
      await same(page, before, "search result");
    },
  },
]);

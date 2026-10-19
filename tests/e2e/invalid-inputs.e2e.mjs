// Flow 3: bad files get an accurate message, no stuck spinner, and the app keeps working.
import assert from "node:assert/strict";
import { suite, openApp, setFile, loadFile, waitForBanner, fx, DEMO_FILE, canvasStats } from "./lib.mjs";

const cases = [
  ["empty file", "empty.ifc", /"empty\.ifc" is empty\./, false],
  ["text file named .ifc", "not-ifc.ifc", /not a valid IFC file \(no ISO-10303-21 header\)/, false],
  ["plain .txt", "not-ifc.txt", /"not-ifc\.txt" is not an \.ifc, \.ifcZIP or \.zip file/, false],
  ["truncated IFC", "truncated.ifc", /Could not read "truncated\.ifc"|no 3D geometry/, true],
  ["IFC without geometry", "no-geometry-ifc4.ifc", /"no-geometry-ifc4\.ifc" has no 3D geometry to show\./, true],
];

await suite("invalid-inputs", cases.map(([name, file, message, parses]) => ({
  name: `${name}: shows "${message.source.slice(0, 40)}...", spinner ends, app still usable`,
  allowErrors: [/Failed to load/, /Could not/],
  timeout: 120000,
  fn: async ({ page }) => {
    await openApp(page);
    await setFile(page, fx(file));
    const text = await waitForBanner(page, message, parses ? 40000 : 15000);
    assert.match(text, message);
    await page.locator(".loading-overlay").waitFor({ state: "detached", timeout: 30000 });
    // still usable: the next, good file loads without a reload
    await page.getByRole("button", { name: "Dismiss error" }).click();
    await loadFile(page, DEMO_FILE);
    const s = await canvasStats(page);
    assert.ok(s.variance > 200, "good file renders after the bad one");
  },
})));

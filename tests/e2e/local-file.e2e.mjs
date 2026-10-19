// Flow 2: open local .ifc files through the file input and inspect them.
import assert from "node:assert/strict";
import { suite, openApp, loadFile, canvasStats, tapModel, panelText, readLevels, closeViews, fx, DEMO_FILE, downloadLibraryModel, bannerText } from "./lib.mjs";

await suite("local-file", [
  {
    name: "demo-building.ifc renders; selecting a wall shows its properties with the storey elevation in metres",
    fn: async ({ page, project }) => {
      await openApp(page);
      await loadFile(page, DEMO_FILE);
      const s = await canvasStats(page);
      assert.ok(s.variance > 200, `canvas looks empty (variance ${s.variance.toFixed(1)})`);
      await tapModel(page, project);
      const panel = page.locator(".element-panel");
      await panel.getByText("Storey", { exact: true }).waitFor({ timeout: 15000 });
      const text = await panelText(page);
      assert.match(text, /\bWALL\b/i);
      const m = /(Ground|First|Second) floor at (\+?[\d.]+) ?m/.exec(text);
      assert.ok(m, `no "<storey> at <n> m" row in:\n${text.slice(0, 400)}`);
      const expected = { Ground: 0, First: 3, Second: 6 }[m[1]];
      assert.equal(Number(m[2]), expected, `${m[1]} floor elevation`);
      assert.match(text, /Wall Common/i);
    },
  },
  {
    name: "millimetre IFC2X3 fixture: levels read in metres (0, +3, +6.25)",
    fn: async ({ page }) => {
      await openApp(page);
      await loadFile(page, fx("mm-ifc2x3.ifc"));
      const levels = await readLevels(page);
      assert.deepEqual(levels, [
        { name: "Roof", elevation: "+6.25 m" },
        { name: "First", elevation: "+3.00 m" },
        { name: "Ground", elevation: "0.00 m" },
      ]);
      await closeViews(page);
      const s = await canvasStats(page);
      assert.ok(s.variance > 100, "fixture renders something");
    },
  },
  {
    name: "metre IFC4 fixture: levels are kept (0, +3.2, +6.4)",
    projects: ["desktop"],
    fn: async ({ page }) => {
      await openApp(page);
      await loadFile(page, fx("m-ifc4.ifc"));
      assert.deepEqual((await readLevels(page)).map((l) => l.elevation), ["+6.40 m", "+3.20 m", "0.00 m"]);
    },
  },
  {
    name: "feet IFC4 fixture: 10 ft and 20 ft read as +3.05 m and +6.10 m",
    projects: ["desktop"],
    fn: async ({ page }) => {
      await openApp(page);
      await loadFile(page, fx("feet-ifc4.ifc"));
      assert.deepEqual((await readLevels(page)).map((l) => l.elevation), ["+6.10 m", "+3.05 m", "0.00 m"]);
    },
  },
  {
    name: "unit assignment at the end of the file still gives metres",
    projects: ["desktop"],
    fn: async ({ page }) => {
      await openApp(page);
      await loadFile(page, fx("units-at-end-ifc2x3.ifc"));
      assert.deepEqual((await readLevels(page)).map((l) => l.elevation), ["+2.80 m", "0.00 m"]);
    },
  },
  {
    name: "FZK house saved from the library opens and renders (IFC4)",
    fn: async ({ page, skip }) => {
      const path = await downloadLibraryModel(/FZK/i);
      if (!path) skip("no FZK model in the library");
      await openApp(page);
      await loadFile(page, path);
      const s = await canvasStats(page);
      assert.ok(s.variance > 100, `canvas looks empty (variance ${s.variance.toFixed(1)})`);
      assert.equal(await bannerText(page), "");
      assert.ok((await readLevels(page)).length >= 2, "FZK has storeys");
    },
  },
]);

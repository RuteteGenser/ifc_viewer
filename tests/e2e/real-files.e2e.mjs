// Flow 12 (optional, ARGUS_REAL=1): real downloaded models load and show plausible levels.
// Expected elevations were read from the files' IfcBuildingStorey.Elevation and unit assignment.
import assert from "node:assert/strict";
import { suite, openApp, loadFile, readLevels, MODELS_DIR, existsSync, bannerText } from "./lib.mjs";

const FILES = [
  ["duplex", "duplex/duplex.ifc", { Roof: "+6.00 m", "Level 2": "+3.10 m", "Level 1": "0.00 m", "T/FDN": "-1.25 m" }],
  ["clinic", "dental_clinic/dental_clinic.ifc", { "Roof - Main": "+9.25 m", "Second Floor": "+4.57 m", "First Floor": "0.00 m", "TOF Footing": "-1.00 m" }],
  ["fzk", "fzk_haus/fzk_haus.ifc", { Dachgeschoss: "+2.70 m", Erdgeschoss: "0.00 m" }],
  ["school_str (mm file)", "school_str/school_str.ifc", { Roof: "+11.40 m", "03 - Floor": "+7.60 m", "02 - Floor": "+3.80 m", "01 - Entry Level": "0.00 m", "Sub Level": "-2.50 m" }],
];

await suite("real-files", FILES.map(([name, rel, expected]) => ({
  name: `${name}: loads, no error, levels in metres`,
  projects: ["desktop"],
  timeout: 170000,
  fn: async ({ page, skip }) => {
    if (!process.env.ARGUS_REAL) skip("set ARGUS_REAL=1 to run the real-file smoke");
    const path = `${MODELS_DIR}/${rel}`;
    if (!existsSync(path)) skip(`${path} not found (set ARGUS_MODELS_DIR)`);
    await openApp(page);
    await loadFile(page, path);
    assert.equal(await bannerText(page), "");
    const levels = Object.fromEntries((await readLevels(page)).map((l) => [l.name, l.elevation]));
    assert.deepEqual(levels, expected);
  },
})));

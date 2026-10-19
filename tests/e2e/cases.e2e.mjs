// Cases: save snapshots, jump between them, export (PDF, BCF, case file), import, persistence, model mismatch.
// Needs a build made with VITE_TEST_HOOK=1 (reads the camera through window.__ifcDebug). See tests/TESTING.md.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { suite, openApp, loadSample, loadFile, requireHook, stableClick, FIXTURES, OUT } from "./lib.mjs";

const share = (page) => page.getByRole("button", { name: "Save image or copy view link" });
const panel = (page) => page.getByRole("dialog", { name: "Cases" });
const options = (page) => panel(page).getByRole("option");

async function openShareItem(page, name) {
  await stableClick(share(page));
  await page.getByRole("menuitem", { name }).click();
}
const openCases = async (page) => {
  await openShareItem(page, "Open Cases");
  await panel(page).waitFor({ state: "visible" });
};
const pose = (page) =>
  page.evaluate(() => {
    const d = window.__ifcDebug;
    return { cam: d.camera.position.toArray(), target: d.controls.target.toArray(), q: d.group.quaternion.toArray() };
  });
const near = (a, b, tol, what) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= tol, `${what}[${i}] ${v} vs ${b[i]}`));
const samePose = (a, b) => { near(a.cam, b.cam, 0.02, "camera"); near(a.target, b.target, 0.02, "target"); near(a.q, b.q, 0.002, "model rotation"); };
const nudge = (page, k) =>
  page.evaluate((k) => {
    const d = window.__ifcDebug;
    d.camera.position.sub(d.controls.target).multiplyScalar(k).add(d.controls.target);
    d.group.rotation.y += 0.5;
    d.controls.update();
  }, k);
const selectedIndex = async (page) => (await options(page).evaluateAll((els) => els.findIndex((e) => e.getAttribute("aria-selected") === "true"))) + 1;
const waitPose = (page, want) => page.waitForFunction((w) => {
  const d = window.__ifcDebug;
  const close = (a, b, t) => a.every((v, i) => Math.abs(v - b[i]) <= t);
  return close(d.camera.position.toArray(), w.cam, 0.02) && close(d.group.quaternion.toArray(), w.q, 0.002);
}, want, { timeout: 5000 });
const download = async (page, click) => {
  const [dl] = await Promise.all([page.waitForEvent("download"), click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: readFileSync(path) };
};

await suite("cases", [
  {
    name: "save, jump, export, import, persist",
    timeout: 180000,
    fn: async ({ page, skip, project }) => {
      await openApp(page);
      await requireHook(page, skip);
      await loadSample(page);

      // 1. Share > Save snapshot to case creates a case named after the model and says so.
      const p1 = await pose(page);
      await openShareItem(page, "Save snapshot to case");
      await page.locator(".toast", { hasText: /^Saved to .+ case$/ }).waitFor();
      await openCases(page);
      assert.equal(await options(page).count(), 1, "the saved photo is in the Cases menu");
      await page.screenshot({ path: `${OUT}/cases-${project}-one.png` });

      // 2. Move the view and save a second snapshot with a title.
      await nudge(page, 0.7);
      const p2 = await pose(page);
      await panel(page).getByRole("button", { name: "Save snapshot", exact: true }).click();
      await panel(page).getByLabel("Title (optional)").fill("Second view æøå");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelectorAll('.cases [role="option"]').length === 2);
      assert.equal(await selectedIndex(page), 2, "the new snapshot is selected");
      await page.screenshot({ path: `${OUT}/cases-${project}-strip.png` });

      // 3. Previous / Next jump and restore camera and model pose; the strip highlight follows.
      await panel(page).getByRole("button", { name: "Previous" }).click();
      await waitPose(page, p1);
      samePose(await pose(page), p1);
      assert.equal(await selectedIndex(page), 1);
      await panel(page).getByRole("button", { name: "Next" }).click();
      await waitPose(page, p2);
      samePose(await pose(page), p2);
      assert.equal(await selectedIndex(page), 2);
      await options(page).nth(1).focus();
      await page.keyboard.press("ArrowLeft");
      await waitPose(page, p1);
      assert.equal(await selectedIndex(page), 1, "ArrowLeft on the strip jumps back");
      await options(page).nth(0).click();
      assert.equal(await selectedIndex(page), 1);

      // 4. 44 px targets in the panel, no sideways overflow.
      const small = await page.evaluate(() => [...document.querySelectorAll(".cases button, .cases input:not([hidden]), .cases textarea")]
        .filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { n: (e.getAttribute("aria-label") || e.textContent || e.name || "").trim().slice(0, 30), w: r.width, h: r.height }; })
        .filter((r) => r.w < 43.5 || r.h < 43.5));
      assert.deepEqual(small, [], "every control is at least 44 px");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no horizontal page scroll");

      // 5. Exports.
      await panel(page).getByRole("button", { name: "Export", exact: true }).click();
      const pdf = await download(page, () => panel(page).getByRole("menuitem", { name: "Export PDF" }).click());
      assert.match(pdf.name, /\.pdf$/);
      assert.equal(pdf.bytes.subarray(0, 4).toString(), "%PDF");
      const pages = (pdf.bytes.toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g) || []).length;
      assert.equal(pages, 3, "cover page plus one page per snapshot");
      require_(pdf.bytes.length > 5000, "pdf carries the images");

      await panel(page).getByRole("button", { name: "Export", exact: true }).click();
      const bcf = await download(page, () => panel(page).getByRole("menuitem", { name: "Export BCF" }).click());
      assert.match(bcf.name, /\.bcf$/);
      assert.equal(bcf.bytes[0], 0x50); assert.equal(bcf.bytes[1], 0x4b);
      assert.ok("bcf.version" in unzipSync(new Uint8Array(bcf.bytes)), "bcf.version inside");

      await panel(page).getByRole("button", { name: "Export", exact: true }).click();
      const file = await download(page, () => panel(page).getByRole("menuitem", { name: "Save case file" }).click());
      assert.match(file.name, /\.argus-case\.json$/);
      const saved = JSON.parse(file.bytes.toString());
      assert.equal(saved.snapshots.length, 2);
      assert.equal(saved.snapshots[1].title, "Second view æøå");

      // 6. Delete the case (confirm focuses Cancel), then import the file back: equal.
      await panel(page).getByRole("button", { name: "Delete case" }).click();
      const dialog = page.getByRole("dialog", { name: "Delete this case?" });
      await dialog.waitFor();
      assert.match(await page.evaluate(() => document.activeElement?.textContent), /Cancel/);
      await dialog.getByRole("button", { name: "Delete" }).click();
      await panel(page).getByText(/No cases yet/).waitFor();
      await panel(page).locator('input[type="file"]').setInputFiles({ name: file.name, mimeType: "application/json", buffer: file.bytes });
      await page.waitForFunction(() => document.querySelectorAll('.cases [role="option"]').length === 2);
      const [back] = await Promise.all([page.waitForEvent("download"), (async () => { await panel(page).getByRole("button", { name: "Export", exact: true }).click(); await panel(page).getByRole("menuitem", { name: "Save case file" }).click(); })()]);
      const again = JSON.parse(readFileSync(await back.path(), "utf8"));
      assert.deepEqual(again.snapshots.map((s) => [s.title, s.note, s.view]), saved.snapshots.map((s) => [s.title, s.note, s.view]), "imported case equals the saved one");
      assert.equal(again.name, saved.name);

      // 7. It survives a reload (IndexedDB).
      await page.reload();
      await openApp(page);
      await loadSample(page);
      await openCases(page);
      await panel(page).getByRole("option").first().waitFor();
      assert.equal(await options(page).count(), 2, "case is still there after reload");
      await panel(page).getByRole("button", { name: "Done" }).click();
      await panel(page).waitFor({ state: "detached" });
    },
  },
  {
    name: "another model shows the mismatch banner",
    fn: async ({ page, skip, project }) => {
      await openApp(page);
      await requireHook(page, skip);
      await loadSample(page);
      await openShareItem(page, "Save snapshot to case");
      await page.locator(".toast", { hasText: /^Saved to/ }).waitFor();
      await loadFile(page, `${FIXTURES}/m-ifc4.ifc`);
      await openCases(page);
      const banner = panel(page).getByRole("alert");
      await banner.waitFor();
      assert.match(await banner.innerText(), /This case was made on a different model \(Sample building\)\. Open that file to see everything\. Annotations are placed by coordinates\./);
      await page.screenshot({ path: `${OUT}/cases-${project}-mismatch.png` });
    },
  },
  {
    name: "320 px wide: no horizontal overflow; reduced motion opens at once",
    projects: ["desktop"],
    context: { viewport: { width: 320, height: 640 }, reducedMotion: "reduce" },
    fn: async ({ page, skip }) => {
      await openApp(page);
      await requireHook(page, skip);
      await loadSample(page);
      await openShareItem(page, "Save snapshot to case");
      await page.locator(".toast", { hasText: /^Saved to/ }).waitFor();
      await openCases(page);
      await panel(page).getByRole("option").first().waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "page does not scroll sideways");
      assert.ok(await panel(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "panel does not scroll sideways");
      await page.keyboard.press("Escape");
      await panel(page).waitFor({ state: "detached", timeout: 300 });
    },
  },
]);
function require_(ok, msg) { assert.ok(ok, msg); }

// Flow 9: one model at a time by default. Opening replaces what is loaded; "Add to view" /
// "Add another model" / Shift-drop add. The sidebar (menu drawer on a phone) removes one. Library cases use throwaway models, so
// ARGUS_URL must point at a scratch backend.
// Emulated touch is not a real phone: these check layout, sizes and the logic, not iOS Safari itself.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { suite, openApp, loadFile, loadSample, setFile, waitForModelAfter, waitForBanner, canvasStats, fx, DEMO_FILE, api, devices, createThrowaway, removeThrowaway } from "./lib.mjs";
import { buildIfc } from "../fixtures/generate.mjs";

const stats = (page) => page.evaluate(() => window.__argusLoadStats());
// What the viewer holds, read from the sidebar list (in the DOM on every layout) and the engine counters.
const view = (page) =>
  page.evaluate(() => ({
    names: [...document.querySelectorAll(".model-list .model-row__name")].map((e) => e.textContent.trim()),
    stats: window.__argusLoadStats(),
  }));
const expectModels = async (page, names) => {
  const v = await view(page);
  assert.deepEqual(v.names.slice().sort(), names.slice().sort(), `loaded: ${JSON.stringify(v)}`);
  assert.deepEqual({ engine: v.stats.engine, open: v.stats.open }, { engine: names.length, open: names.length }, `nothing leaked: ${JSON.stringify(v.stats)}`);
};
const makeIfc = (tag) => buildIfc({ schema: "IFC4", unit: "m", name: tag, storeys: [{ name: "Ground", elevation: 0 }], wall: [4, 0.2, 2.8] });
// Library models are loose in the scratch library: they sit in the virtual Unsorted project.
const openUnsorted = async (page) => page.getByRole("button", { name: /^Open project Unsorted/ }).click();
const menuIfNeeded = async (page) => {
  const burger = page.getByRole("button", { name: "Open menu" });
  if ((await burger.isVisible()) && !(await page.locator(".sidebar--open").count())) await burger.click();
};
// "Add another model" through the real UI: the sidebar button (in the menu drawer on a phone).
async function addFiles(page, paths) {
  await waitForModelAfter(page, async () => {
    const chooser = page.waitForEvent("filechooser", { timeout: 10000 });
    await menuIfNeeded(page);
    await page.getByRole("button", { name: "Add another model" }).click();
    await (await chooser).setFiles(paths);
  });
}
const dropFiles = (page, files, { shift = false } = {}) =>
  page.evaluate(
    async ({ files, shift }) => {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name));
      const target = document.querySelector(".viewport-wrapper");
      const fire = (type, el = target) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, shiftKey: shift }));
      fire("dragenter");
      fire("dragover");
      await new Promise((r) => setTimeout(r, 100));
      const zones = { replace: !!document.querySelector("[data-drop-replace]"), add: !!document.querySelector("[data-drop-add]") };
      fire("drop");
      return zones;
    },
    { files: files.map((p) => ({ name: p.split("/").pop(), b64: readFileSync(p).toString("base64") })), shift },
  );
const dropAndWait = (page, files, opts) => waitForModelAfter(page, () => dropFiles(page, files, opts)).then(() => {});

const A = fx("m-ifc4.ifc");
const B = fx("mm-ifc2x3.ifc");
const C = fx("feet-ifc4.ifc");
const names = { A: "m-ifc4", B: "mm-ifc2x3", C: "feet-ifc4", demo: "demo-building" };

await suite("single-model", [
  {
    name: "sample, then a library model from its project page: the scene holds exactly one model",
    timeout: 120000,
    fn: async ({ page }) => {
      const lib = await createThrowaway(makeIfc);
      try {
        await openApp(page);
        await loadSample(page);
        await expectModels(page, ["Sample building"]);
        await menuIfNeeded(page);
        await page.getByRole("button", { name: "Remove Sample building" }).click();
        await page.getByRole("heading", { name: "No projects yet" }).or(page.getByRole("heading", { name: "Projects", level: 1 })).first().waitFor();
        await openUnsorted(page);
        await waitForModelAfter(page, () => page.getByRole("button", { name: `Open ${lib.name}`, exact: true }).click());
        const v = await view(page);
        assert.equal(v.names.length, 1, JSON.stringify(v));
        assert.equal(v.names[0], lib.name.replace(/\.ifc$/, ""));
        assert.equal(v.stats.engine, 1, "the sample was disposed");
        assert.ok((await canvasStats(page)).variance > 100, "the new model renders");
      } finally {
        await removeThrowaway(lib);
      }
    },
  },
  {
    name: "Open IFC file, the picker and a multi-file pick replace as a set",
    timeout: 150000,
    fn: async ({ page }) => {
      await openApp(page);
      await loadFile(page, A);
      await expectModels(page, [names.A]);
      await loadFile(page, B);
      await expectModels(page, [names.B]);
      await waitForModelAfter(page, () => page.locator('input[type="file"]').first().setInputFiles([A, C]));
      await expectModels(page, [names.A, names.C]);
      await loadFile(page, DEMO_FILE);
      await expectModels(page, [names.demo]);
    },
  },
  {
    name: "opening the same file again replaces it without a question",
    fn: async ({ page }) => {
      await openApp(page);
      await loadFile(page, A);
      await loadFile(page, A);
      assert.equal(await page.locator(".confirm-dialog").count(), 0, "no dialog");
      await expectModels(page, [names.A]);
    },
  },
  {
    name: "Open all in a project loads every model of it together",
    timeout: 180000,
    projects: ["desktop", "iphone13"],
    fn: async ({ page }) => {
      const one = await createThrowaway(makeIfc);
      const two = await createThrowaway(makeIfc);
      try {
        await openApp(page);
        await openUnsorted(page);
        await page.getByRole("button", { name: "Open all" }).waitFor();
        await waitForModelAfter(page, () => page.getByRole("button", { name: "Open all" }).click());
        await page.waitForFunction(() => document.querySelectorAll(".model-list .model-row__name").length >= 2, null, { timeout: 60000 });
        const v = await view(page);
        assert.ok(v.names.length >= 2 && v.stats.engine === v.names.length, JSON.stringify(v));
      } finally {
        await removeThrowaway(one);
        await removeThrowaway(two);
      }
    },
  },
  {
    name: "Add another model adds; removing in the sidebar keeps the other and ends in the project browser",
    timeout: 150000,
    fn: async ({ page, project }) => {
      await openApp(page);
      await loadFile(page, A);
      await addFiles(page, B);
      await expectModels(page, [names.A, names.B]);
      // the first-time notice
      const notice = page.locator(".multi-notice");
      await notice.waitFor({ timeout: 5000 });
      assert.match(await notice.innerText(), /2 models are loaded together\. Open the menu to remove one\./);
      await notice.getByRole("button", { name: "Dismiss" }).click();
      assert.equal(await notice.count(), 0);
      assert.equal(await page.locator(".models-chip").count(), 0, "no Models chip in the header");

      await menuIfNeeded(page);
      await page.getByRole("button", { name: `Remove ${names.A}` }).click();
      await expectModels(page, [names.B]);
      // one left: no "Remove all"
      assert.equal(await page.getByRole("button", { name: "Remove all" }).count(), 0);
      await page.getByRole("button", { name: `Remove ${names.B}` }).click();
      await page.getByRole("heading", { name: "No projects yet" }).waitFor();
      assert.deepEqual((await stats(page)), { engine: 0, open: 0, queued: 0 });
      // the notice is once per session: two models again, no second notice
      await loadFile(page, A);
      await addFiles(page, C);
      await page.waitForTimeout(500);
      assert.equal(await notice.count(), 0, "the notice shows once per session");
    },
  },
  {
    name: "Remove all in the sidebar",
    fn: async ({ page }) => {
      await openApp(page);
      await loadFile(page, A);
      await addFiles(page, [B, C]);
      await expectModels(page, [names.A, names.B, names.C]);
      await menuIfNeeded(page);
      await page.getByRole("button", { name: "Remove all" }).click();
      await page.getByRole("heading", { name: "No projects yet" }).waitFor();
      assert.deepEqual(await stats(page), { engine: 0, open: 0, queued: 0 });
    },
  },
  {
    name: "the sidebar Remove button is labelled (wide layout)",
    projects: ["desktop"],
    fn: async ({ page }) => {
      await openApp(page);
      await loadFile(page, A);
      await addFiles(page, B);
      const remove = page.locator(".sidebar").getByRole("button", { name: `Remove ${names.A}` });
      assert.match((await remove.innerText()).trim(), /Remove/);
      await remove.click();
      await expectModels(page, [names.B]);
    },
  },
  {
    name: "a replace whose new file is corrupt keeps the old model",
    allowErrors: [/Failed to load/, /Could not/],
    timeout: 150000,
    fn: async ({ page }) => {
      await openApp(page);
      await loadFile(page, A);
      await setFile(page, fx("not-ifc.ifc"));
      await waitForBanner(page, /not a valid IFC file/, 15000);
      await expectModels(page, [names.A]);
      await page.getByRole("button", { name: "Dismiss error" }).click();
      await setFile(page, fx("truncated.ifc"));
      await waitForBanner(page, /Could not read "truncated\.ifc"|no 3D geometry/, 60000);
      await page.locator(".loading-overlay").waitFor({ state: "detached", timeout: 30000 });
      const v = await view(page);
      assert.ok(v.names.includes(names.A), `the old model must stay: ${JSON.stringify(v)}`);
      assert.ok((await canvasStats(page)).variance > 100, "the old model still renders");
    },
  },
  {
    name: "drag and drop: a plain drop replaces, Shift or the Add to view zone adds",
    projects: ["desktop"],
    timeout: 180000,
    fn: async ({ page }) => {
      await openApp(page);
      await loadFile(page, A);
      let zones;
      await waitForModelAfter(page, async () => {
        zones = await dropFiles(page, [B]);
      });
      assert.deepEqual(zones, { replace: true, add: true }, "both zones show while a model is loaded");
      await expectModels(page, [names.B]);
      await dropAndWait(page, [C], { shift: true });
      await expectModels(page, [names.B, names.C]);
      // dropping on the Add to view zone itself
      await waitForModelAfter(page, () =>
        page.evaluate(async (file) => {
          const dt = new DataTransfer();
          dt.items.add(new File([Uint8Array.from(atob(file.b64), (c) => c.charCodeAt(0))], file.name));
          const wrap = document.querySelector(".viewport-wrapper");
          wrap.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt }));
          await new Promise((r) => setTimeout(r, 100));
          const zone = document.querySelector("[data-drop-add]");
          zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
        }, { name: "m-ifc4.ifc", b64: readFileSync(A).toString("base64") }),
      );
      await expectModels(page, [names.A, names.B, names.C]);
    },
  },
  {
    name: "drag and drop onto an empty viewer shows one message and opens the file",
    projects: ["desktop"],
    fn: async ({ page }) => {
      await openApp(page);
      const zones = await page.evaluate(async () => {
        const dt = new DataTransfer();
        dt.items.add(new File(["x"], "x.ifc"));
        document.querySelector(".viewport-wrapper").dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt }));
        await new Promise((r) => setTimeout(r, 100));
        return { add: !!document.querySelector("[data-drop-add]"), box: document.querySelector(".drop-overlay__box")?.textContent ?? "" };
      });
      assert.equal(zones.add, false);
      assert.match(zones.box, /Drop \.ifc/);
    },
  },
  {
    name: "phones and tablets: the header has no chip, stays inside the screen and keeps 44 px targets with two models",
    projects: ["iphone13", "ipad-mini"],
    timeout: 150000,
    fn: async ({ page }) => {
      await openApp(page);
      await loadFile(page, A);
      await addFiles(page, B);
      assert.equal(await page.locator(".models-chip").count(), 0);
      const o = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        iw: window.innerWidth,
        small: [...document.querySelectorAll(".header button")].filter((b) => b.offsetParent).map((b) => [b.getAttribute("aria-label") || b.textContent.trim(), Math.round(b.getBoundingClientRect().height)]).filter(([, h]) => h < 44),
        right: Math.max(...[...document.querySelectorAll(".header > *")].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().right)),
      }));
      assert.ok(o.sw <= o.iw, `page scrolls sideways: ${JSON.stringify(o)}`);
      assert.deepEqual(o.small, [], "header targets under 44 px");
      assert.ok(o.right <= o.iw + 1, `header runs off screen: ${JSON.stringify(o)}`);
      await menuIfNeeded(page);
      await page.getByRole("button", { name: `Remove ${names.A}` }).click();
      await expectModels(page, [names.B]);
    },
  },
  {
    name: "small phones (iPhone SE, Pixel 7): header, drawer, remove all, no overflow (emulated touch)",
    projects: ["desktop"],
    timeout: 240000,
    fn: async ({ browser }) => {
      for (const name of ["iPhone SE", "Pixel 7"]) {
        const ctx = await browser.newContext({ ...devices[name], httpCredentials: { username: "ifc", password: "123" } });
        await ctx.addInitScript(() => localStorage.setItem("argus.welcome.v1", "1"));
        const page = await ctx.newPage();
        try {
          await openApp(page);
          await loadFile(page, A);
          await addFiles(page, B);
          assert.equal(await page.locator(".models-chip").count(), 0, name);
          const head = await page.evaluate(() => ({ iw: innerWidth, right: Math.max(...[...document.querySelectorAll(".header > *")].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().right)), small: [...document.querySelectorAll(".header button")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 43.9).length }));
          assert.ok(head.right <= head.iw + 1 && head.small === 0, `${name}: header ${JSON.stringify(head)}`);
          assert.ok((await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)), `${name}: horizontal overflow`);
          await menuIfNeeded(page);
          await page.getByRole("button", { name: "Remove all" }).tap();
          await page.getByRole("heading", { name: "No projects yet" }).waitFor();
        } finally {
          await ctx.close();
        }
      }
    },
  },
]);

// Flow 9: one model at a time by default. Opening replaces what is loaded; "Add to view" /
// "Add another model" / Shift-drop add. The Models chip and sheet remove one. Read-only against
// the real library (it opens existing models, never uploads or deletes).
// Emulated touch is not a real phone: these check layout, sizes and the logic, not iOS Safari itself.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { suite, openApp, loadFile, loadSample, setFile, waitForModelAfter, waitForBanner, canvasStats, fx, DEMO_FILE, api, devices } from "./lib.mjs";

const stats = (page) => page.evaluate(() => window.__argusLoadStats());
// What the viewer holds, read from the sidebar list (in the DOM on every layout) and the engine counters.
const view = (page) =>
  page.evaluate(() => ({
    names: [...document.querySelectorAll(".model-list .model-row__name")].map((e) => e.textContent.trim()),
    stats: window.__argusLoadStats(),
    chip: document.querySelector(".models-chip")?.textContent.trim() ?? null,
  }));
const expectModels = async (page, names) => {
  const v = await view(page);
  assert.deepEqual(v.names.slice().sort(), names.slice().sort(), `loaded: ${JSON.stringify(v)}`);
  assert.deepEqual({ engine: v.stats.engine, open: v.stats.open }, { engine: names.length, open: names.length }, `nothing leaked: ${JSON.stringify(v.stats)}`);
};
const libraryModel = async (pattern) => (await (await api.get("/models")).json()).find((m) => pattern.test(m.name));
const menuIfNeeded = async (page) => {
  const burger = page.getByRole("button", { name: "Open menu" });
  if ((await burger.isVisible()) && !(await page.locator(".sidebar--open").count())) await burger.click();
};
// "Add another model" through the real UI: the Models sheet where the chip is shown, else the sidebar button.
async function addFiles(page, paths) {
  await waitForModelAfter(page, async () => {
    const chip = page.locator(".models-chip");
    const chooser = page.waitForEvent("filechooser", { timeout: 10000 });
    if (await chip.isVisible()) {
      await chip.click();
      await page.getByRole("dialog", { name: "Models" }).getByRole("button", { name: "Add another model" }).click();
    } else {
      await menuIfNeeded(page);
      await page.getByRole("button", { name: "Add another model" }).click();
    }
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
    name: "sample, then a library model: the scene holds exactly one model",
    timeout: 120000,
    fn: async ({ page, project }) => {
      const lib = await libraryModel(/FZK/);
      assert.ok(lib, "the library has the FZK model");
      await openApp(page);
      await loadSample(page);
      await expectModels(page, ["Sample building"]);
      await menuIfNeeded(page);
      await waitForModelAfter(page, () => page.getByRole("button", { name: `Open ${lib.name}`, exact: true }).click());
      const v = await view(page);
      assert.equal(v.names.length, 1, JSON.stringify(v));
      assert.match(v.names[0], /FZK/);
      assert.equal(v.stats.engine, 1, "the sample was disposed");
      assert.ok((await canvasStats(page)).variance > 100, "the new model renders");
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
    name: "Add to view in a library row's More menu gives two models; the chip shows the count",
    timeout: 120000,
    fn: async ({ page, project }) => {
      const lib = await libraryModel(/FZK/);
      await openApp(page);
      await loadSample(page);
      const chip = page.locator(".models-chip");
      if (project === "desktop") assert.equal(await chip.count(), 0, "desktop: no chip while only one model is loaded");
      else assert.equal((await chip.innerText()).trim(), "1 model");
      await menuIfNeeded(page);
      await page.getByRole("button", { name: `More actions for ${lib.name}` }).click();
      assert.equal(await page.getByRole("button", { name: "Open", exact: true }).count(), 1, "Open sits next to Add to view");
      await waitForModelAfter(page, () => page.getByRole("button", { name: "Add to view", exact: true }).click());
      const v = await view(page);
      assert.equal(v.names.length, 2, JSON.stringify(v));
      assert.equal(v.stats.engine, 2);
      assert.equal(v.chip, "2 models");
      assert.ok(await chip.isVisible(), "the chip is visible with two models on every layout");
    },
  },
  {
    name: "a loaded library row shows Open, has no Add to view, and tapping it changes nothing",
    timeout: 120000,
    fn: async ({ page }) => {
      const lib = await libraryModel(/FZK/);
      await openApp(page);
      await loadSample(page);
      await menuIfNeeded(page);
      await waitForModelAfter(page, () => page.getByRole("button", { name: `Open ${lib.name}`, exact: true }).click());
      await menuIfNeeded(page);
      const row = page.getByRole("button", { name: `${lib.name}, already open` });
      await row.waitFor();
      assert.match(await row.innerText(), /Open/);
      await row.click();
      await page.waitForTimeout(500);
      assert.equal((await view(page)).names.length, 1);
      await menuIfNeeded(page);
      await page.getByRole("button", { name: `More actions for ${lib.name}` }).click();
      assert.equal(await page.getByRole("button", { name: "Add to view", exact: true }).count(), 0);
    },
  },
  {
    name: "Add another model adds; removing through the Models sheet keeps the other and ends in the empty state",
    timeout: 150000,
    fn: async ({ page, project }) => {
      await openApp(page);
      await loadFile(page, A);
      await addFiles(page, B);
      await expectModels(page, [names.A, names.B]);
      // the first-time notice
      const notice = page.locator(".multi-notice");
      await notice.waitFor({ timeout: 5000 });
      assert.match(await notice.innerText(), /2 models are loaded together\. Use Models to remove one\./);
      await notice.getByRole("button", { name: "Dismiss" }).click();
      assert.equal(await notice.count(), 0);

      await page.locator(".models-chip").click();
      const sheet = page.getByRole("dialog", { name: "Models" });
      await sheet.waitFor();
      await sheet.getByRole("button", { name: `Remove ${names.A}` }).click();
      await expectModels(page, [names.B]);
      assert.ok(await sheet.isVisible(), "the sheet stays while a model is left");
      // one left: no "Remove all" duplicate
      assert.equal(await sheet.getByRole("button", { name: "Remove all" }).count(), 0);
      await sheet.getByRole("button", { name: `Remove ${names.B}` }).click();
      await sheet.waitFor({ state: "detached" });
      await page.getByRole("heading", { name: "Open a building model" }).waitFor();
      assert.deepEqual((await stats(page)), { engine: 0, open: 0, queued: 0 });
      await page.getByRole("heading", { name: "My models" }).first().waitFor();
      // the notice is once per session: two models again, no second notice
      await loadFile(page, A);
      await addFiles(page, C);
      await page.waitForTimeout(500);
      assert.equal(await notice.count(), 0, "the notice shows once per session");
    },
  },
  {
    name: "Remove all in the Models sheet",
    fn: async ({ page }) => {
      await openApp(page);
      await loadFile(page, A);
      await addFiles(page, [B, C]);
      await expectModels(page, [names.A, names.B, names.C]);
      await page.locator(".models-chip").click();
      await page.getByRole("dialog", { name: "Models" }).getByRole("button", { name: "Remove all" }).click();
      await page.getByRole("heading", { name: "Open a building model" }).waitFor();
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
    name: "no horizontal overflow and 44 px targets with the Models sheet open",
    projects: ["iphone13", "ipad-mini"],
    timeout: 150000,
    fn: async ({ page }) => {
      await openApp(page);
      await loadFile(page, A);
      await addFiles(page, B);
      const chip = page.locator(".models-chip");
      assert.ok((await chip.boundingBox()).height >= 44, "chip is 44 px high");
      await chip.tap();
      const sheet = page.getByRole("dialog", { name: "Models" });
      await sheet.waitFor();
      const sizes = await sheet.evaluate((el) =>
        [...el.querySelectorAll("button, label")].map((b) => ({ t: (b.getAttribute("aria-label") || b.textContent).trim().slice(0, 30), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })),
      );
      for (const s of sizes) assert.ok(s.h >= 44 && s.w >= 44, `target too small: ${JSON.stringify(s)}`);
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, sheet: document.querySelector(".models-sheet").scrollWidth, sheetW: document.querySelector(".models-sheet").clientWidth }));
      assert.ok(o.sw <= o.iw, `page scrolls sideways: ${JSON.stringify(o)}`);
      assert.ok(o.sheet <= o.sheetW, `sheet scrolls sideways: ${JSON.stringify(o)}`);
      await sheet.getByRole("button", { name: `Remove ${names.A}` }).tap();
      await expectModels(page, [names.B]);
    },
  },
  {
    name: "small phones (iPhone SE, Pixel 7): chip, sheet, remove, no overflow (emulated touch)",
    projects: ["desktop"],
    timeout: 240000,
    fn: async ({ browser }) => {
      for (const name of ["iPhone SE", "Pixel 7"]) {
        const ctx = await browser.newContext({ ...devices[name], httpCredentials: { username: "ifc", password: "123" } });
        const page = await ctx.newPage();
        try {
          await openApp(page);
          await loadFile(page, A);
          assert.equal((await page.locator(".models-chip").innerText()).trim(), "1 model", name);
          await addFiles(page, B);
          assert.equal((await page.locator(".models-chip").innerText()).trim(), "2 models", name);
          const box = await page.locator(".models-chip").boundingBox();
          assert.ok(box.height >= 44, `${name}: chip height ${box.height}`);
          const head = await page.evaluate(() => ({ brand: document.querySelector(".header__brand").getBoundingClientRect().right, chip: document.querySelector(".models-chip").getBoundingClientRect().left, iw: innerWidth, chipRight: document.querySelector(".models-chip").getBoundingClientRect().right }));
          assert.ok(head.chip >= head.brand && head.chipRight <= head.iw, `${name}: chip placement ${JSON.stringify(head)}`);
          await page.locator(".models-chip").tap();
          const sheet = page.getByRole("dialog", { name: "Models" });
          await sheet.waitFor();
          for (const b of await sheet.locator("button, label").all()) {
            const r = await b.boundingBox();
            assert.ok(r.height >= 44 && r.width >= 44, `${name}: small target ${await b.innerText()} ${JSON.stringify(r)}`);
          }
          assert.ok((await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)), `${name}: horizontal overflow`);
          await sheet.getByRole("button", { name: "Remove all" }).tap();
          await page.getByRole("heading", { name: "Open a building model" }).waitFor();
        } finally {
          await ctx.close();
        }
      }
    },
  },
]);

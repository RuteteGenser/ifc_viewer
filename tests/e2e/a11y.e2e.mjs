// Accessibility and keyboard sweep: landmarks and names, keyboard-only flows (focus order and return, ARIA tabs,
// menus, dialogs), visible focus rings, text contrast, forced colours and reflow at 200% / 400% zoom.
// Screen readers (VoiceOver, TalkBack) are not covered: this asserts the attributes they read, not what they say.
import assert from "node:assert/strict";
import { suite, openApp, loadSample, loadFile, setFile, waitForBanner, settle, stableClick, DEMO_FILE, fx } from "./lib.mjs";
import { collectText, rate, flatten, parseColor, ratio } from "./contrast.mjs";

const desktop = ["desktop"];
const focusDesc = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.tagName.toLowerCase()}|${a.getAttribute("aria-label") || a.textContent.trim().slice(0, 30)}` : "none";
  });
const isBody = (page) => page.evaluate(() => document.activeElement === document.body || !document.activeElement);
const press = async (page, key, n = 1) => {
  for (let i = 0; i < n; i++) await page.keyboard.press(key);
};
// Moves focus with the real Tab key until `match` is true (at most `max` presses).
async function tabTo(page, match, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(match)) return;
  }
  throw new Error(`Tab never reached the control: ${await focusDesc(page)}`);
}
const reduced = (page) => page.emulateMedia({ reducedMotion: "reduce" });

// A signed-in-less trial session so the access banner and its dialogs exist without a backend.
const fakeSession = (page) =>
  page.route("**/api/session", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        account: { id: "a11y", kind: "anonymous", locale: "en" },
        entitlement: { state: "anonymous_trial", endsAt: new Date(Date.now() + 5 * 86400000).toISOString() },
        serverTime: new Date().toISOString(),
        public: {},
      }),
    }),
  );

suite("a11y", [
  {
    name: "page: lang, title, landmarks, one h1, canvas named, no unnamed controls, no double live regions",
    projects: ["desktop", "iphone13"],
    fn: async ({ page }) => {
      await openApp(page);
      assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
      await loadSample(page);
      assert.match(await page.title(), /^Sample building - Argus/, "title names the open model");
      const r = await page.evaluate(() => {
        const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
        const name = (el) => (el.getAttribute("aria-label") || (el.labels && [...el.labels].map((l) => l.textContent).join("")) || el.textContent || el.title || "").trim();
        return {
          main: document.querySelectorAll("main").length,
          header: document.querySelectorAll("header").length,
          asides: [...document.querySelectorAll("aside")].map((a) => a.getAttribute("aria-label")),
          h1: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim()),
          canvas: [...document.querySelectorAll("canvas")].map((c) => [c.getAttribute("role"), c.getAttribute("aria-label"), !!document.getElementById(c.getAttribute("aria-describedby") || "x")]),
          unnamed: [...document.querySelectorAll("button, a[href], input, select, textarea, [role=button], [role=tab], [role=menuitem]")].filter(vis).filter((e) => !name(e)).map((e) => e.outerHTML.slice(0, 90)),
          double: [...document.querySelectorAll("[role=status][aria-live], [role=alert][aria-live]")].map((e) => e.className),
        };
      });
      assert.equal(r.main, 1, "one main landmark");
      assert.equal(r.header, 1);
      assert.ok(r.asides.every(Boolean), `every aside is labelled: ${r.asides}`);
      assert.deepEqual(r.h1, ["Sample building"], "one h1 naming the model");
      assert.deepEqual(r.canvas[0], ["img", "3D model view", true], "canvas has a name and a described-by note");
      assert.deepEqual(r.unnamed, [], "controls without an accessible name");
      assert.deepEqual(r.double, [], "role=status/alert must not also set aria-live");
    },
  },
  {
    name: "keyboard: skip link is the first stop and moves into the viewer",
    projects: desktop,
    fn: async ({ page }) => {
      await openApp(page);
      await page.keyboard.press("Tab");
      assert.equal(await focusDesc(page), "a|Skip to the viewer");
      const box = await page.locator(".skip-link").boundingBox();
      assert.ok(box && box.y >= 0 && box.x >= 0, "skip link is on screen when focused");
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "viewer");
      assert.equal(new URL(page.url()).hash, "", "skip link does not change the URL");
      await page.keyboard.press("Tab");
      assert.ok(await page.evaluate(() => !!document.activeElement?.closest("main")), "next Tab is inside the viewer region");
    },
  },
  {
    name: "keyboard: open sample, select by search and by structure tree, focus never falls to the page",
    projects: desktop,
    fn: async ({ page }) => {
      await openApp(page);
      await tabTo(page, () => document.activeElement?.textContent.trim() === "or try a sample building");
      await page.keyboard.press("Enter");
      await page.locator(".loading-overlay").waitFor({ state: "detached", timeout: 60000 }).catch(() => {});
      await page.waitForSelector(".toolbar", { state: "visible" });
      await settle(page, 1200);
      assert.ok(!(await isBody(page)), `focus lost after the model opened: ${await focusDesc(page)}`);
      // search: type, ArrowDown, Enter selects and zooms
      const search = page.getByRole("combobox", { name: "Search elements" });
      await search.focus();
      await page.keyboard.type("north wall");
      await page.getByRole("button", { name: "Individual items" }).click();
      await search.focus();
      await press(page, "ArrowDown");
      await press(page, "Enter");
      await page.getByText("Hide this element").waitFor({ timeout: 10000 });
      assert.ok(!(await isBody(page)), "focus stays in the search field after selecting");
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "combobox");
      // structure tree: arrows walk the rows (Right opens a node), Enter on an element selects it
      await press(page, "Escape");
      const tree = page.getByRole("tree", { name: "Model structure" });
      await tree.locator("[role=treeitem][tabindex='0']").focus();
      let onElement = false;
      for (let i = 0; i < 60 && !onElement; i++) {
        onElement = await page.evaluate(() => document.activeElement?.classList.contains("mt-row--element"));
        if (!onElement) {
          await press(page, "ArrowRight");
          await press(page, "ArrowDown");
        }
      }
      assert.ok(onElement, "arrow keys reach an element row");
      await press(page, "Enter");
      await page.getByText("Hide this element").waitFor({ timeout: 10000 });
      assert.equal(await tree.locator("[aria-selected=true]").count(), 1, "the row is marked selected");
    },
  },
  {
    name: "tabs: tablist/tab/tabpanel, roving tabindex, arrow keys, Home/End",
    projects: desktop,
    fn: async ({ page }) => {
      await openApp(page);
      await loadSample(page);
      const tabs = page.getByRole("tab");
      assert.equal(await tabs.count(), 3);
      assert.equal(await page.getByRole("tablist").count(), 1);
      const state = () => page.evaluate(() => [...document.querySelectorAll("[role=tab]")].map((t) => `${t.getAttribute("aria-selected")}/${t.tabIndex}`).join(" "));
      assert.equal(await state(), "true/0 false/-1 false/-1");
      const panel = page.getByRole("tabpanel");
      assert.equal(await panel.getAttribute("aria-labelledby"), "rp-tab-info");
      assert.equal(await tabs.first().getAttribute("aria-controls"), await panel.getAttribute("id"));
      await tabs.first().focus();
      await press(page, "ArrowRight");
      await page.waitForFunction(() => document.activeElement?.id === "rp-tab-measurements");
      assert.equal(await state(), "false/-1 true/0 false/-1");
      assert.equal(await panel.getAttribute("aria-labelledby"), "rp-tab-measurements");
      await press(page, "End");
      await page.waitForFunction(() => document.activeElement?.id === "rp-tab-dimensions");
      await press(page, "ArrowRight"); // wraps
      await page.waitForFunction(() => document.activeElement?.id === "rp-tab-info");
      await press(page, "ArrowLeft");
      await page.waitForFunction(() => document.activeElement?.id === "rp-tab-dimensions");
      await press(page, "Home");
      await page.waitForFunction(() => document.activeElement?.id === "rp-tab-info");
      // Tab leaves the tablist in one stroke (only the selected tab is a stop)
      await press(page, "Tab");
      assert.ok(await page.evaluate(() => !document.activeElement?.closest("[role=tablist]")), "Tab moves past the tab strip");
    },
  },
  {
    name: "popovers and menus: Esc closes and returns focus; the share menu is arrow-key navigable",
    projects: desktop,
    fn: async ({ page }) => {
      await reduced(page);
      await openApp(page);
      await loadSample(page);
      // help
      const help = page.getByRole("button", { name: "Keyboard shortcuts" });
      await help.focus();
      await press(page, "Enter");
      assert.equal(await help.getAttribute("aria-expanded"), "true");
      await press(page, "Escape");
      await page.waitForFunction(() => !document.querySelector(".shortcuts-help__popover"));
      assert.equal(await help.getAttribute("aria-expanded"), "false");
      assert.equal(await focusDesc(page), "button|Keyboard shortcuts");
      // views panel: Tab into it, Esc, focus is back on the opener
      const views = page.getByRole("button", { name: "Views and levels" });
      await views.focus();
      await press(page, "Enter");
      await page.getByRole("dialog", { name: "Views and levels" }).waitFor();
      assert.ok(await page.evaluate(() => !!document.activeElement?.closest(".view-tools__panel")), "focus moves into the views dialog");
      await press(page, "Escape");
      await page.waitForFunction(() => !document.querySelector(".view-tools__panel"));
      assert.equal(await focusDesc(page), "button|Views and levels");
      // share menu
      const share = page.getByRole("button", { name: "Save image or copy view link" });
      await share.focus();
      await press(page, "Enter");
      await page.getByRole("menu", { name: "Save and share" }).waitFor();
      assert.match(await focusDesc(page), /^button\|Save snapshot to case/, "focus enters the menu on the first item");
      await press(page, "ArrowDown");
      assert.match(await focusDesc(page), /Download image/);
      await press(page, "End");
      assert.match(await focusDesc(page), /Open Cases/);
      await press(page, "ArrowDown"); // wraps
      assert.match(await focusDesc(page), /Save snapshot to case/);
      await press(page, "Escape");
      await page.waitForFunction(() => !document.querySelector(".view-tools__panel"));
      assert.equal(await focusDesc(page), "button|Save image or copy view link");
      // library More actions: Esc folds it away and focus stays on the More button
      const more = page.getByRole("button", { name: /^More actions for AC20/ });
      if (await more.count()) {
        await more.focus();
        await press(page, "Enter");
        assert.equal(await more.getAttribute("aria-expanded"), "true");
        await press(page, "Tab");
        await press(page, "Escape");
        assert.equal(await more.getAttribute("aria-expanded"), "false");
        assert.ok(await more.evaluate((el) => el === document.activeElement), "focus returns to More");
      }
    },
  },
  {
    name: "context menu: focus enters on open, arrows move, Esc closes",
    projects: desktop,
    fn: async ({ page }) => {
      await openApp(page);
      await loadSample(page);
      const b = await page.locator("canvas").first().boundingBox();
      await page.mouse.click(b.x + b.width * 0.45, b.y + b.height * 0.5);
      await page.mouse.click(b.x + b.width * 0.45, b.y + b.height * 0.5, { button: "right" });
      const menu = page.getByRole("menu", { name: "Element actions" });
      await menu.waitFor({ timeout: 5000 });
      assert.match(await focusDesc(page), /Zoom to element/);
      await press(page, "ArrowDown");
      assert.match(await focusDesc(page), /Isolate element/);
      await press(page, "ArrowUp");
      await press(page, "ArrowUp");
      assert.match(await focusDesc(page), /Copy GUID/, "wraps to the last item");
      await press(page, "Escape");
      await menu.waitFor({ state: "detached", timeout: 3000 });
    },
  },
  {
    name: "dialogs: replace confirm traps focus, Esc cancels, focus returns to the opener",
    projects: desktop,
    fn: async ({ page }) => {
      await reduced(page);
      await openApp(page);
      await loadFile(page, DEMO_FILE);
      const opener = page.getByRole("button", { name: "Add another model" }).first();
      await page.waitForFunction(() => !document.querySelector(".sidebar__add-button")?.disabled);
      await settle(page, 2000); // the viewer is still busy for a moment after the model shows; an earlier Enter can be lost
      await opener.focus();
      assert.equal(await focusDesc(page), "button|Add another model");
      const chooser = page.waitForEvent("filechooser");
      await press(page, "Enter");
      await (await chooser).setFiles(DEMO_FILE);
      const dialog = page.getByRole("dialog", { name: "Replace existing model?" });
      await dialog.waitFor({ timeout: 10000 });
      assert.equal(await dialog.getAttribute("aria-modal"), "true");
      assert.ok(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]")), "focus moved into the dialog");
      for (let i = 0; i < 5; i++) {
        await press(page, "Tab");
        assert.ok(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]")), "Tab stays in the dialog");
      }
      await press(page, "Shift+Tab");
      assert.ok(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]")));
      await press(page, "Escape");
      await dialog.waitFor({ state: "detached", timeout: 3000 });
      await page.waitForFunction(() => document.activeElement?.classList.contains("sidebar__add-button"), null, { timeout: 3000 }).catch(() => {});
      assert.equal(await focusDesc(page), "button|Add another model", "focus returns to the opener");
    },
  },
  {
    name: "access dialog (mocked trial session): initial focus, trap, Esc, focus returns to the opener",
    projects: desktop,
    allowErrors: [/Failed to load resource/, /api\//],
    fn: async ({ page }) => {
      await reduced(page);
      await fakeSession(page);
      await openApp(page);
      const banner = page.getByTestId("acc-banner");
      await banner.waitFor({ timeout: 10000 });
      assert.equal(await banner.getAttribute("role"), "status");
      const opener = banner.getByRole("button", { name: /code/i });
      await opener.focus();
      await press(page, "Enter");
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      assert.equal(await dialog.getAttribute("aria-modal"), "true");
      assert.ok(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]")), "initial focus inside");
      assert.equal(await page.evaluate(() => document.activeElement?.tagName), "INPUT", "initial focus is the code field");
      for (let i = 0; i < 6; i++) {
        await press(page, "Tab");
        assert.ok(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]")), "Tab stays inside");
      }
      await press(page, "Escape");
      await dialog.waitFor({ state: "detached", timeout: 3000 });
      assert.equal(await page.evaluate((t) => document.activeElement?.textContent === t, await opener.textContent()), true, "focus returns to the opener");
    },
  },
  {
    name: "focus ring: 2px or more, contrast 3:1 against what is behind it, on every kind of control",
    projects: ["desktop", "iphone13"],
    allowErrors: [/Failed to load resource/, /Could not|not an/],
    fn: async ({ page }) => {
      await reduced(page);
      await openApp(page);
      await settle(page, 600);
      await loadSample(page);
      await page.getByRole("combobox", { name: "Search elements" }).fill("wall");
      await settle(page, 600);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Toggle measure mode" }).click();
      await setFile(page, fx("not-ifc.txt"));
      await waitForBanner(page, /not an \.ifc/, 15000);
      await page.keyboard.press("Shift"); // keyboard modality: programmatic focus then matches :focus-visible
      const rows = await page.evaluate(async () => {
        const out = [];
        const seen = new Set();
        const sel = "button, input, select, [role=tab], [role=treeitem], [role=separator][tabindex], a[href], summary";
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2 || getComputedStyle(el).visibility === "hidden" || el.closest("[inert],[hidden]") || el.tabIndex < -1 || el.disabled || el.matches(".skip-link")) continue;
          const key = el.tagName + "." + (el.className || "").toString().split(" ")[0] + "." + (el.getAttribute("type") || "");
          if (seen.has(key)) continue;
          seen.add(key);
          el.focus({ focusVisible: true });
          await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
          const cs = getComputedStyle(el);
          const chain = [];
          for (let p = el.parentElement; p; p = p.parentElement) chain.push(getComputedStyle(p).backgroundColor);
          out.push({ key, label: el.getAttribute("aria-label") || el.textContent.trim().slice(0, 20), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), color: cs.outlineColor, shadow: cs.boxShadow !== "none", chain });
        }
        return out;
      });
      assert.ok(rows.length > 10, `sampled ${rows.length} control kinds`);
      const bad = [];
      for (const r of rows) {
        const bg = flatten(r.chain);
        const c = parseColor(r.color);
        const ok = r.style !== "none" && r.width >= 2 && c && c.a > 0.99 && ratio(c, bg) >= 3;
        if (!ok) bad.push(`${r.key} "${r.label}" ${r.style} ${r.width}px ${r.color} ratio ${c ? ratio(c, bg).toFixed(2) : "?"}`);
      }
      assert.deepEqual(bad, [], "controls with a weak or missing focus ring");
    },
  },
  {
    name: "contrast: text in every state meets 4.5:1 (3:1 for large text and disabled controls)",
    projects: ["desktop", "iphone13"],
    allowErrors: [/Failed to load resource/],
    timeout: 120000,
    fn: async ({ page, phone }) => {
      await reduced(page);
      const fails = [];
      const scan = async (label) => {
        await settle(page, 350);
        for (const r of rate(await page.evaluate(collectText))) {
          const need = r.disabled ? Math.min(r.need, 3) : r.need;
          if (r.ratio < need) fails.push(`${label}: ${r.ratio.toFixed(2)} < ${need} "${r.text}" (${r.size}px) ${r.where}`);
        }
      };
      await openApp(page);
      await settle(page, 700);
      await scan("empty");
      await loadSample(page);
      await settle(page, 800);
      await scan("loaded");
      if (!phone) {
        await page.getByRole("combobox", { name: "Search elements" }).fill("wall");
        await scan("search");
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Toggle measure mode" }).click();
        await scan("measure armed");
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
        await scan("shortcuts");
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Views and levels" }).click();
        await scan("views");
        await page.keyboard.press("Escape");
        await page.locator(".element-panel__tab").nth(1).click();
        await scan("measurements tab");
        await page.getByRole("button", { name: /^More actions for AC20/ }).click();
        await scan("library actions");
        // a hover tooltip (hotkey chip)
        await page.getByRole("button", { name: "Toggle tag tool" }).hover();
        await scan("tooltip");
      }
      await setFile(page, fx("not-ifc.txt"));
      await waitForBanner(page, /not an \.ifc/, 15000);
      await scan("error banner");
      assert.deepEqual(fails, [], "low-contrast text");
    },
  },
  {
    name: "forced colours: the focus ring is a system colour and the armed tool keeps a border",
    projects: desktop,
    fn: async ({ page }) => {
      await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
      await openApp(page);
      await loadSample(page);
      const measure = page.getByRole("button", { name: "Toggle measure mode" });
      await measure.click();
      const r = await measure.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { border: cs.borderTopWidth, style: cs.borderTopStyle };
      });
      assert.equal(r.border, "2px");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Home: fit the whole model in view" }).focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      const o = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { s: cs.outlineStyle, w: parseFloat(cs.outlineWidth) }; });
      assert.ok(o.s !== "none" && o.w >= 2, `outline ${o.s} ${o.w}`);
    },
  },
  {
    name: "reflow: no horizontal scroll or off-screen controls at 200% (1280 -> 640) and 400% (1280 -> 320) zoom",
    projects: desktop,
    allowErrors: [/Failed to load resource/, /Could not|not an/],
    timeout: 150000,
    fn: async ({ page }) => {
      await reduced(page);
      const offscreen = () =>
        page.evaluate(() => {
          const W = innerWidth;
          const out = [];
          for (const el of document.querySelectorAll("button, input, select, a[href], [role=dialog], .status-banner, .toast, .toolbar, .tool-hint, .acc-banner, .first-run, .models-sheet")) {
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2 || getComputedStyle(el).visibility === "hidden" || el.closest("[inert],[hidden]")) continue;
            if (r.right > W + 1 || r.left < -1) out.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]} ${Math.round(r.left)}..${Math.round(r.right)}`);
          }
          return { scroll: document.documentElement.scrollWidth, W, out };
        });
      for (const [w, h] of [[640, 400], [320, 568]]) {
        await page.setViewportSize({ width: w, height: h });
        await openApp(page);
        await settle(page, 400);
        let o = await offscreen();
        assert.deepEqual(o.out, [], `${w}px empty state`);
        assert.ok(o.scroll <= w, `${w}px: page scrolls sideways (${o.scroll})`);
        // the empty state must not be covered by the details panel (it has nothing to show yet)
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".element-panel")).display), "none", `${w}px: details panel hidden with no model`);
        await loadSample(page);
        await settle(page, 600);
        o = await offscreen();
        assert.deepEqual(o.out, [], `${w}px with a model`);
        await page.getByRole("button", { name: "Keyboard shortcuts" }).click().catch(() => {});
        await settle(page, 300);
        o = await offscreen();
        assert.deepEqual(o.out, [], `${w}px shortcuts popover`);
        await page.keyboard.press("Escape");
        await setFile(page, fx("not-ifc.txt"));
        await waitForBanner(page, /not an \.ifc/, 15000);
        o = await offscreen();
        assert.deepEqual(o.out, [], `${w}px error banner`);
        assert.ok(o.scroll <= w);
      }
    },
  },
  {
    name: "zoom-limit toast is announced once through a single status region",
    projects: desktop,
    fn: async ({ page }) => {
      await openApp(page);
      await loadSample(page);
      await page.evaluate(() => {
        window.__n = 0;
        new MutationObserver((l) => l.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && n.matches?.(".toast") && window.__n++))).observe(document.body, { childList: true, subtree: true });
      });
      await page.locator("canvas").first().hover();
      await press(page, "+", 40);
      await settle(page, 500);
      const info = await page.evaluate(() => ({ toasts: window.__n, regions: [...document.querySelectorAll(".toast")].map((t) => [t.getAttribute("role"), t.getAttribute("aria-live")]) }));
      assert.ok(info.toasts <= 1, `toast element created ${info.toasts} times`);
      for (const [role, live] of info.regions) assert.deepEqual([role, live], ["status", null]);
    },
  },
]);

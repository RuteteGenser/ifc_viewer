// Annotation layer e2e. Needs a build made with VITE_TEST_HOOK=1 (window.__annotations); the viewer is a
// mock with a fixed camera, so every tool is driven with real pointer events and checked against the data.
//   ARGUS_URL=http://localhost:<port> [ARGUS_PROJECTS=desktop,iphone13] node tests/e2e/annotations.e2e.mjs
import { mkdirSync } from "node:fs";
import { suite, openApp, isTouch, OUT } from "./lib.mjs";

const SHOTS = process.env.ARGUS_SHOTS || `${OUT}/annotations`;
mkdirSync(SHOTS, { recursive: true });
const P = ["desktop", "iphone13"];

// Mock viewer: world [x,y,z] -> px = centre + (x + cam.x) * 100, y flipped. Picks land on z = 0, except in the
// left 30 px strip (a miss). `occ` decides occlusion; z >= 50 counts as behind the camera.
async function setup(page, annotations = []) {
  await openApp(page);
  await page.waitForFunction(() => !!window.__annotations, null, { timeout: 15000 });
  await page.evaluate((initial) => {
    const el = document.createElement("div");
    el.id = "ann-host";
    el.style.cssText = "position:fixed;left:0;right:0;bottom:0;top:var(--header-height,52px);pointer-events:none;z-index:15";
    document.body.append(el);
    // The mock camera looks at a 6 m x 3 m wall; drawn behind the marks (the real canvas stays empty).
    const st = document.createElement("style");
    st.textContent = ".empty-state{display:none!important} #ann-host::before{content:'';position:absolute;left:calc(50% - 300px);top:calc(50% - 150px);width:600px;height:300px;background:repeating-linear-gradient(0deg,#d8cdb8 0 1px,transparent 1px 50px),repeating-linear-gradient(90deg,#d8cdb8 0 1px,transparent 1px 50px),#e9dfcc;border:2px solid #a89674}";
    document.head.append(st);
    const m = (window.__mock = { cam: { x: 0 }, occ: () => false, subs: new Set(), picks: [], downs: 0 });
    const R = () => el.getBoundingClientRect();
    const viewer = {
      project(p) {
        const r = R(), x = r.width / 2 + (p[0] + m.cam.x) * 100, y = r.height / 2 - p[1] * 100;
        return { x, y, visible: p[2] < 50 && x >= 0 && y >= 0 && x <= r.width && y <= r.height, depth: p[2] };
      },
      async pick(cx, cy) {
        const r = R();
        m.picks.push([cx, cy]);
        if (cx - r.left < 30) return null;
        return { point: [(cx - r.left - r.width / 2) / 100 - m.cam.x, -(cy - r.top - r.height / 2) / 100, 0], guid: "GUID-1", storey: "Level 1" };
      },
      unprojectOnPlane(cx, cy, pt) { const r = R(); return [(cx - r.left - r.width / 2) / 100 - m.cam.x, -(cy - r.top - r.height / 2) / 100, pt[2]]; },
      isOccluded: (p) => m.occ(p),
      subscribeCamera(cb) { m.subs.add(cb); return () => m.subs.delete(cb); },
      getSize() { const r = R(); return { width: r.width, height: r.height }; },
    };
    m.setCam = (x) => { m.cam.x = x; m.subs.forEach((f) => f()); };
    document.addEventListener("pointerdown", (e) => { if (e.target.tagName === "CANVAS") m.downs++; }, true);
    window.__ctl = window.__annotations.mountAnnotationLayer(el, viewer, { annotations: initial });
  }, annotations);
  await page.waitForSelector("[data-testid=ann-layer]");
}
const anns = (page) => page.evaluate(() => window.__ctl.getAnnotations());
const frameWait = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const view = (page) => page.evaluate(() => { const r = document.getElementById("ann-host").getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, t: r.top }; });
const at = async (page, fx, fy) => { const v = await view(page); return [v.l + v.w * fx, v.t + v.h * fy]; }; // client px
const shot = async (page, name, project) => { await page.waitForTimeout(350); return page.screenshot({ path: `${SHOTS}/${name}-${project}.png` }); };

async function tap(page, touch, [x, y]) { if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); }
async function drag(page, touch, pts) {
  if (!touch) {
    await page.mouse.move(...pts[0]); await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(...p);
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const tp = ([x, y]) => [{ x, y, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: tp(pts[0]) });
  for (const p of pts.slice(1)) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: tp(p) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}
const arm = (page, label) => page.locator(".ann-dock").getByRole("button", { name: new RegExp(`^${label}`) }).click();
async function placeText(page, touch, tool, label, frac, text) {
  const btn = page.locator(".ann-dock").getByRole("button", { name: new RegExp(`^${label}`) });
  if ((await btn.getAttribute("aria-pressed")) !== "true") await btn.click(); // a tool stays armed after placing
  await tap(page, touch, await at(page, ...frac));
  const ed = page.locator(".ann-editor");
  await ed.waitFor();
  if (text) await ed.locator("textarea").fill(text);
  await ed.getByRole("button", { name: "Save" }).click();
  await ed.waitFor({ state: "detached" });
}
const line = (a, b, n = 12) => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);

suite("annotations", [
  { name: "comment: tap places it, text persists, badges count up", projects: P, fn: async ({ page, touch, project }) => {
    await setup(page);
    await placeText(page, touch, "comment", "Comment", [0.35, 0.4], "Crack in the slab");
    let a = await anns(page);
    if (a.length !== 1 || a[0].type !== "comment" || a[0].text !== "Crack in the slab") throw new Error(`bad: ${JSON.stringify(a)}`);
    if (a[0].anchor.guid !== "GUID-1" || a[0].anchor.storey !== "Level 1" || a[0].anchor.point.length !== 3) throw new Error("anchor not from pick");
    await placeText(page, touch, "comment", "Comment", [0.6, 0.55], "Second one");
    await frameWait(page);
    const badges = await page.locator(".ann-badge").allInnerTexts();
    if (badges.join() !== "1,2") throw new Error(`badges ${badges}`);
    await tap(page, touch, await at(page, 0.35, 0.4)); // armed still: tap on a handle selects it
    await shot(page, "comment", project);
    a = await anns(page);
    if (a.length !== 2) throw new Error("tapping a handle must not add");
  } },
  { name: "comment: a miss says so, empty text cannot be saved, Esc cancels the editor", projects: P, fn: async ({ page, touch }) => {
    await setup(page);
    await arm(page, "Comment");
    await tap(page, touch, [10, 300]);
    await page.getByText("Nothing there").waitFor();
    await tap(page, touch, await at(page, 0.5, 0.4));
    const ed = page.locator(".ann-editor");
    if (!(await ed.getByRole("button", { name: "Save" }).isDisabled())) throw new Error("empty comment saveable");
    await ed.locator("textarea").fill("x".repeat(2100));
    if ((await ed.locator("textarea").inputValue()).length !== 2000) throw new Error("2000 char cap missing");
    await ed.locator("textarea").press("Escape");
    await ed.waitFor({ state: "detached" });
    if ((await anns(page)).length) throw new Error("cancel created one");
  } },
  { name: "pin: icon at the anchor, text optional", projects: P, fn: async ({ page, touch, project }) => {
    await setup(page);
    await placeText(page, touch, "pin", "Pin", [0.5, 0.4], "");
    const a = await anns(page);
    if (a.length !== 1 || a[0].type !== "pin" || a[0].text !== "") throw new Error(JSON.stringify(a));
    await frameWait(page);
    if (!(await page.locator(".ann-pin svg").isVisible())) throw new Error("no pin icon");
    await shot(page, "pin", project);
  } },
  { name: "text: plain label without a card", projects: P, fn: async ({ page, touch, project }) => {
    await setup(page);
    await placeText(page, touch, "text", "Text", [0.45, 0.45], "Fire door");
    const a = await anns(page);
    if (a[0]?.type !== "text" || a[0].text !== "Fire door") throw new Error(JSON.stringify(a));
    await frameWait(page);
    if (await page.locator(".ann-card").count()) throw new Error("text must not render a card");
    if ((await page.locator(".ann-label").innerText()) !== "Fire door") throw new Error("label missing");
    await shot(page, "text", project);
  } },
  { name: "arrow: start/end recorded, rubber band shows, short drags are ignored, off-model end uses the plane", projects: P, fn: async ({ page, touch, project }) => {
    await setup(page);
    await arm(page, "Arrow");
    const s = await at(page, 0.3, 0.4), e = await at(page, 0.7, 0.55);
    await drag(page, touch, line(s, e, 6));
    await frameWait(page);
    let a = await anns(page);
    if (a.length !== 1 || a[0].type !== "arrow") throw new Error(JSON.stringify(a));
    const v = await view(page);
    const want = (p) => [(p[0] - v.l - v.w / 2) / 100, -(p[1] - v.t - v.h / 2) / 100];
    const near = (got, w) => Math.abs(got[0] - w[0]) < 0.03 && Math.abs(got[1] - w[1]) < 0.03;
    if (!near(a[0].anchor.point, want(s)) || !near(a[0].target.point, want(e))) throw new Error(`points ${JSON.stringify(a[0].anchor.point)} ${JSON.stringify(a[0].target.point)}`);
    const d = await page.locator(".ann-shape--arrow .ann-stroke").getAttribute("d");
    const h = await page.locator(".ann-shape--arrow .ann-head").getAttribute("d");
    if (!/^M[\d. -]+L[\d. -]+$/.test(d) || !/Z$/.test(h)) throw new Error(`path ${d} / ${h}`);
    await shot(page, "arrow", project);
    // too short
    await drag(page, touch, line(await at(page, 0.5, 0.2), [(await at(page, 0.5, 0.2))[0] + 10, (await at(page, 0.5, 0.2))[1]], 3));
    await page.getByText("Drag a little further").waitFor();
    // end off the model (left strip): plane point at the start's z
    await drag(page, touch, line(await at(page, 0.6, 0.7), [12, (await at(page, 0.6, 0.7))[1]], 6));
    await frameWait(page);
    a = await anns(page);
    if (a.length !== 2 || a[1].target.guid !== null || a[1].target.point[2] !== 0) throw new Error(JSON.stringify(a[1]));
  } },
  { name: "freehand: sampled, simplified to <= 200 points, 3D points", projects: P, fn: async ({ page, touch, project }) => {
    await setup(page);
    await arm(page, "Draw");
    const [x0, y0] = await at(page, 0.2, 0.45);
    const raw = Array.from({ length: 400 }, (_, i) => [x0 + i * 0.6, y0 + Math.sin(i / 14) * 40 + (i % 2)]);
    await drag(page, touch, raw);
    await frameWait(page);
    const a = await anns(page);
    if (a.length !== 1 || a[0].type !== "freehand") throw new Error(JSON.stringify(a).slice(0, 300));
    const n = a[0].path.length;
    if (n < 5 || n > 200 || n >= raw.length) throw new Error(`path has ${n} points`);
    if (!a[0].path.every((p) => p.length === 3 && p.every(Number.isFinite))) throw new Error("bad points");
    if ((await page.locator(".ann-shape--freehand .ann-stroke").getAttribute("d")).length < 20) throw new Error("no path drawn");
    if ((await page.locator(".ann-shape--freehand .ann-stroke").evaluate((e) => getComputedStyle(e).strokeLinecap)) !== "round") throw new Error("caps not round");
    await shot(page, "freehand", project);
  } },
  { name: "colour: palette sets the next mark, action bar recolours a selected one", projects: P, fn: async ({ page, touch, project }) => {
    await setup(page);
    await page.getByRole("button", { name: "Colour", exact: true }).click();
    await page.getByRole("group", { name: "Annotation colour" }).getByRole("button", { name: "Colour #1971c2" }).click();
    await placeText(page, touch, "pin", "Pin", [0.4, 0.4], "blue");
    if ((await anns(page))[0].color !== "#1971c2") throw new Error("palette colour not used");
    await frameWait(page);
    await page.locator(".ann-handle").click();
    const bar = page.getByRole("toolbar", { name: "Annotation actions" });
    await bar.waitFor();
    await shot(page, "actionbar", project);
    await bar.getByRole("button", { name: "Colour #2f9e44" }).click();
    if ((await anns(page))[0].color !== "#2f9e44") throw new Error("recolour failed");
    await bar.getByRole("button", { name: "Edit" }).click();
    const ed = page.locator(".ann-editor");
    await ed.locator("textarea").fill("green now");
    await ed.getByRole("button", { name: "Save" }).click();
    if ((await anns(page))[0].text !== "green now") throw new Error("edit failed");
  } },
  { name: "undo, redo and delete (buttons)", projects: P, fn: async ({ page, touch }) => {
    await setup(page);
    await placeText(page, touch, "pin", "Pin", [0.4, 0.4], "a");
    await placeText(page, touch, "pin", "Pin", [0.6, 0.4], "b");
    await page.getByRole("button", { name: "Undo" }).click();
    if ((await anns(page)).length !== 1) throw new Error("undo");
    await page.getByRole("button", { name: "Redo" }).click();
    if ((await anns(page)).length !== 2) throw new Error("redo");
    await frameWait(page);
    await page.locator("[data-ann]", { has: page.locator(".ann-pin") }).first().locator(".ann-handle").click();
    await page.getByRole("button", { name: "Delete selected" }).click();
    const a = await anns(page);
    if (a.length !== 1 || a[0].text !== "b") throw new Error(JSON.stringify(a));
    await page.getByRole("button", { name: "Undo" }).click();
    if ((await anns(page)).length !== 2) throw new Error("undo of delete");
  } },
  { name: "occluded fades to 25 percent with dashed style; off-screen and behind-camera are hidden", projects: P, fn: async ({ page, touch, project }) => {
    await setup(page);
    await placeText(page, touch, "comment", "Comment", [0.35, 0.4], "front");
    await placeText(page, touch, "comment", "Comment", [0.65, 0.4], "behind wall");
    await arm(page, "Arrow");
    await drag(page, touch, line(await at(page, 0.3, 0.6), await at(page, 0.7, 0.6), 5));
    await frameWait(page);
    await page.evaluate(() => { window.__mock.occ = (p) => p[0] > 0.2; window.__mock.setCam(0); });
    await frameWait(page);
    const items = page.locator(".ann-item--comment");
    const o1 = await items.nth(0).evaluate((e) => getComputedStyle(e).opacity), o2 = await items.nth(1).evaluate((e) => getComputedStyle(e).opacity);
    if (o1 !== "1" || o2 !== "0.25") throw new Error(`opacity ${o1} / ${o2} `);
    if ((await items.nth(1).locator(".ann-badge").evaluate((e) => getComputedStyle(e).borderStyle)) !== "dashed") throw new Error("not dashed");
    const arrowOcc = await page.locator(".ann-shape--arrow").evaluate((e) => [e.dataset.occ, getComputedStyle(e).opacity, getComputedStyle(e.querySelector(".ann-stroke")).strokeDasharray]);
    if (arrowOcc[1] !== "1" && arrowOcc[0] === "1") throw new Error(`arrow ${arrowOcc}`); // one end visible: not faded
    await shot(page, "occluded", project);
    await page.evaluate(() => { window.__mock.occ = () => true; window.__mock.setCam(0); });
    await frameWait(page);
    const faded = await page.locator(".ann-shape--arrow").evaluate((e) => [getComputedStyle(e).opacity, getComputedStyle(e.querySelector(".ann-stroke")).strokeDasharray]);
    if (faded[0] !== "0.25" || faded[1] === "none") throw new Error(`arrow faded ${faded}`);
    await page.evaluate(() => { window.__mock.occ = () => false; window.__mock.setCam(-100); });
    await frameWait(page);
    for (const el of await page.locator("[data-ann]").all()) if ((await el.evaluate((e) => getComputedStyle(e).visibility === "hidden" || getComputedStyle(e).display === "none" ? "none" : "shown")) !== "none") throw new Error("off-screen annotation visible");
    await page.evaluate(() => window.__mock.setCam(0));
    await frameWait(page);
    if ((await items.nth(0).evaluate((e) => getComputedStyle(e).visibility)) === "hidden") throw new Error("did not come back");
  } },
  { name: "camera change re-projects within one frame, one rAF per change", projects: P, fn: async ({ page, touch }) => {
    await setup(page);
    await placeText(page, touch, "pin", "Pin", [0.5, 0.4], "p");
    await frameWait(page);
    const r = await page.evaluate(async () => {
      const el = document.querySelector(".ann-item--pin");
      const x0 = el.getBoundingClientRect().left;
      let calls = 0;
      const orig = window.requestAnimationFrame;
      window.requestAnimationFrame = (f) => { calls++; return orig(f); };
      for (let i = 0; i < 5; i++) window.__mock.setCam(0.1 * (i + 1)); // five changes, one frame
      const scheduled = calls;
      await new Promise((res) => orig(res));
      window.requestAnimationFrame = orig;
      return { dx: el.getBoundingClientRect().left - x0, scheduled };
    });
    if (Math.abs(r.dx - 50) > 1.5 || r.scheduled !== 1) throw new Error(JSON.stringify(r));
  } },
  { name: "armed tool captures the pointer, unarmed lets the canvas orbit", projects: P, fn: async ({ page, touch }) => {
    await setup(page);
    const c = await at(page, 0.5, 0.4);
    const topAt = () => page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e.closest(".ann-layer") ? e.className : e.tagName; }, c);
    const unarmed = await topAt();
    if (unarmed !== "CANVAS") throw new Error(`unarmed hit ${unarmed}`);
    await arm(page, "Arrow");
    if (!(await topAt()).includes("ann-capture")) throw new Error("armed does not capture");
    if ((await page.locator(".ann-capture").evaluate((e) => getComputedStyle(e).touchAction)) !== "none") throw new Error("touch-action");
    const before = await page.evaluate(() => window.__mock.downs);
    await drag(page, touch, line(c, [c[0] + 80, c[1]], 4));
    if ((await page.evaluate(() => window.__mock.downs)) !== before) throw new Error("canvas received the armed drag");
    await page.getByRole("button", { name: "Done" }).click();
    const free = [c[0], c[1] + 150]; // away from the new arrow's handle
    await drag(page, touch, line(free, [free[0] + 80, free[1]], 4));
    if ((await page.evaluate(() => window.__mock.downs)) <= before) throw new Error("canvas did not get the unarmed drag");
  } },
  { name: "keyboard: C P A T F arm, Esc cancels, Delete removes, Ctrl+Z undoes", projects: ["desktop"], fn: async ({ page }) => {
    await setup(page);
    const pressed = () => page.locator(".ann-dock [aria-pressed=true]").evaluateAll((l) => l.map((e) => e.getAttribute("aria-label")));
    for (const [k, n] of [["c", "Comment"], ["p", "Pin"], ["a", "Arrow"], ["t", "Text"], ["f", "Draw"]]) {
      await page.keyboard.press(k);
      const p = await pressed();
      if (p.length !== 1 || !p[0].startsWith(n)) throw new Error(`${k} -> ${p}`);
    }
    await page.keyboard.press("Escape");
    if ((await pressed()).length) throw new Error("Esc did not disarm");
    await page.keyboard.press("p");
    await tap(page, false, await at(page, 0.5, 0.4));
    await page.locator(".ann-editor").locator("textarea").fill("typing p c a does not arm tools");
    if ((await pressed())[0].startsWith("Pin") === false) throw new Error("typing changed the tool");
    await page.locator(".ann-editor").getByRole("button", { name: "Save" }).click();
    await page.keyboard.press("Escape");
    await frameWait(page);
    await page.locator(".ann-handle").click();
    await page.keyboard.press("Delete");
    if ((await anns(page)).length) throw new Error("Delete");
    await page.keyboard.press("Control+z");
    if ((await anns(page)).length !== 1) throw new Error("Ctrl+Z");
    await page.keyboard.press("Control+Shift+z");
    if ((await anns(page)).length) throw new Error("Ctrl+Shift+Z");
  } },
  { name: "44px targets, captions on phone, hint pill with Done", projects: P, fn: async ({ page, touch, project }) => {
    await setup(page, [{ id: "01HZZZZZZZZZZZZZZZZZZZZZZZ", type: "comment", color: "#d9480f", text: "seed", author: "", createdAt: new Date().toISOString(), anchor: { point: [0, 0, 0], guid: null, storey: null }, target: null, path: null }]);
    await frameWait(page);
    await page.locator(".ann-handle").click();
    const small = await page.evaluate(() => [...document.querySelectorAll(".ann-tool,.ann-handle,.ann-btn,.ann-swatch")].filter((e) => e.offsetParent).map((e) => [e.className, e.getBoundingClientRect()]).filter(([, r]) => r.width < 43.5 || r.height < 43.5).map(([c, r]) => `${c} ${r.width}x${r.height}`));
    if (small.length) throw new Error(`small targets: ${small}`);
    const cap = await page.locator(".ann-tool__cap").first().isVisible();
    if (cap !== (project === "iphone13")) throw new Error(`caption visible=${cap} on ${project}`);
    await arm(page, "Comment");
    const hint = page.getByRole("status").filter({ hasText: "Tap on the model to place a comment" });
    await hint.waitFor();
    await shot(page, "toolbar-hint", project);
    await hint.getByRole("button", { name: "Done" }).click();
    await hint.waitFor({ state: "detached" });
  } },
  { name: "editor on a phone is a bottom sheet that follows the keyboard (visualViewport)", projects: ["iphone13"], fn: async ({ page, touch }) => {
    await setup(page);
    await arm(page, "Comment");
    await tap(page, touch, await at(page, 0.5, 0.35));
    const ed = page.locator(".ann-editor");
    await ed.waitFor();
    const r = await ed.evaluate((e) => { const b = e.getBoundingClientRect(); return { bottom: b.bottom, h: innerHeight, left: b.left, right: b.right, w: innerWidth }; });
    if (Math.abs(r.bottom - r.h) > 1 || r.left !== 0 || r.right !== r.w) throw new Error(`not a bottom sheet ${JSON.stringify(r)}`);
    await shot(page, "editor-sheet", "iphone13");
    // a keyboard shrinks the visual viewport: emulate by resizing the layout viewport's visual part via CDP
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 400, deviceScaleFactor: 3, mobile: true });
    await page.waitForTimeout(300);
    const b2 = await ed.evaluate((e) => e.getBoundingClientRect().bottom);
    if (b2 > 401) throw new Error(`sheet below the shrunken viewport: ${b2}`);
  } },
  { name: "320 px wide: no horizontal overflow, dock and editor fit", projects: ["iphone13"], context: { viewport: { width: 320, height: 640 } }, fn: async ({ page, touch }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await setup(page);
    const dock = await page.locator(".ann-dock").boundingBox();
    if (dock.x < 0 || dock.x + dock.width > 320) throw new Error(`dock ${JSON.stringify(dock)}`);
    await arm(page, "Comment");
    await tap(page, touch, await at(page, 0.5, 0.35));
    await page.locator(".ann-editor").waitFor();
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth }));
    if (o.sw > 320 || o.bw > 320) throw new Error(`overflow ${JSON.stringify(o)}`);
    await shot(page, "narrow-320", "iphone13");
  } },
  { name: "reduced motion: cards do not animate", projects: P, context: { reducedMotion: "reduce" }, fn: async ({ page, touch }) => {
    await setup(page);
    await placeText(page, touch, "comment", "Comment", [0.5, 0.4], "calm");
    await page.locator(".ann-handle").click();
    await frameWait(page);
    const anim = await page.locator(".ann-card").evaluate((e) => getComputedStyle(e).animationName);
    if (anim !== "none") throw new Error(`animation ${anim}`);
  } },
  { name: "external annotations replace the list and reset undo history", projects: ["desktop"], fn: async ({ page, touch }) => {
    await setup(page);
    await placeText(page, touch, "pin", "Pin", [0.5, 0.4], "x");
    await page.evaluate(() => window.__ctl.setAnnotations([]));
    await frameWait(page);
    if (await page.locator(".ann-item").count()) throw new Error("not replaced");
    if (!(await page.getByRole("button", { name: "Undo" }).isDisabled())) throw new Error("history survived a snapshot switch");
  } },
]);

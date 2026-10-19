// Annotations on the REAL viewer, driven through Cases: annotate a snapshot with every tool, turn the model and check
// the marks follow their 3D points, occlusion, prev/next, reload, PDF and BCF. Needs a VITE_TEST_HOOK=1 build.
//   ARGUS_URL=http://localhost:<port> [ARGUS_PROJECTS=desktop,iphone13] node tests/e2e/annotations-real.e2e.mjs
// Emulated touch (playwright iPhone 13) is not a real phone.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { unzipSync, strFromU8 } from "fflate";
import { suite, openApp, loadSample, requireHook, stableClick, canvasBox, isTouch, OUT } from "./lib.mjs";

const SHOTS = process.env.ARGUS_SHOTS || `${OUT}/annotations-real`;
mkdirSync(SHOTS, { recursive: true });
const P = ["desktop", "iphone13"];

const panel = (page) => page.getByRole("dialog", { name: "Cases" });
const dock = (page) => page.locator(".ann-dock");
const shot = async (page, name, project) => { await page.waitForTimeout(400); return page.screenshot({ path: `${SHOTS}/${name}-${project}.png` }); };
const frames = (page, n = 3) => page.evaluate((n) => new Promise((r) => { const f = (k) => (k ? requestAnimationFrame(() => f(k - 1)) : r()); f(n); }), n);
const items = (page) => page.evaluate(() => window.__annotSession.getItems());
const waitSaved = (page, n) => page.waitForFunction(async (n) => {
  const open = indexedDB.databases ? await indexedDB.databases() : [];
  return open.length > 0 && n >= 0;
}, n).catch(() => {});

async function openShareItem(page, name) {
  await stableClick(page.getByRole("button", { name: "Save image or copy view link" }));
  await page.getByRole("menuitem", { name }).click();
}
async function openCases(page) {
  await openShareItem(page, "Open Cases");
  await panel(page).waitFor({ state: "visible" });
}
async function saveSnapshot(page, title) {
  await openCases(page);
  await panel(page).getByRole("button", { name: "Save snapshot", exact: true }).click();
  if (title) await panel(page).getByLabel("Title (optional)").fill(title);
  await page.keyboard.press("Enter");
  await page.waitForFunction((t) => [...document.querySelectorAll('.cases [role="option"]')].length >= 1 && !document.querySelector(".cases input[name=title]"), title);
}
async function startAnnotating(page) {
  await panel(page).getByRole("button", { name: "Annotate" }).click();
  await panel(page).waitFor({ state: "detached" });
  await dock(page).waitFor();
  await page.waitForFunction(() => !!window.__annotSession?.edit);
  await page.waitForTimeout(700); // the view eases to the snapshot
}
async function finishAnnotating(page) {
  await page.getByRole("button", { name: "Finish annotating" }).click();
  await dock(page).waitFor({ state: "detached" });
  await page.waitForTimeout(700); // 400 ms debounce + write
}
const arm = async (page, label) => {
  const b = dock(page).getByRole("button", { name: new RegExp(`^${label}`) });
  if ((await b.getAttribute("aria-pressed")) !== "true") await b.click();
};
async function tap(page, touch, [x, y]) { if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); }
async function drag(page, touch, pts) {
  if (!touch) {
    await page.mouse.move(...pts[0]); await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(...p, { steps: 2 });
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
const line = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
// Client px of a fraction of the model's on-screen box: the sample building is framed in the middle of the canvas.
const spot = async (page, fx, fy) => { const b = await canvasBox(page); return [b.x + b.width * fx, b.y + b.height * fy]; };
async function place(page, touch, tool, label, xy, text) {
  await arm(page, label);
  await tap(page, touch, xy);
  const ed = page.locator(".ann-editor");
  await ed.waitFor();
  if (text) await ed.locator("textarea").fill(text);
  await ed.getByRole("button", { name: "Save" }).click();
  await ed.waitFor({ state: "detached" });
}

// Turns the whole model by `angle` around `axis` ("right" = the camera's screen-horizontal axis, "up" = world Y)
// through its bounding-box centre, the way the app turns it (the camera stays).
const turn = (page, angle, axis = "right") => page.evaluate(([angle, axis]) => {
  const { THREE, camera, group, controls } = window.__ifcDebug;
  const box = new THREE.Box3().setFromObject(group), c = box.getCenter(new THREE.Vector3());
  const ax = axis === "up" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const q = new THREE.Quaternion().setFromAxisAngle(ax, angle);
  group.position.sub(c).applyQuaternion(q).add(c);
  group.quaternion.premultiply(q);
  group.updateMatrixWorld(true);
  controls.update();
  window.dispatchEvent(new Event("resize"));
}, [angle, axis]);
const pose = (page) => page.evaluate(() => { const { group } = window.__ifcDebug; return { p: group.position.toArray(), q: group.quaternion.toArray() }; });
const setPose = (page, w) => page.evaluate((w) => { const { group } = window.__ifcDebug; group.position.fromArray(w.p); group.quaternion.fromArray(w.q); group.updateMatrixWorld(true); }, w);

// Independent projection of an annotation point (snapshot frame) with the live camera and model, client px.
const expected = (page, point, basePose) => page.evaluate(([point, base]) => {
  const { THREE, camera, group } = window.__ifcDebug;
  camera.updateMatrixWorld(); group.updateMatrixWorld(true);
  const b = new THREE.Matrix4().compose(new THREE.Vector3(...base.p), new THREE.Quaternion(...base.q), new THREE.Vector3(1, 1, 1));
  const v = new THREE.Vector3(...point).applyMatrix4(group.matrixWorld.clone().multiply(b.invert())).project(camera);
  const r = document.querySelector("canvas").getBoundingClientRect();
  return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
}, [point, basePose]);
// Where the layer put the badge of annotation `id` (centre of its item), client px.
const badgeAt = (page, id) => page.evaluate((id) => {
  const el = document.querySelector(`.ann-item[data-ann="${id}"]`);
  const root = document.querySelector("[data-testid=ann-layer]").getBoundingClientRect();
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform);
  return { x: root.left + Number(m[1]), y: root.top + Number(m[2]), vis: el.dataset.vis, occ: el.dataset.occ };
}, id);
const near = (a, b, tol, what) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) <= tol, `${what}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);

const download = async (page, click) => {
  const [dl] = await Promise.all([page.waitForEvent("download"), click()]);
  return { name: dl.suggestedFilename(), bytes: readFileSync(await dl.path()) };
};

await suite("annotations-real", [
  {
    name: "annotate a snapshot with every tool, marks follow the model, occlusion, prev/next, reload, PDF and BCF",
    projects: P,
    timeout: 300000,
    fn: async ({ page, skip, project }) => {
      const touch = isTouch(project);
      await openApp(page);
      await requireHook(page, skip);
      await loadSample(page);
      await page.waitForTimeout(800);

      // ---- snapshot A, then annotate it with each tool through real pointer events
      const basePose = await pose(page);
      await saveSnapshot(page, "Snapshot A");
      await startAnnotating(page);
      await shot(page, "01-dock", project);
      // Spots on the building (fractions of the canvas). A phone tap snaps to a handle within ~15 px, so keep them apart.
      const F = touch
        ? { comment: [0.5, 0.5], pin: [0.25, 0.45], text: [0.75, 0.42], arrow: [[0.4, 0.33], [0.62, 0.38]], draw: [[0.3, 0.53], [0.7, 0.5]] }
        : { comment: [0.5, 0.5], pin: [0.42, 0.56], text: [0.58, 0.46], arrow: [[0.4, 0.44], [0.5, 0.4]], draw: [[0.45, 0.62], [0.6, 0.58]] };
      await place(page, touch, "comment", "Comment", await spot(page, ...F.comment), "Crack A");
      await place(page, touch, "pin", "Pin", await spot(page, ...F.pin), "");
      await place(page, touch, "text", "Text", await spot(page, ...F.text), "Door A");
      await arm(page, "Arrow");
      await drag(page, touch, line(await spot(page, ...F.arrow[0]), await spot(page, ...F.arrow[1])));
      await arm(page, "Draw");
      await drag(page, touch, line(await spot(page, ...F.draw[0]), await spot(page, ...F.draw[1]), 14));
      await page.waitForFunction(() => window.__annotSession.getItems().length === 5, null, { timeout: 15000 });
      const a = await items(page);
      assert.deepEqual(a.map((x) => x.type), ["comment", "pin", "text", "arrow", "freehand"]);
      assert.ok(a.every((x) => x.anchor.point.length === 3 && x.anchor.point.every(Number.isFinite)), "3D anchors from the real raycast");
      assert.ok(a[0].anchor.guid, "the comment knows the element it sits on");
      assert.ok(a[4].path.length >= 2);
      await dock(page).getByRole("button", { name: /^Draw/ }).click(); // disarm
      await frames(page);
      await shot(page, "02-all-tools", project);

      // ---- rotate the model: the marks follow their 3D points (within 2 px of an independent projection)
      const comment = a[0], pinA = a[1];
      for (const [angle, axis] of [[0.35, "up"], [-0.2, "right"]]) {
        await turn(page, angle, axis);
        await frames(page, 4);
        await page.waitForTimeout(250);
        for (const m of [comment, pinA]) {
          const got = await badgeAt(page, m.id);
          const want = await expected(page, m.anchor.point, basePose);
          const own = await page.evaluate(({ pt }) => window.__annotSession.viewer.project(pt), { pt: m.anchor.point });
          const root = await page.evaluate(() => { const r = document.querySelector("[data-testid=ann-layer]").getBoundingClientRect(); return { l: r.left, t: r.top }; });
          assert.equal(got.vis, "1", "mark visible");
          near(got, want, 2, `${m.type} badge after turning ${axis} ${angle}`);
          near({ x: root.l + own.x, y: root.t + own.y }, want, 2, "viewer.project");
        }
      }
      await shot(page, "03-turned", project);

      // ---- occlusion: turn it over so the comment's point is behind the building
      await turn(page, Math.PI, "right");
      await page.waitForFunction((id) => document.querySelector(`.ann-item[data-ann="${id}"]`)?.dataset.occ === "1", comment.id, { timeout: 15000 });
      assert.ok(Number(await page.evaluate((id) => getComputedStyle(document.querySelector(`.ann-item[data-ann="${id}"]`)).opacity, comment.id)) < 0.5, "occluded mark is faded");
      await shot(page, "04-occluded", project);
      await turn(page, -Math.PI, "right");
      await page.waitForFunction((id) => document.querySelector(`.ann-item[data-ann="${id}"]`)?.dataset.occ === "0", comment.id, { timeout: 15000 });
      await setPose(page, basePose);
      await finishAnnotating(page);

      // ---- snapshot B (another view) with its own comment
      await turn(page, 0.5, "up");
      await saveSnapshot(page, "Snapshot B");
      await page.waitForFunction(() => document.querySelectorAll(".ann-item").length === 0, null, { timeout: 5000 }); // A's marks give way to B's (none)
      await startAnnotating(page);
      await place(page, touch, "comment", "Comment", await spot(page, 0.5, 0.5), "Beam B");
      await finishAnnotating(page);

      // ---- prev/next shows each snapshot's own annotations (read-only: no toolbar, no action bar)
      await openCases(page);
      const count = async () => { await page.waitForTimeout(900); await frames(page); return page.locator(".ann-item").count(); };
      assert.equal(await panel(page).getByRole("option", { selected: true }).count(), 1);
      await panel(page).getByRole("button", { name: "Previous" }).click();
      assert.equal(await count(), 5, "A shows its five marks");
      assert.equal(await dock(page).count(), 0, "no toolbar when only showing");
      await shot(page, "05-prev-readonly", project);
      await panel(page).getByRole("button", { name: "Next" }).click();
      assert.equal(await count(), 1, "B shows its own one");
      assert.match(await page.locator(".ann-item").first().getByRole("button").getAttribute("aria-label"), /Beam B/);

      // ---- reload keeps them (IndexedDB)
      await page.reload();
      await openApp(page);
      await loadSample(page);
      await openCases(page);
      await panel(page).getByRole("option").first().waitFor();
      await panel(page).getByRole("option").nth(0).click();
      assert.equal(await count(), 5, "A's marks survived the reload");

      // ---- exports
      await panel(page).getByRole("button", { name: "Export", exact: true }).click();
      const pdf = await download(page, () => panel(page).getByRole("menuitem", { name: "Export PDF" }).click());
      const file = `${SHOTS}/export-${project}.pdf`;
      writeFileSync(file, pdf.bytes);
      const text = execFileSync("pdftotext", [file, "-"]).toString();
      for (const t of ["Crack A", "Door A", "Beam B"]) assert.ok(text.includes(t), `PDF lists "${t}"`);
      execFileSync("pdftoppm", ["-r", "70", "-f", "2", "-l", "2", "-png", file, `${SHOTS}/export-${project}`]);
      await panel(page).getByRole("button", { name: "Export", exact: true }).click();
      const bcf = await download(page, () => panel(page).getByRole("menuitem", { name: "Export BCF" }).click());
      const files = unzipSync(new Uint8Array(bcf.bytes));
      const markups = Object.entries(files).filter(([k]) => k.endsWith("markup.bcf")).map(([, v]) => strFromU8(v)).join("\n");
      for (const t of ["Crack A", "Door A", "Beam B"]) assert.ok(markups.includes(t), `BCF comment "${t}"`);
    },
  },
  {
    name: "Save snapshot while annotating keeps the marks; the dock stays clear of the other controls",
    projects: P,
    timeout: 200000,
    fn: async ({ page, skip, project }) => {
      const touch = isTouch(project);
      await openApp(page);
      await requireHook(page, skip);
      await loadSample(page);
      await page.waitForTimeout(800);
      await saveSnapshot(page, "One");
      await startAnnotating(page);
      await place(page, touch, "comment", "Comment", await spot(page, 0.5, 0.5), "Keep me");
      await turn(page, 0.3, "up");
      await frames(page, 3);
      await openShareItem(page, "Save snapshot to case");
      await page.locator(".toast", { hasText: /^Saved to/ }).waitFor();
      await page.waitForTimeout(800);
      await finishAnnotating(page);
      await openCases(page);
      await panel(page).getByRole("option").nth(1).waitFor();
      assert.equal(await panel(page).getByRole("option").count(), 2);
      await panel(page).getByRole("option").nth(1).click();
      await page.waitForTimeout(900);
      assert.equal(await page.locator(".ann-item").count(), 1, "the new snapshot carries the mark");
      assert.match(await panel(page).locator(".cases__annos").innerText(), /Keep me/);
      await panel(page).getByRole("button", { name: "Done" }).click();

      // layout: the dock overlaps none of the other visible controls
      await openCases(page);
      await panel(page).getByRole("option").nth(0).click();
      await startAnnotating(page);
      await arm(page, "Colour");
      await page.waitForTimeout(300);
      const clashes = await page.evaluate(() => {
        const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
        const d = box(document.querySelector(".ann-dock"));
        const hit = (a, b) => a.l < b.r - 1 && a.r > b.l + 1 && a.t < b.b - 1 && a.b > b.t + 1;
        return [".view-tools button", ".history-buttons__button", ".plane-switch", ".toolbar button", "header button", ".cases", ".hud *"]
          .flatMap((sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null && getComputedStyle(e).visibility !== "hidden").filter((e) => hit(d, box(e))).map((e) => `${sel} ${(e.getAttribute("aria-label") || e.className || "").toString().slice(0, 30)}`));
      });
      await shot(page, "06-layout", project);
      assert.deepEqual(clashes, [], "dock collides with other controls");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scroll");
    },
  },
  {
    name: "320 px wide phone: the toolbar and the text editor fit and clear the other controls",
    projects: ["iphone13"],
    context: { viewport: { width: 320, height: 640 }, screen: { width: 320, height: 640 } },
    timeout: 200000,
    fn: async ({ page, skip, project }) => {
      await openApp(page);
      await requireHook(page, skip);
      await loadSample(page);
      await page.waitForTimeout(800);
      await saveSnapshot(page, "Narrow");
      await startAnnotating(page);
      await place(page, true, "comment", "Comment", await spot(page, 0.5, 0.45), "Narrow comment");
      await arm(page, "Pin");
      await tap(page, true, await spot(page, 0.3, 0.5));
      const ed = page.locator(".ann-editor");
      await ed.waitFor();
      await ed.locator("textarea").fill("Pin text");
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/07-320-editor-${project}.png` });
      const b = await ed.getByRole("button", { name: "Save" }).boundingBox();
      assert.ok(b && b.x >= 0 && b.x + b.width <= 320 && b.y + b.height <= 640, `Save button on screen ${JSON.stringify(b)}`);
      await ed.getByRole("button", { name: "Save" }).click();
      await ed.waitFor({ state: "detached" });
      await page.waitForTimeout(500);
      await shot(page, "08-320-dock", project);
      const clashes = await page.evaluate(() => {
        const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
        const d = box(document.querySelector(".ann-dock"));
        const hit = (a, b) => a.l < b.r - 1 && a.r > b.l + 1 && a.t < b.b - 1 && a.b > b.t + 1;
        const out = [];
        for (const sel of [".view-tools button", ".history-buttons__button", ".plane-switch", ".compass", ".toolbar button", "header button"]) {
          for (const e of document.querySelectorAll(sel)) if (e.offsetParent !== null && hit(d, box(e))) out.push(sel);
        }
        if (d.l < 0 || d.r > innerWidth || d.b > innerHeight) out.push("dock off screen");
        return out;
      });
      assert.deepEqual(clashes, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no sideways scroll");
    },
  },
]);

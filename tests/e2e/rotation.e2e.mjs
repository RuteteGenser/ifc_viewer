// One-finger / mouse rotation feel: the orange pivot dot, roll, pole flips, gain, first-move jumps.
// Needs a hook build (VITE_TEST_HOOK=1, see tests/e2e/hook-build.sh):
//   ARGUS_URL=http://localhost:<port> node tests/e2e/rotation.e2e.mjs
// Numbers are printed for every case; ROT_SOFT=1 prints them without failing.
// Emulated touch (CDP) is not a real phone: it checks geometry and timing, not finger feel.
import assert from "node:assert/strict";
import { suite, openApp, loadSample, requireHook, canvasBox, isTouch } from "./lib.mjs";

const rows_note = (m) => console.log(`  note ${m}`);
const SOFT = !!process.env.ROT_SOFT;
const TOL = { dotToPointer: 2, dotStationary: 1, rollDeg: 0.5, firstMoveDeg: 2, gainRatio: 1.15 };

// ---- in-page helpers (installed once per page)
const install = () => {
  const d = window.__ifcDebug;
  const rect = () => document.querySelector("canvas").getBoundingClientRect();
  const toClient = (v) => { const p = v.clone().project(d.camera); const r = rect(); return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; };
  window.__R = {
    pivot: () => { const s = d.pivotState(); return { ...s, ...toClient(new d.THREE.Vector3(...s.pos)) }; },
    local: () => d.group.worldToLocal(new d.THREE.Vector3(...d.pivotState().pos)).toArray(),
    where: (l) => toClient(d.group.localToWorld(new d.THREE.Vector3(...l))),
    quat: () => d.group.quaternion.toArray(),
    // up vector of the model in camera space: roll = its tilt from screen-vertical, flipped = pointing down
    up: () => { const q = d.camera.quaternion.clone().invert().multiply(d.group.quaternion); const u = new d.THREE.Vector3(0, 1, 0).applyQuaternion(q); return { roll: (Math.atan2(u.x, u.y) * 180) / Math.PI, y: u.y }; },
    save: () => { window.__g0 = [d.group.position.toArray(), d.group.quaternion.toArray()]; },
    reset: () => { d.group.position.set(...window.__g0[0]); d.group.quaternion.set(...window.__g0[1]); d.controls.dispatchEvent({ type: "change" }); },
    hits: async (n) => { const r = rect(); const out = []; for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) { const x = r.left + (r.width * i) / n, y = r.top + (r.height * j) / n; if (document.elementFromPoint(x, y)?.tagName === "CANVAS" && (await d.raycast(x, y))) out.push([x, y]); } return out; },
    empties: async (n) => { const r = rect(); const out = []; for (let i = 0; i <= n; i++) for (let j = 1; j < n; j++) { const x = r.left + 4 + ((r.width - 8) * i) / n, y = r.top + (r.height * j) / n; if (document.elementFromPoint(x, y)?.tagName === "CANVAS" && !(await d.raycast(x, y))) out.push([x, y]); } return out; },
    state: () => d.pivotState(),
  };
};
const angBetween = (a, b) => (2 * Math.acos(Math.min(1, Math.abs(a.reduce((s, v, i) => s + v * b[i], 0)))) * 180) / Math.PI;

async function rig(page, ctx, project, skip, { sheet = false } = {}) {
  // Software GL renders a frame in 0.3 to 1 s, so a gesture that takes 0.5 s on a real phone would trip the
  // 500 ms long-press (context menu) timer here; stretch only that one timer for this test.
  await ctx.addInitScript(() => { const st = window.setTimeout; window.setTimeout = (f, d, ...a) => st(f, d === 500 ? 60000 : d, ...a); });
  await openApp(page);
  await loadSample(page);
  await requireHook(page, skip);
  const touch = isTouch(project);
  const cdp = await ctx.newCDPSession(page);
  const send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, id) => ({ x: p.x, y: p.y, id })) });
  await page.evaluate(install);
  if (sheet) {
    // a tap selects an element, which opens the info sheet and sets the camera view offset
    const [x, y] = (await page.evaluate(() => window.__R.hits(6)))[0];
    if (touch) { await send("touchStart", [{ x, y }]); await send("touchEnd", []); } else await page.mouse.click(x, y);
    await page.waitForTimeout(1500);
  }
  await page.evaluate(() => window.__R.save());
  const api = {
    touch,
    down: async (x, y) => { if (touch) await send("touchStart", [{ x, y }]); else { await page.mouse.move(x, y); await page.mouse.down(); } },
    move: async (x, y) => { if (touch) await send("touchMove", [{ x, y }]); else await page.mouse.move(x, y); },
    up: async () => { if (touch) await send("touchEnd", []); else await page.mouse.up(); },
    ready: () => page.waitForFunction(() => window.__R.state().rotating, null, { timeout: 5000, polling: 10 }),
    async drag(from, to, steps = 10) {
      await api.down(from[0], from[1]);
      await api.ready().catch(() => {});
      for (let i = 1; i <= steps; i++) { await api.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps); await page.waitForTimeout(12); }
      await api.up();
    },
    reset: async () => { await page.evaluate(() => window.__R.reset()); await page.waitForTimeout(400); }, // the worker raycast needs a frame to see the restored pose
  };
  return api;
}

const check = (label, ok, msg) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label}: ${msg}`); if (!ok && !SOFT) return msg; return null; };
const finish = (fails) => { if (fails.filter(Boolean).length) throw new Error(fails.filter(Boolean).join("\n")); };

const VARIANTS = [
  { project: "desktop", dpr: 1, sheet: false }, { project: "desktop", dpr: 2, sheet: false },
  { project: "iphone13", dpr: 2, sheet: false }, { project: "iphone13", dpr: 3, sheet: false },
  { project: "iphone13", dpr: 3, sheet: true }, { project: "ipad-mini", dpr: 2, sheet: true },
];

const cases = [];
for (const v of VARIANTS) {
  const tag = `${v.project} dpr${v.dpr}${v.sheet ? " sheet-open" : ""}`;
  const base = { projects: [v.project], context: { deviceScaleFactor: v.dpr }, timeout: 240000 };
  cases.push({
    ...base,
    name: `dot sits on the pointer, stays on its model point during the drag, empty start does not jump (${tag})`,
    fn: async ({ page, ctx, project, skip }) => {
      const r = await rig(page, ctx, project, skip, v);
      const fails = [];
      const hits = await page.evaluate(() => window.__R.hits(7));
      let offMax = 0, driftMax = 0, angMin = 999;
      for (let k = 0; k < 6; k++) {
        const [x, y] = hits[Math.floor((k * hits.length) / 6)];
        const q0 = await page.evaluate(() => window.__R.quat());
        await r.down(x, y);
        await r.ready().catch(async (e) => { throw new Error(`row ${k} at ${Math.round(x)},${Math.round(y)}: ${JSON.stringify(await page.evaluate(() => window.__R.state()))} ${e.message.split("\n")[0]}`); });
        const p = await page.evaluate(() => window.__R.pivot());
        offMax = Math.max(offMax, Math.hypot(p.x - x, p.y - y));
        const loc = await page.evaluate(() => window.__R.local());
        for (let i = 1; i <= 8; i++) {
          await r.move(x + 9 * i, y + 4 * i); await page.waitForTimeout(30);
          const w = await page.evaluate((l) => window.__R.where(l), loc);
          driftMax = Math.max(driftMax, Math.hypot(w.x - p.x, w.y - p.y));
        }
        angMin = Math.min(angMin, angBetween(q0, await page.evaluate(() => window.__R.quat())));
        await r.up(); await r.reset();
      }
      fails.push(check(tag + " dot-to-pointer", offMax <= TOL.dotToPointer, `max ${offMax.toFixed(2)} px (limit ${TOL.dotToPointer})`));
      fails.push(check(tag + " dot stationary", driftMax <= TOL.dotStationary, `max ${driftMax.toFixed(2)} px (limit ${TOL.dotStationary})`));
      fails.push(check(tag + " drag rotates", angMin > 1, `min ${angMin.toFixed(1)} deg`));
      // empty start: the first 2 px of movement must not turn the model by more than the limit
      const empties = await page.evaluate(() => window.__R.empties(8));
      if (empties.length) {
        let jump = 0;
        for (const [x, y] of empties.slice(0, 3)) {
          const q0 = await page.evaluate(() => window.__R.quat());
          await r.down(x, y); await r.ready().catch(() => {});
          await r.move(x + 2, y); await page.waitForTimeout(60);
          jump = Math.max(jump, angBetween(q0, await page.evaluate(() => window.__R.quat())));
          await r.up(); await r.reset();
        }
        fails.push(check(tag + " empty-start first move", jump <= TOL.firstMoveDeg, `max ${jump.toFixed(2)} deg for a 2 px move (limit ${TOL.firstMoveDeg})`));
      }
      if (r.touch) {
        // fat finger: a press that just misses the model (within the 14 px ring) pivots on the nearest surface, not the centre
        const near = await page.evaluate(async () => {
          const r = document.querySelector("canvas").getBoundingClientRect(); const d = window.__ifcDebug;
          for (let j = 1; j < 12; j++) for (let i = 1; i < 12; i++) {
            const x = r.left + (r.width * i) / 12, y = r.top + (r.height * j) / 12;
            if (!(await d.raycast(x, y)) || document.elementFromPoint(x, y)?.tagName !== "CANVAS") continue;
            for (let dx = 3; dx <= 12; dx += 3) if (!(await d.raycast(x + dx, y)) && document.elementFromPoint(x + dx, y)?.tagName === "CANVAS" && (await d.raycast(x, y))) return [x + dx, y];
          }
          return null;
        });
        if (near) {
          await r.down(near[0], near[1]); await r.ready();
          const p = await page.evaluate(() => window.__R.pivot());
          const dist = Math.hypot(p.x - near[0], p.y - near[1]);
          await r.up(); await r.reset();
          fails.push(check(tag + " near-miss press", dist <= 15, `dot ${dist.toFixed(1)} px from a press that just missed the model (limit 15)`));
        } else rows_note(tag + " near-miss press: no edge point found");
      }
      finish(fails);
    },
  });
}
// roll / flips / gain are independent of the DPR and the sheet: once per input kind
for (const project of ["desktop", "iphone13"]) {
  cases.push({
    projects: [project], timeout: 300000,
    name: `30 random drags: no roll, no pole flip; first move no jump; gain is symmetric (${project})`,
    fn: async ({ page, ctx, skip }) => {
      const r = await rig(page, ctx, project, skip);
      const b = await canvasBox(page);
      const fails = [];
      let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
      const hits = await page.evaluate(() => window.__R.hits(7));
      let rollMax = 0, minUpY = 1;
      for (let i = 0; i < 30; i++) {
        const [x, y] = hits[Math.floor(rnd() * hits.length)];
        const to = [Math.min(b.x + b.width - 4, Math.max(b.x + 4, x + (rnd() - 0.5) * b.width * 0.9)), Math.min(b.y + b.height - 4, Math.max(b.y + 4, y + (rnd() - 0.5) * b.height * 0.9))];
        await r.drag([x, y], to, 8);
        const u = await page.evaluate(() => window.__R.up());
        rollMax = Math.max(rollMax, Math.abs(u.roll)); minUpY = Math.min(minUpY, u.y);
        if (i % 6 === 5) await r.reset(); // keep the model near the screen so later drags still hit it
      }
      fails.push(check(project + " roll", rollMax < TOL.rollDeg, `max |roll| ${rollMax.toFixed(3)} deg after 30 drags (limit ${TOL.rollDeg})`));
      fails.push(check(project + " no flip", minUpY > 0, `min model-up screen-y ${minUpY.toFixed(3)} (must stay > 0)`));
      await r.reset();
      // first move from the framed Home pose
      const [hx, hy] = hits[Math.floor(hits.length / 2)];
      const q0 = await page.evaluate(() => window.__R.quat());
      await r.down(hx, hy); await r.ready(); await r.move(hx + 1.5, hy); await page.waitForTimeout(60);
      const jump = angBetween(q0, await page.evaluate(() => window.__R.quat()));
      await r.up(); await r.reset();
      fails.push(check(project + " first move", jump <= TOL.firstMoveDeg, `${jump.toFixed(2)} deg for a 1.5 px move (limit ${TOL.firstMoveDeg})`));
      // gain: same pixel travel horizontally and vertically should turn the model about equally
      const turn = async (dx, dy) => {
        await r.reset();
        const q = await page.evaluate(() => window.__R.quat());
        await r.drag([hx, hy], [hx + dx, hy + dy], 10);
        return angBetween(q, await page.evaluate(() => window.__R.quat()));
      };
      const aH = await turn(60, 0), aV = await turn(0, 60);
      const ratio = Math.max(aH, aV) / Math.min(aH, aV);
      fails.push(check(project + " gain", ratio <= TOL.gainRatio, `60 px horizontal ${aH.toFixed(1)} deg, vertical ${aV.toFixed(1)} deg (ratio ${ratio.toFixed(2)}, limit ${TOL.gainRatio}); canvas ${Math.round(b.width)}x${Math.round(b.height)}`));
      // a flick that starts moving before the (async) hit test has answered must not lose its first pixels
      const slow = await turn(30, 0);
      await r.reset();
      const qf = await page.evaluate(() => window.__R.quat());
      await r.down(hx, hy);
      for (let i = 1; i <= 6; i++) await r.move(hx + 5 * i, hy);
      await page.waitForFunction(() => window.__R.state().rotating, null, { timeout: 5000, polling: 10 });
      await page.waitForTimeout(300);
      const fast = angBetween(qf, await page.evaluate(() => window.__R.quat()));
      await r.up();
      fails.push(check(project + " buffered first deltas", fast / slow >= 0.9, `30 px flick without waiting ${fast.toFixed(1)} deg vs ${slow.toFixed(1)} deg when waiting (ratio ${(fast / slow).toFixed(2)}, need >= 0.9)`));
      finish(fails);
    },
  });
}

await suite("rotation", cases);

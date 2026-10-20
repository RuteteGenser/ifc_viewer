// Hover tooltips of the floating view controls and the tool row: fully inside the viewport and
// on top (nothing paints over them), at 1440, 1024 and tablet width. Mouse only.
import assert from "node:assert/strict";
import { suite, openApp, loadSample, OUT } from "./lib.mjs";
import { join } from "node:path";

const CONTROLS = ["Views and levels", "Save image or copy view link", "Zoom out", "Zoom in", "Home", "Measure", "Clip"];

await suite("tooltips", [
  {
    name: "each control's tooltip is inside the viewport and not covered (1440, 1024, 820)",
    projects: ["desktop"],
    fn: async ({ page }) => {
      await openApp(page);
      await loadSample(page);
      for (const w of [1440, 1024, 820]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(400);
        for (const name of CONTROLS) {
          const btn = page.locator(`.tooltip button[aria-label="${name}"], .tooltip button:has-text("${name}")`).first();
          if (!(await btn.count())) continue;
          await page.mouse.move(2, 450);
          await btn.hover();
          await page.waitForTimeout(260);
          const info = await btn.evaluate((el) => {
            const box = el.closest(".tooltip").querySelector(".tooltip__box");
            const r = box.getBoundingClientRect();
            const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            const style = getComputedStyle(box);
            return { r: { x: r.x, y: r.y, w: r.width, h: r.height }, vis: style.visibility, op: +style.opacity, pe: style.pointerEvents, coveredBy: top && !box.contains(top) && top !== box ? top.className || top.tagName : null, vw: innerWidth, vh: innerHeight };
          });
          assert.equal(info.vis, "visible", `${w} ${name}: not shown`);
          assert.ok(info.r.x >= 0 && info.r.y >= 0 && info.r.x + info.r.w <= info.vw && info.r.y + info.r.h <= info.vh, `${w} ${name}: outside the viewport ${JSON.stringify(info.r)}`);
          // pointer-events: none, so the hit test at its centre finds what is beneath; the box must not be painted over:
          // check that no other element with a higher stacking order covers it by temporarily making it hit-testable.
          const covered = await btn.evaluate((el) => {
            const box = el.closest(".tooltip").querySelector(".tooltip__box");
            box.style.pointerEvents = "auto";
            const r = box.getBoundingClientRect();
            const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            const ok = top && box.contains(top);
            box.style.pointerEvents = "";
            return ok ? null : (top?.className || top?.tagName);
          });
          assert.equal(covered, null, `${w} ${name}: covered by ${covered}`);
          // A hint must not hide the neighbouring controls it describes (the capsule's other buttons).
          const hides = await btn.evaluate((el) => {
            const r = el.closest(".tooltip").querySelector(".tooltip__box").getBoundingClientRect();
            const hit = [...(el.closest(".view-tools") ? el.closest(".view-tools").querySelectorAll(".view-tools__button") : [])].filter((b) => b !== el && !el.closest(".tooltip").contains(b)).find((b) => {
              const q = b.getBoundingClientRect();
              return q.width && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top;
            });
            return hit ? hit.getAttribute("aria-label") || hit.textContent.trim() : null;
          });
          assert.equal(hides, null, `${w} ${name}: tooltip hides the control "${hides}"`);
          if (w === 1440 && name === "Zoom in") await page.screenshot({ path: join(OUT, "tooltip-zoom-1440.png") });
          if (w === 1024 && name === "Views and levels") await page.screenshot({ path: join(OUT, "tooltip-views-1024.png") });
        }
      }
    },
  },
]);

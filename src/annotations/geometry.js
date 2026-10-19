// Pure screen-space helpers for the annotation layer. No DOM, no three.
import { stackUp } from "../ifc/labelStack";

export const MIN_ARROW_PX = 24;

const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

// Distance from point p to segment a-b, in any dimension (points are number arrays).
function segDist(p, a, b) {
  const ab = b.map((v, i) => v - a[i]);
  const len2 = ab.reduce((s, v) => s + v * v, 0);
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, p.reduce((s, v, i) => s + (v - a[i]) * ab[i], 0) / len2));
  return dist(p, a.map((v, i) => v + t * ab[i]));
}

// Ramer-Douglas-Peucker (iterative, so a long stroke cannot overflow the stack). With
// `maxPoints` the tolerance is doubled until the result fits, so the cap never truncates a path.
export function rdpSimplify(points, epsilon = 1.5, maxPoints = Infinity) {
  if (points.length <= 2) return points.slice();
  let eps = Math.max(epsilon, 1e-6);
  for (let guard = 0; guard < 40; guard++, eps *= 2) {
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      let far = -1, max = eps;
      for (let i = s + 1; i < e; i++) {
        const d = segDist(points[i], points[s], points[e]);
        if (d > max) { max = d; far = i; }
      }
      if (far >= 0) { keep[far] = 1; stack.push([s, far], [far, e]); }
    }
    const out = points.filter((_, i) => keep[i]);
    if (out.length <= maxPoints) return out;
  }
  return [points[0], points[points.length - 1]];
}

// Shaft end (where the head starts) and the three head vertices, in screen px.
export function arrowGeometry(start, end, headLen = 14, headAngle = Math.PI / 7) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return { length: 0, shaftEnd: { ...end }, head: [end, end, end] };
  const h = Math.min(headLen, length * 0.6);
  const ang = Math.atan2(dy, dx);
  const wing = (s) => ({ x: end.x - h * Math.cos(ang + s * headAngle), y: end.y - h * Math.sin(ang + s * headAngle) });
  const base = { x: end.x - h * 0.8 * Math.cos(ang), y: end.y - h * 0.8 * Math.sin(ang) };
  return { length, shaftEnd: base, head: [wing(1), { ...end }, wing(-1)] };
}

// Keeps a w*h box (top-left x,y) inside the viewport with a margin.
export function clampToViewport({ x, y, w, h }, { width, height }, margin = 4) {
  return {
    x: Math.max(margin, Math.min(x, width - w - margin)),
    y: Math.max(margin, Math.min(y, height - h - margin)),
  };
}

// Label de-overlap: rects {l,r,t,b} -> vertical offsets (px, move UP), via the shared stackUp.
export const placeLabels = (rects, gap = 4) => stackUp(rects, gap);

// Splits a projected polyline ({x,y,visible}) into runs of visible points (>= 2 points each).
export function projectPathVisibleSegments(projected) {
  const runs = [];
  let cur = [];
  for (const p of projected) {
    if (p && p.visible) cur.push({ x: p.x, y: p.y });
    else { if (cur.length > 1) runs.push(cur); cur = []; }
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

// SVG path through the points, smoothed with quadratic curves through segment midpoints.
export function smoothPathD(pts) {
  if (pts.length === 0) return "";
  const f = (n) => Math.round(n * 10) / 10;
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  if (pts.length === 1) return `${d}l0 0.01`;
  if (pts.length === 2) return `${d}L${f(pts[1].x)} ${f(pts[1].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
    d += `${i === 1 ? "L" + f((pts[0].x + pts[1].x) / 2) + " " + f((pts[0].y + pts[1].y) / 2) : ""}Q${f(pts[i].x)} ${f(pts[i].y)} ${f(mx)} ${f(my)}`;
  }
  const last = pts[pts.length - 1];
  return `${d}L${f(last.x)} ${f(last.y)}`;
}

// Screen-space de-overlap for measurement total labels. `rects` are {l, r, t, b} in px
// (y grows downward), in a stable order. Returns, per rect, how many px to move it UP so no
// two labels intersect (plus `gap`). Earlier rects never move; a later one hops above
// whatever it hits. Pure and cheap: O(n^2) on a handful of labels, capped passes.
export function stackUp(rects, gap = 4) {
  const dy = new Array(rects.length).fill(0);
  const placed = [];
  rects.forEach((r, i) => {
    let up = 0;
    for (let pass = 0; pass <= rects.length; pass++) {
      const t = r.t - up, b = r.b - up;
      const blocker = placed.find((q) => r.l < q.r && r.r > q.l && t < q.b + gap && b > q.t - gap);
      if (!blocker) break;
      up = r.b - (blocker.t - gap);
    }
    dy[i] = up;
    placed.push({ l: r.l, r: r.r, t: r.t - up, b: r.b - up });
  });
  return dy;
}

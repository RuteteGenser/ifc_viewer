// Is a 3D anchor (a tag, the long-press ring) visible from the camera, or hidden behind something?
// Pure functions; the viewer feeds them the first raycast hit along the line of sight.

// The first surface along the ray to the anchor is the anchor's own surface when it lies within a small
// tolerance of the anchor: 1.5 percent of the distance (pixel rounding at a grazing angle) plus 2 cm.
export function visibleByHit(anchorDistance, hitDistance) {
  if (hitDistance == null || !Number.isFinite(hitDistance)) return null; // no answer: keep the old state
  return hitDistance >= anchorDistance - (0.015 * anchorDistance + 0.02);
}

// Two consecutive agreeing observations are needed to flip the shown state, so a silhouette edge cannot flicker.
// state: { shown, agree }. observed: true | false | null (null = unknown, changes nothing).
export function stepVisibility(state, observed, needed = 2) {
  if (observed == null) return state;
  if (observed === state.shown) return state.agree === 0 ? state : { shown: state.shown, agree: 0 };
  const agree = state.agree + 1;
  return agree >= needed ? { shown: observed, agree: 0 } : { shown: state.shown, agree };
}

// On screen: in front of the camera and inside the NDC square (x, y in -1..1, z in -1..1 after projection).
export function onScreen(ndc, margin = 0) {
  return ndc.z > -1 && ndc.z < 1 && Math.abs(ndc.x) <= 1 + margin && Math.abs(ndc.y) <= 1 + margin;
}

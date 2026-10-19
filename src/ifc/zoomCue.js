// Zoom-limit toast latch. `latched` is the limit already announced ("min" | "max" | null).
// `reached` is the limit hit right now (or null). `dist` is the camera's distance to its
// near surface (for "min") or to the scene centre (for "max"); `zone` is the soft zone width.
// The cue fires once per contact: it re-arms only when the camera has left the soft zone,
// never by time. Returns the new latch and whether to show the toast.
export function cueStep(latched, reached, dist, limits, zone) {
  if (reached) return { latched: reached, fire: reached !== latched };
  if (latched === "min" && dist > limits.min + zone) return { latched: null, fire: false };
  if (latched === "max" && dist < limits.max - zone) return { latched: null, fire: false };
  return { latched, fire: false };
}

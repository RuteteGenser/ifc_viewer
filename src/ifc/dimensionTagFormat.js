// Compact dimension-tag text, returned as one or more lines (e.g.
// `["Ø80mm"]` or `["OD: Ø110", "ID: 106.0mm"]`) rather than a single
// string, so a pipe's outside/inside diameter can render as two separate
// lines. Cross-section only — the extrusion length is deliberately left
// off every tag (it isn't the dimension someone glancing at a floating
// tag needs, and it cluttered the box).
export function formatDimensionTag(category, dimData) {
  if (!dimData) return null;
  const { shape, diameter, width, height, wallThickness } = dimData;

  // A hollow circular profile is a real pipe — show labeled outside/
  // inside diameter (ID = OD − 2×wall thickness, the wall exists on
  // both sides of the bore) as two lines instead of a bare diameter; a
  // solid circular profile (a round duct) has no wall thickness at all
  // and keeps the plain "Ø{d}mm" format.
  if (shape === "circular" && typeof diameter === "number" && typeof wallThickness === "number") {
    const id = diameter - 2 * wallThickness;
    return [`OD: Ø${Math.round(diameter)}`, `ID: ${id.toFixed(1)}mm`];
  }

  if (shape === "circular" && typeof diameter === "number") {
    return [`Ø${Math.round(diameter)}mm`];
  }
  if (shape === "rectangular" && typeof width === "number" && typeof height === "number") {
    return [`${Math.round(width)}×${Math.round(height)}mm`];
  }
  // No resolvable profile (e.g. a proxy with no shape data, or an
  // unrecognized profile type) — caller shows no tag at all.
  return null;
}

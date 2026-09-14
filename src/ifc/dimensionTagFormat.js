// Compact dimension-tag text, returned as one or more lines (e.g.
// `["Ø80mm · 5.6m"]` or `["OD: Ø110mm", "ID: 106.0mm"]`) rather than a
// single string, so a pipe's outside/inside diameter can render as two
// separate lines. Deliberately mixes units (mm for the cross-section,
// meters for length) rather than reusing the app's usual mm-only
// formatting (see formatMm in useIfcViewer.js) — a duct run's length
// reads far better as "5.6m" than "5600.0 mm" in a small floating tag,
// while a cross-section reads better in mm than as "0.08m".
export function formatDimensionTag(category, dimData) {
  if (!dimData) return null;
  const { shape, diameter, width, height, length, wallThickness } = dimData;

  // A hollow circular profile is a real pipe — show labeled outside/
  // inside diameter (ID = OD − 2×wall thickness, the wall exists on
  // both sides of the bore) as two lines instead of a bare diameter,
  // with no length line; a solid circular profile (a round duct) has no
  // wall thickness at all and keeps the plain "Ø{d}mm · {len}m" format.
  if (shape === "circular" && typeof diameter === "number" && typeof wallThickness === "number") {
    const id = diameter - 2 * wallThickness;
    return [`OD: Ø${Math.round(diameter)}mm`, `ID: ${id.toFixed(1)}mm`];
  }

  let head;
  if (shape === "circular" && typeof diameter === "number") {
    head = `Ø${Math.round(diameter)}mm`;
  } else if (shape === "rectangular" && typeof width === "number" && typeof height === "number") {
    head = `${Math.round(width)}×${Math.round(height)}mm`;
  } else {
    // No resolvable profile (e.g. a proxy with no shape data, or an
    // unrecognized profile type) — caller shows no tag at all.
    return null;
  }

  // Fittings (bends, tees, ...) don't have one single clean "length" the
  // way a straight run does, so it's dropped regardless of what the
  // extraction happened to compute for their one extrusion.
  const isFitting = category?.toUpperCase() === "IFCFLOWFITTING";
  if (!isFitting && typeof length === "number") {
    return [`${head} · ${(length / 1000).toFixed(1)}m`];
  }
  return [head];
}

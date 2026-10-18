// Reads the project's unit assignment (IFCUNITASSIGNMENT) straight from the
// IFC text. The loader hands back numbers in the file's own units, so every
// length, area, volume and mass shown in the UI needs this to be labelled or
// converted correctly.
//
// The assignment can sit anywhere: exporters put it at the top, but several
// (e.g. the Clinic samples) write IFCPROJECT and IFCUNITASSIGNMENT at the very
// end of a 13-27 MB file. So the first and last slices are scanned first and
// the whole file only when a referenced unit is not found there. Bytes are
// decoded slice by slice; the file is never copied as a whole unless the
// fallback is needed.

const SLICE = 3 * 1024 * 1024;

const PREFIX = {
  EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 10,
  DECI: 0.1, CENTI: 0.01, MILLI: 0.001, MICRO: 1e-6, NANO: 1e-9, PICO: 1e-12, FEMTO: 1e-15, ATTO: 1e-18,
};
const PREFIX_SYMBOL = {
  EXA: "E", PETA: "P", TERA: "T", GIGA: "G", MEGA: "M", KILO: "k", HECTO: "h", DECA: "da",
  DECI: "d", CENTI: "c", MILLI: "m", MICRO: "µ", NANO: "n", PICO: "p", FEMTO: "f", ATTO: "a",
};
// Named non-SI units: factor to the SI base unit of the same kind.
const NAMED = {
  FOOT: { f: 0.3048, label: "ft" }, FEET: { f: 0.3048, label: "ft" }, INCH: { f: 0.0254, label: "in" },
  YARD: { f: 0.9144, label: "yd" }, MILE: { f: 1609.344, label: "mi" },
  "SQUARE FOOT": { f: 0.09290304, label: "ft²" }, "SQUARE FEET": { f: 0.09290304, label: "ft²" },
  "SQUARE INCH": { f: 0.00064516, label: "in²" }, "SQUARE YARD": { f: 0.83612736, label: "yd²" },
  "CUBIC FOOT": { f: 0.028316846592, label: "ft³" }, "CUBIC FEET": { f: 0.028316846592, label: "ft³" },
  "CUBIC INCH": { f: 0.000016387064, label: "in³" }, "CUBIC YARD": { f: 0.764554857984, label: "yd³" },
  LITRE: { f: 0.001, label: "l" }, LITER: { f: 0.001, label: "l" }, GALLON: { f: 0.003785411784, label: "gal" },
  POUND: { f: 0.45359237, label: "lb" }, OUNCE: { f: 0.028349523125, label: "oz" }, TON: { f: 1000, label: "t" },
};

const KINDS = {
  LENGTHUNIT: { si: "METRE", name: "length" },
  AREAUNIT: { si: "SQUARE_METRE", name: "area" },
  VOLUMEUNIT: { si: "CUBIC_METRE", name: "volume" },
  MASSUNIT: { si: "GRAM", name: "mass" },
};

function findBytes(bytes, pattern, from = 0) {
  const first = pattern[0];
  const last = bytes.length - pattern.length;
  outer: for (let i = bytes.indexOf(first, from); i !== -1 && i <= last; i = bytes.indexOf(first, i + 1)) {
    for (let j = 1; j < pattern.length; j++) if (bytes[i + j] !== pattern[j]) continue outer;
    return i;
  }
  return -1;
}

function decode(bytes, start, end) {
  return new TextDecoder("latin1").decode(bytes.subarray(start, end));
}

const ASSIGNMENT = Array.from("IFCUNITASSIGNMENT(", (c) => c.charCodeAt(0));

// Text around the unit assignment: a window before it (units are usually
// declared just ahead of it) and a window after it. Falls back to head+tail.
function candidateText(bytes) {
  if (bytes.length <= 2 * SLICE) return decode(bytes, 0, bytes.length);
  const at = findBytes(bytes, ASSIGNMENT);
  if (at === -1) return null;
  return decode(bytes, Math.max(0, at - SLICE), Math.min(bytes.length, at + SLICE));
}

function statement(text, id) {
  const re = new RegExp(`#${id}\\s*=\\s*(IFC[A-Z0-9]+)\\s*\\(([^;]*)\\);`, "i");
  const m = re.exec(text);
  return m ? { type: m[1].toUpperCase(), args: m[2] } : null;
}

function splitArgs(args) {
  const out = [];
  let depth = 0;
  let quote = false;
  let cur = "";
  for (const ch of args) {
    if (ch === "'") quote = !quote;
    if (!quote && ch === "(") depth++;
    if (!quote && ch === ")") depth--;
    if (!quote && depth === 0 && ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// -> { unitType, factor, label } or null when it can't be resolved from `text`.
function resolveUnit(text, id) {
  const st = statement(text, id);
  if (!st) return null;
  const a = splitArgs(st.args);
  if (st.type === "IFCSIUNIT") {
    // IFC2X3 and IFC4 alike: (Dimensions, UnitType, Prefix, Name)
    const unitType = a[1]?.replace(/\./g, "").toUpperCase();
    const prefix = a[2]?.replace(/\./g, "").toUpperCase();
    const name = a[3]?.replace(/\./g, "").toUpperCase();
    const p = prefix && prefix !== "$" ? prefix : "";
    const mult = p ? PREFIX[p] ?? 1 : 1;
    const symbol = p ? PREFIX_SYMBOL[p] ?? "" : "";
    const base = { METRE: "m", SQUARE_METRE: "m²", CUBIC_METRE: "m³", GRAM: "g" }[name];
    if (!base) return unitType ? { unitType, factor: 1, label: name?.toLowerCase() ?? "" } : null;
    // Gram's SI base is the kilogram; everything else is already base.
    const baseFactor = name === "GRAM" ? 0.001 : 1;
    let label = base;
    if (name === "SQUARE_METRE") label = `${symbol}m²`;
    else if (name === "CUBIC_METRE") label = `${symbol}m³`;
    else label = `${symbol}${base}`;
    // A prefix on SQUARE_METRE / CUBIC_METRE is read the way Revit and most
    // exporters mean it: milli = mm² / mm³ (the file's values, e.g. 1.09e7 for
    // a room, only make sense that way), not a thousandth of a m².
    const power = name === "SQUARE_METRE" ? 2 : name === "CUBIC_METRE" ? 3 : 1;
    return { unitType, factor: baseFactor * Math.pow(mult, power), label };
  }
  if (st.type === "IFCCONVERSIONBASEDUNIT") {
    // (Dimensions, UnitType, Name, ConversionFactor -> IfcMeasureWithUnit)
    const unitType = a[1]?.replace(/\./g, "").toUpperCase();
    const rawName = (a[2] ?? "").replace(/^'|'$/g, "").trim().toUpperCase();
    const named = NAMED[rawName] ?? NAMED[rawName.replace(/S$/, "")];
    let factor = named?.f;
    const ref = /^#(\d+)$/.exec(a[3] ?? "");
    if (ref) {
      const mw = statement(text, ref[1]);
      if (mw?.type === "IFCMEASUREWITHUNIT") {
        const parts = splitArgs(mw.args);
        const value = /\(([-+0-9.eE]+)\)/.exec(parts[0] ?? "");
        const baseUnit = /^#(\d+)$/.exec(parts[1] ?? "") ? resolveUnit(text, /^#(\d+)$/.exec(parts[1])[1]) : null;
        if (value && baseUnit) factor = Number(value[1]) * baseUnit.factor;
      }
    }
    if (!Number.isFinite(factor)) return null;
    return { unitType, factor, label: named?.label ?? rawName.toLowerCase() };
  }
  return null;
}

function parseAssignment(text) {
  const re = /IFCUNITASSIGNMENT\s*\(\s*\(([^)]*)\)\s*\)/gi;
  const found = [];
  let m;
  while ((m = re.exec(text))) found.push(m[1].split(",").map((s) => s.trim().replace(/^#/, "")));
  // Several assignments can exist in a federated file; the first is the project's.
  const ids = found[0];
  if (!ids) return { complete: false, units: {} };
  const units = {};
  let missing = false;
  for (const id of ids) {
    const unit = resolveUnit(text, id);
    if (!unit) {
      // Might be an unrelated unit type we cannot see; only a problem if it is one we need.
      const st = statement(text, id);
      if (!st) missing = true;
      continue;
    }
    const kind = KINDS[unit.unitType];
    if (kind && !units[kind.name]) units[kind.name] = unit;
  }
  return { complete: !missing, units };
}

function metres(known) {
  return { factor: 1, label: "m", known };
}

function build(parsed) {
  const u = parsed.units;
  const length = u.length ? { factor: u.length.factor, label: u.length.label, known: true } : metres(false);
  return {
    length: length.label,
    area: u.area ? u.area.label : `${length.label}²`,
    volume: u.volume ? u.volume.label : `${length.label}³`,
    mass: u.mass ? u.mass.label : "kg",
    factorToMetre: length.factor,
    // To SI (m, m², m³, kg). null = not declared, so the value's unit is unknown.
    toSI: {
      length: u.length ? u.length.factor : null,
      area: u.area ? u.area.factor : null,
      volume: u.volume ? u.volume.factor : null,
      mass: u.mass ? u.mass.factor : null,
    },
    known: length.known,
  };
}

const cache = new WeakMap();

export function readProjectUnits(bytes) {
  if (!bytes) return build({ units: {} });
  if (cache.has(bytes)) return cache.get(bytes);
  let parsed = null;
  try {
    const text = candidateText(bytes);
    if (text) parsed = parseAssignment(text);
    if (text && !parsed.complete && bytes.length > 2 * SLICE) {
      // Rare: units declared far from the assignment. One pass over everything.
      parsed = parseAssignment(decode(bytes, 0, bytes.length));
    }
  } catch {
    parsed = null;
  }
  const units = build(parsed ?? { units: {} });
  cache.set(bytes, units);
  return units;
}

// Pure text entry point for tests.
export function parseUnitsText(text) {
  return build(parseAssignment(text));
}

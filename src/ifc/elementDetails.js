// Pure helpers that turn the raw item data from FragmentsModel.getItemsData
// (property sets, quantity sets, material and spatial relations) into the
// small, display-ready structure the info panel renders. No React, no
// web-ifc: everything here can be tested in plain node.

import { readProjectUnits } from "./projectUnits";

const QUANTITY_VALUE_KEYS = [
  "LengthValue",
  "AreaValue",
  "VolumeValue",
  "CountValue",
  "WeightValue",
  "TimeValue",
];

// Quantity category -> kind of unit it is measured in.
const QUANTITY_KIND = {
  IFCQUANTITYLENGTH: "length",
  IFCQUANTITYAREA: "area",
  IFCQUANTITYVOLUME: "volume",
  IFCQUANTITYWEIGHT: "mass",
  IFCQUANTITYCOUNT: "count",
  IFCQUANTITYTIME: "time",
};

// Measure type of a single property value -> kind of unit.
const MEASURE_KIND = {
  IFCLENGTHMEASURE: "length",
  IFCPOSITIVELENGTHMEASURE: "length",
  IFCAREAMEASURE: "area",
  IFCVOLUMEMEASURE: "volume",
  IFCMASSMEASURE: "mass",
  IFCPLANEANGLEMEASURE: "angle",
  IFCTHERMODYNAMICTEMPERATUREMEASURE: "temperature",
  IFCTHERMALTRANSMITTANCEMEASURE: "uvalue",
};

// "Pset_WallCommon" -> "Wall Common", "Qto_SlabBaseQuantities" -> "Slab Base Quantities",
// "AcmeFireData" -> "Acme Fire Data". Always splits camel case and underscores.
export function prettyName(raw) {
  if (raw == null) return "";
  let s = String(raw).trim();
  s = s.replace(/^(Pset|Qto|PSet|QTO)_/, "");
  s = s.replace(/_/g, " ");
  s = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return s.replace(/\s+/g, " ").trim() || String(raw);
}

// "IFCBUILDINGELEMENTPROXY" -> "Building Element Proxy" is not recoverable from
// the upper-cased name, so use a table for the common ones and fall back to
// Title Case of the stripped name.
const CATEGORY_LABELS = {
  IFCBUILDINGELEMENTPROXY: "Building element proxy",
  IFCBUILDINGSTOREY: "Storey",
  IFCCURTAINWALL: "Curtain wall",
  IFCFLOWSEGMENT: "Flow segment",
  IFCFLOWFITTING: "Flow fitting",
  IFCFLOWTERMINAL: "Flow terminal",
  IFCFLOWCONTROLLER: "Flow controller",
  IFCFLOWTREATMENTDEVICE: "Flow treatment device",
  IFCDISTRIBUTIONELEMENT: "Distribution element",
  IFCOPENINGELEMENT: "Opening",
  IFCCOVERING: "Covering",
  IFCFURNISHINGELEMENT: "Furniture",
  IFCSTAIRFLIGHT: "Stair flight",
  IFCBUILDINGELEMENTPART: "Building element part",
  IFCMEMBER: "Member",
  IFCPLATE: "Plate",
  IFCSPACE: "Space",
  IFCSITE: "Site",
  IFCBUILDING: "Building",
  IFCPROJECT: "Project",
};
export function prettyCategory(raw) {
  if (!raw) return "";
  const key = String(raw).toUpperCase();
  if (CATEGORY_LABELS[key]) return CATEGORY_LABELS[key];
  const s = key.replace(/^IFC/, "").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Unit handling lives in projectUnits.js (it finds the unit assignment
// wherever it sits in the file and resolves prefixes and conversion units).
export { readProjectUnits };
const metreUnits = () => readProjectUnits(null);

function signedMetres(m) {
  const t = trimNumber(m, 2);
  return Number(t) > 0 ? `+${t}` : t;
}

function trimNumber(n, decimals) {
  if (!Number.isFinite(n)) return String(n);
  const fixed = n.toFixed(decimals);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

export const UNIT_UNKNOWN = "(unit unknown)";

// Converts a value in the file's unit to SI for kinds the project declares a
// unit for; area, volume and mass are shown in m², m³ and kg. null factor =
// the file did not declare that unit, so the number is shown but flagged.
function toSI(value, kind, units) {
  const factor = units.toSI?.[kind];
  if (factor === null) return { value, unit: UNIT_UNKNOWN };
  return { value: value * (factor ?? 1), unit: { area: "m²", volume: "m³", mass: "kg" }[kind] };
}

// Display string and unit for one number of a given kind.
function formatNumber(value, kind, units) {
  switch (kind) {
    case "length":
      return { text: trimNumber(value, 3), unit: units.length };
    case "area": {
      const c = toSI(value, kind, units);
      return { text: trimNumber(c.value, 2), unit: c.unit };
    }
    case "volume": {
      const c = toSI(value, kind, units);
      return { text: trimNumber(c.value, 3), unit: c.unit };
    }
    case "mass": {
      const c = toSI(value, kind, units);
      return { text: trimNumber(c.value, 2), unit: c.unit };
    }
    case "angle":
      return { text: trimNumber((value * 180) / Math.PI, 1), unit: "°" };
    case "temperature":
      return { text: trimNumber(value, 1), unit: "K" };
    case "uvalue":
      return { text: trimNumber(value, 3), unit: "W/m²K" };
    case "count":
      return { text: trimNumber(value, 0), unit: "" };
    default:
      return { text: Number.isInteger(value) ? String(value) : trimNumber(value, 4), unit: "" };
  }
}

function unwrap(v) {
  return v && typeof v === "object" && "value" in v ? v.value : v;
}

function formatScalar(raw, typeName, units) {
  const value = unwrap(raw);
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return { text: value ? "Yes" : "No", unit: "" };
  if (typeof value === "number") return formatNumber(value, MEASURE_KIND[String(typeName ?? "").toUpperCase()], units);
  return { text: String(value), unit: "" };
}

function propertyRow(prop, units) {
  const name = unwrap(prop.Name) ?? "";
  const category = unwrap(prop._category) ?? "";
  let formatted = null;
  if (prop.NominalValue !== undefined || prop.Value !== undefined) {
    const v = prop.NominalValue ?? prop.Value;
    formatted = formatScalar(v, v?.type, units);
  } else if (Array.isArray(prop.EnumerationValues)) {
    const items = prop.EnumerationValues.map((v) => unwrap(v)).filter((v) => v != null);
    if (items.length) formatted = { text: items.join(", "), unit: "" };
  } else if (Array.isArray(prop.ListValues)) {
    const items = prop.ListValues.map((v) => formatScalar(v, v?.type, units)).filter(Boolean);
    if (items.length) formatted = { text: items.map((i) => i.text).join(", "), unit: items[0].unit };
  } else if (prop.LowerBoundValue !== undefined || prop.UpperBoundValue !== undefined) {
    const lo = formatScalar(prop.LowerBoundValue, prop.LowerBoundValue?.type, units);
    const hi = formatScalar(prop.UpperBoundValue, prop.UpperBoundValue?.type, units);
    if (lo || hi) formatted = { text: `${lo?.text ?? "…"} to ${hi?.text ?? "…"}`, unit: (lo ?? hi).unit };
  } else if (prop.Description && category === "IFCPROPERTYREFERENCEVALUE") {
    formatted = { text: String(unwrap(prop.Description)), unit: "" };
  }
  return {
    name: String(name),
    label: prettyName(name),
    value: formatted?.text ?? null,
    unit: formatted?.unit ?? "",
  };
}

function quantityRow(quantity, units) {
  const name = unwrap(quantity.Name) ?? "";
  const kind = QUANTITY_KIND[unwrap(quantity._category)];
  let formatted = null;
  for (const key of QUANTITY_VALUE_KEYS) {
    if (quantity[key] !== undefined) {
      const v = unwrap(quantity[key]);
      if (typeof v === "number") formatted = formatNumber(v, kind, units);
      break;
    }
  }
  return {
    name: String(name),
    label: prettyName(name),
    value: formatted?.text ?? null,
    unit: formatted?.unit ?? "",
  };
}

function materialNames(item, depth = 0) {
  if (!item || depth > 3) return [];
  const names = [];
  const own = unwrap(item.Name);
  const category = unwrap(item._category) ?? "";
  if (category === "IFCMATERIAL" && own) names.push(String(own));
  // Layer sets, constituent sets, lists: collect nested material names when the
  // loader returned them, else fall back to the set's own name.
  for (const key of ["ForLayerSet", "MaterialLayers", "MaterialConstituents", "Materials", "Material", "RelatingMaterial"]) {
    const child = item[key];
    if (Array.isArray(child)) for (const c of child) names.push(...materialNames(c, depth + 1));
    else if (child && typeof child === "object") names.push(...materialNames(child, depth + 1));
  }
  if (names.length === 0 && own && category !== "IFCMATERIAL" && /MATERIAL/.test(category)) names.push(String(own));
  return names;
}

function classificationEntry(item) {
  const category = unwrap(item._category) ?? "";
  if (!/^IFCCLASSIFICATION/.test(category)) return null;
  const id = unwrap(item.Identification) ?? unwrap(item.ItemReference);
  const name = unwrap(item.Name);
  const source = unwrap(item.ReferencedSource?.Name) ?? unwrap(item.Source);
  const text = [id, name].filter((x) => x != null && x !== "").join(" ");
  if (!text) return null;
  return { text, source: source ? String(source) : "" };
}

// Builds the structure the info panel shows from one getItemsData row.
export function buildElementDetails(data, units = metreUnits()) {
  const definitions = Array.isArray(data.IsDefinedBy) ? data.IsDefinedBy : [];
  const groups = [];
  for (const def of definitions) {
    let kind = null;
    let rows = null;
    if (Array.isArray(def.HasProperties)) {
      kind = "pset";
      rows = def.HasProperties.map((p) => propertyRow(p, units));
    } else if (Array.isArray(def.Quantities)) {
      kind = "qto";
      rows = def.Quantities.map((q) => quantityRow(q, units));
    }
    if (!kind) continue;
    rows = rows.filter((r) => r.name && r.value !== null);
    if (rows.length === 0) continue; // empty sets are noise
    const rawName = unwrap(def.Name) ?? (kind === "qto" ? "Quantities" : "Property set");
    groups.push({ kind, name: String(rawName), label: prettyName(rawName), rows });
  }
  // Quantities first (they are what people look up most), then property sets.
  groups.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "qto" ? -1 : 1));

  const associations = [
    ...(Array.isArray(data.HasAssociations) ? data.HasAssociations : []),
    ...(Array.isArray(data.ClassificationRefForObjects) ? data.ClassificationRefForObjects : []),
  ];
  const materials = [...new Set(associations.flatMap((a) => materialNames(a)))];
  const classifications = associations.map(classificationEntry).filter(Boolean);

  const container = Array.isArray(data.ContainedInStructure) ? data.ContainedInStructure[0] : null;
  const storey = container ? unwrap(container.Name) ?? null : null;
  const storeyElevation = container && typeof unwrap(container.Elevation) === "number" ? unwrap(container.Elevation) : null;

  return {
    groups,
    materials,
    classifications,
    storey: storey ? String(storey) : null,
    // IfcBuildingStorey.Elevation as written in the IFC (the importer keeps
    // the attribute as-is, in the file's unit), shown in metres.
    storeyElevation: storeyElevation === null ? null : { text: signedMetres(storeyElevation * units.factorToMetre), unit: "m" },
    units,
  };
}

// Filters groups by a case-insensitive query on group label, row label or value.
export function filterGroups(groups, query) {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  const out = [];
  for (const g of groups) {
    if (g.label.toLowerCase().includes(q) || g.name.toLowerCase().includes(q)) {
      out.push(g);
      continue;
    }
    const rows = g.rows.filter(
      (r) => r.label.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || String(r.value).toLowerCase().includes(q),
    );
    if (rows.length) out.push({ ...g, rows });
  }
  return out;
}

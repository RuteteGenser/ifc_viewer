// Case data format (see docs/cases/CASES-SPEC.md). Pure: factories + a strict, normalising validator.
import { newId, isId } from "./ids";

export const SCHEMA = "argus.case/1";
export const LIMITS = {
  snapshotsPerCase: 50,
  annotationsPerSnapshot: 100,
  textChars: 2000,
  titleChars: 200,
  nameChars: 200,
  freehandPoints: 200,
  sectionsPerSnapshot: 6,
  guidsPerList: 50000,
  tags: 20,
  coordAbs: 1e9,
};
export const PALETTE = ["#d9480f", "#c92a2a", "#1971c2", "#2f9e44", "#f08c00", "#862e9c"];
export const ANNOTATION_TYPES = ["comment", "pin", "arrow", "text", "freehand"];
export const STATUSES = ["open", "resolved"];
export const IFC_SCHEMAS = ["IFC2X3", "IFC4", "IFC4X3"];
export const SECTION_PRESETS = ["plan", "side", "front"];

const nowIso = () => new Date().toISOString();
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// ---- factories -------------------------------------------------------------
export function newCase({ name = "Untitled case", model = {}, author = "", id, now } = {}) {
  const t = now || nowIso();
  return {
    schema: SCHEMA,
    id: id || newId(),
    name,
    createdAt: t,
    updatedAt: t,
    model: { name: "", sha256: null, size: null, ifcSchema: null, projectGuid: null, lengthUnit: "m", ...model },
    snapshots: [],
    meta: { author, status: "open", tags: [] },
  };
}

export function newSnapshot({ title = "", note = "", thumb = null, image = null, view, id, now } = {}) {
  return {
    id: id || newId(),
    title,
    note,
    createdAt: now || nowIso(),
    thumb,
    image,
    view: {
      camera: null,
      modelPose: null,
      sections: [],
      hiddenGuids: [],
      isolatedGuids: null,
      hiddenCategories: [],
      storey: null,
      ...view,
    },
    annotations: [],
  };
}

// fields: color, text, author, anchor {point,guid,storey}, target {point,guid}, path, id, now
export function newAnnotation(type, fields = {}) {
  const { id, now, ...rest } = fields;
  return {
    id: id || newId(),
    type,
    color: PALETTE[0],
    text: "",
    author: "",
    createdAt: now || nowIso(),
    anchor: null,
    target: null,
    path: null,
    ...rest,
    ...(rest.anchor ? { anchor: { guid: null, storey: null, ...rest.anchor } } : {}),
    ...(rest.target ? { target: { guid: null, ...rest.target } } : {}),
  };
}

// ---- normalisers (each returns a clean value or null) -------------------------
const str = (v, max, fallback = "") => (typeof v === "string" ? v.trim().slice(0, max) : fallback);
const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
const clampCoord = (v) => num(v, -LIMITS.coordAbs, LIMITS.coordAbs);

function vec(v, n) {
  if (!Array.isArray(v) || v.length !== n) return null;
  const out = v.map(clampCoord);
  return out.some((x) => x === null) ? null : out;
}
const vec3 = (v) => vec(v, 3);
const iso = (v, fallback) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : fallback);
const dataUrl = (v) => (typeof v === "string" && /^data:image\/[a-z0-9.+-]+;base64,/i.test(v) ? v : null);
const optStr = (v, max = 200) => { const s = str(v, max); return s || null; };

function strList(v, cap, max = 200) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) if (typeof x === "string" && x.trim()) { out.push(x.trim().slice(0, max)); if (out.length >= cap) break; }
  return out;
}

function normCamera(c) {
  if (!isObj(c)) return null;
  const position = vec3(c.position), quaternion = vec(c.quaternion, 4);
  if (!position || !quaternion) return null;
  return { position, quaternion, fov: num(c.fov, 1, 179) ?? 60, target: vec3(c.target), flat: c.flat === true };
}
function normPose(p) {
  if (!isObj(p)) return null;
  const position = vec3(p.position), quaternion = vec(p.quaternion, 4);
  return position && quaternion ? { position, quaternion } : null;
}
function normSection(s) {
  if (!isObj(s)) return null;
  const normal = vec3(s.normal), constant = clampCoord(s.constant);
  if (!normal || constant === null) return null;
  return { normal, constant, enabled: s.enabled !== false, flipped: s.flipped === true, preset: SECTION_PRESETS.includes(s.preset) ? s.preset : null };
}

function normView(v, warn) {
  v = isObj(v) ? v : {};
  let sections = (Array.isArray(v.sections) ? v.sections : []).map(normSection).filter(Boolean);
  if (sections.length > LIMITS.sectionsPerSnapshot) { warn(`Only ${LIMITS.sectionsPerSnapshot} section planes kept.`); sections = sections.slice(0, LIMITS.sectionsPerSnapshot); }
  return {
    camera: normCamera(v.camera),
    modelPose: normPose(v.modelPose),
    sections,
    hiddenGuids: strList(v.hiddenGuids, LIMITS.guidsPerList),
    isolatedGuids: Array.isArray(v.isolatedGuids) ? strList(v.isolatedGuids, LIMITS.guidsPerList) : null,
    hiddenCategories: strList(v.hiddenCategories, 500),
    storey: optStr(v.storey),
  };
}

function normAnnotation(a, warn, label) {
  if (!isObj(a)) { warn(`${label}: not an object, dropped.`); return null; }
  if (!ANNOTATION_TYPES.includes(a.type)) { warn(`${label}: unknown type "${String(a.type)}", dropped.`); return null; }
  let path = null;
  if (a.type === "freehand") {
    path = (Array.isArray(a.path) ? a.path : []).map(vec3).filter(Boolean);
    if (path.length > LIMITS.freehandPoints) { warn(`${label}: freehand cut to ${LIMITS.freehandPoints} points.`); path = path.slice(0, LIMITS.freehandPoints); }
    if (path.length < 2) { warn(`${label}: freehand needs at least 2 valid points, dropped.`); return null; }
  }
  let anchor = null;
  if (isObj(a.anchor)) {
    const point = vec3(a.anchor.point);
    if (point) anchor = { point, guid: optStr(a.anchor.guid), storey: optStr(a.anchor.storey) };
  }
  if (!anchor && path) anchor = { point: path[0], guid: null, storey: null };
  if (!anchor) { warn(`${label}: missing or invalid anchor point, dropped.`); return null; }
  let target = null;
  if (a.type === "arrow") {
    const point = isObj(a.target) ? vec3(a.target.point) : null;
    if (!point) { warn(`${label}: arrow without a valid end point, dropped.`); return null; }
    target = { point, guid: optStr(a.target.guid) };
  }
  const color = typeof a.color === "string" && PALETTE.includes(a.color.toLowerCase()) ? a.color.toLowerCase() : PALETTE[0];
  const text = str(a.text, LIMITS.textChars);
  if (typeof a.text === "string" && a.text.trim().length > LIMITS.textChars) warn(`${label}: text cut to ${LIMITS.textChars} characters.`);
  return {
    id: isId(a.id) ? a.id : newId(), type: a.type, color, text, author: str(a.author, 100),
    createdAt: iso(a.createdAt, nowIso()), anchor, target, path,
  };
}

function normSnapshot(s, warn, label) {
  if (!isObj(s)) { warn(`${label}: not an object, dropped.`); return null; }
  const rawAnn = Array.isArray(s.annotations) ? s.annotations : [];
  let list = rawAnn;
  if (list.length > LIMITS.annotationsPerSnapshot) { warn(`${label}: only ${LIMITS.annotationsPerSnapshot} annotations kept.`); list = list.slice(0, LIMITS.annotationsPerSnapshot); }
  const seen = new Set();
  const annotations = [];
  list.forEach((a, i) => {
    const n = normAnnotation(a, warn, `${label} annotation ${i + 1}`);
    if (!n) return;
    if (seen.has(n.id)) n.id = newId();
    seen.add(n.id);
    annotations.push(n);
  });
  return {
    id: isId(s.id) ? s.id : newId(), title: str(s.title, LIMITS.titleChars), note: str(s.note, LIMITS.textChars),
    createdAt: iso(s.createdAt, nowIso()), thumb: dataUrl(s.thumb), image: dataUrl(s.image),
    view: normView(s.view, warn), annotations,
  };
}

// Returns { ok, errors[], warnings[], case }. ok=false only for structural problems (not an object,
// wrong/missing schema). Bad parts inside a valid case are dropped or clamped and reported in warnings.
export function validateCase(obj) {
  const errors = [], warnings = [];
  const warn = (m) => warnings.push(m);
  if (!isObj(obj)) return { ok: false, errors: ["The file is not a case (expected a JSON object)."], warnings, case: null };
  if (obj.schema !== SCHEMA) {
    const got = typeof obj.schema === "string" ? `"${obj.schema.slice(0, 40)}"` : "none";
    return { ok: false, errors: [`Unsupported case format ${got}. This version of Argus reads "${SCHEMA}".`], warnings, case: null };
  }
  if (obj.snapshots !== undefined && !Array.isArray(obj.snapshots)) errors.push("snapshots must be a list.");
  if (errors.length) return { ok: false, errors, warnings, case: null };

  const m = isObj(obj.model) ? obj.model : {};
  const sha = typeof m.sha256 === "string" && /^[0-9a-f]{64}$/i.test(m.sha256.trim()) ? m.sha256.trim().toLowerCase() : null;
  const size = typeof m.size === "number" && Number.isFinite(m.size) && m.size >= 0 ? Math.floor(m.size) : null;
  const schemaName = typeof m.ifcSchema === "string" && IFC_SCHEMAS.includes(m.ifcSchema.trim().toUpperCase()) ? m.ifcSchema.trim().toUpperCase() : null;
  const meta = isObj(obj.meta) ? obj.meta : {};

  let rawSnaps = Array.isArray(obj.snapshots) ? obj.snapshots : [];
  if (rawSnaps.length > LIMITS.snapshotsPerCase) { warn(`Only the first ${LIMITS.snapshotsPerCase} snapshots were kept.`); rawSnaps = rawSnaps.slice(0, LIMITS.snapshotsPerCase); }
  const seen = new Set();
  const snapshots = [];
  rawSnaps.forEach((s, i) => {
    const n = normSnapshot(s, warn, `Snapshot ${i + 1}`);
    if (!n) return;
    if (seen.has(n.id)) n.id = newId();
    seen.add(n.id);
    snapshots.push(n);
  });

  const createdAt = iso(obj.createdAt, nowIso());
  return {
    ok: true, errors, warnings,
    case: {
      schema: SCHEMA, id: isId(obj.id) ? obj.id : newId(), name: str(obj.name, LIMITS.nameChars) || "Untitled case",
      createdAt, updatedAt: iso(obj.updatedAt, createdAt),
      model: { name: str(m.name, 300), sha256: sha, size, ifcSchema: schemaName, projectGuid: optStr(m.projectGuid), lengthUnit: str(m.lengthUnit, 10) || "m" },
      snapshots,
      meta: { author: str(meta.author, 100), status: STATUSES.includes(meta.status) ? meta.status : "open", tags: strList(meta.tags, LIMITS.tags, 50) },
    },
  };
}

// BCF 2.1 export / import for Argus Cases. Pure functions, no DOM, no UI.
//
// AXES. Argus (three.js) is Y-up, BCF is Z-up, both right-handed. A point (x, y, z)
// in three space is written to BCF as (x, -z, y), and read back as (a, b, c) -> (a, c, -b).
// This is a proper rotation (det +1), so handedness and quaternions stay valid. Only world
// coordinates are converted; `view.modelPose` is NOT applied (the model is assumed unrotated
// in the BCF), and coordinates are in case.model.lengthUnit (BCF expects metres).
//
// CAMERA. three cameras look down local -Z with +Y up: direction = q * (0,0,-1), up = q * (0,1,0).
// FieldOfView is the vertical fov in degrees. Orthographic (flat) is exported as perspective.
//
// CLIPPING. A section {normal n, constant c} keeps n.p + c >= 0 (three Plane). BCF Location is
// the plane point -c*n/|n|, BCF Direction is -n (it points toward the clipped side). Only enabled
// sections are exported; `normal` is taken as already flipped.
//
// IDS. toGuid(id) is exactly reversible for ULID-style ids (26 Crockford chars, first <= 7: 128 bits
// map to the 32 hex digits; it is 8-4-4-4-12 formatted but does not set RFC4122 version bits).
// Other ids get a deterministic hash GUID that fromGuid cannot map back. Topics written by Argus
// carry the label "Argus"; only those get their original ids restored on import.
//
// IMPORT. Comments become 'comment' annotations. A BCF comment has no 3D point, so the anchor
// point is 3 m in front of the camera (three space) and anchor.guid is the viewpoint's first
// Selection IfcGuid. Only the first viewpoint of a topic becomes the snapshot.
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARGUS_LABEL = "Argus";
const IN_FRONT = 3;
const TARGET_DIST = 10;

// ---------- ids ----------
let idFactory = null;
export function setIdFactory(fn) { idFactory = typeof fn === "function" ? fn : null; }
export function randomId() {
  if (idFactory) return idFactory();
  let t = Date.now(), s = "";
  for (let i = 0; i < 10; i++) { s = CROCKFORD[t % 32] + s; t = Math.floor(t / 32); }
  for (let i = 0; i < 16; i++) s += CROCKFORD[Math.floor(Math.random() * 32)];
  return s;
}

export function toGuid(id) {
  const up = String(id).toUpperCase();
  let hex;
  if (ULID_RE.test(up)) {
    let n = 0n;
    for (const ch of up) n = n * 32n + BigInt(CROCKFORD.indexOf(ch));
    hex = n.toString(16).padStart(32, "0");
  } else {
    hex = "";
    for (let k = 0; k < 4; k++) {
      let h = (0x811c9dc5 ^ (k * 0x9e3779b1)) >>> 0;
      const s = String(id);
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
      hex += (h >>> 0).toString(16).padStart(8, "0");
    }
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function fromGuid(guid) {
  if (typeof guid !== "string" || !GUID_RE.test(guid.trim())) return null;
  let n = BigInt("0x" + guid.trim().replace(/-/g, ""));
  let s = "";
  for (let i = 0; i < 26; i++) { s = CROCKFORD[Number(n % 32n)] + s; n /= 32n; }
  return s;
}

// ---------- vectors, axes, quaternions ----------
export const toBcfAxes = ([x, y, z]) => [x, 0 - z, y];
export const fromBcfAxes = ([a, b, c]) => [a, c, 0 - b];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function rotateByQuat([qx, qy, qz, qw], [x, y, z]) {
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
}
/** three-space quaternion -> {dir, up} (three space). */
export function quatToDirUp(q) { return { dir: rotateByQuat(q, [0, 0, -1]), up: rotateByQuat(q, [0, 1, 0]) }; }
/** three-space dir + up -> unit quaternion [x,y,z,w] with w >= 0. */
export function dirUpToQuat(dirIn, upIn) {
  const z = norm([-dirIn[0], -dirIn[1], -dirIn[2]]);
  let upv = upIn;
  if (Math.hypot(...cross(upv, z)) < 1e-9) upv = Math.abs(z[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  const x = norm(cross(upv, z)), y = cross(z, x);
  const m00 = x[0], m10 = x[1], m20 = x[2], m01 = y[0], m11 = y[1], m21 = y[2], m02 = z[0], m12 = z[1], m22 = z[2];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]; }
  const l = Math.hypot(...q); q = q.map((v) => v / l);
  return q[3] < 0 ? q.map((v) => -v) : q;
}

// ---------- base64 / data URLs ----------
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function bytesToB64(u8) {
  let o = "";
  for (let i = 0; i < u8.length; i += 3) {
    const n = (u8[i] << 16) | ((u8[i + 1] || 0) << 8) | (u8[i + 2] || 0);
    o += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < u8.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < u8.length ? B64[n & 63] : "=");
  }
  return o;
}
export function b64ToBytes(s) {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]) : 0));
    const n = (c[0] << 18) | (c[1] << 12) | (c[2] << 6) | c[3];
    if (p < out.length) out[p++] = n >> 16; if (p < out.length) out[p++] = (n >> 8) & 255; if (p < out.length) out[p++] = n & 255;
  }
  return out;
}
function parseDataUrl(u) {
  const m = /^data:image\/(jpeg|jpg|png);base64,(.*)$/s.exec(typeof u === "string" ? u : "");
  return m ? { ext: m[1] === "png" ? "png" : "jpg", bytes: b64ToBytes(m[2]) } : null;
}

// ---------- XML writer ----------
export function xmlEscape(s) {
  return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/\r/g, "&#13;");
}
/** el(name, attrs, content): content is a string (escaped), an array of el() strings, or omitted (self-closing). */
export function el(name, attrs, content) {
  let a = "";
  for (const k of Object.keys(attrs || {})) if (attrs[k] != null) a += ` ${k}="${xmlEscape(attrs[k])}"`;
  if (content == null || (Array.isArray(content) && !content.length)) return `<${name}${a}/>`;
  return `<${name}${a}>${Array.isArray(content) ? content.join("") : xmlEscape(content)}</${name}>`;
}
const DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';

// ---------- XML reader (small, tolerant, throws on structural errors) ----------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function xmlUnescape(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const c = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(c); } catch { return ""; } }
    return ENT[e] ?? m;
  });
}
const local = (n) => n.slice(n.indexOf(":") + 1);
/** Returns the root node {name, attrs, kids, text}. Names have namespace prefixes stripped. */
export function parseXml(src) {
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|(<)/g;
  const attrRe = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const stack = []; let root = null, m;
  src = src.replace(/^﻿/, "");
  while ((m = re.exec(src))) {
    if (m[7]) throw new Error("XML: stray '<'");
    if (m[1] !== undefined) { if (stack.length) stack[stack.length - 1].text += m[1]; continue; }
    if (m[6] !== undefined) { if (stack.length) stack[stack.length - 1].text += xmlUnescape(m[6]); else if (m[6].trim()) throw new Error("XML: text outside root"); continue; }
    if (m[3] === undefined) continue;
    const name = local(m[3]);
    if (m[2]) {
      const top = stack.pop();
      if (!top || top.name !== name) throw new Error(`XML: unexpected </${name}>`);
      continue;
    }
    const attrs = {}; let a; attrRe.lastIndex = 0;
    while ((a = attrRe.exec(m[4]))) attrs[local(a[1])] = xmlUnescape(a[2] ?? a[3]);
    const node = { name, attrs, kids: [], text: "" };
    if (stack.length) stack[stack.length - 1].kids.push(node); else if (root) throw new Error("XML: multiple roots"); else root = node;
    if (!m[5]) stack.push(node);
  }
  if (stack.length) throw new Error(`XML: unclosed <${stack[stack.length - 1].name}>`);
  if (!root) throw new Error("XML: no root element");
  return root;
}
const lc = (s) => s.toLowerCase();
const kid = (n, name) => n && n.kids.find((k) => lc(k.name) === lc(name));
const kidsOf = (n, name) => (n ? n.kids.filter((k) => lc(k.name) === lc(name)) : []);
const txt = (n, name) => { const k = kid(n, name); return k ? k.text : undefined; };
const num = (n, name) => { const v = parseFloat(txt(n, name)); return Number.isFinite(v) ? v : undefined; };
const vec = (n) => { if (!n) return null; const v = [num(n, "X"), num(n, "Y"), num(n, "Z")]; return v.every((x) => x !== undefined) ? v : null; };
const descend = (n, test, out = []) => { for (const k of n.kids) { if (test(k)) out.push(k); descend(k, test, out); } return out; };

// ---------- export ----------
const f = (n) => String(Object.is(n, -0) ? 0 : n);
const vecEl = (name, [x, y, z]) => el(name, null, [el("X", null, f(x)), el("Y", null, f(y)), el("Z", null, f(z))]);
const uniq = (a) => [...new Set(a)];

function viewpointXml(sn, guid, annos) {
  const v = sn.view || {}, cam = v.camera;
  const hidden = v.hiddenGuids || [], iso = v.isolatedGuids;
  const isolating = Array.isArray(iso) && iso.length > 0;
  const exc = uniq(isolating ? iso : hidden);
  const sel = uniq(annos.map((a) => a.anchor && a.anchor.guid).filter(Boolean));
  const comp = [el("ViewSetupHints", { SpacesVisible: String(!(v.hiddenCategories || []).includes("IFCSPACE")), SpaceBoundariesVisible: "false", OpeningsVisible: "false" })];
  if (sel.length) comp.push(el("Selection", null, sel.map((g) => el("Component", { IfcGuid: g }))));
  comp.push(el("Visibility", { DefaultVisibility: String(!isolating) }, exc.length ? [el("Exceptions", null, exc.map((g) => el("Component", { IfcGuid: g })))] : undefined));
  const parts = [el("Components", null, comp)];
  if (cam && cam.position && cam.quaternion) {
    const { dir, up } = quatToDirUp(cam.quaternion);
    parts.push(el("PerspectiveCamera", null, [vecEl("CameraViewPoint", toBcfAxes(cam.position)), vecEl("CameraDirection", toBcfAxes(dir)),
      vecEl("CameraUpVector", toBcfAxes(up)), el("FieldOfView", null, f(cam.fov ?? 60))]));
  }
  const planes = (v.sections || []).filter((s) => s && s.enabled !== false && s.normal);
  if (planes.length) parts.push(el("ClippingPlanes", null, planes.map((s) => {
    const n = norm(s.normal), c = (s.constant || 0) / (Math.hypot(...s.normal) || 1);
    return el("ClippingPlane", null, [vecEl("Location", toBcfAxes(n.map((x) => -c * x))), vecEl("Direction", toBcfAxes(n.map((x) => -x)))]);
  })));
  return DECL + el("VisualizationInfo", { Guid: guid, "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance", "xmlns:xsd": "http://www.w3.org/2001/XMLSchema" }, parts);
}

/** buildBcf(case, {now}) -> Uint8Array (zip). */
export function buildBcf(c, opts = {}) {
  const files = {};
  const author = (c.meta && c.meta.author) || "Argus";
  const modified = c.updatedAt || opts.now || new Date().toISOString();
  const status = c.meta && c.meta.status === "resolved" ? "Resolved" : "Open";
  const m = c.model || {};
  files["bcf.version"] = strToU8(DECL + el("Version", { VersionId: "2.1" }, [el("DetailedVersion", null, "2.1")]));
  files["project.bcfp"] = strToU8(DECL + el("ProjectExtension", null, [el("Project", { ProjectId: toGuid(c.id || "case") }, [el("Name", null, c.name || "Case")]), el("ExtensionSchema")]));
  (c.snapshots || []).forEach((sn, i) => {
    const g = toGuid(sn.id), vpGuid = toGuid(sn.id + ":viewpoint"), dir = g + "/";
    const annos = sn.annotations || [];
    const img = parseDataUrl(sn.image || sn.thumb);
    const comments = annos.map((a) => {
      let text = a.text;
      if (a.type === "arrow" || a.type === "freehand" || (!text && a.type !== "comment" && a.type !== "text" && a.type !== "pin")) {
        const near = (a.anchor && (a.anchor.storey || a.anchor.guid)) || "model";
        text = `${a.type === "freehand" ? "Freehand" : "Arrow"} annotation near ${near}` + (a.text ? `: ${a.text}` : "");
      } else if (!text) text = a.type === "pin" ? "Pin" : "Comment";
      return el("Comment", { Guid: toGuid(a.id) }, [el("Date", null, a.createdAt || sn.createdAt || modified), el("Author", null, a.author || author),
        el("Comment", null, text), el("Viewpoint", { Guid: vpGuid })]);
    });
    const markup = el("Markup", { "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance", "xmlns:xsd": "http://www.w3.org/2001/XMLSchema" }, [
      el("Header", null, [el("File", { IfcProject: m.projectGuid || undefined, Isexternal: "true" }, [el("Filename", null, m.name || ""), el("Date", null, c.createdAt || modified)])]),
      el("Topic", { Guid: g, TopicType: "Issue", TopicStatus: status }, [
        el("Title", null, sn.title || `${c.name || "Case"} ${i + 1}`), el("Index", null, String(i + 1)), el("Labels", null, [el("Label", null, ARGUS_LABEL)]),
        el("CreationDate", null, sn.createdAt || c.createdAt || modified), el("CreationAuthor", null, author), el("ModifiedDate", null, modified),
        el("Description", null, sn.note || "")]),
      ...comments,
      el("Viewpoints", { Guid: vpGuid }, [el("Viewpoint", null, "viewpoint.bcfv"), ...(img ? [el("Snapshot", null, "snapshot." + img.ext)] : [])]),
    ]);
    files[dir + "markup.bcf"] = strToU8(DECL + markup);
    files[dir + "viewpoint.bcfv"] = strToU8(viewpointXml(sn, vpGuid, annos));
    if (img) files[dir + "snapshot." + img.ext] = img.bytes;
  });
  return zipSync(files, { level: 6 });
}

// ---------- import ----------
const normPath = (p) => p.replace(/\\/g, "/").replace(/^\.?\//, "");
const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");

/** parseBcf(bytes) -> {case, warnings[]}. Never throws on bad input. */
export function parseBcf(bytes) {
  const warnings = [];
  const warn = (w) => warnings.push(w);
  let zip;
  try { zip = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); } catch (e) { warn("Not a readable zip file: " + e.message); zip = {}; }
  const files = {};
  for (const k of Object.keys(zip)) files[normPath(k)] = zip[k];
  const read = (p) => { try { return parseXml(strFromU8(files[p])); } catch (e) { warn(`${p}: ${e.message}`); return null; } };

  if (files["bcf.version"]) {
    const v = read("bcf.version"), id = v && (v.attrs.VersionId || txt(v, "DetailedVersion"));
    if (id && !/^(2\.[01]|3\.0)/.test(id)) warn(`BCF version ${id} is untested, reading as 2.1`);
  } else warn("bcf.version is missing, assuming BCF 2.1");
  let projName = null, projId = null;
  if (files["project.bcfp"]) {
    const p = read("project.bcfp"), pr = p && kid(p, "Project");
    if (pr) { projName = txt(pr, "Name") || null; projId = pr.attrs.ProjectId || null; }
  }

  const topics = [];
  for (const path of Object.keys(files).sort()) {
    if (!/(^|\/)markup\.bcf$/i.test(path)) {
      if (!/(^|\/)(viewpoint[^/]*\.bcfv|snapshot[^/]*\.(png|jpe?g)|[^/]*\.bcfv|bcf\.version|project\.bcfp)$/i.test(path) && !path.endsWith("/")) warn(`Ignored unknown file ${path}`);
      continue;
    }
    const root = read(path); if (!root) continue;
    const topic = kid(root, "Topic");
    if (!topic) { warn(`${path}: no Topic element`); continue; }
    topics.push({ path, dir: dirOf(path), root, topic });
  }
  if (!topics.length) warn("No topics found");

  const argus = topics.length > 0 && topics.every((t) => kidsOf(kid(t.topic, "Labels"), "Label").some((l) => l.text.trim() === ARGUS_LABEL));
  const mkId = (guid, restore) => (restore && fromGuid(guid)) || randomId();
  const nowIso = new Date().toISOString();
  const snapshots = [];
  let modelFile = null, author = "", resolved = topics.length > 0, created = null, updated = null;

  topics.forEach(({ path, dir, root, topic }, ti) => {
    const file = kid(kid(root, "Header"), "File");
    if (file && !modelFile) modelFile = { name: txt(file, "Filename") || "", guid: file.attrs.IfcProject || null };
    const status = lc(topic.attrs.TopicStatus || "");
    if (!/^(closed|resolved|done|fixed)$/.test(status)) resolved = false;
    author = author || (txt(topic, "CreationAuthor") || "").trim();
    const cdate = (txt(topic, "CreationDate") || "").trim() || nowIso, mdate = (txt(topic, "ModifiedDate") || "").trim();
    if (!created || cdate < created) created = cdate;
    if (mdate && (!updated || mdate > updated)) updated = mdate;

    // viewpoints: 2.x puts them under Markup, 3.0 under Topic > Viewpoints
    const vps = descend(root, (n) => /^viewpoints?$/.test(lc(n.name)) && !!(kid(n, "Viewpoint") || { text: "" }).text.trim());
    if (vps.length > 1) warn(`${path}: ${vps.length - 1} extra viewpoint(s) ignored`);
    const vp = vps[0];
    let camera = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], fov: 60, target: [0, 0, -TARGET_DIST], flat: false };
    const view = { camera, modelPose: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] }, sections: [], hiddenGuids: [], isolatedGuids: null, hiddenCategories: [], storey: null };
    let image = null, selGuid = null;
    if (!vp) warn(`${path}: topic has no viewpoint, using a default camera`);
    else {
      const vfile = (txt(vp, "Viewpoint") || "").trim(), sfile = (txt(vp, "Snapshot") || "").trim();
      const vi = vfile && files[normPath(dir + vfile)] ? read(normPath(dir + vfile)) : null;
      if (vfile && !vi && !files[normPath(dir + vfile)]) warn(`${path}: missing viewpoint file ${vfile}`);
      if (vi) {
        const pc = kid(vi, "PerspectiveCamera") || kid(vi, "OrthogonalCamera");
        const pos = vec(kid(pc, "CameraViewPoint")), dir3 = vec(kid(pc, "CameraDirection")), up = vec(kid(pc, "CameraUpVector"));
        if (pos && dir3 && up) {
          const d = norm(fromBcfAxes(dir3)), p = fromBcfAxes(pos);
          camera.position = p; camera.quaternion = dirUpToQuat(d, fromBcfAxes(up));
          camera.target = p.map((x, i) => x + d[i] * TARGET_DIST);
          if (lc(pc.name) === "perspectivecamera") camera.fov = num(pc, "FieldOfView") ?? 60; else { camera.flat = true; warn(`${path}: orthogonal camera read as flat view`); }
        } else warn(`${path}: viewpoint has no usable camera`);
        for (const cp of kidsOf(kid(vi, "ClippingPlanes"), "ClippingPlane")) {
          const loc = vec(kid(cp, "Location")), dr = vec(kid(cp, "Direction"));
          if (!loc || !dr) { warn(`${path}: skipped a malformed clipping plane`); continue; }
          const n = norm(fromBcfAxes(dr).map((x) => -x));
          view.sections.push({ normal: n, constant: -dot(n, fromBcfAxes(loc)), enabled: true, flipped: false, preset: null });
        }
        const comps = kid(vi, "Components");
        const guids = (n) => kidsOf(n, "Component").map((c) => c.attrs.IfcGuid).filter(Boolean);
        selGuid = guids(kid(comps, "Selection"))[0] || null;
        const vis = kid(comps, "Visibility");
        if (vis) { const ex = guids(kid(vis, "Exceptions")); if (lc(vis.attrs.DefaultVisibility || "true") === "false") view.isolatedGuids = ex; else view.hiddenGuids = ex; }
        const hints = kid(comps, "ViewSetupHints");
        if (hints && lc(hints.attrs.SpacesVisible || "") === "false") view.hiddenCategories = ["IFCSPACE"];
      }
      if (sfile) {
        const b = files[normPath(dir + sfile)], ext = /\.png$/i.test(sfile) ? "png" : /\.jpe?g$/i.test(sfile) ? "jpeg" : null;
        if (!b) warn(`${path}: missing snapshot file ${sfile}`); else if (!ext) warn(`${path}: unsupported snapshot type ${sfile}`);
        else image = `data:image/${ext};base64,${bytesToB64(b)}`;
      }
    }
    const { dir: d3 } = quatToDirUp(camera.quaternion);
    const point = camera.position.map((x, i) => x + d3[i] * IN_FRONT);
    const annotations = descend(root, (n) => lc(n.name) === "comment" && (n.attrs.Guid !== undefined || n.kids.length > 0)).map((cm) => ({
      id: mkId(cm.attrs.Guid, argus), type: "comment", color: "#d9480f", text: txt(cm, "Comment") ?? "",
      author: (txt(cm, "Author") || "").trim(), createdAt: (txt(cm, "Date") || "").trim() || cdate,
      anchor: { point: point.slice(), guid: selGuid, storey: null }, target: null, path: null }));
    snapshots.push({ id: mkId(topic.attrs.Guid, argus), title: (txt(topic, "Title") || "").trim() || `Topic ${ti + 1}`, note: txt(topic, "Description") || "",
      createdAt: cdate, thumb: null, image, view, annotations });
  });

  const name = projName || (modelFile && modelFile.name) || "Imported BCF";
  return { case: {
    schema: "argus.case/1", id: (argus && projId && fromGuid(projId)) || randomId(), name, createdAt: created || nowIso, updatedAt: updated || created || nowIso,
    model: { name: (modelFile && modelFile.name) || "", sha256: null, size: null, ifcSchema: null, projectGuid: (modelFile && modelFile.guid) || null, lengthUnit: "m" },
    snapshots, meta: { author, status: resolved ? "resolved" : "open", tags: [] } }, warnings };
}

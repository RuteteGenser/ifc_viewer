// Bridge between the Cases feature and the 3D viewer. The viewer hook hands over a getter for its refs
// (see useIfcViewer.js, `cases`); everything here reads them lazily, so the adapter is created once.
// Pure helpers are exported for tests. Spec: docs/cases/CASES-SPEC.md ("view").
import * as THREE from "three";
import { fileSchemaOf } from "../ifc/stepHeader";
import { readProjectUnits } from "../ifc/projectUnits";
import { LIMITS } from "./schema";

const FLAT_FOV_MAX = 20; // same threshold the view link uses for "flat" (parallel-looking) projection
const MAX_HASH_BYTES = 100 * 1024 * 1024;
const CHUNK = 2000;
const round = (n) => Math.round(n * 1e5) / 1e5;
const arr = (v) => v.toArray().map(round);

export const chunk = (list, n = CHUNK) => {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

// A section axis name when the normal lies along a model axis (plan = Y, side = X, front = Z), else null.
export function presetOf(normal) {
  const names = ["side", "plan", "front"];
  for (let a = 0; a < 3; a++) if (Math.abs(Math.abs(normal[a]) - 1) < 1e-3) return names[a];
  return null;
}

// Plane snapshot ({ normal: Vector3, enabled }) of the clip manager -> spec section. Plane: n.X + c = 0, snapshot point = -c n.
export function sectionFromSnapshot(snap) {
  const n = snap.normal.clone().normalize();
  const constant = -n.dot(snap.point);
  return { normal: n.toArray().map(round), constant: round(constant), enabled: snap.enabled !== false, flipped: false, preset: presetOf(n.toArray()) };
}

// Spec section -> arguments for the clip manager's add(): a unit normal and a point on the plane.
export function planeFromSection(s) {
  const normal = new THREE.Vector3(...s.normal).normalize();
  return { normal, point: normal.clone().multiplyScalar(-s.constant) };
}

export const parseKey = (key) => {
  const sep = key.lastIndexOf("::");
  return { modelId: key.slice(0, sep), localId: Number(key.slice(sep + 2)) };
};

// GUIDs -> { [modelId]: localId[] } and the GUIDs no model knew about.
export async function resolveGuids(entries, guids) {
  const byModel = {};
  const found = new Set();
  for (const [modelId, { model }] of entries) {
    const ids = [];
    for (const part of chunk(guids)) {
      let res = [];
      try { res = await model.getLocalIdsByGuids(part); } catch { res = []; }
      res.forEach((id, i) => { if (id != null) { ids.push(id); found.add(part[i]); } });
    }
    byModel[modelId] = ids;
  }
  return { byModel, missing: guids.filter((g) => !found.has(g)) };
}

async function localIdsToGuids(model, ids) {
  const out = [];
  for (const part of chunk(ids)) {
    try { for (const g of await model.getGuidsByLocalIds(part)) if (g) out.push(g); } catch { /* element without a guid */ }
  }
  return out;
}

const shaCache = new WeakMap();
async function sha256Hex(bytes) {
  if (!bytes || bytes.length > MAX_HASH_BYTES || !globalThis.crypto?.subtle) return null;
  if (shaCache.has(bytes)) return shaCache.get(bytes);
  const p = crypto.subtle.digest("SHA-256", bytes).then((d) => [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("")).catch(() => null);
  shaCache.set(bytes, p);
  return p;
}

// IfcProject GlobalId, read from the text near either end of the file (exporters write it at the top or the very end).
export function projectGuidOf(bytes) {
  if (!bytes) return null;
  const SLICE = 1 << 20;
  const dec = new TextDecoder("latin1");
  const parts = bytes.length <= 2 * SLICE ? [bytes] : [bytes.subarray(0, SLICE), bytes.subarray(bytes.length - SLICE)];
  for (const p of parts) {
    const m = /IFCPROJECT\(\s*'([^']{22})'/i.exec(dec.decode(p));
    if (m) return m[1];
  }
  return null;
}

const schemaOf = (bytes) => {
  const name = bytes ? fileSchemaOf(bytes)?.name?.toUpperCase() : null;
  if (!name) return null;
  if (name.startsWith("IFC2X3")) return "IFC2X3";
  if (name.startsWith("IFC4X3")) return "IFC4X3";
  if (name.startsWith("IFC4")) return "IFC4";
  return null;
};

export function createViewerAdapter(getDeps) {
  const d = () => getDeps();

  function captureCamera() {
    const { cameraRef, controlsRef, modelsGroupRef } = d();
    const camera = cameraRef.current, controls = controlsRef.current, group = modelsGroupRef.current;
    if (!camera || !controls || !group) return null;
    return {
      camera: { position: arr(camera.position), quaternion: arr(camera.quaternion), fov: round(camera.fov), target: arr(controls.target), flat: camera.fov < FLAT_FOV_MAX },
      modelPose: { position: arr(group.position), quaternion: arr(group.quaternion) },
    };
  }

  async function captureView() {
    const base = captureCamera();
    if (!base) return null;
    const x = d();
    const manager = x.clipPlaneManagerRef.current;
    const sections = (manager?.list() || []).map((p) => manager.getPlaneSnapshot(p.id)).filter(Boolean).map(sectionFromSnapshot).slice(0, LIMITS.sectionsPerSnapshot);
    const entries = [...x.modelsRef.current.entries()];
    const categories = [...x.hiddenCategoriesRef.current];
    const isolating = x.isolatedKeysRef.current.size > 0;

    let isolatedGuids = null;
    if (isolating) {
      isolatedGuids = [];
      for (const [modelId, { model }] of entries) {
        const ids = [...x.isolatedKeysRef.current].map(parseKey).filter((k) => k.modelId === modelId).map((k) => k.localId);
        isolatedGuids.push(...(await localIdsToGuids(model, ids)));
      }
    }

    // Hidden elements: what the model reports hidden, minus what is hidden for a reason of its own
    // (rooms are off by default, hidden categories are saved as categories, an isolate set hides the rest).
    const hiddenGuids = [];
    if (!isolating) {
      for (const [, { model }] of entries) {
        let ids = [];
        try { ids = await model.getItemsByVisibility(false); } catch { continue; }
        if (!ids.length) continue;
        const skip = new Set();
        const regexes = categories.map((c) => new RegExp(`^${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"));
        if (!x.spacesShown()) regexes.push(/^IFCSPACE$/i);
        if (regexes.length) {
          try { Object.values(await model.getItemsOfCategories(regexes)).flat().forEach((id) => skip.add(id)); } catch { /* keep all */ }
        }
        hiddenGuids.push(...(await localIdsToGuids(model, ids.filter((id) => !skip.has(id)))));
      }
    }
    const sel = x.levelSel?.();
    return { ...base, sections, hiddenGuids: hiddenGuids.slice(0, LIMITS.guidsPerList), isolatedGuids, hiddenCategories: categories, storey: sel?.name || null };
  }

  // Eases the camera, the model's own turn and the field of view together. Any user input cancels it
  // (the viewer's input handlers cancel cameraAnimRef).
  function easeTo(view, ms) {
    const x = d();
    const camera = x.cameraRef.current, controls = x.controlsRef.current, group = x.modelsGroupRef.current;
    if (!camera || !controls || !group) return;
    x.cancelCameraAnim();
    x.autoFramedRef.current = false;
    const c = view.camera;
    const endPos = new THREE.Vector3(...c.position), endTarget = new THREE.Vector3(...(c.target || [0, 0, 0]));
    const endFov = c.fov;
    const pose = view.modelPose;
    const endQuat = pose ? new THREE.Quaternion(...pose.quaternion).normalize() : group.quaternion.clone();
    const endGroupPos = pose ? new THREE.Vector3(...pose.position) : group.position.clone();
    const from = { quat: group.quaternion.clone(), gpos: group.position.clone(), pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
    const set = (e) => {
      group.quaternion.copy(from.quat).slerp(endQuat, e);
      group.position.copy(from.gpos).lerp(endGroupPos, e);
      group.updateMatrixWorld(true);
      camera.fov = from.fov + (endFov - from.fov) * e;
      x.applyPose(camera, controls, { position: from.pos.clone().lerp(endPos, e), target: from.target.clone().lerp(endTarget, e) });
      x.requestRenderRef.current();
    };
    const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!ms || reduced) { set(1); return; }
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      set(k * k * (3 - 2 * k));
      x.cameraAnimRef.current = k < 1 ? requestAnimationFrame(step) : 0;
    };
    x.cameraAnimRef.current = requestAnimationFrame(step);
  }

  // Returns { missing } = number of saved element ids the open model does not contain.
  async function applyView(view, { animate = true } = {}) {
    const x = d();
    if (!view || x.modelsRef.current.size === 0) return { missing: 0 };
    x.clearSelection();
    if (view.camera) {
      x.setFlat(!!view.camera.flat);
      easeTo(view, animate ? 400 : 0);
    }

    const manager = x.clipPlaneManagerRef.current;
    if (manager) {
      for (const p of manager.list()) manager.remove(p.id);
      for (const s of (view.sections || []).slice(0, LIMITS.sectionsPerSnapshot)) {
        const { normal, point } = planeFromSection(s);
        const id = manager.add(normal, point);
        manager.setEnabled(id, s.enabled !== false);
      }
      x.setClipPlanes(manager.list());
    }

    const entries = [...x.modelsRef.current.entries()];
    let missing = 0;
    // Isolate (or plain reset when null) first: it clears hidden categories too.
    let isoKeys = new Set();
    if (view.isolatedGuids?.length) {
      const r = await resolveGuids(entries, view.isolatedGuids);
      missing += r.missing.length;
      isoKeys = new Set(Object.entries(r.byModel).flatMap(([m, ids]) => ids.map((id) => `${m}::${id}`)));
    }
    x.setIsolatedKeys(isoKeys);
    await x.applyIsolation(isoKeys);
    for (const cat of view.hiddenCategories || []) await x.setCategoryHidden(cat, true);
    if (view.hiddenGuids?.length) {
      const r = await resolveGuids(entries, view.hiddenGuids);
      missing += r.missing.length;
      for (const [modelId, ids] of Object.entries(r.byModel)) if (ids.length) await x.modelsRef.current.get(modelId).model.setVisible(ids, false);
      await x.pipelineRef.current?.fragments.core.update(true);
      x.invalidateGroupSphereRef.current();
    }
    x.requestRenderRef.current();
    return { missing };
  }

  // JPEG data URL of the 3D canvas only (no controls), scaled down to maxWidth.
  // The drawing buffer is cleared once a frame is shown, so render and copy it in the same task.
  async function captureImage({ maxWidth = 1280, quality = 0.82 } = {}) {
    const x = d();
    const renderer = x.rendererRef.current, scene = x.sceneRef.current, camera = x.cameraRef.current;
    if (!renderer || !scene || !camera) return null;
    renderer.render(scene, camera);
    const src = renderer.domElement;
    const scale = Math.min(1, maxWidth / src.width);
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(src.width * scale));
    out.height = Math.max(1, Math.round(src.height * scale));
    const g = out.getContext("2d");
    g.fillStyle = "#f2ebe0"; // the scene background; JPEG has no alpha
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(src, 0, 0, out.width, out.height);
    x.requestRenderRef.current();
    return out.toDataURL("image/jpeg", quality);
  }

  async function getModelInfo() {
    const x = d();
    const first = x.models()[0];
    const entry = first && x.modelsRef.current.get(first.id);
    if (!entry) return null;
    const bytes = entry.sourceBytes || null;
    return {
      name: first.name,
      sha256: await sha256Hex(bytes),
      size: bytes ? bytes.length : null,
      ifcSchema: schemaOf(bytes),
      projectGuid: projectGuidOf(bytes),
      lengthUnit: readProjectUnits(bytes).length,
    };
  }

  // All GlobalIds of the open models are not listed (too many); matchModel gets a lookup instead.
  async function hasGuids(guids) {
    const x = d();
    const { missing } = await resolveGuids([...x.modelsRef.current.entries()], guids);
    return { found: guids.length - missing.length, missing };
  }

  return { captureView, applyView, captureImage, getModelInfo, hasGuids };
}

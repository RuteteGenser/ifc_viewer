// The `viewer` object the annotation layer needs (src/annotations/README.md), for the real scene.
// Annotation points live in the WORLD frame the snapshot was captured in (view.modelPose). The app turns the
// model, not the camera, so a point is carried to the live scene by the pose delta  now * snapshot^-1  and
// points picked now are carried back. getBase() returns the snapshot's modelPose (or null = no delta).
import * as THREE from "three";
import { visibleByHit, stepVisibility, onScreen } from "../ifc/anchorVisibility";

const RAYS_PER_FRAME = 3;
const IDLE_FRAMES = 90; // an occlusion entry nobody asked about for this many frames is dropped

export function poseMatrix(pose, out = new THREE.Matrix4()) {
  if (!pose?.position || !pose?.quaternion) return out.identity();
  return out.compose(new THREE.Vector3(...pose.position), new THREE.Quaternion(...pose.quaternion).normalize(), new THREE.Vector3(1, 1, 1));
}

// d(): { cameraRef, modelsGroupRef, rendererRef, raycastVisibleRef, levels() }
export function createAnnotationViewer(d, getBase) {
  const subs = new Set();
  const delta = new THREE.Matrix4(), inv = new THREE.Matrix4(), base = new THREE.Matrix4();
  const v = new THREE.Vector3(), ray = new THREE.Raycaster(), plane = new THREE.Plane(), dir = new THREE.Vector3();
  const sig = new Float32Array(36);
  let version = 0, raf = 0, frame = 0, busy = false, lastSync = -1e9;
  const occ = new Map();
  let queue = Promise.resolve(); // the scene answers one ray at a time

  const parts = () => {
    const x = d();
    const camera = x.cameraRef.current, group = x.modelsGroupRef.current, canvas = x.rendererRef.current?.domElement;
    return camera && group && canvas ? { camera, group, canvas } : null;
  };
  // The overlay is the viewport wrapper; on a phone the canvas starts below the toolbars, not at the wrapper's corner.
  const origin = (p) => {
    const c = p.canvas.getBoundingClientRect(), w = (p.canvas.closest(".viewport-wrapper") || p.canvas).getBoundingClientRect();
    return { x: c.left - w.left, y: c.top - w.top };
  };
  const sync = (p) => {
    const t = performance.now();
    if (t - lastSync < 4) return;
    lastSync = t;
    p.camera.updateMatrixWorld();
    p.group.updateMatrixWorld();
    delta.copy(p.group.matrixWorld).multiply(inv.copy(poseMatrix(getBase(), base)).invert());
  };
  const toLive = (p, point) => v.set(point[0], point[1], point[2]).applyMatrix4(delta);
  const toBase = (w) => { inv.copy(delta).invert(); return w.clone().applyMatrix4(inv).toArray(); };
  const size = (p) => ({ width: p.canvas.clientWidth, height: p.canvas.clientHeight });
  // What the person can see: side panels and sheets cover part of the canvas (the app frames the model in the rest).
  const visibleSize = (p) => { const s = size(p), o = origin(p), f = d().getVisibleFrac?.() || { x: 1, y: 1 }; return { width: o.x + s.width * f.x, height: o.y + s.height * f.y }; };

  function project(point) {
    const p = parts();
    if (!p) return { x: 0, y: 0, visible: false, depth: 0 };
    sync(p);
    const ndc = toLive(p, point).project(p.camera);
    const s = size(p), o = origin(p);
    return { x: o.x + (ndc.x * 0.5 + 0.5) * s.width, y: o.y + (-ndc.y * 0.5 + 0.5) * s.height, visible: onScreen(ndc), depth: ndc.z };
  }

  const serial = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

  async function pick(clientX, clientY) {
    return serial(async () => {
      const p = parts();
      if (!p) return null;
      const hit = await d().raycastVisibleRef.current(clientX, clientY);
      if (!hit) return null;
      lastSync = -1e9;
      sync(p);
      let guid = null, storey = null;
      try { [guid] = await hit.fragments.getGuidsByLocalIds([hit.localId]); } catch { /* no guid */ }
      const key = `${hit.fragments?.modelId}::${hit.localId}`;
      storey = d().levels?.().find((l) => l.keys.includes(key))?.name ?? null;
      return { point: toBase(hit.point), guid: guid || null, storey };
    });
  }

  function unprojectOnPlane(clientX, clientY, point) {
    const p = parts();
    if (!p) return null;
    lastSync = -1e9;
    sync(p);
    const r = p.canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), p.camera);
    p.camera.getWorldDirection(dir);
    plane.setFromNormalAndCoplanarPoint(dir, toLive(p, point).clone());
    const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
    return hit ? toBase(hit) : null;
  }

  // ---- occlusion: a cached answer per point, refreshed by one ray per point after the view changed (same test and
  // two-answer debounce as the pinned tags, see ifc/anchorVisibility.js). Unknown = visible.
  function isOccluded(point) {
    const key = point.join(",");
    let e = occ.get(key);
    if (!e) occ.set(key, (e = { point, vis: { shown: true, agree: 0 }, seen: -1, tries: 0 }));
    e.q = frame;
    return !e.vis.shown;
  }

  async function check(due) {
    busy = true;
    let flipped = false;
    try {
      for (const e of due.slice(0, RAYS_PER_FRAME)) {
        const p = parts();
        if (!p) return;
        sync(p);
        const live = toLive(p, e.point).clone();
        const ndc = live.clone().project(p.camera);
        if (!onScreen(ndc)) { e.seen = version; continue; }
        const r = p.canvas.getBoundingClientRect();
        const hit = await serial(() => d().raycastVisibleRef.current(r.left + (ndc.x * 0.5 + 0.5) * r.width, r.top + (-ndc.y * 0.5 + 0.5) * r.height));
        const seen = visibleByHit(p.camera.position.distanceTo(live), hit ? p.camera.position.distanceTo(hit.point) : null);
        if (seen === null) { if (++e.tries >= 3) { e.seen = version; e.tries = 0; } continue; }
        e.tries = 0;
        e.seen = version;
        const next = stepVisibility(e.vis, seen);
        if (next.shown !== e.vis.shown) flipped = true;
        e.vis = next;
      }
    } catch { /* keep the old answers */ } finally {
      busy = false;
      if (flipped) subs.forEach((f) => f());
    }
  }

  function tick() {
    raf = 0;
    if (!subs.size) return;
    frame++;
    const p = parts();
    if (p) {
      p.camera.updateMatrixWorld();
      p.group.updateMatrixWorld();
      let changed = false;
      const put = (x, i) => { if (Math.abs(sig[i] - x) > 1e-6) { sig[i] = x; changed = true; } };
      p.camera.matrixWorld.elements.forEach((x, i) => put(x, i));
      p.group.matrixWorld.elements.forEach((x, i) => put(x, 16 + i));
      const pe = p.camera.projectionMatrix.elements;
      put(pe[0], 32); put(pe[5], 33); put(pe[8], 34); put(pe[9], 35);
      if (changed) { version++; lastSync = -1e9; subs.forEach((f) => f()); }
      if (!busy) {
        const due = [];
        for (const [k, e] of occ) {
          if (frame - e.q > IDLE_FRAMES) occ.delete(k);
          else if (e.seen !== version || e.vis.agree > 0) due.push(e);
        }
        if (due.length) check(due);
      }
    }
    raf = requestAnimationFrame(tick);
  }

  // A snapshot-frame point in the live world frame (for annotations copied into a new snapshot).
  function toWorld(point) {
    const p = parts();
    if (!p) return point;
    lastSync = -1e9;
    sync(p);
    return toLive(p, point).toArray();
  }

  return {
    project,
    toWorld,
    pick,
    isOccluded,
    unprojectOnPlane,
    getSize: () => { const p = parts(); return p ? visibleSize(p) : { width: 0, height: 0 }; },
    subscribeCamera(cb) {
      subs.add(cb);
      window.addEventListener("resize", cb);
      if (!raf) raf = requestAnimationFrame(tick);
      return () => {
        subs.delete(cb);
        window.removeEventListener("resize", cb);
        if (!subs.size) { if (raf) cancelAnimationFrame(raf); raf = 0; occ.clear(); }
      };
    },
  };
}

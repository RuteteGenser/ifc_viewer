// The Clearance measure tool, scene part: casts the four rays, draws the result and keeps it readable.
// Built once by the viewer with the pieces it already owns (label sprites, fat lines, raycast), so a clearance
// looks like every other measurement: ink pill with a halo, 2 to 3 px lines, constant on-screen size.
// All geometry is stored in modelsGroup's frame, so a clearance turns with the model and never with the camera.
import { visibleByHit, stepVisibility, onScreen } from "./anchorVisibility.js";
import { stackUp } from "./labelStack.js";
import {
  DIRECTIONS, HIT_EPSILON, boxFromChunks, nearestHit, rayExitDistance, viewDirections, clearanceLabelText,
  makeClearance, clearanceSummary, serializeClearance, deserializeClearance,
} from "./clearance.js";

const INK = 0x2a2622;
const OPEN_INK = 0x8a8073;
const LABEL_NORMAL = "#e8eaed";
const LABEL_MUTED = "#9aa0a6"; // the existing secondary style: lighter text on the same ink pill
const TICK_PIXELS = 12;
const RAYS_PER_FRAME = 3;
const FADE_MS = 120;

export function createClearanceScene(d) {
  const { THREE, modelsGroup, camera, renderer } = d;
  const entries = []; // { id, data, lines, dashes, ticks, dot, labels, anchors }
  let uid = 0;

  // ---- Rays. The fragments worker casts along a camera ray through a pixel; a throwaway camera sitting on the
  // ray origin and looking down the ray turns any world ray into that.
  const rayCamera = new THREE.PerspectiveCamera(8, 1, 0.01, 1e6);
  const rayDom = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), clientWidth: 100, clientHeight: 100 };
  const rayMouse = new THREE.Vector2(50, 50);
  const castWorldRay = async (originWorld, dirWorld) => {
    rayCamera.position.copy(originWorld);
    rayCamera.up.set(0, Math.abs(dirWorld.y) > 0.9 ? 0 : 1, Math.abs(dirWorld.y) > 0.9 ? 1 : 0);
    rayCamera.lookAt(originWorld.clone().add(dirWorld));
    rayCamera.updateMatrixWorld(true);
    const data = { camera: rayCamera, mouse: rayMouse, dom: rayDom };
    const planes = d.clippingPlanes();
    // The worker answers a cast that overlaps another one (a hover pick, a label check) with nothing, which looks
    // exactly like open air: ask again a couple of times before believing an empty answer.
    let all = [];
    for (let attempt = 0; attempt < 3 && all.length === 0; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 60));
      for (const entry of d.visibleModels()) {
        const hits = await entry.model.raycastAll(data);
        if (hits) all = all.concat(hits);
      }
    }
    // Sections: geometry the cut removed is not there to be measured to (same rule as picking).
    return planes.length ? all.filter((h) => planes.every((p) => p.distanceToPoint(h.point) >= -1e-4)) : all;
  };

  // The box of the element, in modelsGroup's frame, from its own geometry (a world box would grow when the model is turned).
  const elementBox = async (hit) => {
    const model = hit.fragments;
    modelsGroup.updateMatrixWorld(true);
    const groups = await model.getItemsGeometry([hit.localId]);
    const toLocal = new THREE.Matrix4().copy(modelsGroup.matrixWorld).invert().multiply(model.object.matrixWorld);
    const box = boxFromChunks(groups.flat(), toLocal.elements);
    if (box) return box;
    const [world] = await model.getBoxes([hit.localId]);
    if (!world) return null;
    const local = world.clone().applyMatrix4(new THREE.Matrix4().copy(modelsGroup.matrixWorld).invert());
    return { min: local.min.toArray(), max: local.max.toArray() };
  };

  // Measures from the middle of the tapped element in the four directions. Resolves to clearance data (no id yet).
  let casting = false;
  const measure = async (hit, name) => {
    casting = true;
    try {
      return await measureInner(hit, name);
    } finally {
      casting = false;
    }
  };
  const measureInner = async (hit, name) => {
    const box = await elementBox(hit);
    if (!box) return null;
    const centre = [0, 1, 2].map((k) => (box.min[k] + box.max[k]) / 2);
    modelsGroup.updateMatrixWorld(true);
    const inv = modelsGroup.quaternion.clone().invert();
    const fwd = camera.getWorldDirection(new THREE.Vector3()).applyQuaternion(inv);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).applyQuaternion(inv);
    const dirs = viewDirections(fwd.toArray(), camUp.toArray());
    const sceneBox = d.sceneBox();
    const diag = sceneBox ? sceneBox.min.distanceTo(sceneBox.max) : 1000;
    const originWorld = modelsGroup.localToWorld(new THREE.Vector3(...centre));
    const self = (h) => h.fragments?.modelId === hit.fragments.modelId && h.localId === hit.localId;
    const values = {};
    const reach = {};
    // One ray at a time: the worker answers a second cast that is already in flight with nothing.
    const cast = [];
    for (const dir of DIRECTIONS) {
      const local = new THREE.Vector3(...dirs[dir]);
      const world = local.clone().applyQuaternion(modelsGroup.quaternion).normalize();
      const hits = await castWorldRay(originWorld, world);
      // Distance in the model's frame, from the hit point itself.
      const measured = hits.map((h) => ({ h, distance: modelsGroup.worldToLocal(h.point.clone()).sub(new THREE.Vector3(...centre)).dot(local) }));
      cast.push({ dir, best: nearestHit(measured, { isSelf: (m) => self(m.h), epsilon: HIT_EPSILON, maxRange: diag }) });
    }
    for (const { dir, best } of cast) {
      if (best) {
        values[dir] = best.distance;
        reach[dir] = best.distance;
      } else {
        values[dir] = null;
        reach[dir] = Math.min(diag, sceneBox ? rayExitDistance(centre, dirs[dir], sceneBox.min.toArray(), sceneBox.max.toArray()) : diag);
      }
    }
    return makeClearance({ id: null, name, modelId: hit.fragments.modelId, localId: hit.localId, centre, dirs, values, reach });
  };

  // ---- Drawing
  const endOf = (c, dir) => new THREE.Vector3(...c.centre).addScaledVector(new THREE.Vector3(...c.dirs[dir]), c.reach[dir]);

  const labelLines = (c, dir) => [{ text: clearanceLabelText(dir, c.values[dir]), color: c.values[dir] == null ? LABEL_MUTED : LABEL_NORMAL }];

  const build = (data, id) => {
    const c = { ...data, id };
    const centre = new THREE.Vector3(...c.centre);
    const lines = {};
    const labels = {};
    const anchors = {};
    for (const dir of DIRECTIONS) {
      const open = c.values[dir] == null;
      const end = endOf(c, dir);
      const geometry = new d.LineGeometry();
      geometry.setPositions([centre.x, centre.y, centre.z, end.x, end.y, end.z]);
      const material = new d.LineMaterial({ color: open ? OPEN_INK : INK, depthTest: false, linewidth: d.lineWidth, resolution: d.resolution, dashed: open, dashSize: 0.12, gapSize: 0.1 });
      const line = new d.Line2(geometry, material);
      line.computeLineDistances();
      line.renderOrder = 999;
      line.frustumCulled = false;
      modelsGroup.add(line);
      lines[dir] = line;
      const label = d.createLabel(labelLines(c, dir), "center", 0.5);
      label.position.copy(centre).lerp(end, 0.5);
      modelsGroup.add(label);
      labels[dir] = label;
      anchors[dir] = { vis: { shown: true, agree: 0 }, seen: -1, tries: 0, fade: 1 };
    }
    const ticksGeometry = new d.LineSegmentsGeometry();
    ticksGeometry.setPositions(new Array(24).fill(0));
    const ticks = new d.LineSegments2(ticksGeometry, new d.LineMaterial({ color: INK, depthTest: false, linewidth: d.lineWidth, resolution: d.resolution }));
    ticks.renderOrder = 999;
    ticks.frustumCulled = false;
    modelsGroup.add(ticks);
    const dot = new THREE.Mesh(d.markerGeometry, new THREE.MeshBasicMaterial({ color: INK, depthTest: false }));
    dot.renderOrder = 999;
    dot.position.copy(centre);
    modelsGroup.add(dot);
    const entry = { id, data: c, lines, ticks, dot, labels, anchors };
    entries.push(entry);
    applyVisibility(entry);
    d.requestRender();
    return entry;
  };

  const applyVisibility = (entry) => {
    const on = d.tagsVisible();
    entry.dot.visible = on;
    entry.ticks.visible = on;
    for (const dir of DIRECTIONS) {
      entry.lines[dir].visible = on;
      entry.labels[dir].visible = on && entry.anchors[dir].fade > 0.01;
    }
  };

  const add = (data) => {
    const entry = build(data, `clearance-${++uid}`);
    return clearanceSummary(entry.data);
  };
  const addSerialized = (text) => {
    const data = deserializeClearance(text);
    return data ? add(data) : null;
  };

  const remove = (id) => {
    const i = entries.findIndex((e) => e.id === id);
    if (i === -1) return false;
    const [e] = entries.splice(i, 1);
    modelsGroup.remove(e.ticks, e.dot, ...DIRECTIONS.map((x) => e.lines[x]), ...DIRECTIONS.map((x) => e.labels[x]));
    for (const dir of DIRECTIONS) {
      e.lines[dir].geometry.dispose();
      e.lines[dir].material.dispose();
      e.labels[dir].material.map.dispose(); // never the shared sprite geometry
      e.labels[dir].material.dispose();
    }
    e.ticks.geometry.dispose();
    e.ticks.material.dispose();
    e.dot.material.dispose();
    d.requestRender();
    return true;
  };

  const find = (id) => entries.find((e) => e.id === id);

  // ---- Per frame: constant on-screen size, tick marks, label layout
  const fwd = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const worldPerPixel = (obj) => {
    const depth = obj.getWorldPosition(tmp).sub(camera.position).dot(fwd);
    return (2 * Math.tan((camera.fov * Math.PI) / 360) * depth) / renderer.domElement.clientHeight;
  };
  const project = (obj, out) => {
    obj.getWorldPosition(tmp).project(camera);
    out.x = (tmp.x * 0.5 + 0.5) * renderer.domElement.clientWidth;
    out.y = (-tmp.y * 0.5 + 0.5) * renderer.domElement.clientHeight;
    return out;
  };

  const frame = () => {
    if (entries.length === 0) return;
    camera.getWorldDirection(fwd);
    const invQuat = modelsGroup.quaternion.clone().invert();
    const fwdLocal = fwd.clone().applyQuaternion(invQuat);
    const rects = [];
    const owners = [];
    for (const e of entries) {
      e.dot.scale.setScalar(worldPerPixel(e.dot) * d.markerPixels);
      const positions = [];
      for (const dir of DIRECTIONS) {
        const end = endOf(e.data, dir);
        const half = (worldPerPixel(e.dot) * TICK_PIXELS) / 2;
        const side = tmp2.set(...e.data.dirs[dir]).cross(fwdLocal);
        if (side.lengthSq() < 1e-8) side.set(1, 0, 0).cross(fwdLocal);
        side.normalize().multiplyScalar(half);
        positions.push(end.x - side.x, end.y - side.y, end.z - side.z, end.x + side.x, end.y + side.y, end.z + side.z);
        const label = e.labels[dir];
        const h = worldPerPixel(label) * d.labelPixels;
        label.scale.set(h * label.userData.aspect, h, 1);
        const vertical = dir === "up" || dir === "down";
        label.center.set(vertical ? -0.12 : 0.5, vertical ? 0.5 : 1.15);
        if (label.visible) {
          const p = project(label, { x: 0, y: 0 });
          const w = d.labelPixels * label.userData.aspect;
          const cy = label.center.y;
          const cx = label.center.x;
          rects.push({ l: p.x - cx * w - 2, r: p.x + (1 - cx) * w + 2, t: p.y - (1 - cy) * d.labelPixels - 2, b: p.y + cy * d.labelPixels + 2 });
          owners.push({ label, vertical });
        }
      }
      e.ticks.geometry.setPositions(positions);
    }
    // Labels that would overlap hop up, so every number stays readable.
    const lifts = stackUp(rects, 2);
    owners.forEach((o, i) => {
      if (lifts[i] > 0) o.label.center.y -= lifts[i] / d.labelPixels;
    });
  };

  // ---- Occlusion: a number hides while something stands in front of it, with the same margin and the same
  // two-agreeing-answers hysteresis as the pinned tags.
  const pose = new Float32Array(36);
  let version = 0;
  let busy = false;
  let fadeAt = performance.now();
  const reduced = typeof window !== "undefined" ? window.matchMedia?.("(prefers-reduced-motion: reduce)") : null;
  const poseChanged = () => {
    camera.updateMatrixWorld();
    modelsGroup.updateMatrixWorld();
    let changed = false;
    const put = (v, i) => {
      if (Math.abs(pose[i] - v) > 1e-6) {
        pose[i] = v;
        changed = true;
      }
    };
    camera.matrixWorld.elements.forEach((v, i) => put(v, i));
    modelsGroup.matrixWorld.elements.forEach((v, i) => put(v, 16 + i));
    const pe = camera.projectionMatrix.elements;
    put(pe[0], 32); put(pe[5], 33); put(pe[8], 34); put(pe[9], 35);
    return changed;
  };
  const ndcOf = (label) => label.getWorldPosition(tmp).clone().project(camera);
  const check = async (due, v) => {
    busy = true;
    try {
      const rect = renderer.domElement.getBoundingClientRect();
      for (const { label, a } of due.slice(0, RAYS_PER_FRAME)) {
        const ndc = ndcOf(label);
        if (!onScreen(ndc)) continue;
        const world = label.getWorldPosition(new THREE.Vector3());
        const anchorDistance = camera.position.distanceTo(world);
        const hit = await d.raycast(rect.left + (ndc.x * 0.5 + 0.5) * rect.width, rect.top + (-ndc.y * 0.5 + 0.5) * rect.height);
        const seen = visibleByHit(anchorDistance, hit ? camera.position.distanceTo(hit.point) : null);
        if (seen === null) {
          if (++a.tries >= 3) { a.seen = v; a.tries = 0; }
          continue;
        }
        a.tries = 0;
        a.seen = v;
        a.vis = stepVisibility(a.vis, seen);
      }
    } catch (err) {
      console.error("Clearance label visibility check failed", err);
    } finally {
      busy = false;
      d.requestRender();
    }
  };
  const pump = () => {
    if (poseChanged()) version++;
    const now = performance.now();
    const dt = Math.min(100, now - fadeAt);
    fadeAt = now;
    if (entries.length === 0 || !d.tagsVisible() || casting) return;
    const items = [];
    for (const e of entries) for (const dir of DIRECTIONS) items.push({ label: e.labels[dir], a: e.anchors[dir] });
    const due = [];
    for (const it of items) {
      if (!onScreen(ndcOf(it.label))) {
        it.a.vis = { shown: false, agree: 0 };
        it.a.seen = version;
      } else if (it.a.seen !== version || it.a.vis.agree > 0) due.push(it);
    }
    if (due.length > 0 && !busy) check(due, version);
    let animating = false;
    for (const it of items) {
      const a = it.a;
      const target = a.vis.shown ? 1 : 0;
      const next = reduced?.matches ? target : a.fade + Math.sign(target - a.fade) * Math.min(Math.abs(target - a.fade), dt / FADE_MS);
      if (next !== a.fade) {
        a.fade = next;
        animating = true;
      }
      it.label.material.opacity = a.fade;
      it.label.visible = a.fade > 0.01;
    }
    if (animating) d.requestRender();
  };

  return {
    measure,
    add,
    addSerialized,
    remove,
    list: () => entries.map((e) => clearanceSummary(e.data)),
    snapshot: (id) => {
      const e = find(id);
      return e ? serializeClearance(e.data) : null;
    },
    nameOf: (id) => find(id)?.data.name ?? null,
    refreshVisibility: () => entries.forEach(applyVisibility),
    frame,
    pump,
    // for tests: the raw hits of one ray (model frame in, model frame out)
    castRaw: async (origin, dir) => {
      const o = modelsGroup.localToWorld(new THREE.Vector3(...origin));
      const w = new THREE.Vector3(...dir).applyQuaternion(modelsGroup.quaternion).normalize();
      const hits = await castWorldRay(o, w);
      return hits.map((h) => ({ localId: h.localId, modelId: h.fragments?.modelId, distance: h.distance, point: modelsGroup.worldToLocal(h.point.clone()).toArray() }));
    },
    debug: () => entries.map((e) => ({ ...clearanceSummary(e.data), centre: e.data.centre, values: e.data.values, reach: e.data.reach, labels: Object.fromEntries(DIRECTIONS.map((x) => [x, { visible: e.labels[x].visible, shown: e.anchors[x].vis.shown }])) })),
  };
}

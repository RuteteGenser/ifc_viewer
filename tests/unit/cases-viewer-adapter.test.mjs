import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { chunk, presetOf, sectionFromSnapshot, planeFromSection, parseKey, projectGuidOf, createViewerAdapter } from "../../src/cases/viewerAdapter.js";

test("chunk splits a list", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 2), []);
});

test("presetOf names the model axis a normal lies along", () => {
  assert.equal(presetOf([0, -1, 0]), "plan");
  assert.equal(presetOf([1, 0, 0]), "side");
  assert.equal(presetOf([0, 0, -1]), "front");
  assert.equal(presetOf([0.6, 0.8, 0]), null);
});

test("a plane survives section -> plane -> section", () => {
  const snap = { normal: new THREE.Vector3(0, -1, 0), point: new THREE.Vector3(0, 3.2, 0), enabled: true };
  const section = sectionFromSnapshot(snap);
  assert.equal(section.preset, "plan");
  assert.equal(section.constant, 3.2); // -n.p = 3.2
  const { normal, point } = planeFromSection(section);
  assert.ok(normal.distanceTo(snap.normal) < 1e-9);
  // the plane through `point` with `normal` is the same plane: n.X + c = 0
  assert.ok(Math.abs(normal.dot(point) + section.constant) < 1e-9);
});

test("parseKey and projectGuidOf", () => {
  assert.deepEqual(parseKey("model-1::42"), { modelId: "model-1", localId: 42 });
  const ifc = new TextEncoder().encode("DATA;\n#1=IFCPROJECT('0YvhS0LWT7Ru6kLQf2KbZV',#2,'P',$);\n");
  assert.equal(projectGuidOf(ifc), "0YvhS0LWT7Ru6kLQf2KbZV");
  assert.equal(projectGuidOf(null), null);
});

function fakeViewer() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(5, 6, 7);
  camera.lookAt(0, 0, 0);
  const controls = { target: new THREE.Vector3(1, 2, 3), update() {} };
  const group = new THREE.Group();
  group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
  const planes = new Map();
  const manager = {
    list: () => [...planes.keys()].map((id) => ({ id })),
    getPlaneSnapshot: (id) => planes.get(id),
    add: (normal, point) => { const id = `c${planes.size + 1}`; planes.set(id, { normal: normal.clone(), point: point.clone(), enabled: true }); return id; },
    remove: (id) => planes.delete(id),
    setEnabled: (id, e) => { planes.get(id).enabled = e; },
  };
  const guids = { 1: "G1", 2: "G2", 3: "G3" };
  const hidden = new Set([1]);
  const model = {
    getItemsByVisibility: async () => [...hidden],
    getItemsOfCategories: async () => ({}),
    getGuidsByLocalIds: async (ids) => ids.map((i) => guids[i] ?? null),
    getLocalIdsByGuids: async (gs) => gs.map((g) => Number(Object.keys(guids).find((k) => guids[k] === g)) || null),
    setVisible: async (ids, v) => ids.forEach((i) => (v ? hidden.delete(i) : hidden.add(i))),
  };
  const state = { flat: null, isolated: null, cleared: 0, rendered: 0 };
  const deps = {
    cameraRef: { current: camera }, controlsRef: { current: controls }, modelsGroupRef: { current: group },
    modelsRef: { current: new Map([["m1", { model, sourceBytes: new TextEncoder().encode("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;") }]]) },
    requestRenderRef: { current: () => { state.rendered++; } }, clipPlaneManagerRef: { current: manager }, setClipPlanes: () => {},
    hiddenCategoriesRef: { current: new Set() }, isolatedKeysRef: { current: new Set() },
    setIsolatedKeys: (k) => { state.isolated = k; }, applyIsolation: async () => {}, setCategoryHidden: async () => {},
    cancelCameraAnim: () => {}, cameraAnimRef: { current: 0 }, autoFramedRef: { current: true },
    applyPose: (cam, ctl, pose) => { cam.position.copy(pose.position); ctl.target.copy(pose.target); cam.lookAt(ctl.target); },
    clearSelection: () => { state.cleared++; }, pipelineRef: { current: null }, invalidateGroupSphereRef: { current: () => {} },
    setFlat: (f) => { state.flat = f; }, models: () => [{ id: "m1", name: "a.ifc" }], spacesShown: () => true, levelSel: () => ({ name: "Level 2" }),
  };
  return { deps, camera, controls, group, planes, hidden, state, manager };
}

test("captureView reads the camera, model pose, sections, hidden ids and storey", async () => {
  const v = fakeViewer();
  v.manager.add(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 2, 0));
  const a = createViewerAdapter(() => v.deps);
  const view = await a.captureView();
  assert.deepEqual(view.camera.position, [5, 6, 7]);
  assert.deepEqual(view.camera.target, [1, 2, 3]);
  assert.equal(view.camera.flat, false);
  assert.equal(view.modelPose.quaternion.length, 4);
  assert.equal(view.sections.length, 1);
  assert.equal(view.sections[0].preset, "plan");
  assert.deepEqual(view.hiddenGuids, ["G1"]);
  assert.equal(view.isolatedGuids, null);
  assert.equal(view.storey, "Level 2");
});

test("applyView restores the pose and sections, hides by GUID and counts the ones not found", async () => {
  const v = fakeViewer();
  const a = createViewerAdapter(() => v.deps);
  const view = await a.captureView();
  v.camera.position.set(0, 0, 50);
  v.group.quaternion.identity();
  v.hidden.clear();
  view.hiddenGuids = ["G2", "G404"];
  view.sections = [{ normal: [1, 0, 0], constant: -4, enabled: true, flipped: false, preset: "side" }];
  const res = await a.applyView(view, { animate: false });
  assert.equal(res.missing, 1);
  assert.deepEqual([...v.hidden], [2]);
  assert.ok(v.camera.position.distanceTo(new THREE.Vector3(5, 6, 7)) < 1e-4);
  assert.ok(v.group.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5)) < 1e-4);
  assert.equal(v.planes.size, 1);
  assert.equal(v.state.cleared, 1);
  assert.equal(v.state.flat, false);
});

test("applyView with an isolate set turns GUIDs into model keys", async () => {
  const v = fakeViewer();
  const a = createViewerAdapter(() => v.deps);
  const view = await a.captureView();
  view.isolatedGuids = ["G3", "nope"];
  const res = await a.applyView(view, { animate: false });
  assert.deepEqual([...v.state.isolated], ["m1::3"]);
  assert.equal(res.missing, 1);
});

test("getModelInfo reports name, size and schema; sha256 of the bytes", async () => {
  const v = fakeViewer();
  const info = await createViewerAdapter(() => v.deps).getModelInfo();
  assert.equal(info.name, "a.ifc");
  assert.equal(info.ifcSchema, "IFC4");
  assert.match(info.sha256, /^[0-9a-f]{64}$/);
  assert.equal(info.size, 52);
});

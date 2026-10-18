import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { robustUnion, planeSheetFor } from "../../src/ifc/modelBounds.js";

const box = (cx, cy, cz, s = 1) =>
  new THREE.Box3(new THREE.Vector3(cx - s / 2, cy - s / 2, cz - s / 2), new THREE.Vector3(cx + s / 2, cy + s / 2, cz + s / 2));

// 10x10 grid of unit cubes, 0..90 m on x and z
const grid = () => Array.from({ length: 100 }, (_, i) => box((i % 10) * 10, 0, Math.floor(i / 10) * 10));

test("no boxes: null, nothing dropped", () => {
  assert.deepEqual(robustUnion([]), { box: null, dropped: 0 });
  assert.deepEqual(robustUnion([null, new THREE.Box3()]), { box: null, dropped: 0 });
});

test("fewer than 30 elements: plain union, outliers kept", () => {
  const boxes = [...Array.from({ length: 10 }, (_, i) => box(i, 0, 0)), box(5000, 0, 0)];
  const { box: b, dropped } = robustUnion(boxes);
  assert.equal(dropped, 0);
  assert.ok(b.max.x > 4999);
});

test("a stray element far outside a 100-element model is dropped from the framing", () => {
  const boxes = [...grid(), box(5000, 0, 0)];
  const { box: b, dropped } = robustUnion(boxes);
  assert.equal(dropped, 1);
  assert.ok(b.max.x < 100, `max x ${b.max.x}`);
  assert.ok(b.min.x < 1 && b.max.z > 89);
});

test("a ground plane much bigger than the building is dropped", () => {
  const boxes = [...grid(), new THREE.Box3(new THREE.Vector3(-300, -1, -300), new THREE.Vector3(400, 0, 400))];
  const { box: b, dropped } = robustUnion(boxes);
  assert.equal(dropped, 1);
  assert.ok(b.max.x < 100);
});

test("a well-behaved model is returned whole", () => {
  const { box: b, dropped } = robustUnion(grid());
  assert.equal(dropped, 0);
  assert.equal(b.min.x, -0.5);
  assert.equal(b.max.x, 90.5);
});

test("planeSheetFor: no bounds -> null; floor plane is centred and 1.1x the longer side", () => {
  assert.equal(planeSheetFor({ normal: new THREE.Vector3(0, 1, 0), constant: 0 }, [{ localBox: null }]), null);
  const entries = [{ localBox: new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 10, 10)) }];
  const sheet = planeSheetFor({ normal: new THREE.Vector3(0, 1, 0), constant: -4 }, entries);
  assert.equal(sheet.centre.y, 4);
  assert.equal(sheet.centre.x, 10);
  assert.ok(Math.abs(sheet.side - 22) < 1e-9);
});

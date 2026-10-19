import test from "node:test";
import assert from "node:assert/strict";
import { projectAtCapture } from "../../src/cases/burnAnnotations.js";
import { poseMatrix } from "../../src/cases/annotationViewer.js";

// Camera at z = 10 looking down -z (identity quaternion), fov 90: the point (0,0,0) is the picture centre.
const view = { camera: { position: [0, 0, 10], quaternion: [0, 0, 0, 1], fov: 90 } };

test("projectAtCapture: centre, right and up map to the expected pixels", () => {
  const c = projectAtCapture(view, 200, 100, [0, 0, 0]);
  assert.ok(Math.abs(c.x - 100) < 1e-6 && Math.abs(c.y - 50) < 1e-6);
  const up = projectAtCapture(view, 200, 100, [0, 10, 0]); // tan(45) * distance 10 = top edge
  assert.ok(Math.abs(up.y) < 1e-6);
  const right = projectAtCapture(view, 200, 100, [20, 0, 0]); // aspect 2: right edge at x = 20
  assert.ok(Math.abs(right.x - 200) < 1e-6);
});

test("projectAtCapture: behind the camera and no camera give null", () => {
  assert.equal(projectAtCapture(view, 200, 100, [0, 0, 20]), null);
  assert.equal(projectAtCapture({}, 200, 100, [0, 0, 0]), null);
});

test("poseMatrix: identity without a pose, composes position and rotation with one", () => {
  assert.deepEqual(poseMatrix(null).elements.slice(0, 4), [1, 0, 0, 0]);
  const m = poseMatrix({ position: [1, 2, 3], quaternion: [0, 0, 0, 1] });
  assert.deepEqual(m.elements.slice(12, 15), [1, 2, 3]);
});

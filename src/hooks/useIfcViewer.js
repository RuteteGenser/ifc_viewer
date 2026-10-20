import { buildElementDetails, readProjectUnits } from "../ifc/elementDetails";
import useModelBrowser from "./useModelBrowser";
import { formatLength } from "../ifc/formatLength";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { unzip, zip } from "fflate";
import {
  closeRawIfcModel,
  extractDimensionTagData,
  extractElementIfcData,
  isEligibleCategoryName,
  openRawIfcModel,
} from "../ifc/rawIfcQuery";
import { formatDimensionTag } from "../ifc/dimensionTagFormat";
import { cueStep } from "../ifc/zoomCue";
import { importIfcInWorker, releaseImporterMemory } from "../ifc/ifcImportClient";
import { KIND, ImportError, classifyFailure, describeFailure, failureDetails, isRetryable, toImportError } from "../reliability/importErrors";
import { isStaleBuild, refreshFailedAssets, registerOpenWork, reloadResuming, runningBuildId, startupIntent } from "../reliability/recovery";
import { BACKOFF_MS, attemptText, sleep, stallLimitMs } from "../reliability/retry";
import { HEAD_BYTES, hasStepHeader, isZip } from "../ifc/stepHeader";
import { LoadQueue, buildLimitMs, fileKind, ifcEntries, mayRetryStall, queuedText } from "../reliability/loadPlan";
import { useViewFeatures } from "./useViewFeatures";
import useSpaceVisibility from "./useSpaceVisibility";
import { createViewerAdapter } from "../cases/viewerAdapter";
import { robustUnion } from "../ifc/modelBounds";
import { sheetRect, PLANE_COLORS, SHEET_OPACITY, planesToDrop, activeAfterRemove, axisOf, KIND_BY_AXIS, miniSlab } from "../ifc/sectionPlanes";
import { stackUp } from "../ifc/labelStack";
import { createPressRings } from "../ifc/pressRings";
import { visibleByHit, stepVisibility, onScreen } from "../ifc/anchorVisibility";

const IFC_EXTENSION = /\.ifc$/i;
// buildingSMART's ifcZIP format is a plain ZIP archive containing one or
// more .ifc (or .ifcXML, not supported by this viewer) files, no special
// re-encoding; a .zip holding an .ifc is opened the same way (see fileKind).
const MAX_IFC_BYTES = 1.5 * 1024 * 1024 * 1024; // beyond this a browser tab cannot hold the file and its geometry

let uid = 0;
function nextId() {
  uid += 1;
  return `model-${Date.now()}-${uid}`;
}

// A per-item worker-backed change (setVisible, highlight, ...) resolving
// only means the request was accepted, not that the affected tiles have
// actually been rebuilt and are ready to draw. That rebuild happens on
// FragmentsModels' own internal update cycle, which is rate-limited to
// once per `maxUpdateRate` (100ms) — including the animate loop's own
// unconditional per-frame `core.update()` call, which means calling
// `core.update(true)` ourselves right after the change is usually a
// no-op (it hits the exact same rate limit and gets silently skipped).
// Neither awaiting that call nor waiting for the model's `onViewUpdated`
// event (confirmed by testing against a production build: both still
// sometimes left the stale frame on screen, needing an unrelated later
// interaction to finally show the change) reliably catches the moment
// the rebuild actually lands. Rendering on every frame for a short
// window instead guarantees the very next frame after whichever
// natural ~100ms cycle picks up the change also gets drawn, without
// needing to know exactly when that happens.
export function renderForAWhile(requestRender, durationMs = 1000) {
  const deadline = performance.now() + durationMs;
  const tick = () => {
    requestRender();
    if (performance.now() < deadline) requestAnimationFrame(tick);
  };
  tick();
}

// Visual-only whole-model color override. Deliberately does NOT use
// FragmentsModel's own setColor()/resetColor()/highlight() API — a
// rigorous check confirmed those calls resolve successfully (and
// getHighlight() would report the change) but never actually change
// what's rendered, the same silent-no-op this codebase already hit with
// per-item highlight() (see showHighlightFill's own comment on that).
// This instead walks the model's real THREE.Mesh children directly and
// swaps in a cloned, recolored material — each mesh's *original*
// material is stashed on `userData.originalMaterial` the first time an
// override is applied (never disposed — it may still be owned/shared by
// fragments' own MaterialManager) so resetting is exact, not a lossy
// "put back some default." Passing `color: null` restores it. Called
// both directly (picking a new color) and defensively from a model's
// onViewUpdated event (tiles regenerate in the background on LOD/
// visibility changes, which would otherwise silently drop the override
// on a rebuilt tile — see where onViewUpdated is wired up below).
function applyModelColorOverride(object, color) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    const wasOverridden = !!child.userData.originalMaterial;

    if (color) {
      // Per-mesh try/catch is load-bearing, not defensive fluff: some
      // tile materials (confirmed for fragments' own LOD placeholder
      // tiles, streamed in the background for any model complex enough
      // to trigger LOD) aren't a plain color-bearing material at all —
      // cloning one throws (three.js's Material.clone() calls `new
      // this.constructor()` with no arguments, and that material's
      // constructor dereferences a required argument and throws on
      // undefined). Object3D.traverse() has no per-child error
      // isolation, so one uncaught throw here used to abort the *entire*
      // traversal, silently leaving every mesh visited afterward
      // uncolored — exactly the "not all elements changed" bug. A
      // skipped mesh here is harmless: if it's a transient LOD
      // placeholder, the next onViewUpdated cycle retries once fragments
      // swaps in real geometry with a normal material.
      try {
        const previousOverride = wasOverridden ? child.material : null;
        if (!wasOverridden) child.userData.originalMaterial = child.material;
        const source = child.userData.originalMaterial;
        const sourceMats = Array.isArray(source) ? source : [source];
        const overridden = sourceMats.map((m) => {
          // LOD placeholder tiles use `LodMaterial`, a THREE.ShaderMaterial
          // with no plain `.color` — its color lives in a `lodColor`
          // uniform, and its instances are shared across every tile using
          // the same base color (fragments' own MaterialManager caches
          // them by definition). Mutate the shared instance's uniform in
          // place instead of cloning: cloning would throw (see above), and
          // even if it didn't, tiles would need re-pointing at the clone
          // every time fragments regenerates them.
          if (m.isLodMaterial) {
            if (!m.userData.originalLodColor) m.userData.originalLodColor = m.lodColor.clone();
            m.lodColor.set(color);
            return m;
          }
          const clone = m.clone();
          clone.color.set(color);
          return clone;
        });
        child.material = Array.isArray(source) ? overridden : overridden[0];
        // Only dispose the previous override *after* the new one is
        // built successfully — disposing first (as this used to do)
        // would leave the mesh materialless if the clone above threw.
        // Never dispose a LodMaterial here — it's the same shared
        // instance as `source`/`overridden` (mutated, not cloned), still
        // in active use by other tiles.
        if (previousOverride) {
          const prevMats = Array.isArray(previousOverride) ? previousOverride : [previousOverride];
          prevMats.forEach((m) => {
            if (!m.isLodMaterial) m.dispose();
          });
        }
        // Repeated-geometry instances (bolts, windows, structural
        // members) can carry their own per-instance tint in
        // `instanceColor`, which three.js's instancing shader multiplies
        // into the material's base color — left alone, that would blend
        // the override with each instance's original hue instead of a
        // flat color. Suppress it for the duration of the override
        // (nulling it makes the shader skip the multiply entirely) and
        // restore it on clear, symmetric with the material itself.
        if (child.isInstancedMesh && child.instanceColor && !child.userData.originalInstanceColor) {
          child.userData.originalInstanceColor = child.instanceColor;
          child.instanceColor = null;
        }
      } catch (err) {
        if (!wasOverridden) delete child.userData.originalMaterial;
        if (!child.userData.colorOverrideSkipped) {
          child.userData.colorOverrideSkipped = true;
          console.warn("Skipped color override for a mesh with a non-standard material", err);
        }
      }
    } else if (wasOverridden) {
      const source = child.userData.originalMaterial;
      const currentMats = Array.isArray(child.material) ? child.material : [child.material];
      currentMats.forEach((m) => {
        if (m.isLodMaterial) {
          if (m.userData.originalLodColor) {
            m.lodColor.set(m.userData.originalLodColor);
            delete m.userData.originalLodColor;
          }
        } else {
          m.dispose();
        }
      });
      child.material = source;
      delete child.userData.originalMaterial;
      if (child.userData.originalInstanceColor) {
        child.instanceColor = child.userData.originalInstanceColor;
        delete child.userData.originalInstanceColor;
      }
    }
  });
}

// `object` reflects the *current* world transform (including any rotation
// applied by the arcball drag below), unlike the fragments library's own
// `model.box`, which is fixed at load time and would go stale once the
// model group starts rotating.
const MIN_SURFACE_DISTANCE = 0.2; // metres

// Zoom tuning, all in one place. Lengths other than minSurface are measured
// in "fit distance" L: how far the camera sits to frame the whole scene at
// the current field of view (so big models, tiny models and flat view all
// feel alike).
const ZOOM = {
  minSurface: MIN_SURFACE_DISTANCE, // closest approach to the surface under the cursor, metres (capped at 5% of L for tiny models)
  maxFitFactor: 3, // furthest the camera may sit from the scene centre, as a multiple of L
  stepFrac: 0.03, // one mouse-wheel notch (100 px) moves the camera this fraction of L, whatever the distance
  maxNotchesPerEvent: 3, // cap for a single wheel event
  keyNotches: 3, // notches per + / - key press or button tap
  easeMs: 90, // time constant of the glide toward the zoom goal
  softNotches: 2, // the last 2 notches before a limit ease out ...
  softFloor: 0.35, // ... down to this fraction of a full step (never zero, so the limit is reached in finite time)
};

function getSceneBox(entries) {
  const box = new THREE.Box3();
  let hasContent = false;
  for (const entry of entries) {
    const { object } = entry;
    if (!object.visible) continue;
    // Prefer the exact union of the elements' own boxes (see
    // computeModelLocalBox): the raw object box is inflated by tile bounds.
    let objectBox;
    if (entry.localBox && object.parent) {
      object.parent.updateMatrixWorld(true);
      objectBox = entry.localBox.clone().applyMatrix4(object.parent.matrixWorld);
    } else {
      objectBox = new THREE.Box3().setFromObject(object);
    }
    if (!objectBox.isEmpty()) {
      box.union(objectBox);
      hasContent = true;
    }
  }
  return hasContent ? box : null;
}

// Union of every drawn element's real bounding box, expressed in the model
// group's local frame (call while the group is still in its load pose).
// Stray far-away elements are ignored (see ifc/modelBounds.js).
async function computeModelLocalBox(model, group) {
  const ids = await model.getItemsIdsWithGeometry();
  const all = [];
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const boxes = await model.getBoxes(ids.slice(i, i + CHUNK));
    for (const b of boxes) if (b && !b.isEmpty()) all.push(b);
  }
  const { box: world } = robustUnion(all);
  if (!world) return null;
  group.updateMatrixWorld(true);
  const inverse = group.matrixWorld.clone().invert();
  // The section sheet must cover everything, strays included.
  const full = new THREE.Box3();
  for (const b of all) full.union(b);
  return { box: world.applyMatrix4(inverse), full: full.applyMatrix4(inverse) };
}

const TOUCH_UI = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

const DEFAULT_VIEW_DIR = new THREE.Vector3(1, 0.8, 1).normalize();

function boxCorners(box) {
  const out = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

// Normalised-device bounds of points as the camera currently sees them.
function ndcBounds(camera, points) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const v = new THREE.Vector3();
  for (const p of points) {
    v.copy(p).project(camera);
    b.minX = Math.min(b.minX, v.x);
    b.maxX = Math.max(b.maxX, v.x);
    b.minY = Math.min(b.minY, v.y);
    b.maxY = Math.max(b.maxY, v.y);
  }
  return b;
}

function placeCamera(camera, target, dir, distance) {
  camera.position.copy(target).addScaledVector(dir, distance);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
}

// Computes (without applying) the camera pose that fits `box` into the part
// of the canvas that is not covered by UI. `frac` is the visible rectangle
// as a fraction of the canvas ({x, y}); with the camera's view offset set to
// centre that rectangle, it spans [-frac.x, frac.x] x [-frac.y, frac.y] in
// normalised device coordinates, so the fit is done in those units.
function withoutViewOffset(camera, fn) {
  const saved = camera.view ? { ...camera.view } : null;
  if (saved?.enabled) {
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  try {
    return fn();
  } finally {
    if (saved?.enabled) {
      camera.setViewOffset(saved.fullWidth, saved.fullHeight, saved.offsetX, saved.offsetY, saved.width, saved.height);
      camera.updateProjectionMatrix();
    }
  }
}

const FIT_MARGIN = 0.82; // the model fills about 82% of the free area, leaving ~9% each side

function computeFit(camera, box, frac, dir, margin = FIT_MARGIN) {
  return withoutViewOffset(camera, () => computeFitRaw(camera, box, frac, dir, margin));
}

function computeFitRaw(camera, box, frac, dir, margin) {
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.5);
  const corners = boxCorners(box);
  const saved = camera.position.clone();
  const savedQ = camera.quaternion.clone();
  const target = center.clone();
  let distance = radius * 3;
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  for (let iter = 0; iter < 4; iter++) {
    let lo = radius * 1.05;
    let hi = radius * 80;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      placeCamera(camera, target, dir, mid);
      const b = ndcBounds(camera, corners);
      const ext = Math.max(
        Math.max(Math.abs(b.minX), Math.abs(b.maxX)) / frac.x,
        Math.max(Math.abs(b.minY), Math.abs(b.maxY)) / frac.y,
      );
      if (ext > margin) lo = mid;
      else hi = mid;
    }
    distance = hi;
    placeCamera(camera, target, dir, distance);
    const b = ndcBounds(camera, corners);
    const mx = (b.minX + b.maxX) / 2;
    const my = (b.minY + b.maxY) / 2;
    if (Math.abs(mx) < 0.002 && Math.abs(my) < 0.002) break;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    target.addScaledVector(right, mx * tanHalf * camera.aspect * distance);
    target.addScaledVector(up, my * tanHalf * distance);
  }
  const pose = { target, position: target.clone().addScaledVector(dir, distance), distance, radius };
  camera.position.copy(saved);
  camera.quaternion.copy(savedQ);
  camera.updateMatrixWorld(true);
  return pose;
}

function applyPose(camera, controls, pose) {
  controls.target.copy(pose.target);
  camera.position.copy(pose.position);
  const d = pose.distance ?? camera.position.distanceTo(pose.target);
  camera.near = Math.max(d / 1000, 0.01);
  camera.far = d * 100;
  camera.updateProjectionMatrix();
  controls.update();
}

function frameCameraOnScene(camera, controls, entries, frac = { x: 1, y: 1 }, dir = DEFAULT_VIEW_DIR) {
  const box = getSceneBox(entries);
  if (!box) return null;
  const pose = computeFit(camera, box, frac, dir);
  applyPose(camera, controls, pose);
  return pose;
}

/**
 * Owns the Three.js scene/camera/renderer/controls and the web-ifc parsing
 * pipeline. Returns everything a React UI needs to drive it: a ref to
 * attach to the viewport container, the list of loaded models, and
 * functions to load/show/hide/remove them.
 */
export function useIfcViewer() {
  const containerRef = useRef(null);
  const pipelineRef = useRef(null); // { components, fragments, ifcLoader }
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const rendererRef = useRef(null);
  const modelsGroupRef = useRef(null); // THREE.Group holding every loaded model, rotated as a unit
  const clipPlaneManagerRef = useRef(null); // { add, remove, flip, setEnabled, setGizmoVisible, list } | null
  const modelsRef = useRef(new Map()); // modelId -> { model: FragmentsModel, object: THREE.Object3D }
  const rawIfcHandlesRef = useRef(new Map()); // modelId -> { api, modelID } | never entered if sourceBytes is unavailable — lazily opened raw web-ifc models, for data getItemsData can't reach (see rawIfcQuery.js)
  const modelNamesRef = useRef(new Map()); // modelId -> display name, kept in sync with `models` state
  const modelColorsRef = useRef(new Map()); // modelId -> hex color string | null, kept in sync with `models` state
  const invalidateGroupSphereRef = useRef(() => {});
  const requestRenderRef = useRef(() => {});
  const pendingSurfacePickRef = useRef(null); // { id, promise } | null
  const clearHighlightRef = useRef(() => {});
  const selectElementFromRef = useRef(null); // set by the main effect; lets the structure tree select an element like a click does
  const selectedHitRef = useRef(null); // { modelId, localId } | null — identifies the current selection
  const cameraClipPlaneRef = useRef(new THREE.Plane());
  const cameraClipEnabledRef = useRef(false);
  const cameraClipDistanceRef = useRef(0);
  const measureManagerRef = useRef(null); // { addPoint, cancelPending, remove, list } | null
  const hoverLabelRef = useRef(null); // DOM node the App renders; text/position are written directly (no React churn per mouse move)
  const measureModeActiveRef = useRef(false);
  const showMeasureDeletePopupRef = useRef(() => {});
  const measureDeletePopupRef = useRef(null); // mirrors measureDeletePopup state, for the imperative animate() loop
  const measureLegEditPopupRef = useRef(null); // mirrors measureLegEditPopup state, for the imperative animate() loop
  const raycastVisibleRef = useRef(async () => null); // bridges the effect-scoped raycastVisible out to top-level callbacks
  const lastPointerClientRef = useRef({ x: 0, y: 0 }); // last known mouse position, for keyboard shortcuts that need a cursor-relative raycast
  // Undo/redo history for the "modeling" actions below (hide element,
  // clip plane create/remove/flip, measurement create/remove) — each
  // entry is a { undo, redo } pair of (possibly async) callbacks. Model
  // load/remove, camera/view changes, visibility checkboxes, and
  // selection are intentionally not tracked here.
  const viewInsetBottomRef = useRef(0);
  const autoFramedRef = useRef(false); // true until the user moves the camera themselves; insets then re-fit the model
  const cameraAnimRef = useRef(0);
  const zoomStepRef = useRef(() => {}); // (notches) => void, set by the main effect; used by the zoom keys and buttons
  const zoomCancelRef = useRef(() => {}); // drops any pending zoom glide; set by the main effect
  const zoomMetricsRef = useRef(() => null); // () => { L, min, max, step, center } | null; set by the main effect
  const showToastRef = useRef(() => {});
  const clipMoveModeRef = useRef(false);
  const refitModelRef = useRef(() => {});
  const pressRingsRef = useRef(null);
  const selectionTouchedRef = useRef(false); // an element has been selected: the info sheet never moves the camera after that
  const fitByFocusRef = useRef(false); // the last focus re-fitted the whole model; re-fit again when the sheet size changes
  const selectionAnchorRef = useRef(null); // selected point in modelsGroup-local coordinates
  const viewInsetRightRef = useRef(0);
  const applyViewInsetRef = useRef(() => {});
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  // Degrees, measured from the model's own local -Z axis (an arbitrary
  // reference with no inherent geographic meaning) to true north. Purely
  // a display calibration for the compass below — it's read every frame
  // by the animate loop's compass calculation, but never touches
  // modelsGroup itself.
  const northOffsetRef = useRef(0);
  const tagToolActiveRef = useRef(false);
  const tagsVisibleRef = useRef(true);
  const categoryHideModeActiveRef = useRef(false);
  // Uppercase IFC category names (e.g. "IFCWALLSTANDARDCASE") currently
  // hidden via the hide-category tool — the source of truth read/written
  // from inside the imperative effect below; `hiddenCategories` state
  // (declared with the other useState calls) is a derived snapshot kept
  // in sync for the sidebar's list to render from.
  const hiddenCategoriesRef = useRef(new Set());
  // guid -> {shape,diameter,width,height,length} | null — avoids
  // re-extracting the same element's dimension data on every hover frame;
  // cleared per-model in removeModel.
  const dimensionExtractionCacheRef = useRef(new Map());
  const clearDimensionTagsForModelRef = useRef(() => {});
  const unpinDimensionTagRef = useRef(() => {});
  const clearAllDimensionPinsRef = useRef(() => {});
  const clearHoveredDimensionTagRef = useRef(() => {});
  const refreshAllDimensionTagsVisibilityRef = useRef(() => {});
  const refreshMeasurementsVisibilityRef = useRef(() => {});

  const [models, setModels] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("");
  const [error, setError] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false); // the last load ended in an error worth retrying
  const [errorInfo, setErrorInfo] = useState(null); // { details, intent } for the banner's Details and Reload; see appendError
  const [toast, setToast] = useState(null); // { id, text } | null — short self-dismissing notice
  const toastTimerRef = useRef(0);
  const [clipMoveMode, setClipMoveModeState] = useState(false); // touch: one-finger drag slides the section plane instead of orbiting
  const loadTokenRef = useRef(0); // bumped by every load and by Cancel, so a stale load can tell it was abandoned
  const cancelLoadRef = useRef(() => {});
  const lastLoadFilesRef = useRef(null);
  const [ready, setReady] = useState(false);
  const pendingFilesRef = useRef(null); // files chosen before the viewer finished starting
  const loadingNowRef = useRef(false); // mirrors isLoading for code outside React (see registerOpenWork)
  useEffect(() => {
    loadingNowRef.current = isLoading;
  }, [isLoading]);
  // A chunk that fails to download must never reload the page away from an
  // open model, one being opened or one waiting to be opened (see main.jsx).
  useEffect(() => {
    registerOpenWork(() => modelsRef.current.size > 0 || loadingNowRef.current || !!pendingFilesRef.current?.length);
  }, []);
  const [clipPlanes, setClipPlanes] = useState([]); // [{ id, enabled, gizmoVisible }]
  const [contextMenu, setContextMenu] = useState(null); // { x, y } | null
  const [cameraClipEnabled, setCameraClipEnabledState] = useState(false);
  const [cameraClipDistance, setCameraClipDistanceState] = useState(0);
  const [cameraClipMax, setCameraClipMax] = useState(1);
  const [selectedElement, setSelectedElement] = useState(null);
  const [selectedElementLoading, setSelectedElementLoading] = useState(false);
  const [zoomLimit, setZoomLimit] = useState(null); // "min" | "max" while the camera sits at a zoom limit
  const [measureModeActive, setMeasureModeActiveState] = useState(false);
  const [measurements, setMeasurements] = useState([]); // [{ id, depth, horizontal, vertical, length }]
  const [measureDeletePopup, setMeasureDeletePopup] = useState(null); // { entryId, which, x, y } | null
  const [measureLegEditPopup, setMeasureLegEditPopup] = useState(null); // { entryId, which, x, y } | null — which: "depth" | "horizontal" | "vertical"
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]); // { key, modelId, localId, name, category, modelName }[]
  const [isolatedKeys, setIsolatedKeys] = useState(() => new Set()); // `${modelId}::${localId}`
  const [confirmReplace, setConfirmReplace] = useState(null); // { name, resolve } | null
  const [northOffsetDeg, setNorthOffsetDegState] = useState(0);
  const [compassAngleDeg, setCompassAngleDeg] = useState(0);
  const [tagToolActive, setTagToolActiveState] = useState(false);
  const [tagsVisible, setTagsVisibleState] = useState(true);
  const [pinnedDimensionTags, setPinnedDimensionTags] = useState([]); // [{ key, guid, category, name, dimData }]
  const [categoryHideModeActive, setCategoryHideModeActiveState] = useState(false);
  const [hiddenCategories, setHiddenCategories] = useState([]); // string[] — categories currently hidden via the hide-category tool
  const spaces = useSpaceVisibility({ models, modelsRef, pipelineRef, requestRenderRef, invalidateGroupSphereRef, renderForAWhile });
  // Mirrors the lengths of the undo/redo stacks so toolbar buttons (the
  // only way to undo/redo on a touch device, which has no Ctrl+Z) can
  // enable/disable themselves; the stacks themselves stay in refs.
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });

  // A new action always invalidates the redo history — the standard
  // undo/redo convention (you can't "redo" something that's no longer
  // where it would have applied).
  const syncHistoryCounts = useCallback(() => {
    setHistoryCounts({ undo: undoStackRef.current.length, redo: redoStackRef.current.length });
  }, []);
  const pushUndo = useCallback((entry) => {
    undoStackRef.current.push(entry);
    redoStackRef.current = [];
    syncHistoryCounts();
  }, [syncHistoryCounts]);
  const undo = useCallback(async () => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    syncHistoryCounts();
    await entry.undo();
    redoStackRef.current.push(entry);
    syncHistoryCounts();
  }, [syncHistoryCounts]);
  const redo = useCallback(async () => {
    const entry = redoStackRef.current.pop();
    if (!entry) return;
    syncHistoryCounts();
    await entry.redo();
    undoStackRef.current.push(entry);
    syncHistoryCounts();
  }, [syncHistoryCounts]);

  // Shared by the hide-category tool's in-view click (armed via
  // categoryHideModeActiveRef, dispatched from inside the imperative
  // effect below), the sidebar's "restore" button on a hidden-category
  // row, and setCategoryHidden's own undo/redo below — all just need to
  // flip every item of one category, across every loaded model, to a
  // given visibility. Uses getItemsOfCategories (an exact, case-
  // insensitive match on the category name) rather than tracking
  // individual local IDs, since a "category" here always means "every
  // instance of this IFC type", not a specific selection. Unconditional
  // — no "already in that state" guard — so undo/redo can always
  // deterministically flip back regardless of hiddenCategoriesRef's
  // current contents.
  const applyCategoryVisibility = useCallback(async (category, hidden) => {
    const key = category.toUpperCase();
    renderForAWhile(() => requestRenderRef.current());
    const categoryRegex = new RegExp(`^${key}$`, "i");
    const entries = [...modelsRef.current.entries()];
    await Promise.all(
      entries.map(async ([modelId, { model }]) => {
        let idsByCategory;
        try {
          idsByCategory = await model.getItemsOfCategories([categoryRegex]);
        } catch (err) {
          console.error("Failed to query category for visibility toggle", err);
          return;
        }
        const ids = Object.values(idsByCategory).flat();
        if (ids.length > 0) await model.setVisible(ids, !hidden);
        // Hiding a category that contains the currently selected/highlighted
        // element leaves the same stale highlight/panel as hiding just that
        // one element does (see hideHit/setVisible above) — the highlight
        // overlay is a separate mesh outside fragments' own visibility
        // system, so it doesn't disappear on its own just because the
        // underlying element got hidden.
        const sel = selectedHitRef.current;
        if (hidden && sel && sel.modelId === modelId && ids.includes(sel.localId)) {
          clearHighlightRef.current?.();
          selectedHitRef.current = null;
          setSelectedElement(null);
        }
      }),
    );
    await pipelineRef.current?.fragments.core.update(true);
    invalidateGroupSphereRef.current();
    if (hidden) hiddenCategoriesRef.current.add(key);
    else hiddenCategoriesRef.current.delete(key);
    setHiddenCategories([...hiddenCategoriesRef.current]);
    requestRenderRef.current();
  }, []);

  const setCategoryHidden = useCallback(async (category, hidden) => {
    const key = category.toUpperCase();
    if (hiddenCategoriesRef.current.has(key) === hidden) return; // already in that state
    await applyCategoryVisibility(category, hidden);
    pushUndo({
      undo: () => applyCategoryVisibility(category, !hidden),
      redo: () => applyCategoryVisibility(category, hidden),
    });
  }, [applyCategoryVisibility, pushUndo]);

  // Recalibrates which direction the compass calls "true north" without
  // ever touching modelsGroup — the model itself never rotates from this.
  const setNorthOffset = useCallback((deg) => {
    northOffsetRef.current = deg;
    setNorthOffsetDegState(deg);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let disposed = false;
    const loadedModels = modelsRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf2ebe0);
    sceneRef.current = scene;

    const modelsGroup = new THREE.Group();
    scene.add(modelsGroup);
    modelsGroupRef.current = modelsGroup;

    // Bounding sphere of `modelsGroup`, cached in the group's own local
    // frame (so it survives the group's rotation/translation during an
    // arcball drag, both of which are rigid transforms that preserve a
    // sphere's radius) and only recomputed when the model set or a model's
    // visibility actually changes (see invalidateGroupSphere below), rather
    // than on every rotate-gesture pointerdown — `Box3.setFromObject` walks
    // the whole geometry tree, so recomputing it per-gesture is wasteful
    // for large models.
    let groupSphereLocal = null; // { center: Vector3 in modelsGroup-local space, radius }
    // Per-model bounding spheres, cached the same way as groupSphereLocal
    // but keyed by modelId. A single sphere spanning every loaded model
    // (groupSphereLocal) is a fine proxy for "the scale of what's in
    // view" only when there's roughly one model — once a much larger
    // model (e.g. a low-poly city/landscape) shares the group with a
    // much smaller one (e.g. a house), the combined sphere is dominated
    // by the larger model and no longer reflects what's actually under
    // the cursor or in front of the camera. nearestModelHit below uses
    // these instead wherever that distinction matters.
    let modelSpheresLocal = null; // Map<modelId, { center: Vector3 local, radius }>
    // `modelSpheresLocal` above is computed from raw geometry
    // (Box3.setFromObject), which has no notion of per-element visibility
    // at all — a fragments model manages "hidden" elements (isolation,
    // right-click-hide) as a worker-side instance flag, not by touching
    // Object3D.visible or removing geometry, so the raw box always
    // includes hidden elements too. This second cache holds the same
    // shape but built from only the currently-visible elements' actual
    // boxes (via getVisible + getBoxes), so zoom distance/framing isn't
    // thrown off by geometry the user can no longer see. It's async to
    // compute (worker round-trips), so it's refreshed in the background
    // whenever invalidateGroupSphere fires and getModelSpheres falls back
    // to the raw (possibly stale-inclusive-of-hidden) sphere until it's
    // ready — matching zoomHitCache's own "best effort, refined shortly
    // after" pattern below.
    let visibleModelSpheresLocal = null; // Map<modelId, { center: Vector3 local, radius }> | null
    let visibleSpheresGeneration = 0;
    // Real per-pixel raycasting is async (worker-backed) and too slow to
    // run synchronously on every wheel tick, so the exact hit point under
    // the cursor is cached from the last resolved raycast and reused,
    // refreshed in the background on every zoom tick (never more than one
    // request in flight — see onZoomWheel). The sphere-based estimate
    // above is only a fallback for the handful of ticks before the first
    // real hit resolves, or when the cursor is over empty space.
    let zoomHitCache = null; // { point: THREE.Vector3 (world), clientX, clientY } | null
    let zoomRaycastPending = false;
    // Shared by anything that wants to reuse zoomHitCache for the current
    // cursor position (zoom-to-cursor, and the rotate pivot below) — how
    // close (in screen pixels) the cache's own cursor position has to be
    // to count as "still describing here."
    const CACHE_PIXEL_TOLERANCE = 20;
    // Rate-limits onZoomWheel's distance basis tick-to-tick (see below) —
    // separate from zoomHitCache, which caches the *point*; this caches
    // how far the *previous* tick judged that point (or its fallback) to
    // be, so a single anomalous jump (e.g. a raycast that skips through a
    // window's missing glazing to a wall meters behind it) can't produce
    // an outsized zoom step.
    // Background refresh for visibleModelSpheresLocal (see its
    // declaration above) — chunked the same way this codebase's other
    // bulk fragments queries are, and guarded by a generation counter so
    // a later invalidation (another visibility toggle before this one
    // finishes) discards this run's result instead of racing it.
    const recomputeVisibleModelSpheres = async () => {
      const myGeneration = ++visibleSpheresGeneration;
      const CHUNK = 500;
      const result = new Map();
      for (const [modelId, entry] of modelsRef.current) {
        if (!entry.object.visible) continue;
        const allIds = await entry.model.getLocalIds();
        if (myGeneration !== visibleSpheresGeneration) return;
        const visibleIds = [];
        for (let i = 0; i < allIds.length; i += CHUNK) {
          const chunk = allIds.slice(i, i + CHUNK);
          const flags = await entry.model.getVisible(chunk);
          for (let j = 0; j < chunk.length; j++) if (flags[j]) visibleIds.push(chunk[j]);
        }
        if (myGeneration !== visibleSpheresGeneration) return;
        if (visibleIds.length === 0) continue;
        const box = new THREE.Box3();
        for (let i = 0; i < visibleIds.length; i += CHUNK) {
          const boxes = await entry.model.getBoxes(visibleIds.slice(i, i + CHUNK));
          for (const b of boxes) box.union(b);
        }
        if (myGeneration !== visibleSpheresGeneration) return;
        if (box.isEmpty()) continue;
        const worldSphere = box.getBoundingSphere(new THREE.Sphere());
        result.set(modelId, {
          center: modelsGroup.worldToLocal(worldSphere.center.clone()),
          radius: worldSphere.radius,
        });
      }
      if (myGeneration !== visibleSpheresGeneration) return;
      visibleModelSpheresLocal = result;
    };
    const invalidateGroupSphere = () => {
      groupSphereLocal = null;
      modelSpheresLocal = null;
      visibleModelSpheresLocal = null;
      zoomHitCache = null;
      recomputeVisibleModelSpheres().catch((err) => {
        console.error("Failed to compute visible-only bounding spheres", err);
      });
    };
    const getGroupSphere = () => {
      if (!groupSphereLocal) {
        if (modelsGroup.children.length === 0) return null;
        const box = new THREE.Box3().setFromObject(modelsGroup);
        if (box.isEmpty()) return null;
        const worldSphere = box.getBoundingSphere(new THREE.Sphere());
        groupSphereLocal = {
          center: modelsGroup.worldToLocal(worldSphere.center.clone()),
          radius: worldSphere.radius,
        };
      }
      // Only modelsGroup's own matrixWorld is needed here (not any
      // child's), and its parent (the scene) never moves, so this cheap
      // update is exactly equivalent to a full updateMatrixWorld(true)
      // for our purposes — without recursing into every child mesh.
      // Matters now that this is called on every zoom wheel tick (not
      // just once per rotate-gesture start), which can fire very
      // frequently on a trackpad.
      modelsGroup.updateMatrix();
      modelsGroup.matrixWorld.copy(modelsGroup.matrix);
      return {
        center: modelsGroup.localToWorld(groupSphereLocal.center.clone()),
        radius: groupSphereLocal.radius,
      };
    };
    const getModelSpheres = () => {
      if (!modelSpheresLocal) {
        modelSpheresLocal = new Map();
        for (const [modelId, entry] of modelsRef.current) {
          const box = new THREE.Box3().setFromObject(entry.object);
          if (box.isEmpty()) continue;
          const worldSphere = box.getBoundingSphere(new THREE.Sphere());
          modelSpheresLocal.set(modelId, {
            center: modelsGroup.worldToLocal(worldSphere.center.clone()),
            radius: worldSphere.radius,
          });
        }
      }
      modelsGroup.updateMatrix();
      modelsGroup.matrixWorld.copy(modelsGroup.matrix);
      const spheres = [];
      for (const [modelId, local] of modelSpheresLocal) {
        const entry = modelsRef.current.get(modelId);
        if (!entry || !entry.object.visible) continue;
        // Prefer the visible-elements-only sphere once the background
        // computation has resolved (see visibleModelSpheresLocal above) —
        // the raw one still includes isolated/right-click-hidden elements
        // within an otherwise-visible model, which would otherwise throw
        // off zoom distance/framing toward geometry the user can't see.
        const visibleLocal = visibleModelSpheresLocal?.get(modelId) ?? local;
        spheres.push({
          center: modelsGroup.localToWorld(visibleLocal.center.clone()),
          radius: Math.max(visibleLocal.radius, 0.001),
        });
      }
      return spheres;
    };
    // Finds where a ray first meets any loaded model's own bounding
    // sphere (not one sphere spanning every loaded model — see the
    // comment on modelSpheresLocal above for why that distinction
    // matters). Handles the ray origin being inside a sphere by using
    // the exit point ahead of it rather than the entry point behind it,
    // which matters once the camera is zoomed in close to/inside the
    // model being viewed. Returns { point, t, radius } for the nearest
    // hit ahead of origin, or null if the ray misses every model.
    const nearestModelHit = (origin, dir) => {
      let best = null;
      for (const { center, radius } of getModelSpheres()) {
        const oc = origin.clone().sub(center);
        const b = oc.dot(dir);
        const c = oc.dot(oc) - radius * radius;
        const discriminant = b * b - c;
        if (discriminant < 0) continue;
        const sqrtDisc = Math.sqrt(discriminant);
        const tNear = -b - sqrtDisc;
        const t = tNear > 0 ? tNear : -b + sqrtDisc;
        if (t <= 0) continue;
        if (!best || t < best.t) {
          best = { t, radius, point: origin.clone().addScaledVector(dir, t) };
        }
      }
      return best;
    };
    invalidateGroupSphereRef.current = invalidateGroupSphere;

    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      5000,
    );
    camera.position.set(15, 15, 15);
    cameraRef.current = camera;
    // Test hook, only compiled into builds made with VITE_TEST_HOOK=1 (never the deployed build).
    if (import.meta.env.VITE_TEST_HOOK) window.__ifcDebug = { camera, get controls() { return controlsRef.current; }, get group() { return modelsGroupRef.current; }, get models() { return modelsRef.current; }, THREE };

    // Phones render at devicePixelRatio 2 (capped below), where multisampling
    // adds little to edge quality but costs fill-rate and memory every frame.
    const renderer = new THREE.WebGLRenderer({ antialias: !(TOUCH_UI && window.devicePixelRatio >= 2) });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.localClippingEnabled = true;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Shared by every measurement line/leg's LineMaterial (see
    // createMeasureLeg etc. below) — Line2's fat-line shader needs the
    // viewport size in pixels to convert `linewidth` (in CSS pixels) into
    // clip space, so this must stay in sync with the renderer's actual
    // size (updated alongside the ResizeObserver's renderer.setSize call).
    const measureLineResolution = new THREE.Vector2(container.clientWidth, container.clientHeight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    // Mouse-wheel zoom is intercepted and replaced by the cursor-relative
    // version below (see onZoomWheel), but zoomToCursor/enableZoom stay
    // on so two-finger touch pinch-zoom — which OrbitControls handles
    // via an entirely separate (non-'wheel') code path gated on these
    // same flags — keeps working on mobile exactly as before.
    // Off on touch: zooming toward the midpoint between two fingers drifts
    // the model sideways and the zoom rate varies with where the target
    // sits; pinching toward the (model-centred) target stays predictable.
    controls.zoomToCursor = !TOUCH_UI;
    controls.mouseButtons = {
      LEFT: null, // handled by the arcball model-rotation below
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: null, // right-click opens a context menu instead (see below)
    };
    controls.touches = {
      ONE: null, // single-finger drag is handled by the arcball rotation below too
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    // OrbitControls has a documented, hardcoded modifier behavior for
    // whichever button is bound to MOUSE.PAN: holding ctrl/meta/shift
    // switches it to MOUSE.ROTATE for that drag instead — its own
    // built-in orbit-the-camera-around-target rotation, entirely
    // separate from (and incompatible with) the custom arcball
    // model-rotation system below. Since rotation here is never meant
    // to go through OrbitControls at all, disable it outright so
    // shift+middle-click can't accidentally fall into that native path
    // (this doesn't affect the custom rotation, which drives
    // modelsGroup.quaternion directly via its own pointer listeners, or
    // touch two-finger dolly/pan, which uses a separate code path).
    controls.enableRotate = false;
    controls.minDistance = MIN_SURFACE_DISTANCE;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // On-demand rendering: the actual GPU draw (`renderer.render`) only
    // needs to happen when something visible has actually changed, not on
    // every RAF tick — otherwise the viewer keeps rendering at 60fps
    // forever even while the user is just looking at a static model.
    // `controls.update()` and the fragments worker sync stay unconditional
    // since they're comparatively cheap bookkeeping (and the latter drives
    // progressive geometry streaming, which shouldn't depend on the camera
    // having moved).
    let needsRender = true;
    const requestRender = () => {
      needsRender = true;
    };
    requestRenderRef.current = requestRender;
    controls.addEventListener("change", requestRender);

    // Multiple independent surface clip planes, each created via
    // right-click "Create clip plane here". Each plane's definition
    // (localPlane) lives in modelsGroup's local frame — same reasoning as
    // the single-plane version this replaces: the camera never moves
    // during a rotate gesture, so a world-fixed plane would appear to
    // swing through the model instead of staying put on the surface it
    // was created on; re-deriving the world-space plane every frame from
    // the model's current pose (see the render loop below) keeps it
    // glued there. Each plane also gets a translucent, draggable "gizmo"
    // mesh, parented under modelsGroup so it inherits the model's
    // rotation for free (no manual per-frame world-quaternion math needed
    // for the mesh, unlike the clipping plane itself, which THREE.js
    // requires in world space) — it visualizes where the cut is and, when
    // its own gizmoVisible flag is on, can be shift+dragged along its own
    // normal (see onRotateStart/onClipPlaneDragMove below).
    let clipPlaneUid = 0;
    const clipPlanesRuntime = []; // { id, localPlane, worldPlane, mesh, enabled, gizmoVisible }
    // A simple quad (2 triangles sharing one diagonal) rather than a
    // many-segment circle/fan: a triangle fan's segments all share the
    // center vertex, and anti-aliased edge coverage gets blended twice
    // at each shared edge under transparency — visible as a faint
    // radiating moiré/seam pattern across the whole disc. A quad has
    // only one internal edge, so this artifact is negligible.
    //
    // A thin box rather than a zero-thickness plane: shift+drag/shift+
    // scroll/middle+scroll all raycast against this exact mesh (see
    // tryStartClipPlaneDrag and moveClipPlaneUnderCursor below), and a
    // perfectly flat quad's on-screen silhouette shrinks toward a
    // single line — genuinely near-zero pixels wide — when viewed
    // close to edge-on, making it effectively unclickable from some
    // angles. Giving it a small thickness along its own normal (the
    // box's 3rd dimension) keeps a real, non-vanishing cross-section to
    // hit at any viewing angle, at the cost of an imperceptible amount
    // of extra visible "edge" thickness face-on.
    const GIZMO_THICKNESS = 0.08; // fraction of the gizmo's own unit width
    const gizmoGeometry = new THREE.BoxGeometry(1, 1, GIZMO_THICKNESS);
    const GIZMO_UP = new THREE.Vector3(0, 0, 1); // faces +Z before orienting to the plane's normal
    // A thin outline keeps the sheet readable now that its fill is faint.
    const gizmoOutlineGeometry = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1));

    const refreshClippingPlanes = () => {
      const planes = clipPlanesRuntime.filter((p) => p.enabled).map((p) => p.worldPlane);
      if (cameraClipEnabledRef.current) planes.push(cameraClipPlaneRef.current);
      renderer.clippingPlanes = planes;
      requestRender();
    };

    // Every loaded model's full bounds (strays included), in modelsGroup's frame.
    const fullSceneBox = () => {
      const box = new THREE.Box3();
      for (const e of modelsRef.current.values()) {
        const b = e.fullLocalBox ?? e.localBox;
        if (b) box.union(b);
      }
      return box.isEmpty() ? null : box;
    };
    const isPhoneUi = () => TOUCH_UI || window.innerWidth <= 768;
    let activeClipId = null;
    const notifyClipPlanes = () => setClipPlanes(clipPlaneManager.list());
    // Plane 1 and 2 get their own hue; the active one is darker and more opaque.
    const restyleSheets = () => {
      const many = clipPlanesRuntime.length > 1;
      clipPlanesRuntime.forEach((p, i) => {
        const active = p.id === activeClipId;
        const base = new THREE.Color(PLANE_COLORS[i % PLANE_COLORS.length]);
        const col = active && many ? base.clone().multiplyScalar(0.72) : base;
        p.mesh.material.color.copy(col);
        p.mesh.material.opacity = many ? (active ? SHEET_OPACITY.active : SHEET_OPACITY.inactive) : TOUCH_UI ? 0.1 : 0.16;
        p.outline.material.color.copy(col);
        p.outline.material.opacity = many && !active ? 0.45 : 0.9;
      });
      requestRender();
    };

    // Repositions/reorients/rescales a plane's gizmo mesh from its local
    // plane definition. Only needs to run when the local plane itself
    // changes (creation, flip, drag) or the model's overall scale
    // reference changes — not every frame, since the mesh is parented
    // under modelsGroup and inherits its rotation automatically.
    const syncGizmoMesh = (entry) => {
      const { localPlane, mesh } = entry;
      // A rectangle on the plane that covers the whole scene's cross-section
      // (see sheetRect); falls back to the bounding sphere while no model's
      // bounds are measured yet.
      const rect = sheetRect(localPlane, fullSceneBox());
      entry.rect = rect;
      const sphere = getGroupSphere();
      const fallback = sphere ? Math.max(sphere.radius * (TOUCH_UI ? 1.3 : 2.6), 0.1) : 10;
      const sheetW = rect ? rect.halfU * 2 : fallback;
      const sheetH = rect ? rect.halfV * 2 : fallback;
      const pointOnPlaneLocal = rect ? rect.centre : localPlane.normal.clone().multiplyScalar(-localPlane.constant);
      // The gizmo sits exactly at the clip plane's own boundary — which
      // this very plane also clips against — so at that exact distance,
      // GPU floating-point clip-distance evaluation is right at the
      // zero/epsilon threshold and flickers per-fragment (a sparse,
      // dithered dropout pattern) between clipped and kept. Nudge it a
      // hair into the kept region (along +normal) so it renders solidly.
      // Scaled by camera-to-plane distance (not the model's overall
      // bounding-sphere radius, and not the gizmo's own visual `scale`
      // above): on a geometrically large/spread-out model, a radius-based
      // offset stayed "far too small to notice" only when viewed from
      // roughly the whole-model framing distance — zoomed in close (the
      // normal way to actually work with a clip plane), that same offset
      // became a large, very visible gap between the blue gizmo and the
      // real cut line. Camera distance keeps the nudge imperceptible at
      // whatever distance the plane is actually being viewed from.
      modelsGroup.updateMatrix();
      modelsGroup.matrixWorld.copy(modelsGroup.matrix);
      const pointOnPlaneWorld = modelsGroup.localToWorld(pointOnPlaneLocal.clone());
      const cameraDistance = camera.position.distanceTo(pointOnPlaneWorld);
      const KEPT_SIDE_EPSILON = cameraDistance * 0.002;
      mesh.position.copy(pointOnPlaneLocal).addScaledVector(localPlane.normal, KEPT_SIDE_EPSILON);
      if (rect) mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(rect.u, rect.v, rect.n));
      else mesh.quaternion.setFromUnitVectors(GIZMO_UP, localPlane.normal);
      // The box's 1x1 face is a unit square (half-width 0.5), so scale by
      // ~2x the radius to get a comparable span to what a radius-1.3x
      // circle would have covered. Uniform scaling also grows the thin
      // GIZMO_THICKNESS dimension proportionally, which is fine — it
      // just keeps the raycast hit-target a constant fraction of the
      // gizmo's own (now scale-dependent) visual size.
      mesh.scale.set(sheetW, sheetH, Math.max(sheetW, sheetH));
      if (entry.outline) {
        entry.outline.position.copy(mesh.position);
        entry.outline.quaternion.copy(mesh.quaternion);
        entry.outline.scale.set(sheetW, sheetH, 1);
      }
    };

    const clipPlaneManager = {
      add: (localNormal, localPoint) => {
        // A phone keeps two planes at most: the oldest makes room.
        const drop = planesToDrop(clipPlanesRuntime.length, isPhoneUi());
        for (let k = 0; k < drop; k++) {
          clipPlaneManager.remove(clipPlanesRuntime[0].id);
          showToastRef.current?.("Two sections at most on a phone. Replaced the oldest.");
        }
        const id = `clip-${++clipPlaneUid}`;
        const localPlane = new THREE.Plane();
        localPlane.normal.copy(localNormal);
        localPlane.constant = -localPlane.normal.dot(localPoint);
        const material = new THREE.MeshBasicMaterial({
          color: PLANE_COLORS[0],
          transparent: true,
          opacity: TOUCH_UI ? 0.1 : 0.16,
          side: THREE.DoubleSide,
          depthWrite: false,
          // The gizmo sits exactly on the clip plane — which is also
          // exactly where the model's own cut cross-section lies — so
          // without this the two coplanar surfaces z-fight (flickering,
          // radiating moiré patterns) rather than blending cleanly.
          // Negative polygon-offset values push this surface slightly
          // toward the camera in the depth buffer only, with no effect
          // on its actual (already-correct) position.
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
        });
        const mesh = new THREE.Mesh(gizmoGeometry, material);
        mesh.renderOrder = 1;
        modelsGroup.add(mesh);
        const outline = new THREE.LineSegments(
          gizmoOutlineGeometry,
          new THREE.LineBasicMaterial({ color: PLANE_COLORS[0], transparent: true, opacity: 0.7, depthWrite: false }),
        );
        outline.renderOrder = 1;
        modelsGroup.add(outline);
        const entry = {
          outline,
          id,
          localPlane,
          worldPlane: new THREE.Plane(),
          mesh,
          enabled: true,
          gizmoVisible: true,
        };
        syncGizmoMesh(entry);
        clipPlanesRuntime.push(entry);
        activeClipId = id;
        restyleSheets();
        refreshClippingPlanes();
        return id;
      },
      remove: (id) => {
        const index = clipPlanesRuntime.findIndex((p) => p.id === id);
        if (index === -1) return;
        const ids = clipPlanesRuntime.map((p) => p.id);
        const [entry] = clipPlanesRuntime.splice(index, 1);
        activeClipId = activeAfterRemove(ids, activeClipId, id);
        modelsGroup.remove(entry.mesh);
        entry.mesh.material.dispose();
        modelsGroup.remove(entry.outline);
        entry.outline.material.dispose();
        restyleSheets();
        refreshClippingPlanes();
      },
      setActive: (id) => {
        if (!clipPlanesRuntime.some((p) => p.id === id) || activeClipId === id) return;
        activeClipId = id;
        restyleSheets();
        notifyClipPlanes();
      },
      activeId: () => activeClipId,
      flip: (id) => {
        const entry = clipPlanesRuntime.find((p) => p.id === id);
        if (!entry) return;
        entry.localPlane.normal.negate();
        entry.localPlane.constant *= -1;
        syncGizmoMesh(entry);
        requestRender();
        notifyClipPlanes();
      },
      // Slides a plane along its own normal (used by the section slider).
      setConstant: (id, constant) => {
        const entry = clipPlanesRuntime.find((p) => p.id === id);
        if (!entry) return;
        entry.localPlane.constant = constant;
        syncGizmoMesh(entry);
        requestRender();
        notifyClipPlanes();
      },
      setEnabled: (id, enabled) => {
        const entry = clipPlanesRuntime.find((p) => p.id === id);
        if (!entry) return;
        entry.enabled = enabled;
        refreshClippingPlanes();
      },
      setGizmoVisible: (id, visible) => {
        const entry = clipPlanesRuntime.find((p) => p.id === id);
        if (!entry) return;
        entry.gizmoVisible = visible;
        // The mesh's own Object3D.visible stays true unconditionally;
        // only material.visible toggles rendering. This is what lets
        // tryMiddleScrollClipPlane (below) hit-test every plane's mesh
        // regardless of whether its handle is currently shown, since it
        // deliberately raycasts against all meshes rather than filtering
        // by `gizmoVisible` the way the shift+scroll/shift+drag gestures
        // do. (Which gestures react to a hidden gizmo is controlled by
        // the `gizmoVisible` filters at those call sites, not by this
        // visibility mechanism itself.)
        entry.mesh.material.visible = visible;
        entry.outline.material.visible = visible;
        requestRender();
      },
      list: () => {
        const box = fullSceneBox();
        return clipPlanesRuntime.map((p, i) => {
          const axis = axisOf(p.localPlane.normal);
          return {
            id: p.id,
            enabled: p.enabled,
            gizmoVisible: p.gizmoVisible,
            active: p.id === activeClipId,
            index: i,
            color: PLANE_COLORS[i % PLANE_COLORS.length],
            kind: axis ? KIND_BY_AXIS[axis] : "tilted",
            slab: box ? miniSlab(p.localPlane, box) : null,
          };
        });
      },
      refreshClippingPlanes,
      // For undo: enough to recreate an equivalent plane via `add` after
      // it's been removed. The original localPoint isn't retained on the
      // entry (only the resulting plane's normal/constant are), but any
      // point on the plane works just as well for reconstruction.
      getPlaneSnapshot: (id) => {
        const entry = clipPlanesRuntime.find((p) => p.id === id);
        if (!entry) return null;
        return {
          normal: entry.localPlane.normal.clone(),
          point: entry.localPlane.normal.clone().multiplyScalar(-entry.localPlane.constant),
          enabled: entry.enabled,
          gizmoVisible: entry.gizmoVisible,
        };
      },
    };
    clipPlaneManagerRef.current = clipPlaneManager;
    if (import.meta.env.VITE_TEST_HOOK) {
      window.__ifcDebug.clip = clipPlaneManager;
      window.__ifcDebug.addPlane = (n, p) => { const id = clipPlaneManager.add(n, p); notifyClipPlanes(); return id; };
      window.__ifcDebug.sections = () => ({
        box: (() => { const b = fullSceneBox(); return b && { min: b.min.toArray(), max: b.max.toArray() }; })(),
        planes: clipPlanesRuntime.map((p) => ({
          id: p.id, active: p.id === activeClipId, normal: p.localPlane.normal.toArray(), constant: p.localPlane.constant,
          rect: p.rect && { centre: p.rect.centre.toArray(), u: p.rect.u.toArray(), v: p.rect.v.toArray(), halfU: p.rect.halfU, halfV: p.rect.halfV },
          meshScale: p.mesh.scale.toArray(), opacity: p.mesh.material.opacity, color: p.mesh.material.color.getHex(),
        })),
      });
    }

    // Converts a world-space direction (e.g. a raycast hit's face normal)
    // into modelsGroup's local frame, matching how measurement points
    // themselves are stored (see worldToLocal calls below) — needed since
    // the model can be rotated relative to world space at any time.
    const localDirectionFromWorld = (worldVec) => {
      const invQuat = modelsGroup.quaternion.clone().invert();
      return worldVec.clone().applyQuaternion(invQuat).normalize();
    };

    const MEASURE_UP = new THREE.Vector3(0, 1, 0);
    const MEASURE_FALLBACK_TANGENT = new THREE.Vector3(0, 0, 1);
    // Builds the orthonormal basis a measurement's dogleg is decomposed
    // into. `tangentUp` ("Vertical") is always true world-Y — it must
    // never depend on which surface was clicked, or reversing the click
    // order (wall-then-floor vs floor-then-wall) would silently swap
    // what "Vertical" even means. `normal` ("Depth") is instead always a
    // *horizontal* direction: the reference surface's own normal
    // projected onto the horizontal plane (unchanged from before for a
    // vertical wall, whose normal is already horizontal), falling back
    // to a fixed horizontal axis only when that projection is
    // degenerate — i.e. the surface itself is horizontal (a floor or
    // ceiling), which has no horizontal normal component of its own to
    // measure "depth into" at all.
    const measureBasis = (localNormal) => {
      const normal = (localNormal ?? MEASURE_UP).clone().normalize();
      const horizNormal = new THREE.Vector3(normal.x, 0, normal.z);
      const depthDir = horizNormal.lengthSq() > 1e-6 ? horizNormal.normalize() : MEASURE_FALLBACK_TANGENT.clone();
      const tangentRight = new THREE.Vector3().crossVectors(MEASURE_UP, depthDir).normalize();
      return { normal: depthDir, tangentUp: MEASURE_UP.clone(), tangentRight };
    };
    // Decomposes the vector from a to b into that basis: `depth` is the
    // (signed) distance along the reference surface's normal, `right`/
    // `up` are the in-plane components. These three, applied in order as
    // displacements from `a`, land exactly on `b` again (it's just `b-a`
    // expressed in a different orthonormal basis), which is what lets the
    // 3D dogleg visualization below still work unchanged.
    const measureComponents = (a, b, basis) => {
      const d = b.clone().sub(a);
      return { depth: d.dot(basis.normal), right: d.dot(basis.tangentRight), up: d.dot(basis.tangentUp) };
    };

    // Measure tool: click point A, then point B, and record the local-space
    // (modelsGroup frame) difference between them. Points/line/markers are
    // parented under modelsGroup (like the clip-plane gizmos above) so they
    // inherit model rotation for free instead of needing per-frame transform
    // math the way the transient, world-fixed pivotMarker does.
    const measurementsRuntime = []; // { id, markerA, markerB, line, legDepth, legRight, legUp, label, legDepthLabel, legRightLabel, legUpLabel, referenceNormal, depth, horizontal, vertical, length }
    const measureMarkerGeometry = new THREE.SphereGeometry(1, 12, 12);
    const MEASURE_MARKER_PIXELS = 5;
    // Label height on screen, halo included: about 12.5 px type in a 22 px pill.
    const MEASURE_LEG_LABEL_PIXEL_HEIGHT = 28; // the main label and (via the ratio below) the per-leg labels
    // On a phone the three per-leg labels shrink so they crowd the total less.
    const MEASURE_LEG_LABEL_SMALL_PIXEL_HEIGHT = TOUCH_UI ? 25 : 28;
    const MEASURE_LINE_WIDTH = TOUCH_UI ? 3 : 2;
    let measurePendingPoint = null; // THREE.Vector3 (modelsGroup-local) | null
    let measurePendingMarker = null; // THREE.Mesh | null
    let measureUid = 0;
    // Live preview of the in-progress second point: built lazily on the
    // first hover once point A exists, then updated in place every
    // subsequent hover (never pushed into measurementsRuntime — it's
    // torn down as soon as the real point B is placed or the pending
    // point is cancelled).
    let measurePreviewEntry = null; // { markerB, line, legDepth, legRight, legUp, label, legDepthLabel, legRightLabel, legUpLabel } | null
    // Same "stash latest cursor position, raycast at most once per
    // rendered frame" pattern as the measure-marker drag and dimension-
    // tag hover below (see their own comments) — processed inside
    // animate().
    let measurePreviewPendingClient = null; // { clientX, clientY } | null
    let measurePreviewRaycastBusy = false;
    let measurePreviewGeneration = 0;

    const createMeasureMarker = () => {
      // Dark fill (not white) so the marker stays visible against the
      // light scene background (see scene.background above) — same
      // reasoning applies to the measurement lines' color below.
      const marker = new THREE.Mesh(
        measureMarkerGeometry,
        new THREE.MeshBasicMaterial({ color: 0x2a2622, depthTest: false }),
      );
      marker.renderOrder = 999;
      modelsGroup.add(marker);
      return marker;
    };

    // One two-point line per axis leg of the Pythagoras-style dogleg
    // (see addPoint below) — a right-angle path between the two measured
    // points, colored to match the existing ΔX/ΔY/ΔZ convention, drawn
    // alongside (not instead of) the straight hypotenuse line.
    const createMeasureLeg = (p1, p2, color) => {
      // THREE.LineBasicMaterial's `linewidth` is a documented no-op on
      // most desktop browsers (ANGLE/OpenGL-core restricts native GL line
      // width to 1px) — Line2/LineMaterial is three.js's "fat line" addon
      // that actually renders at the requested pixel width via a screen-
      // space shader, hence needing `resolution` kept in sync with the
      // renderer's size (see measureLineResolution above).
      const geometry = new LineGeometry();
      geometry.setPositions([p1.x, p1.y, p1.z, p2.x, p2.y, p2.z]);
      const material = new LineMaterial({ color, depthTest: false, linewidth: MEASURE_LINE_WIDTH, resolution: measureLineResolution });
      const leg = new Line2(geometry, material);
      leg.computeLineDistances();
      leg.renderOrder = 999;
      modelsGroup.add(leg);
      return leg;
    };

    // A billboard-style text label showing a measurement's length, drawn
    // onto one shared canvas per measurement/leg and rescaled per frame
    // like the markers above. THREE.Sprite auto-faces the camera, so no
    // projection math is needed. Dragging an endpoint (below) redraws
    // this same canvas in place via updateMeasureLabelText rather than
    // recreating it. The per-axis ΔX/ΔY/ΔZ breakdown lives on the three
    // dogleg leg labels instead (see createMeasureLeg usage in addPoint),
    // so this main label stays length-only.
    // Shared with scaleDimensionTags below, which needs to know exactly
    // how many canvas pixels one line (plus the fixed vertical padding)
    // takes up in order to scale a multi-line dimension tag at the same
    // per-line size as a single-line one — keep these two in sync with
    // drawMeasureLabelCanvas's own layout rather than duplicating the
    // literals.
    const MEASURE_LABEL_LINE_HEIGHT = 44;
    const MEASURE_LABEL_PADDING_Y = 16;
    // `align` defaults to "center" for measurement labels (main/leg
    // labels, always centered on their measured point); dimension tags
    // pass "left" instead so their text reads left-aligned in the box.
    // One label style for every 3D label: a warm-ink pill (the app's --ink) with
    // white text (14:1), a thin light halo so it reads on dark models too, and a
    // soft shadow. A line that has its own colour (a leg, a pinned tag) keeps it
    // as a small dot in front of the text, so colour is never the only cue.
    // A secondary line (a tag's family name) is lighter and regular weight.
    const MEASURE_LABEL_DOTS = new Set(["#ef4444", "#3b82f6", "#22c55e", "#e0a458"]);
    const MEASURE_LABEL_SECONDARY = new Set(["#9aa0a6"]);
    const LABEL_FONT_STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    const LABEL_HALO = 6; // canvas px of halo + shadow room around the pill
    const drawMeasureLabelCanvas = (canvas, ctx, lines, align = "center") => {
      const font = (line) => (MEASURE_LABEL_SECONDARY.has(line.color) ? `500 32px ${LABEL_FONT_STACK}` : `600 34px ${LABEL_FONT_STACK}`);
      const lineHeight = MEASURE_LABEL_LINE_HEIGHT;
      const paddingX = 26;
      const paddingY = MEASURE_LABEL_PADDING_Y;
      const dotSpace = 30;
      const dotted = (line) => MEASURE_LABEL_DOTS.has(line.color);
      const hasDots = lines.some(dotted);
      const textWidth = (line) => { ctx.font = font(line); return ctx.measureText(line.text).width; };
      const width = Math.max(...lines.map((l) => textWidth(l) + (hasDots ? dotSpace : 0)));
      const m = LABEL_HALO;
      const w = Math.ceil(width + paddingX * 2);
      const h = Math.ceil(lineHeight * lines.length + paddingY * 2);
      canvas.width = w + m * 2;
      canvas.height = h + m * 2;
      // Resizing the canvas resets all context state, so font/fill/etc.
      // must be re-applied below.
      const radius = lines.length > 1 ? 22 : h / 2;
      ctx.save();
      ctx.shadowColor = "rgba(42, 38, 34, 0.28)";
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 1;
      ctx.fillStyle = "rgba(255, 253, 249, 0.92)"; // the halo: --surface
      ctx.beginPath();
      ctx.roundRect(m - 3, m - 3, w + 6, h + 6, radius + 3);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#2a2622"; // --ink
      ctx.beginPath();
      ctx.roundRect(m, m, w, h, radius);
      ctx.fill();
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      lines.forEach((line, i) => {
        const y = m + paddingY + lineHeight * (i + 0.5) + 1;
        const tw = textWidth(line);
        const contentWidth = tw + (hasDots ? dotSpace : 0);
        const x = m + (align === "left" ? paddingX : (w - contentWidth) / 2);
        if (dotted(line)) {
          ctx.fillStyle = line.color;
          ctx.beginPath();
          ctx.arc(x + 8, y - 1, 8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.font = font(line);
        ctx.fillStyle = MEASURE_LABEL_SECONDARY.has(line.color) ? "#d8cfbf" : "#ffffff";
        ctx.fillText(line.text, x + (hasDots ? dotSpace : 0), y);
      });
    };
    const createMeasureLabel = (lines, align = "center", anchorY = 0.5) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      drawMeasureLabelCanvas(canvas, ctx, lines, align);

      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      // The canvas holds sRGB colours: without this the pill renders washed out (grey, not ink).
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
      const sprite = new THREE.Sprite(material);
      // `center` is where the sprite sits relative to its anchor point;
      // measurement labels are nudged off their line midpoints (the total
      // above, the legs below) so they don't stack when the legs run
      // nearly parallel to the total.
      sprite.center.set(0.5, anchorY);
      sprite.renderOrder = 1000;
      sprite.userData = { canvas, ctx, aspect: canvas.width / canvas.height };
      modelsGroup.add(sprite);
      return sprite;
    };
    const updateMeasureLabelText = (sprite, lines, align = "center") => {
      drawMeasureLabelCanvas(sprite.userData.canvas, sprite.userData.ctx, lines, align);
      sprite.userData.aspect = sprite.userData.canvas.width / sprite.userData.canvas.height;
      sprite.material.map.needsUpdate = true;
    };
    // Distances inside the Three.js scene are in meters (the loader's
    // coordinate convention); measurements are displayed in millimeters
    // instead, matching this project's construction-drawing convention.
    // Metres with two decimals from a metre up, whole millimetres below —
    // short and readable on a phone (the sidebar list keeps exact mm).
    const formatMm = formatLength;
    const measureLabelLines = (length) => [
      { text: formatMm(length), color: "#e8eaed" },
    ];

    // Live preview while hovering for point B, before it's clicked. Reuses
    // the exact same objects/dogleg math as a finished measurement (see
    // addPoint's "completed" branch below), just lazily created on first
    // hover and updated in place thereafter (same in-place-update pattern
    // as applyMeasureMarkerDrag) rather than recreated every mousemove.
    const updateMeasurePreview = (a, b, localNormal) => {
      if (!measurePreviewEntry) {
        const markerB = createMeasureMarker();
        const geometry = new LineGeometry();
        geometry.setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
        const material = new LineMaterial({ color: 0x2a2622, depthTest: false, linewidth: MEASURE_LINE_WIDTH, resolution: measureLineResolution });
        const line = new Line2(geometry, material);
        line.computeLineDistances();
        line.renderOrder = 999;
        modelsGroup.add(line);
        const legDepth = createMeasureLeg(a, a, 0xef4444);
        const legRight = createMeasureLeg(a, a, 0x3b82f6);
        const legUp = createMeasureLeg(a, a, 0x22c55e);
        const label = createMeasureLabel(measureLabelLines(0), "center", -0.1);
        const legDepthLabel = createMeasureLabel([{ text: "0.000 m", color: "#ef4444" }], "center", 1.1);
        const legRightLabel = createMeasureLabel([{ text: "0.000 m", color: "#3b82f6" }], "center", 1.1);
        const legUpLabel = createMeasureLabel([{ text: "0.000 m", color: "#22c55e" }], "center", 1.1);
        measurePreviewEntry = { markerB, line, legDepth, legRight, legUp, label, legDepthLabel, legRightLabel, legUpLabel };
      }
      const entry = measurePreviewEntry;
      entry.markerB.visible = tagsVisibleRef.current;
      entry.markerB.position.copy(b);

      entry.line.geometry.setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
      entry.line.computeLineDistances();

      // Dogleg via the reference surface's own basis (see measureBasis
      // above) instead of raw X/Y/Z, so the legs mean "along the wall"
      // and "distance to the wall" rather than arbitrary global axes.
      const basis = measureBasis(localNormal);
      const { depth, right, up } = measureComponents(a, b, basis);
      const cornerRight = a.clone().addScaledVector(basis.tangentRight, right);
      const cornerRightUp = cornerRight.clone().addScaledVector(basis.tangentUp, up);
      const setLeg = (leg, p1, p2) => {
        leg.geometry.setPositions([p1.x, p1.y, p1.z, p2.x, p2.y, p2.z]);
        leg.computeLineDistances();
      };
      setLeg(entry.legRight, a, cornerRight);
      setLeg(entry.legUp, cornerRight, cornerRightUp);
      setLeg(entry.legDepth, cornerRightUp, b);

      const length = a.distanceTo(b);
      entry.label.position.copy(a).add(b).multiplyScalar(0.5);
      updateMeasureLabelText(entry.label, measureLabelLines(length));
      entry.legRightLabel.position.copy(a).add(cornerRight).multiplyScalar(0.5);
      updateMeasureLabelText(entry.legRightLabel, [{ text: formatMm(Math.abs(right)), color: "#3b82f6" }]);
      entry.legUpLabel.position.copy(cornerRight).add(cornerRightUp).multiplyScalar(0.5);
      updateMeasureLabelText(entry.legUpLabel, [{ text: formatMm(Math.abs(up)), color: "#22c55e" }]);
      entry.legDepthLabel.position.copy(cornerRightUp).add(b).multiplyScalar(0.5);
      updateMeasureLabelText(entry.legDepthLabel, [{ text: formatMm(Math.abs(depth)), color: "#ef4444" }]);

      const visible = tagsVisibleRef.current;
      entry.line.visible = visible;
      entry.legRight.visible = visible;
      entry.legUp.visible = visible;
      entry.legDepth.visible = visible;
      entry.label.visible = visible;
      entry.legRightLabel.visible = visible;
      entry.legUpLabel.visible = visible;
      entry.legDepthLabel.visible = visible;

      requestRender();
    };

    const clearMeasurePreview = () => {
      if (!measurePreviewEntry) return;
      const entry = measurePreviewEntry;
      modelsGroup.remove(
        entry.markerB,
        entry.line,
        entry.legDepth,
        entry.legRight,
        entry.legUp,
        entry.label,
        entry.legDepthLabel,
        entry.legRightLabel,
        entry.legUpLabel,
      );
      entry.markerB.material.dispose();
      entry.line.geometry.dispose();
      entry.line.material.dispose();
      entry.legDepth.geometry.dispose();
      entry.legDepth.material.dispose();
      entry.legRight.geometry.dispose();
      entry.legRight.material.dispose();
      entry.legUp.geometry.dispose();
      entry.legUp.material.dispose();
      // Not entry.label.geometry (or legDepthLabel/legRightLabel/
      // legUpLabel's): THREE.Sprite shares one module-level geometry
      // singleton across every sprite instance in the app — disposing it
      // here would break every other sprite too.
      entry.label.material.map.dispose();
      entry.label.material.dispose();
      entry.legDepthLabel.material.map.dispose();
      entry.legDepthLabel.material.dispose();
      entry.legRightLabel.material.map.dispose();
      entry.legRightLabel.material.dispose();
      entry.legUpLabel.material.map.dispose();
      entry.legUpLabel.material.dispose();
      measurePreviewEntry = null;
      requestRender();
    };

    // Recomputes an entry's whole dogleg (line + three leg geometries +
    // all four labels) plus its stored depth/horizontal/vertical/length
    // from its current markerA/markerB positions and referenceNormal —
    // shared by initial creation, dragging an endpoint, and numerically
    // editing a leg's length, so those three don't each duplicate this
    // same block. Assumes the entry's THREE objects already exist;
    // callers handle any React state sync (`setMeasurements`) and their
    // own reasons for the update themselves.
    // Shared with dimension tags' own visibility toggle (tagsVisibleRef)
    // — one eye icon hides both. Applied here (called at the end of
    // every recompute, i.e. on creation, drag, and leg-length edits
    // alike) so a measurement always picks up the current toggle state
    // the moment it's touched, and again in bulk by the toggle's own
    // bridge below for everything already on screen.
    const applyMeasurementEntryVisibility = (entry) => {
      const visible = tagsVisibleRef.current;
      entry.markerA.visible = visible;
      entry.markerB.visible = visible;
      entry.line.visible = visible;
      entry.legRight.visible = visible;
      entry.legUp.visible = visible;
      entry.legDepth.visible = visible;
      entry.label.visible = visible;
      // A leg of (nearly) zero length would just stack a "0 mm" label on
      // top of its neighbour.
      entry.legRightLabel.visible = visible && (entry.horizontal ?? 1) > 0.005;
      entry.legUpLabel.visible = visible && (entry.vertical ?? 1) > 0.005;
      entry.legDepthLabel.visible = visible && (entry.depth ?? 1) > 0.005;
    };

    const recomputeMeasurementEntry = (entry) => {
      const a = entry.markerA.position;
      const b = entry.markerB.position;
      entry.line.geometry.setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
      entry.line.computeLineDistances();

      const basis = measureBasis(entry.referenceNormal);
      const { depth, right, up } = measureComponents(a, b, basis);
      const cornerRight = a.clone().addScaledVector(basis.tangentRight, right);
      const cornerRightUp = cornerRight.clone().addScaledVector(basis.tangentUp, up);
      const setLeg = (leg, p1, p2) => {
        leg.geometry.setPositions([p1.x, p1.y, p1.z, p2.x, p2.y, p2.z]);
        leg.computeLineDistances();
      };
      setLeg(entry.legRight, a, cornerRight);
      setLeg(entry.legUp, cornerRight, cornerRightUp);
      setLeg(entry.legDepth, cornerRightUp, b);

      entry.depth = Math.abs(depth);
      entry.horizontal = Math.abs(right);
      entry.vertical = Math.abs(up);
      entry.length = a.distanceTo(b);
      entry.label.position.copy(a).add(b).multiplyScalar(0.5);
      updateMeasureLabelText(entry.label, measureLabelLines(entry.length));

      entry.legRightLabel.position.copy(a).add(cornerRight).multiplyScalar(0.5);
      updateMeasureLabelText(entry.legRightLabel, [{ text: formatMm(entry.horizontal), color: "#3b82f6" }]);
      entry.legUpLabel.position.copy(cornerRight).add(cornerRightUp).multiplyScalar(0.5);
      updateMeasureLabelText(entry.legUpLabel, [{ text: formatMm(entry.vertical), color: "#22c55e" }]);
      entry.legDepthLabel.position.copy(cornerRightUp).add(b).multiplyScalar(0.5);
      updateMeasureLabelText(entry.legDepthLabel, [{ text: formatMm(entry.depth), color: "#ef4444" }]);

      applyMeasurementEntryVisibility(entry);
      requestRender();
    };

    // Builds a full measurement (marker/line/legs/labels) from two known
    // local-space points — shared by the normal click-to-place flow
    // (addPoint below) and by undo/redo, which need to recreate a
    // measurement from stored points without going through the
    // pending-point state machine. Reuses `existingMarkerA` if given
    // (the pending-point marker already placed for point A) instead of
    // creating a redundant one. `localNormal` is point B's surface
    // normal (local space) — B, by convention, is "the surface you're
    // measuring to" (see addPoint below) — and is stored on the entry so
    // later dragging point A can recompute the decomposition without
    // losing track of which surface it's still relative to. The three
    // dogleg legs and four labels are created with placeholder geometry/
    // text (same convention as the live preview's lazy creation below) —
    // `recomputeMeasurementEntry` immediately fills in their real
    // positions and values.
    const createMeasurementEntry = (a, b, existingMarkerA, localNormal) => {
      const markerA = existingMarkerA ?? createMeasureMarker();
      markerA.position.copy(a);
      const markerB = createMeasureMarker();
      markerB.position.copy(b);
      const geometry = new LineGeometry();
      geometry.setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
      const material = new LineMaterial({ color: 0x2a2622, depthTest: false, linewidth: MEASURE_LINE_WIDTH, resolution: measureLineResolution });
      const line = new Line2(geometry, material);
      line.computeLineDistances();
      line.renderOrder = 999;
      modelsGroup.add(line);
      const referenceNormal = (localNormal ?? MEASURE_UP).clone();
      const legRight = createMeasureLeg(a, a, 0x3b82f6);
      const legUp = createMeasureLeg(a, a, 0x22c55e);
      const legDepth = createMeasureLeg(a, a, 0xef4444);
      const label = createMeasureLabel(measureLabelLines(0), "center", -0.1);
      const legRightLabel = createMeasureLabel([{ text: "0.000 m", color: "#3b82f6" }], "center", 1.1);
      const legUpLabel = createMeasureLabel([{ text: "0.000 m", color: "#22c55e" }], "center", 1.1);
      const legDepthLabel = createMeasureLabel([{ text: "0.000 m", color: "#ef4444" }], "center", 1.1);
      const entry = {
        id: `measure-${++measureUid}`,
        markerA,
        markerB,
        line,
        legDepth,
        legRight,
        legUp,
        label,
        legDepthLabel,
        legRightLabel,
        legUpLabel,
        referenceNormal,
        depth: 0,
        horizontal: 0,
        vertical: 0,
        length: 0,
      };
      measurementsRuntime.push(entry);
      recomputeMeasurementEntry(entry);
      return entry;
    };

    const measureManager = {
      // Returns "started" after recording point A, "completed" after B
      // finishes a measurement. `localNormal` is only ever used for B —
      // A's own surface normal is irrelevant, since B is always "the
      // surface being measured to" (see createMeasurementEntry above).
      addPoint: (localPoint, localNormal) => {
        if (measurePendingPoint === null) {
          measurePendingPoint = localPoint;
          measurePendingMarker = createMeasureMarker();
          measurePendingMarker.position.copy(localPoint);
          measurePendingMarker.visible = tagsVisibleRef.current;
          requestRender();
          return "started";
        }
        // Two clicks on the same spot would make a 0 mm measurement.
        if (measurePendingPoint.distanceTo(localPoint) < 0.001) return "rejected";
        clearMeasurePreview();
        const a = measurePendingPoint;
        const b = localPoint;
        const aSnap = a.clone();
        const bSnap = b.clone();
        const normalSnap = (localNormal ?? MEASURE_UP).clone();
        const entry = createMeasurementEntry(a, b, measurePendingMarker, localNormal);
        measurePendingPoint = null;
        measurePendingMarker = null;
        const idBox = { id: entry.id };
        pushUndo({
          undo: () => {
            measureManager.remove(idBox.id);
            setMeasurements(measureManager.list());
          },
          redo: () => {
            const created = measureManager.createFromPoints(aSnap, bSnap, normalSnap);
            idBox.id = created.id;
            setMeasurements(measureManager.list());
          },
        });
        return "completed";
      },
      // Recreates a full measurement from two known local-space points
      // (and B's reference normal) — used by undo (restoring a removed
      // measurement) and redo (recreating one that was undone), bypassing
      // the pending-point state machine entirely.
      createFromPoints: (a, b, normal) => createMeasurementEntry(a.clone(), b.clone(), undefined, normal),
      // For undo: captures enough to recreate an equivalent measurement
      // after it's been removed.
      getPointsSnapshot: (id) => {
        const entry = measurementsRuntime.find((m) => m.id === id);
        if (!entry) return null;
        return { a: entry.markerA.position.clone(), b: entry.markerB.position.clone(), normal: entry.referenceNormal.clone() };
      },
      cancelPending: () => {
        if (measurePendingMarker) {
          modelsGroup.remove(measurePendingMarker);
          measurePendingMarker.material.dispose();
          measurePendingMarker = null;
        }
        measurePendingPoint = null;
        clearMeasurePreview();
        requestRender();
      },
      remove: (id) => {
        const index = measurementsRuntime.findIndex((m) => m.id === id);
        if (index === -1) return;
        const [entry] = measurementsRuntime.splice(index, 1);
        modelsGroup.remove(
          entry.markerA,
          entry.markerB,
          entry.line,
          entry.legDepth,
          entry.legRight,
          entry.legUp,
          entry.label,
          entry.legDepthLabel,
          entry.legRightLabel,
          entry.legUpLabel,
        );
        entry.markerA.material.dispose();
        entry.markerB.material.dispose();
        entry.line.geometry.dispose();
        entry.line.material.dispose();
        entry.legDepth.geometry.dispose();
        entry.legDepth.material.dispose();
        entry.legRight.geometry.dispose();
        entry.legRight.material.dispose();
        entry.legUp.geometry.dispose();
        entry.legUp.material.dispose();
        // Not entry.label.geometry (or legDepthLabel/legRightLabel/
        // legUpLabel's): THREE.Sprite shares one module-level geometry
        // singleton across every sprite instance in the app — disposing
        // it here would break every other sprite too.
        entry.label.material.map.dispose();
        entry.label.material.dispose();
        entry.legDepthLabel.material.map.dispose();
        entry.legDepthLabel.material.dispose();
        entry.legRightLabel.material.map.dispose();
        entry.legRightLabel.material.dispose();
        entry.legUpLabel.material.map.dispose();
        entry.legUpLabel.material.dispose();
        requestRender();
      },
      list: () =>
        measurementsRuntime.map((m) => ({ id: m.id, depth: m.depth, horizontal: m.horizontal, vertical: m.vertical, length: m.length })),
      // Repositions B to an exact known local-space point and recomputes
      // everything from it — used both by setLeg below and directly by
      // the edit feature's own undo/redo (which just replays a snapshot
      // position rather than re-deriving one from a typed value).
      setBPosition: (id, bLocal) => {
        const entry = measurementsRuntime.find((m) => m.id === id);
        if (!entry) return false;
        entry.markerB.position.copy(bLocal);
        recomputeMeasurementEntry(entry);
        return true;
      },
      // Moves B so that one leg (depth/horizontal/vertical) becomes
      // exactly `valueMm`, keeping the other two legs' current signed
      // components — and A — unchanged. Returns the old and new B
      // positions (for the caller to build an undo entry from) or null
      // if the measurement no longer exists.
      setLeg: (id, which, valueMm) => {
        const entry = measurementsRuntime.find((m) => m.id === id);
        if (!entry) return null;
        const a = entry.markerA.position;
        const oldB = entry.markerB.position.clone();
        const basis = measureBasis(entry.referenceNormal);
        const { depth, right, up } = measureComponents(a, oldB, basis);
        const newAbs = Math.max(0, valueMm) / 1000;
        // A component sitting at ~0 has an ambiguous sign — default to
        // positive rather than flipping direction on every re-edit.
        const sign = (current) => (current < 0 ? -1 : 1);
        const newB = a
          .clone()
          .addScaledVector(basis.normal, which === "depth" ? sign(depth) * newAbs : depth)
          .addScaledVector(basis.tangentRight, which === "horizontal" ? sign(right) * newAbs : right)
          .addScaledVector(basis.tangentUp, which === "vertical" ? sign(up) * newAbs : up);
        entry.markerB.position.copy(newB);
        recomputeMeasurementEntry(entry);
        return { oldB, newB: newB.clone() };
      },
    };
    measureManagerRef.current = measureManager;

    // Dimension tags (hover / pin): a single registry keyed by
    // `${modelId}::${localId}` (the same composite-key convention
    // isolatedKeys uses elsewhere), one entry — and exactly one sprite —
    // per tagged element. Two independent boolean flags (pinned, hovered)
    // drive one precedence function that decides both visibility and
    // style, which is what makes "never draw two tags on the same
    // element" true by construction rather than by scattered ad hoc
    // checks across the trigger paths below.
    const dimensionTags = new Map(); // key -> entry
    // Colors distinct from the protected measurement-leg colors
    // (#ef4444/#3b82f6/#22c55e) and the clip-gizmo blue — a warm accent
    // for a deliberate pin, a light neutral for a transient hover.
    const DIMENSION_TAG_STYLE_COLORS = {
      pinned: "#e0a458",
      hovered: "#e8eaed",
    };
    // Muted secondary color for the optional family-name line, kept the
    // same regardless of style so it always reads as supplementary to
    // the (style-colored) dimension line below it.
    const DIMENSION_TAG_FAMILY_COLOR = "#9aa0a6";

    const dimensionTagVisualStyle = (entry) => {
      if (entry.pinned) return "pinned";
      if (entry.hovered) return "hovered";
      return null;
    };

    // "Family name" prefers the type-relation name, but many elements —
    // IFCBUILDINGELEMENTPROXY especially, IFC's generic catch-all — have
    // no IfcRelDefinesByType relation at all, only their own instance
    // Name attribute (already fetched on every hover into entry.name).
    // Falling back to it is what makes such elements taggable at all.
    const resolveTagDisplayName = (entry) => entry.dimData?.familyName ?? entry.name ?? null;

    const syncPinnedDimensionTagsState = () => {
      const list = [];
      for (const [key, entry] of dimensionTags) {
        if (entry.pinned) {
          list.push({ key, guid: entry.guid, category: entry.category, name: entry.name, dimData: entry.dimData });
        }
      }
      setPinnedDimensionTags(list);
    };

    const refreshDimensionTagEntry = (key) => {
      const entry = dimensionTags.get(key);
      if (!entry) return;
      const style = dimensionTagVisualStyle(entry);
      const dimLines = style ? formatDimensionTag(entry.category, entry.dimData) : null;
      const familyName = style ? resolveTagDisplayName(entry) : null;
      // The tag tool works on any element now, not just pipes/ducts — an
      // element with no extrudable profile (a wall, a proxy, ...) simply
      // has no dimension line, but still gets a tag from its family name
      // alone. Only suppress the tag entirely when neither resolves.
      if (!style || (!dimLines && !familyName)) {
        entry.showable = false;
        if (entry.sprite) entry.sprite.visible = false;
        requestRender();
        return;
      }
      const lines = [];
      if (familyName) {
        lines.push({ text: familyName, color: DIMENSION_TAG_FAMILY_COLOR });
      }
      if (dimLines) {
        for (const text of dimLines) lines.push({ text, color: DIMENSION_TAG_STYLE_COLORS[style] });
      }
      if (!entry.sprite) {
        entry.sprite = createMeasureLabel(lines, "left");
        // Anchor the sprite's left edge (not its center) at the world
        // point, so the box renders to the right of the cursor/hit point
        // it's tracking instead of straddling it.
        entry.sprite.center.set(0, 0.5);
        entry.sprite.position.copy(entry.localPosition);
      } else {
        updateMeasureLabelText(entry.sprite, lines, "left");
      }
      // Gated by the user's own show/hide toggle, on top of the "is
      // there anything to show" check above — pinned and hovered tags
      // alike stay in the scene but invisible while toggled off.
      entry.showable = true;
      entry.sprite.visible = tagsVisibleRef.current && (entry.anchor?.fade ?? 1) > 0.01;
      requestRender();
    };

    const destroyDimensionTagEntry = (key) => {
      const entry = dimensionTags.get(key);
      if (!entry) return;
      if (entry.sprite) {
        modelsGroup.remove(entry.sprite);
        entry.sprite.material.map?.dispose();
        entry.sprite.material.dispose();
      }
      const wasPinned = entry.pinned;
      dimensionTags.delete(key);
      if (wasPinned) syncPinnedDimensionTagsState();
      requestRender();
    };

    // `meta.localPosition` (a modelsGroup-local THREE.Vector3) is only
    // used the first time an element is seen — once created, an entry's
    // anchor position never moves, even as pinned/hovered flags come and
    // go.
    const getOrCreateDimensionTagEntry = (key, meta) => {
      let entry = dimensionTags.get(key);
      if (!entry) {
        entry = {
          sprite: null,
          guid: meta.guid,
          category: meta.category,
          name: meta.name ?? null,
          localId: meta.localId,
          modelId: meta.modelId,
          localPosition: meta.localPosition,
          dimData: meta.dimData ?? null,
          pinned: false,
          hovered: false,
        };
        dimensionTags.set(key, entry);
      } else if (meta.dimData !== undefined) {
        entry.dimData = meta.dimData;
      }
      return entry;
    };

    const setHoveredFlag = (key, hovered) => {
      const entry = dimensionTags.get(key);
      if (!entry) return;
      entry.hovered = hovered;
      if (!hovered && !entry.pinned) destroyDimensionTagEntry(key);
      else refreshDimensionTagEntry(key);
    };

    const setPinnedFlag = (key, pinned) => {
      const entry = dimensionTags.get(key);
      if (!entry) return;
      entry.pinned = pinned;
      if (pinned) entry.anchor ??= makeAnchor(entry.localPosition); // a placed pin hides behind things; a hover tag follows the cursor and never does
      if (!pinned && !entry.hovered) destroyDimensionTagEntry(key);
      else refreshDimensionTagEntry(key);
      syncPinnedDimensionTagsState();
    };

    const destroyAllDimensionTags = () => {
      for (const key of [...dimensionTags.keys()]) destroyDimensionTagEntry(key);
    };

    // Constant on-screen size for measurement markers (same technique as
    // scalePivotMarker below), since — unlike the transient pivot marker —
    // these persist and need to stay a sane size at any zoom level.
    const measureScratchVec3 = new THREE.Vector3();
    const measureForwardScratch = new THREE.Vector3();
    const scaleMeasureMarkers = () => {
      // Apparent on-screen size in a perspective camera is governed by
      // *depth* (distance along the camera's forward axis), not
      // straight-line distance to the camera — using distanceTo() here
      // over-scales anything off-axis (near the edge of the frustum),
      // since its Euclidean distance is larger than its depth for the
      // same "how far into the scene" position. Project onto the
      // camera's current forward direction instead (computed once here,
      // not per object, since it doesn't change within one scaling pass).
      camera.getWorldDirection(measureForwardScratch);
      const worldPerPixelAt = (object) => {
        const depth = object.getWorldPosition(measureScratchVec3).sub(camera.position).dot(measureForwardScratch);
        return (2 * Math.tan((camera.fov * Math.PI) / 360) * depth) / renderer.domElement.clientHeight;
      };
      const scaleOne = (marker) => {
        marker.scale.setScalar(worldPerPixelAt(marker) * MEASURE_MARKER_PIXELS);
      };
      // Same size for the main label and the three per-leg labels — all
      // are single-line now, so there's no reason for one to be bigger.
      const scaleLegLabel = (label, pixels = MEASURE_LEG_LABEL_PIXEL_HEIGHT) => {
        const height = worldPerPixelAt(label) * pixels;
        label.scale.set(height * label.userData.aspect, height, 1);
      };
      if (measurePendingMarker) scaleOne(measurePendingMarker);
      if (measurePreviewEntry) {
        scaleOne(measurePreviewEntry.markerB);
        scaleLegLabel(measurePreviewEntry.label);
        scaleLegLabel(measurePreviewEntry.legDepthLabel, MEASURE_LEG_LABEL_SMALL_PIXEL_HEIGHT);
        scaleLegLabel(measurePreviewEntry.legRightLabel, MEASURE_LEG_LABEL_SMALL_PIXEL_HEIGHT);
        scaleLegLabel(measurePreviewEntry.legUpLabel, MEASURE_LEG_LABEL_SMALL_PIXEL_HEIGHT);
      }
      for (const entry of measurementsRuntime) {
        scaleOne(entry.markerA);
        scaleOne(entry.markerB);
        scaleLegLabel(entry.label);
        scaleLegLabel(entry.legDepthLabel, MEASURE_LEG_LABEL_SMALL_PIXEL_HEIGHT);
        scaleLegLabel(entry.legRightLabel, MEASURE_LEG_LABEL_SMALL_PIXEL_HEIGHT);
        scaleLegLabel(entry.legUpLabel, MEASURE_LEG_LABEL_SMALL_PIXEL_HEIGHT);
      }
    };

    // Decides, per frame, which leg labels have room. The total label is
    // always shown; a leg label appears only when its leg is long enough on
    // screen to carry it and it would not touch the total, a marker or a
    // leg label already placed. So a tiny measurement reads as one clear
    // number, and a large one shows the full breakdown.
    const layoutScratch = new THREE.Vector3();
    const MEASURE_TOTAL_LABEL_CENTER_Y = -0.1; // as createMeasureLabel(..., -0.1) for the total
    const layoutMeasureLabels = () => {
      const w = renderer.domElement.clientWidth;
      const h = renderer.domElement.clientHeight;
      const toPx = (obj, out) => {
        obj.getWorldPosition(layoutScratch).project(camera);
        out.x = (layoutScratch.x * 0.5 + 0.5) * w;
        out.y = (-layoutScratch.y * 0.5 + 0.5) * h;
        out.z = layoutScratch.z;
      };
      const rectOf = (label, pixels, pad) => {
        const p = { x: 0, y: 0, z: 0 };
        toPx(label, p);
        const lw = pixels * label.userData.aspect;
        const cy = label.center.y;
        return { l: p.x - lw / 2 - pad, r: p.x + lw / 2 + pad, t: p.y - (1 - cy) * pixels - pad, b: p.y + cy * pixels + pad, w: lw };
      };
      const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
      const pa = { x: 0, y: 0, z: 0 };
      const pb = { x: 0, y: 0, z: 0 };
      // Everything already on screen, across all measurements, so labels of
      // neighbouring measurements never sit on top of each other either.
      const placed = [];
      if (tagsVisibleRef.current) {
        // Total labels of close measurements: read every rect once, work out the
        // vertical nudges once, then write each sprite's anchor once (no layout reads
        // after writes). The sprite hangs above its point; a nudge stacks it higher.
        const totals = measurementsRuntime.filter((e) => e.label.visible);
        for (const e of totals) e.label.center.y = MEASURE_TOTAL_LABEL_CENTER_Y;
        const totalRects = totals.map((e) => rectOf(e.label, MEASURE_LEG_LABEL_PIXEL_HEIGHT, 2));
        const lifts = stackUp(totalRects, 2);
        totals.forEach((e, i) => {
          if (lifts[i] > 0) e.label.center.y = MEASURE_TOTAL_LABEL_CENTER_Y - lifts[i] / MEASURE_LEG_LABEL_PIXEL_HEIGHT;
        });
        for (const entry of measurementsRuntime) {
          placed.push(rectOf(entry.label, MEASURE_LEG_LABEL_PIXEL_HEIGHT, 4));
          for (const m of [entry.markerA, entry.markerB]) {
            toPx(m, pa);
            const r = MEASURE_MARKER_PIXELS + 3;
            placed.push({ l: pa.x - r, r: pa.x + r, t: pa.y - r, b: pa.y + r });
          }
        }
      }
      for (const entry of measurementsRuntime) {
        if (!tagsVisibleRef.current) continue;
        const legs = [
          [entry.legRightLabel, entry.legRight, entry.horizontal],
          [entry.legUpLabel, entry.legUp, entry.vertical],
          [entry.legDepthLabel, entry.legDepth, entry.depth],
        ].sort((x, y) => (y[2] ?? 0) - (x[2] ?? 0));
        for (const [label, leg, value] of legs) {
          // A leg as long as the total repeats the same number.
          if ((value ?? 1) <= 0.005 || Math.abs((value ?? 0) - (entry.length ?? 0)) < 0.01 * (entry.length ?? 1)) {
            label.visible = false;
            continue;
          }
          // Try below the leg first, then above it.
          let rect = null;
          let ok = false;
          let legPx = 0;
          const pos = leg.geometry.attributes.instanceStart;
          if (pos && pos.count > 0) {
            const e = leg.geometry.attributes.instanceEnd;
            layoutScratch.set(pos.getX(0), pos.getY(0), pos.getZ(0));
            leg.localToWorld(layoutScratch).project(camera);
            pa.x = (layoutScratch.x * 0.5 + 0.5) * w;
            pa.y = (-layoutScratch.y * 0.5 + 0.5) * h;
            layoutScratch.set(e.getX(0), e.getY(0), e.getZ(0));
            leg.localToWorld(layoutScratch).project(camera);
            pb.x = (layoutScratch.x * 0.5 + 0.5) * w;
            pb.y = (-layoutScratch.y * 0.5 + 0.5) * h;
            legPx = Math.hypot(pa.x - pb.x, pa.y - pb.y);
          }
          for (const cy of [1.1, -0.1]) {
            label.center.y = cy;
            rect = rectOf(label, MEASURE_LEG_LABEL_SMALL_PIXEL_HEIGHT, 2);
            ok = legPx >= rect.w * 0.9 && !placed.some((q) => hit(rect, q));
            if (ok) break;
          }
          label.visible = ok;
          if (ok) placed.push(rect);
        }
      }
    };

    // Constant on-screen size for dimension tags (same technique as
    // scaleMeasureMarkers above) — but scaled by a constant *canvas-
    // pixel-to-world* ratio rather than a constant total sprite height,
    // so a multi-line tag (e.g. a family-name line above the dimension
    // line) renders each line at the same size as a single-line tag
    // instead of the whole canvas being squeezed into the same overall
    // height and every line shrinking as more are added. The ratio is
    // calibrated against a single line's own canvas height so a
    // one-line tag's on-screen size is unchanged from before.
    // ---- Visibility of anchored things (pinned tags, the long-press ring): shown only while nothing stands
    // between the camera and the anchor. One ray per anchor from the camera through the anchor's pixel, with the
    // same raycast as picking (it answers null to a second call while one is in flight, so the rays run one at a
    // time, a few per frame, and only for anchors whose view changed). Two agreeing answers flip the state.
    const ANCHOR_RAYS_PER_FRAME = 3;
    const ANCHOR_FADE_MS = 120;
    const anchorPose = new Float32Array(36);
    let anchorPoseVersion = 0;
    let anchorBusy = false;
    let anchorFadeAt = performance.now();
    const anchorWorld = new THREE.Vector3();
    const anchorNdc = new THREE.Vector3();
    const anchorReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    function makeAnchor(local) {
      return { local, vis: { shown: true, agree: 0 }, seen: -1, tries: 0, fade: 1 };
    }
    const anchorPoseChanged = () => {
      camera.updateMatrixWorld();
      modelsGroup.updateMatrixWorld();
      let changed = false;
      const put = (v, i) => {
        if (Math.abs(anchorPose[i] - v) > 1e-6) {
          anchorPose[i] = v;
          changed = true;
        }
      };
      const pe = camera.projectionMatrix.elements;
      camera.matrixWorld.elements.forEach((v, i) => put(v, i));
      modelsGroup.matrixWorld.elements.forEach((v, i) => put(v, 16 + i));
      put(pe[0], 32); put(pe[5], 33); put(pe[8], 34); put(pe[9], 35);
      return changed;
    };
    const projectAnchor = (a) => anchorNdc.copy(a.local).applyMatrix4(modelsGroup.matrixWorld).project(camera);
    const checkAnchors = async (due, version) => {
      anchorBusy = true;
      try {
        const rect = renderer.domElement.getBoundingClientRect();
        for (const a of due.slice(0, ANCHOR_RAYS_PER_FRAME)) {
          const ndc = projectAnchor(a);
          if (!onScreen(ndc)) continue;
          anchorWorld.copy(a.local).applyMatrix4(modelsGroup.matrixWorld);
          const anchorDistance = camera.position.distanceTo(anchorWorld);
          const hit = await raycastVisible(rect.left + (ndc.x * 0.5 + 0.5) * rect.width, rect.top + (-ndc.y * 0.5 + 0.5) * rect.height);
          const seen = visibleByHit(anchorDistance, hit ? camera.position.distanceTo(hit.point) : null);
          if (seen === null) {
            // no answer (a pick was in flight): retry on the next frames, a few times
            if (++a.tries >= 3) { a.seen = version; a.tries = 0; }
            continue;
          }
          a.tries = 0;
          a.seen = version;
          a.vis = stepVisibility(a.vis, seen);
        }
      } catch (err) {
        console.error("Visibility check failed", err);
      } finally {
        anchorBusy = false;
        requestRender();
      }
    };
    const pumpAnchorVisibility = () => {
      if (anchorPoseChanged()) anchorPoseVersion++;
      const now = performance.now();
      const dt = Math.min(100, now - anchorFadeAt);
      anchorFadeAt = now;
      const anchors = [];
      for (const entry of dimensionTags.values()) if (entry.anchor && entry.sprite && tagsVisibleRef.current) anchors.push(entry.anchor);
      if (pressPin.anchor && pressRings.isPinOn()) anchors.push(pressPin.anchor);
      if (anchors.length === 0) return;
      const due = [];
      for (const a of anchors) {
        if (!onScreen(projectAnchor(a))) {
          a.vis = { shown: false, agree: 0 }; // off screen or behind the camera: no ray needed
          a.seen = anchorPoseVersion;
        } else if (a.seen !== anchorPoseVersion || a.vis.agree > 0) due.push(a);
      }
      if (due.length > 0 && !anchorBusy) checkAnchors(due, anchorPoseVersion);
      let animating = false;
      for (const a of anchors) {
        const target = a.vis.shown ? 1 : 0;
        const next = anchorReduced?.matches ? target : a.fade + Math.sign(target - a.fade) * Math.min(Math.abs(target - a.fade), dt / ANCHOR_FADE_MS);
        if (next !== a.fade) {
          a.fade = next;
          animating = true;
        }
      }
      for (const entry of dimensionTags.values()) {
        const a = entry.anchor;
        if (!a || !entry.sprite) continue;
        entry.sprite.material.opacity = a.fade;
        entry.sprite.visible = !!entry.showable && tagsVisibleRef.current && a.fade > 0.01;
      }
      if (pressPin.anchor && pressRings.isPinOn()) pressRings.setPinHidden(!pressPin.anchor.vis.shown);
      if (animating) requestRender();
    };
    if (import.meta.env.VITE_TEST_HOOK) window.__ifcDebug.tagState = () => [...dimensionTags.values()].filter((e) => e.anchor).map((e) => ({ guid: e.guid, shown: e.anchor.vis.shown, fade: e.anchor.fade, visible: !!e.sprite?.visible, opacity: e.sprite?.material.opacity ?? null }));
    const dimensionTagScratchVec3 = new THREE.Vector3();
    const dimensionTagForwardScratch = new THREE.Vector3();
    const DIMENSION_TAG_ONE_LINE_CANVAS_HEIGHT = MEASURE_LABEL_LINE_HEIGHT + MEASURE_LABEL_PADDING_Y * 2 + LABEL_HALO * 2;
    const DIMENSION_TAG_CANVAS_TO_WORLD_RATIO = MEASURE_LEG_LABEL_PIXEL_HEIGHT / DIMENSION_TAG_ONE_LINE_CANVAS_HEIGHT;
    const scaleDimensionTags = () => {
      if (dimensionTags.size === 0) return;
      // See scaleMeasureMarkers above for why this uses forward-projected
      // depth rather than camera.position.distanceTo() — the latter
      // over-scales a tag the further off-axis (closer to the screen
      // edge) it sits.
      camera.getWorldDirection(dimensionTagForwardScratch);
      const worldPerPixelAt = (object) => {
        const depth = object.getWorldPosition(dimensionTagScratchVec3).sub(camera.position).dot(dimensionTagForwardScratch);
        return (2 * Math.tan((camera.fov * Math.PI) / 360) * depth) / renderer.domElement.clientHeight;
      };
      for (const entry of dimensionTags.values()) {
        const sprite = entry.sprite;
        if (!sprite) continue;
        const scale = worldPerPixelAt(sprite) * DIMENSION_TAG_CANVAS_TO_WORLD_RATIO;
        const canvas = sprite.userData.canvas;
        sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
      }
    };

    // Suppress the browser's native middle-click autoscroll (the little
    // scroll-icon drag mode most browsers activate on a middle-button
    // mousedown) — it fights with OrbitControls' own middle-button pan for
    // the first frame or two, which looked like a jump/stutter right after
    // the click.
    const suppressMiddleClickAutoscroll = (event) => {
      if (event.button === 1) event.preventDefault();
    };
    renderer.domElement.addEventListener(
      "mousedown",
      suppressMiddleClickAutoscroll,
    );

    // The canvas has no tabIndex, so clicking it never moves
    // `document.activeElement` away from whatever was focused before —
    // once the user so much as clicks into the search box, it silently
    // keeps focus forever (even while rotating/clicking the model),
    // which permanently disables the global h/c/m/t keyboard shortcuts
    // below (they intentionally skip themselves while an input has
    // focus, so typing in the search box isn't hijacked). Blur whatever
    // that stray focus is on any interaction with the viewport, for
    // every button (not just rotate's left-button one), so hotkeys keep
    // working after the search box has been used.
    const blurStrayFocus = () => {
      const active = document.activeElement;
      if (active && active !== document.body && !renderer.domElement.contains(active)) {
        active.blur();
      }
    };
    renderer.domElement.addEventListener("pointerdown", blurStrayFocus);

    // Explicit middle-button-held tracking for tryMiddleScrollClipPlane
    // (see onZoomWheel below) — WheelEvent.buttons is unreliable across
    // real browsers/input devices/trackpad-middle-click emulation for a
    // "physically hold the button, then scroll" gesture, even though it
    // works fine in an automated test that hardcodes the property. This
    // tracks the real mousedown/mouseup state instead.
    let middleButtonHeld = false;
    const onMiddleButtonDown = (event) => {
      if (event.button === 1) middleButtonHeld = true;
    };
    const onMiddleButtonUp = (event) => {
      if (event.button === 1) middleButtonHeld = false;
    };
    // Covers the button being released outside the window entirely (e.g.
    // alt-tabbing away while holding it), where no mouseup ever fires.
    const onMiddleButtonReset = () => {
      middleButtonHeld = false;
    };
    window.addEventListener("mousedown", onMiddleButtonDown);
    window.addEventListener("mouseup", onMiddleButtonUp);
    window.addEventListener("blur", onMiddleButtonReset);

    // Clipping planes only discard pixels at render time — the mesh/BVH
    // data a raycast walks is completely untouched by them. Without this,
    // rotating, selecting, or placing a clip plane after cutting into the
    // model would happily hit geometry that's currently invisible behind
    // the cut. When no plane is active this reduces to the plain
    // nearest-hit raycast (fast path); when one or more are active it
    // collects every hit along the ray from every loaded model and
    // returns the closest one that isn't discarded by any active plane,
    // using the exact same normal·X + constant >= 0 "kept" convention
    // every plane's worldPlane/cameraClipPlaneRef is already built around.
    const raycastVisible = async (clientX, clientY) => {
      const data = {
        camera,
        mouse: new THREE.Vector2(clientX, clientY),
        dom: renderer.domElement,
      };
      // Both branches below loop over models themselves rather than
      // delegating to pipeline.fragments.raycast(data) (which aggregates
      // *every* loaded model with no visibility check at all) — a whole
      // model toggled off via the "Loaded Models" checkbox is still
      // `entry.model`-raycastable at the fragments level (that flag only
      // lives on the THREE object, not anything the worker knows about),
      // so without this filter a hidden model sitting in front of a
      // visible one would win the closest-hit race and make the visible
      // one unpickable underneath/behind it.
      const visibleModels = [...modelsRef.current.values()].filter((entry) => entry.object.visible);
      const activePlanes = renderer.clippingPlanes;
      if (activePlanes.length === 0) {
        let closest = null;
        for (const entry of visibleModels) {
          const hit = await entry.model.raycast(data);
          if (hit && (!closest || hit.distance < closest.distance)) closest = hit;
        }
        return closest;
      }
      const allHits = [];
      for (const entry of visibleModels) {
        const hits = await entry.model.raycastAll(data);
        if (hits) allHits.push(...hits);
      }
      if (allHits.length === 0) return null;
      allHits.sort((a, b) => a.distance - b.distance);
      const EPS = 1e-4;
      return (
        allHits.find((hit) =>
          activePlanes.every((plane) => plane.distanceToPoint(hit.point) >= -EPS),
        ) ?? null
      );
    };
    if (import.meta.env.VITE_TEST_HOOK) window.__ifcDebug.raycast = raycastVisible;
    raycastVisibleRef.current = raycastVisible;

    // Right-click opens a context menu (see App.jsx) instead of the
    // browser's native one. Kick off the surface raycast immediately so
    // it's ready (or close to it) by the time the user picks a menu item;
    // the menu itself opens without waiting on it.
    const LONG_PRESS_MS = 500;
    // A ring at the finger while it charges toward the long press, then a ring pinned to the pressed
    // 3D point for as long as the context menu is open (right-click on desktop gets the same pin).
    const pressRings = createPressRings(container, LONG_PRESS_MS);
    pressRingsRef.current = pressRings;
    const pressPin = { anchor: null }; // anchored to the pressed point (modelsGroup space) once the raycast answers
    const pressPinScratch = new THREE.Vector3();
    const updatePressPin = () => {
      if (!pressPin.anchor || !pressRings.isPinOn()) return;
      modelsGroup.updateMatrixWorld();
      pressPinScratch.copy(pressPin.anchor.local).applyMatrix4(modelsGroup.matrixWorld).project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      pressRings.movePin(r.left + (pressPinScratch.x * 0.5 + 0.5) * r.width, r.top + (-pressPinScratch.y * 0.5 + 0.5) * r.height);
    };
    let contextMenuSeq = 0;
    const openContextMenuAt = (clientX, clientY, touch = false) => {
      const id = ++contextMenuSeq;
      pressPin.anchor = null;
      pressRings.showPin(clientX, clientY);
      const promise = raycastVisible(clientX, clientY).catch((err) => {
        console.error("Surface pick failed", err);
        return null;
      });
      pendingSurfacePickRef.current = { id, promise };
      setContextMenu({ x: clientX, y: clientY, touch });
      // Nothing under the pointer: the menu has nothing to act on, so close
      // it and say what to do instead of leaving an inert menu.
      promise.then((hit) => {
        if (hit && id === contextMenuSeq) {
          modelsGroup.updateMatrixWorld();
          pressPin.anchor = makeAnchor(modelsGroup.worldToLocal(hit.point.clone()));
        }
        if (hit || id !== contextMenuSeq) return;
        pressRings.hidePin();
        setContextMenu(null);
        showToastRef.current(touch ? "Press and hold on a model part" : "Right-click on a model part");
      });
    };
    const onContextMenu = (event) => {
      event.preventDefault();
      // A long-press on Android fires "contextmenu" too; our own
      // long-press (below) already opened the menu for that touch.
      if (event.pointerType === "touch" && longPressFiredAt && Date.now() - longPressFiredAt < 1500) return;
      openContextMenuAt(event.clientX, event.clientY, event.pointerType === "touch");
    };
    let longPressFiredAt = 0;
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    // Escape while measuring: cancel just the pending point A if one's
    // been placed (so the tool stays armed for a fresh A), otherwise exit
    // measure mode entirely.
    // Cancels a half-placed measurement, else disarms whichever tool is on.
    // Shared by Escape and by clicking/tapping empty space. Returns true if
    // it did something.
    const exitActiveTool = () => {
      if (measurePendingPoint !== null) {
        measureManager.cancelPending();
        return true;
      }
      if (measureModeActiveRef.current) {
        measureModeActiveRef.current = false;
        setMeasureModeActiveState(false);
        return true;
      }
      if (tagToolActiveRef.current) {
        tagToolActiveRef.current = false;
        setTagToolActiveState(false);
        clearHoveredDimensionTagRef.current?.();
        return true;
      }
      if (categoryHideModeActiveRef.current) {
        categoryHideModeActiveRef.current = false;
        setCategoryHideModeActiveState(false);
        return true;
      }
      return false;
    };
    const onMeasureKeyDown = (event) => {
      if (event.key !== "Escape") return;
      if (exitActiveTool()) {
        event.ifcEscHandled = true;
      } else if (selectedHitRef.current) {
        event.ifcEscHandled = true;
        // Inlined rather than calling the `clearSelection` callback
        // directly — that's defined later in this same hook function via
        // its own useCallback, so referencing it here would depend on
        // this effect's closure being invoked only after that later
        // assignment has run (true today, but fragile to rely on).
        clearHighlightRef.current?.();
        selectedHitRef.current = null;
        setSelectedElement(null);
      }
    };
    window.addEventListener("keydown", onMeasureKeyDown);

    // Ctrl+scroll used to move the (single) clip plane along its own
    // normal; that was replaced by shift+dragging its gizmo (see
    // onClipPlaneDragMove below) and, later, shift+scrolling while
    // hovering that same gizmo (see tryShiftScrollClipPlane, used from
    // onZoomWheel) — both resolve "which plane" the same way, by
    // requiring the cursor to actually be over that plane's own gizmo,
    // since with multiple planes there's no single unambiguous "the"
    // plane a keyboard-modified scroll could target otherwise. Ctrl+wheel
    // is still swallowed here (rather than left unhandled) so it doesn't
    // fall through to the browser's own page-zoom — attached to `window`
    // with `capture: true` so it runs, and can stop the event, before
    // OrbitControls' own wheel listener on `renderer.domElement`;
    // registration order alone wouldn't guarantee that, since both would
    // otherwise be listening on the very same element.
    const onCtrlWheel = (event) => {
      if (!event.ctrlKey) return;
      if (event.target !== renderer.domElement && !renderer.domElement.contains(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("wheel", onCtrlWheel, { capture: true, passive: false });

    // Small marker sphere shown at the current rotation pivot while
    // dragging, so it's obvious what point the model is spinning around.
    // Drawn on top of everything and rescaled each frame (see the render
    // loop) to hold a constant on-screen size at any zoom level.
    const PIVOT_MARKER_PIXELS = 7;
    const pivotMarker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x96652f, depthTest: false }), // --accent
    );
    pivotMarker.visible = false;
    pivotMarker.renderOrder = 999;
    // A fingertip covers about 40 px, so on touch a thin ring (radius in
    // pixels) around the dot stays visible next to the finger. It is a
    // child of the dot: same position, visibility and (via the unit ring
    // radius * PIVOT_RING_PIXELS / PIVOT_MARKER_PIXELS) screen size.
    const PIVOT_RING_PIXELS = 26;
    const pivotRing = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0x96652f, depthTest: false, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    pivotRing.scale.setScalar(PIVOT_RING_PIXELS / PIVOT_MARKER_PIXELS);
    pivotRing.renderOrder = 999;
    pivotRing.visible = TOUCH_UI;
    pivotMarker.add(pivotRing);
    scene.add(pivotMarker);

    if (import.meta.env.VITE_TEST_HOOK) window.__ifcDebug.pivotState = () => ({ visible: pivotMarker.visible, pos: pivotMarker.position.toArray(), scale: pivotMarker.scale.x, rotating, pending: pivotPending });
    const scalePivotMarker = () => {
      if (!pivotMarker.visible) return;
      const distance = camera.position.distanceTo(pivotMarker.position);
      const worldPerPixel =
        (2 * Math.tan((camera.fov * Math.PI) / 360) * distance) /
        renderer.domElement.clientHeight;
      pivotMarker.scale.setScalar(worldPerPixel * PIVOT_MARKER_PIXELS);
      pivotRing.quaternion.copy(camera.quaternion);
      pivotRing.visible = TOUCH_UI && !longPress; // while the long-press ring charges it is the one ring around the finger
    };

    // "Orbit the model" rotation (left mouse button). The camera never
    // moves during the gesture; the model group rotates instead, around
    // the point under the cursor.
    //
    // The whole thing is defined by one invariant:
    //
    //     modelQuat === camQuat · virtualQuat(theta, phi)⁻¹
    //
    // where virtualQuat is the orientation of an imaginary camera
    // orbiting an upright model at azimuth `theta` / elevation `phi`,
    // built with world +Y as its up vector. Rendering the real (fixed)
    // camera against a model posed this way is pixel-identical to
    // orbiting a real camera around a static upright model.
    //
    // Roll-free by construction: the model's up axis, expressed in
    // camera space, is
    //     camQuat⁻¹ · modelQuat · Y  ==  virtualQuat⁻¹ · Y
    // and since virtualQuat is a +Y-up lookAt, that always has a zero
    // screen-x component — i.e. the building's vertical stays vertical
    // on screen and can never tip over, no matter the drag path.
    //
    // Note this must be derived from persisted orbit angles rather than
    // composed onto whatever rotation the group already had: composing
    // only stays roll-free while the group happens to start upright,
    // which stops being true after the very first gesture.
    let rotating = false;
    let pendingNdc = null;
    const rotatePivot = new THREE.Vector3();
    let rotateRadius = 1;
    let startTheta = 0;
    let startPhi = 0;
    let startNdcX = 0;
    let startNdcY = 0;
    let gainX = 1;
    let gainY = 1;
    const cameraQuatStart = new THREE.Quaternion();
    const groupQuatStart = new THREE.Quaternion();
    const groupPosStart = new THREE.Vector3();
    const raycaster = new THREE.Raycaster();
    const WORLD_UP = new THREE.Vector3(0, 1, 0);
    const EPS = 0.001;
    // A full-width drag turns the model 360 degrees with a mouse; a finger
    // is far less precise, so touch turns it about 125 degrees instead.
    const ROTATE_GAIN = TOUCH_UI ? 0.35 : 1;

    // Orientation of a camera at `eye` looking at `target`. Uses
    // Matrix4.lookAt (the camera convention, looking down -Z);
    // Object3D.lookAt() uses the *object* convention (+Z toward the
    // target) and would be 180° off.
    const cameraLookQuaternion = (eye, target) =>
      new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().lookAt(eye, target, WORLD_UP),
      );

    const virtualQuaternion = (theta, phi) => {
      const offset = new THREE.Vector3().setFromSpherical(
        new THREE.Spherical(1, phi, theta),
      );
      return cameraLookQuaternion(offset, new THREE.Vector3(0, 0, 0));
    };

    const getNdc = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };
    // The reverse of getNdc: a world-space point to client (page) coords,
    // for anchoring HTML overlays (like the measure-delete popup below)
    // to a 3D position.
    const worldToClient = (worldPos) => {
      const ndc = worldPos.clone().project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return {
        x: rect.left + (ndc.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-ndc.y * 0.5 + 0.5) * rect.height,
      };
    };

    // Provisional pivot used for the first frames of a drag, until the
    // (async, worker-backed) geometry raycast comes back with the real
    // surface point under the cursor. Falls back to the closest point on
    // the sphere when the ray misses it entirely. The pivot only affects
    // translation, never the orientation, so it can't upset the
    // roll-free guarantee above.
    const raySphereProject = (ndc, center, radius) => {
      raycaster.setFromCamera(ndc, camera);
      const origin = raycaster.ray.origin;
      const dir = raycaster.ray.direction;
      const oc = origin.clone().sub(center);
      const b = oc.dot(dir);
      const c = oc.dot(oc) - radius * radius;
      const discriminant = b * b - c;
      const t = discriminant >= 0 ? -b - Math.sqrt(discriminant) : -b;
      return origin
        .clone()
        .addScaledVector(dir, t)
        .sub(center)
        .setLength(radius)
        .add(center);
    };

    // ---- Zoom engine --------------------------------------------------
    // Wheel, keys and buttons move a *goal* position for the camera along
    // the ray through the cursor, by a fixed world-space length per unit of
    // input (ZOOM.stepFrac of the scene's fit distance), never by a fraction
    // of the remaining distance, so speed is constant all the way in and
    // out. Each frame the camera glides toward the goal (exponential ease,
    // frame-rate independent). Because the camera only slides along the
    // cursor's own ray, the point under the cursor stays under the cursor.
    // Touch pinch still goes through OrbitControls (1:1 with finger spread);
    // enforcePinchLimits below applies the same limits to it.
    const zoom = { active: false, dir: new THREE.Vector3(), point: null, goal: new THREE.Vector3(), last: 0 };
    const zoomTmp = new THREE.Vector3();
    const zoomRay = new THREE.Raycaster();
    const touchPointers = new Set();
    let zoomLimitKind = null;
    // Shows "Closest zoom" / "Furthest zoom" once per contact with a limit; it
    // re-arms only once the camera has left the soft zone (see cueStep), never by time.
    const stepCue = (reached) => {
      const m = zoomMetrics();
      if (!m) return;
      // The camera glides toward the zoom goal: it only counts as "away" when the goal is away too.
      const g = zoom.active && zoom.point;
      const dist =
        zoomLimitKind === "max"
          ? Math.max(camera.position.distanceTo(m.center), zoom.active ? zoom.goal.distanceTo(m.center) : 0)
          : Math.min(camera.position.distanceTo(controls.target), g ? zoomTmp.copy(zoom.point).sub(zoom.goal).dot(zoom.dir) : Infinity);
      const r = cueStep(zoomLimitKind, reached, dist, m, ZOOM.softNotches * m.step);
      zoomLimitKind = r.latched;
      if (r.fire) showToastRef.current(reached === "min" ? "Closest zoom" : "Furthest zoom", 1400);
    };
    const noteZoomLimit = (kind) => {
      setZoomLimit(kind || null);
      stepCue(kind || null);
    };
    // The one place the limits are derived (see ZOOM): L is the distance at
    // which the whole scene just fits the view at the current field of view.
    const zoomMetrics = () => {
      const sphere = getGroupSphere();
      if (!sphere || !(sphere.radius > 0)) return null;
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const t = Math.min(tanV, tanV * camera.aspect);
      const L = (sphere.radius * Math.sqrt(1 + t * t)) / t;
      return {
        L,
        center: sphere.center,
        min: Math.min(ZOOM.minSurface, 0.05 * L),
        max: ZOOM.maxFitFactor * L,
        step: ZOOM.stepFrac * L,
      };
    };
    zoomMetricsRef.current = zoomMetrics;
    if (import.meta.env.VITE_TEST_HOOK) window.__ifcDebug.zoomState = () => ({ active: zoom.active, point: zoom.point && zoom.point.toArray(), goal: zoom.goal.toArray(), limit: zoomLimitKind });
    if (import.meta.env.VITE_TEST_HOOK) window.__ifcDebug.zoomMetrics = zoomMetrics;
    const softFactor = (remaining, m) => {
      const zone = ZOOM.softNotches * m.step;
      const k = Math.max(0, Math.min(1, remaining / zone));
      return ZOOM.softFloor + (1 - ZOOM.softFloor) * (k * k * (3 - 2 * k));
    };
    // Moves the zoom goal `notches` along `ray` (positive = in), clamped to
    // the limits. `cursorPoint` is the surface point under the cursor.
    const zoomAlongRay = (ray, cursorPoint, notches) => {
      const m = zoomMetrics();
      if (!m) return;
      const dir = ray.direction;
      const continuing =
        zoom.active &&
        zoom.dir.dot(dir) > 1 - 1e-10 &&
        zoomTmp.copy(camera.position).sub(zoom.goal).cross(dir).length() < 1e-3 * m.L;
      if (!continuing) {
        zoom.goal.copy(camera.position);
        zoom.dir.copy(dir);
        if (!cursorPoint) zoom.point = null;
      }
      if (cursorPoint) zoom.point = cursorPoint.clone();
      if (!zoom.point) zoom.point = camera.position.clone().addScaledVector(dir, m.L);
      const stepLen = Math.abs(notches) * m.step;
      let kind = null;
      let move = 0;
      if (notches > 0) {
        const remaining = zoomTmp.copy(zoom.point).sub(zoom.goal).dot(zoom.dir) - m.min;
        if (remaining <= 1e-9) {
          kind = "min";
        } else {
          const eff = stepLen * softFactor(remaining, m);
          move = Math.min(eff, remaining);
          if (eff >= remaining) kind = "min";
        }
        zoom.goal.addScaledVector(zoom.dir, move);
      } else {
        const p = zoomTmp.copy(zoom.goal).sub(m.center);
        const b = p.dot(zoom.dir);
        const c = p.lengthSq() - m.max * m.max;
        if (c >= -1e-9) {
          kind = "max";
        } else {
          const tExit = b + Math.sqrt(b * b - c);
          const eff = stepLen * softFactor(tExit, m);
          move = Math.min(eff, tExit);
          if (eff >= tExit) kind = "max";
        }
        zoom.goal.addScaledVector(zoom.dir, -move);
      }
      if (kind) noteZoomLimit(kind);
      else if (move > 0) noteZoomLimit(null);
      if (move > 0 || zoom.active) {
        zoom.active = true;
        zoom.last = performance.now();
        requestRender();
      }
    };
    // Per-frame glide toward the goal (called from animate, before controls.update).
    const stepZoom = (now) => {
      if (!zoom.active) return;
      const m = zoomMetrics();
      const dt = Math.min(0.25, Math.max(0, (now - zoom.last) / 1000));
      zoom.last = now;
      const delta = zoomTmp.copy(zoom.goal).sub(camera.position);
      if (delta.length() <= 1e-5 * (m ? m.L : 1)) {
        camera.position.copy(zoom.goal);
        zoom.active = false;
      } else {
        camera.position.addScaledVector(delta, 1 - Math.exp((-dt * 1000) / ZOOM.easeMs));
      }
      if (m) controls.minDistance = m.min;
      const dist = Math.max(zoom.point ? camera.position.distanceTo(zoom.point) : 0, controls.minDistance);
      // Near plane follows the distance to what you are looking at, so a
      // close surface is never clipped and a far view keeps depth precision.
      camera.near = Math.max(dist / 100, 1e-6);
      camera.updateProjectionMatrix();
      // Target stays exactly on the camera's forward axis, so controls.update()'s
      // lookAt is a no-op and only the distance changes.
      camera.getWorldDirection(zoomTmp);
      controls.target.copy(camera.position).addScaledVector(zoomTmp, dist);
      if (zoomLimitKind) stepCue(null);
      requestRender();
    };
    const cancelZoom = () => {
      zoom.active = false;
    };
    zoomCancelRef.current = cancelZoom;
    // Pinch (OrbitControls, 1:1 with the fingers): the same limits, applied
    // after its update. The far limit pulls the camera back along its view
    // axis (target untouched); the near limit is OrbitControls' minDistance.
    let pinching = false;
    const enforcePinchLimits = () => {
      if (touchPointers.size < 2) {
        if (pinching) {
          pinching = false;
          noteZoomLimit(null); // pinch ended: re-arm the cue
        }
        return;
      }
      pinching = true;
      if (cameraAnimRef.current) return;
      const m = zoomMetrics();
      if (!m) return;
      controls.minDistance = m.min;
      let kind = null;
      const p = zoomTmp.copy(camera.position).sub(m.center);
      if (p.length() >= m.max * (1 - 1e-6)) {
        const fwd = camera.getWorldDirection(new THREE.Vector3());
        const b = p.dot(fwd);
        const disc = b * b - (p.lengthSq() - m.max * m.max);
        const toTarget = camera.position.distanceTo(controls.target);
        if (disc >= 0 && p.length() > m.max) {
          const t = Math.min(Math.max(0, -b - Math.sqrt(disc)), Math.max(0, toTarget - m.min));
          camera.position.addScaledVector(fwd, t);
        }
        kind = "max";
      } else if (camera.position.distanceTo(controls.target) <= m.min * 1.001) {
        kind = "min";
      }
      const d = camera.position.distanceTo(controls.target);
      const near = Math.max(d / 100, 1e-6);
      if (Math.abs(near - camera.near) > camera.near * 0.01) {
        camera.near = near;
        camera.updateProjectionMatrix();
      }
      noteZoomLimit(kind);
    };
    const onTouchPointerDown = (event) => {
      if (event.pointerType === "touch") touchPointers.add(event.pointerId);
    };
    const onTouchPointerUp = (event) => {
      touchPointers.delete(event.pointerId);
    };
    renderer.domElement.addEventListener("pointerdown", onTouchPointerDown);
    window.addEventListener("pointerup", onTouchPointerUp);
    window.addEventListener("pointercancel", onTouchPointerUp);
    // Buttons and keys zoom toward the middle of the view.
    zoomStepRef.current = (notches) => {
      if (modelsGroup.children.length === 0) return;
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(0, 0);
      const apply = (point) => {
        if (disposed) return;
        // Like any direct camera input: stop automatic re-framing and any ease.
        autoFramedRef.current = false;
        fitByFocusRef.current = false;
        if (cameraAnimRef.current) {
          cancelAnimationFrame(cameraAnimRef.current);
          cameraAnimRef.current = 0;
        }
        zoomRay.setFromCamera(ndc, camera);
        let pt = point;
        if (!pt) {
          const hit = nearestModelHit(zoomRay.ray.origin, zoomRay.ray.direction);
          const sphere = getGroupSphere();
          pt = hit ? hit.point : sphere ? raySphereProject(ndc, sphere.center, sphere.radius) : controls.target;
        }
        zoomAlongRay(zoomRay.ray, pt, notches);
      };
      raycastVisible(r.left + r.width / 2, r.top + r.height / 2)
        .then((h) => apply(h ? h.point : null))
        .catch(() => apply(null));
    };

    // Kicks off (at most one at a time) the real, worker-backed raycast
    // that keeps zoomHitCache warm — called both after every zoom tick
    // and on plain hover, so the cache is usually already populated for
    // wherever the cursor currently sits by the time the user starts
    // scrolling, rather than only starting to warm up on the first tick.
    const refreshZoomHitCache = (clientX, clientY) => {
      if (zoomRaycastPending) return;
      zoomRaycastPending = true;
      raycastVisible(clientX, clientY)
        .then((result) => {
          if (disposed) return;
          zoomHitCache = result
            ? { point: result.point.clone(), clientX, clientY }
            : null;
        })
        .catch(() => {
          zoomHitCache = null;
        })
        .finally(() => {
          zoomRaycastPending = false;
        });
    };

    // Custom zoom, intercepting mouse-wheel events before OrbitControls'
    // own built-in wheel-zoom ever sees them (same window+capture-phase
    // trick as onCtrlWheel above, needed since both would otherwise be
    // listening on the very same element). OrbitControls' own dolly
    // always scales by a percentage of the distance to controls.target,
    // never to whatever's actually under the cursor — for a large model
    // where target sits far from the pointed-at detail, that makes zoom
    // feel wildly too coarse or too fine. This uses the distance to the
    // real point under the cursor as the basis instead (via zoomHitCache,
    // refreshed below from the async exact-geometry raycast), falling
    // back to the nearestModelHit/getGroupSphere bounding-sphere estimate
    // only until the first real hit resolves, or when the cursor is over
    // empty space. The sphere estimate alone was not enough: a sphere's
    // surface sits far beyond a wide-but-thin model's (e.g. a building's)
    // real extent along its short axis, so looking close to straight down
    // or up made the estimated distance wildly too large — the camera
    // would blow straight through the roof in one tick, or (once inside
    // the oversized sphere) re-inflate to the far exit point right when
    // trying to slow down and approach precisely. Touch pinch-zoom is
    // untouched — it's a completely separate code path in OrbitControls
    // that never dispatches 'wheel' events, so enableZoom/zoomToCursor
    // are left on for it.
    const onZoomWheel = (event) => {
      if (event.target !== renderer.domElement && !renderer.domElement.contains(event.target)) {
        return;
      }
      if (event.shiftKey && !event.ctrlKey) {
        if (tryShiftScrollClipPlane(event)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        // Shift held but the cursor isn't over any clip-plane gizmo —
        // fall through to normal zoom below.
      }
      if (middleButtonHeld || (event.buttons & 4)) {
        // Middle mouse button currently held — tracked explicitly via
        // mousedown/mouseup above (event.buttons is kept as a harmless
        // secondary signal for browsers where it happens to work) — try
        // moving a plane before falling through to zoom. A stationary
        // middle-button hold doesn't trigger OrbitControls' own
        // middle-drag pan (that only engages on pointer movement), so
        // this doesn't conflict with it.
        if (tryMiddleScrollClipPlane(event)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
      event.preventDefault();
      event.stopPropagation();
      // One notch = 100 px of wheel input, whatever the device reports:
      // pixels (mouse, trackpad scroll), lines (Firefox) or pages. A
      // trackpad pinch arrives as ctrl+wheel with much smaller deltas, so
      // it is scaled up to feel the same.
      const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 400 : 1;
      const px = event.deltaY * unit * (event.ctrlKey ? 4 : 1);
      const notches = Math.max(-ZOOM.maxNotchesPerEvent, Math.min(ZOOM.maxNotchesPerEvent, -px / 100));
      if (notches === 0) return;
      const ndc = getNdc(event);
      raycaster.setFromCamera(ndc, camera);
      const cacheValid =
        zoomHitCache &&
        Math.hypot(zoomHitCache.clientX - event.clientX, zoomHitCache.clientY - event.clientY) <=
          CACHE_PIXEL_TOLERANCE;
      let cursorPoint = null;
      if (cacheValid) {
        cursorPoint = zoomHitCache.point;
      } else if (!(zoom.active && zoom.point)) {
        const dir = raycaster.ray.direction;
        const hit = nearestModelHit(raycaster.ray.origin, dir);
        const sphere = getGroupSphere();
        cursorPoint = hit
          ? hit.point
          : sphere
            ? raySphereProject(ndc, sphere.center, sphere.radius)
            : controls.target;
      }
      zoomAlongRay(raycaster.ray, cursorPoint, notches);
      refreshZoomHitCache(event.clientX, event.clientY);
    };
    window.addEventListener("wheel", onZoomWheel, { capture: true, passive: false });

    // Keep zoomHitCache warm from mere hovering, not just from wheel
    // ticks — otherwise the very first tick of every zoom gesture always
    // falls back to the coarse sphere estimate, since nothing has
    // populated the cache for wherever the cursor just landed yet. This
    // way, by the time the user actually starts scrolling, a real hit is
    // usually already resolved and waiting.
    const onZoomHoverMove = (event) => {
      if (!renderer.domElement.contains(event.target)) return;
      lastPointerClientRef.current = { x: event.clientX, y: event.clientY };
      refreshZoomHitCache(event.clientX, event.clientY);
    };
    renderer.domElement.addEventListener("pointermove", onZoomHoverMove);

    // Live preview of the second measurement point: once point A has
    // been placed and the tool is waiting on point B, keep a preview
    // line/legs/labels tracking the cursor's raycast hit so the user can
    // see the in-progress length/height before clicking. Suppressed
    // while an actual rotate-drag gesture is in progress (pivotPending/
    // rotating), matching the fact that a drag never places a point
    // today (see onRotateEnd's CLICK_MOVE_THRESHOLD check below).
    const onMeasureHoverMove = (event) => {
      if (!measureModeActiveRef.current || measurePendingPoint === null) return;
      if (pivotPending || rotating) return;
      if (!renderer.domElement.contains(event.target)) return;
      measurePreviewPendingClient = { clientX: event.clientX, clientY: event.clientY };
    };
    renderer.domElement.addEventListener("pointermove", onMeasureHoverMove);

    // Hover-based dimension tags: only the cheap cursor position is
    // stashed here on every pointermove — the actual (async, worker-
    // backed) raycast is kicked off at most once per rendered frame from
    // inside animate() below (see dimHoverRaycastBusy there), the same
    // "cap raycast rate to frame rate, not mousemove rate" pattern the
    // measure-marker drag uses. Suppressed during an active rotate/pivot
    // drag and while Measure mode's own hover preview is doing the same
    // job in the same screen space.
    let dimHoverPendingClient = null; // { clientX, clientY } | null
    let dimHoverRaycastBusy = false;
    let dimHoverGeneration = 0;
    let currentHoveredDimensionKey = null; // `${modelId}::${localId}` | null
    const onDimensionHoverMove = (event) => {
      if (!tagToolActiveRef.current) return;
      if (pivotPending || rotating) return;
      if (measureModeActiveRef.current) return;
      if (draggingMeasurePoint) return;
      if (!renderer.domElement.contains(event.target)) return;
      dimHoverPendingClient = { clientX: event.clientX, clientY: event.clientY };
    };
    renderer.domElement.addEventListener("pointermove", onDimensionHoverMove);

    // Mouse only: the element under the cursor is named next to it, and the
    // cursor reflects the active tool. Same one-raycast-per-frame cap as the
    // hover tag above; the label is a plain DOM node written directly.
    let nameHoverPending = null; // { clientX, clientY } | null
    let nameHoverBusy = false;
    let nameHoverGeneration = 0;
    let nameHoverKey = null;
    let nameHoverFetchKey = null; // element whose name is being fetched
    let nameHoverText = null; // { name, category } for nameHoverKey
    let nameHoverPos = { x: 0, y: 0 };
    let lastCursor = "";
    const applyCursor = (overElement) => {
      const tool = measureModeActiveRef.current || tagToolActiveRef.current;
      const cursor = tool ? "crosshair" : categoryHideModeActiveRef.current ? "not-allowed" : overElement ? "pointer" : "";
      if (cursor !== lastCursor) {
        lastCursor = cursor;
        renderer.domElement.style.cursor = cursor;
      }
    };
    const placeHoverLabel = () => {
      const node = hoverLabelRef.current;
      if (!node) return;
      const show = nameHoverKey && nameHoverText;
      node.hidden = !show;
      if (!show) return;
      const w = node.offsetWidth || 160;
      const x = Math.min(nameHoverPos.x + 14, window.innerWidth - w - 8);
      const y = nameHoverPos.y + 18 > window.innerHeight - 40 ? nameHoverPos.y - 36 : nameHoverPos.y + 18;
      node.style.transform = `translate(${Math.max(8, x)}px, ${y}px)`;
    };
    const showHoverText = (text) => {
      const node = hoverLabelRef.current;
      if (!node) return;
      node.replaceChildren();
      const strong = document.createElement("strong");
      strong.textContent = text.name;
      node.append(strong);
      if (text.category) {
        const small = document.createElement("span");
        small.textContent = text.category;
        node.append(small);
      }
    };
    const clearNameHover = () => {
      nameHoverPending = null;
      nameHoverGeneration++;
      nameHoverKey = null;
      nameHoverFetchKey = null;
      nameHoverText = null;
      placeHoverLabel();
      applyCursor(false);
    };
    const onNameHoverMove = (event) => {
      if (event.pointerType !== "mouse") return;
      if (event.buttons !== 0 || pivotPending || rotating || draggingMeasurePoint) {
        clearNameHover();
        return;
      }
      applyCursor(!!nameHoverKey);
      nameHoverPos = { x: event.clientX, y: event.clientY };
      // The label follows the cursor while it stays on the same element.
      if (nameHoverKey && nameHoverText) placeHoverLabel();
      if (measureModeActiveRef.current || tagToolActiveRef.current) return;
      nameHoverPending = { clientX: event.clientX, clientY: event.clientY };
    };
    const handleNameHoverResult = async (hit) => {
      const key = hit ? `${hit.fragments.modelId}::${hit.localId}` : null;
      if (key === nameHoverKey) return;
      if (!key) {
        nameHoverKey = null;
        nameHoverFetchKey = null;
        nameHoverText = null;
        placeHoverLabel();
        applyCursor(false);
        return;
      }
      if (nameHoverFetchKey === key) return;
      nameHoverFetchKey = key;
      const [data] = await hit.fragments.getItemsData([hit.localId], { attributesDefault: true });
      if (nameHoverFetchKey !== key) return;
      const category = data?._category?.value ?? "";
      const name = data?.Name?.value || category || "Element";
      nameHoverKey = key;
      nameHoverText = { name, category: name === category ? "" : category };
      showHoverText(nameHoverText);
      placeHoverLabel();
      applyCursor(true);
    };
    renderer.domElement.addEventListener("pointermove", onNameHoverMove);
    renderer.domElement.addEventListener("pointerleave", clearNameHover);
    renderer.domElement.addEventListener("pointerdown", clearNameHover);
    renderer.domElement.addEventListener("wheel", clearNameHover, { passive: true });

    const applyRotation = (ndc) => {
      const theta = startTheta - Math.PI * ROTATE_GAIN * gainX * (ndc.x - startNdcX);
      // + on the elevation term: ndc.y grows upward, and dragging up
      // should tip the model's top away from you (equivalently, raise
      // the virtual camera), matching OrbitControls' vertical direction.
      const phi = Math.max(
        EPS,
        Math.min(Math.PI - EPS, startPhi + Math.PI * ROTATE_GAIN * gainY * (ndc.y - startNdcY)),
      );

      const modelQuat = cameraQuatStart
        .clone()
        .multiply(virtualQuaternion(theta, phi).invert());

      // World-space rotation applied since the gesture began, used to
      // swing the group's origin around the pivot so the pivot point
      // itself stays put.
      const deltaQ = modelQuat.clone().multiply(groupQuatStart.clone().invert());

      modelsGroup.quaternion.copy(modelQuat);
      const posOffset = groupPosStart.clone().sub(rotatePivot).applyQuaternion(deltaQ);
      modelsGroup.position.copy(rotatePivot).add(posOffset);
    };

    // (Re)base the gesture on the model's current pose and a new pivot.
    // Because everything is measured relative to this snapshot, doing
    // this mid-drag swaps the pivot with zero visible jump: at the
    // instant of the call the accumulated rotation is exactly identity.
    const anchorGesture = (ndc, pivot) => {
      rotatePivot.copy(pivot);
      // Same turn per pixel along both axes: NDC spans the width and the
      // height, so scale each by its size relative to the smaller side.
      const rect = renderer.domElement.getBoundingClientRect();
      const small = Math.max(1, Math.min(rect.width, rect.height));
      gainX = rect.width / small;
      gainY = rect.height / small;
      startNdcX = ndc.x;
      startNdcY = ndc.y;
      cameraQuatStart.copy(camera.quaternion);
      groupQuatStart.copy(modelsGroup.quaternion);
      groupPosStart.copy(modelsGroup.position);

      // Recover the gesture's starting orbit angles by inverting the
      // invariant: virtualQuat = modelQuat⁻¹ · camQuat. Reading them
      // back from the live pose (rather than carrying them in a
      // long-lived variable) keeps things correct even after a pan or
      // zoom has moved the camera since the last rotate.
      const virtualStart = modelsGroup.quaternion
        .clone()
        .invert()
        .multiply(camera.quaternion);
      const spherical = new THREE.Spherical().setFromVector3(
        new THREE.Vector3(0, 0, 1).applyQuaternion(virtualStart),
      );
      startTheta = spherical.theta;
      startPhi = spherical.phi;

      pivotMarker.position.copy(rotatePivot);
      pivotMarker.visible = true;
      requestRender();
    };

    // A left-click (mousedown+mouseup with barely any movement) selects
    // the element under the cursor and shows its IFC properties; a real
    // drag past this threshold is a rotate gesture instead. Reuses the
    // exact same raycast already dispatched for the rotation pivot below
    // (same screen position) rather than firing a second one.
    const CLICK_MOVE_THRESHOLD = 5;
    const PIVOT_RING_PX = 14; // touch: how far from the press point to look for a surface when it hits nothing
    let downClientX = 0;
    let downClientY = 0;
    let pivotRaycastPromise = null;

    // IfcElementQuantity (e.g. "BaseQuantities") is a *different* relation
    // target than IfcPropertySet, even though both attach to an element
    // via the same IsDefinedBy relation: it carries a `Quantities` array
    // instead of `HasProperties`, and each quantity's numeric value lives
    // under whichever IFC attribute matches its specific subtype
    // (IfcQuantityLength -> LengthValue, IfcQuantityArea -> AreaValue,
    // etc. — there's no single common field name).
    const QUANTITY_VALUE_KEYS = [
      "LengthValue",
      "AreaValue",
      "VolumeValue",
      "WeightValue",
      "CountValue",
      "TimeValue",
    ];
    const getQuantityValue = (quantity) => {
      for (const key of QUANTITY_VALUE_KEYS) {
        if (quantity[key] !== undefined) return quantity[key].value ?? null;
      }
      return null;
    };

    // A per-item material tint via FragmentsModel.highlight() proved
    // unreliable in practice: a rigorous same-element before/after
    // comparison against a production build showed the material was
    // registered (confirmed via getHighlight()) but never visibly
    // rendered, regardless of color, opacity, blend mode, forcing a
    // core update, waiting for onViewUpdated, continuous rendering for a
    // full second, or forcing full (non-LOD) geometry — the change
    // simply never reached the screen. A bounding-box outline was a
    // working stopgap, but doesn't match the element's actual shape.
    // getItemsGeometry does: it's a read-only RPC that recomputes an
    // item's geometry fresh from the immutable source data on every
    // call and returns copied-out position/index/normal arrays — never
    // offsets into a live, mutable tile buffer the way the previously-
    // tried getItemDrawChunks approach did, which could be raced by the
    // library's own background tile rebuilding (LOD/visibility-driven
    // regeneration) and end up rendering another same-type element's
    // triangles instead of the clicked one's.
    const HIGHLIGHT_FILL_MATERIAL_PROPS = {
      // A warm amber (the accent's family) reads on light walls, red roofs and blue glass alike;
      // the dark edge below keeps the shape crisp on any colour.
      color: new THREE.Color(0xe08a2c),
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      // depthTest stays on so the highlight is correctly hidden behind
      // any other element actually in front of the selected one (rather
      // than always painting on top of everything). The overlay
      // coincides exactly with the base geometry's own depth (same
      // vertices), so a small polygon offset pulls it slightly toward
      // the camera to avoid z-fighting against that same surface.
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    };
    let highlightOverlays = []; // THREE.Mesh[]
    // Guards only against overlapping showHighlightFill calls from rapid
    // re-selection (selectElementFrom doesn't await the previous call
    // before starting a new one) — the overlay's geometry is always a
    // fresh, independently-owned copy now, so there's no shared-buffer
    // race to guard against.
    let highlightGeneration = 0;
    const clearHighlight = () => {
      highlightGeneration++;
      if (highlightOverlays.length === 0) return;
      for (const overlay of highlightOverlays) {
        overlay.parent?.remove(overlay);
        overlay.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
      }
      highlightOverlays = [];
      requestRender();
    };
    clearHighlightRef.current = clearHighlight;
    const showHighlightFill = async (hit) => {
      const myGeneration = ++highlightGeneration;
      const groups = await hit.fragments.getItemsGeometry([hit.localId]);
      if (myGeneration !== highlightGeneration) return; // superseded while awaiting
      // An item can have more than one representation/geometry chunk;
      // flatten to render all of them.
      const chunks = groups.flat();
      const overlays = [];
      for (const chunk of chunks) {
        if (!chunk.positions || !chunk.indices) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(chunk.positions, 3));
        if (chunk.normals) {
          geometry.setAttribute("normal", new THREE.BufferAttribute(chunk.normals, 3, true));
        }
        geometry.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
        // These are fresh, independently-owned arrays (not shared with
        // any live tile mesh), so normal lazy bounding-volume computation
        // is safe here.
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();
        const overlay = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial(HIGHLIGHT_FILL_MATERIAL_PROPS));
        overlay.renderOrder = 999;
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry, 30),
          new THREE.LineBasicMaterial({ color: 0x6c4720, transparent: true, opacity: 0.9 }),
        );
        edges.renderOrder = 999;
        overlay.add(edges);
        // chunk.transform crosses a worker postMessage, so it arrives as
        // a plain { elements } object rather than a live THREE.Matrix4
        // (matches the library's own reconstruction of this same RPC's
        // result elsewhere).
        overlay.matrix.fromArray(chunk.transform.elements);
        overlay.matrixAutoUpdate = false;
        overlay.frustumCulled = false;
        // Tile meshes are always children of the model's own object, so
        // this is the correct parent for identical placement/rotation.
        hit.fragments.object.add(overlay);
        overlays.push(overlay);
      }
      highlightOverlays = overlays;
      requestRender();
    };

    const formatElementData = (data, modelName) => {
      const definitions = Array.isArray(data.IsDefinedBy) ? data.IsDefinedBy : [];
      const propertySets = definitions
        .map((def) => {
          if (Array.isArray(def.HasProperties)) {
            return {
              name: def.Name?.value ?? "Property set",
              properties: def.HasProperties.map((prop) => ({
                name: prop.Name?.value ?? "",
                value: prop.NominalValue?.value ?? prop.Value?.value ?? null,
              })),
            };
          }
          if (Array.isArray(def.Quantities)) {
            return {
              name: def.Name?.value ?? "Quantities",
              properties: def.Quantities.map((quantity) => ({
                name: quantity.Name?.value ?? "",
                value: getQuantityValue(quantity),
              })),
            };
          }
          return null;
        })
        .filter(Boolean);

      // IFC4 gives an element its own IsTypedBy relation for this; IFC2x3
      // (what this app mostly sees in practice) instead folds the type
      // into the same IsDefinedBy array as the psets/qsets above — it's
      // the one entry with neither HasProperties nor Quantities, since
      // IfcRelDefinesByType and IfcRelDefinesByProperties share the same
      // abstract IfcRelDefines supertype and thus the same inverse
      // attribute on the element.
      const types = Array.isArray(data.IsTypedBy) ? data.IsTypedBy : [];
      const typeDef =
        types[0] ??
        definitions.find(
          (def) => !Array.isArray(def.HasProperties) && !Array.isArray(def.Quantities) && def.Name?.value,
        );
      const typeName = typeDef?.Name?.value ?? null;

      return {
        category: data._category?.value ?? "Unknown",
        name: data.Name?.value ?? null,
        guid: data._guid?.value ?? null,
        objectType: data.ObjectType?.value ?? null,
        tag: data.Tag?.value ?? null,
        typeName,
        modelName: modelName ?? null,
        propertySets,
      };
    };

    // Lazily opens (and caches, per model) an independent raw web-ifc
    // model from the original bytes retained in modelsRef — OpenModel
    // re-parses the whole SPF file, which is nontrivial for a large
    // model, so this must not reopen one per click. Closed in
    // removeModel and in this effect's own cleanup below.
    const getOrOpenRawIfcHandle = async (modelId) => {
      const cached = rawIfcHandlesRef.current.get(modelId);
      if (cached) return cached;
      const entry = modelsRef.current.get(modelId);
      if (!entry?.sourceBytes) return null;
      const handle = await openRawIfcModel(entry.sourceBytes);
      rawIfcHandlesRef.current.set(modelId, handle);
      return handle;
    };

    // Called (from animate() below) whenever the per-frame hover raycast
    // resolves — `hit` is null when the cursor isn't over any geometry.
    // Guarded at each await against the hovered element having already
    // changed again in the meantime (the same staleness pattern
    // selectElementFrom uses), so a slow extraction for an element the
    // user has since moved off never clobbers whatever's hovered by then.
    const handleDimensionHoverResult = async (hit) => {
      const newKey = hit ? `${hit.fragments.modelId}::${hit.localId}` : null;
      if (newKey === currentHoveredDimensionKey) {
        // Still hovering the same element — keep the tag anchored under
        // the cursor's current point on its surface rather than frozen at
        // wherever hover first landed (which could be far from where the
        // cursor now is, on a long run). Skipped once pinned: a placed
        // pin must stay exactly where it was pinned.
        if (newKey && hit) {
          const entry = dimensionTags.get(newKey);
          if (entry && !entry.pinned) {
            modelsGroup.updateMatrixWorld(true);
            entry.localPosition = modelsGroup.worldToLocal(hit.point.clone());
            if (entry.sprite) entry.sprite.position.copy(entry.localPosition);
            requestRender();
          }
        }
        return;
      }
      const previousKey = currentHoveredDimensionKey;
      currentHoveredDimensionKey = newKey;
      if (previousKey) setHoveredFlag(previousKey, false);
      if (!newKey) return;

      const [data] = await hit.fragments.getItemsData([hit.localId], { attributesDefault: true });
      if (currentHoveredDimensionKey !== newKey) return;
      const category = data?._category?.value ?? null;
      const guid = data?._guid?.value ?? null;
      if (!guid) {
        currentHoveredDimensionKey = null;
        return;
      }

      let dimData = dimensionExtractionCacheRef.current.get(guid);
      if (dimData === undefined) {
        const handle = await getOrOpenRawIfcHandle(hit.fragments.modelId);
        dimData = handle ? extractDimensionTagData(handle.api, handle.modelID, category, guid) : null;
        dimensionExtractionCacheRef.current.set(guid, dimData);
      }
      if (currentHoveredDimensionKey !== newKey) return;

      modelsGroup.updateMatrixWorld(true);
      const localPosition = modelsGroup.worldToLocal(hit.point.clone());
      getOrCreateDimensionTagEntry(newKey, {
        guid,
        category,
        name: data?.Name?.value ?? null,
        localId: hit.localId,
        modelId: hit.fragments.modelId,
        localPosition,
        dimData,
      });
      setHoveredFlag(newKey, true);
    };

    // Turning the Tag tool off stops new hover raycasts from being
    // scheduled (see onDimensionHoverMove's guard above), which means a
    // tag left showing from a hover in progress at that exact moment
    // would otherwise never get a further pointermove to notice the
    // tool went off and clear it — force that here instead.
    clearHoveredDimensionTagRef.current = () => {
      if (!currentHoveredDimensionKey) return;
      const key = currentHoveredDimensionKey;
      currentHoveredDimensionKey = null;
      setHoveredFlag(key, false);
    };

    const clearDimensionTagsForModel = (modelId) => {
      for (const [key, entry] of [...dimensionTags]) {
        if (entry.modelId === modelId) destroyDimensionTagEntry(key);
      }
    };
    clearDimensionTagsForModelRef.current = clearDimensionTagsForModel;

    unpinDimensionTagRef.current = (guid) => {
      for (const [key, entry] of dimensionTags) {
        if (entry.guid === guid && entry.pinned) {
          setPinnedFlag(key, false);
          pushUndo({
            undo: () => setPinnedFlag(key, true),
            redo: () => setPinnedFlag(key, false),
          });
          break;
        }
      }
    };

    clearAllDimensionPinsRef.current = () => {
      for (const [key, entry] of [...dimensionTags]) {
        if (entry.pinned) setPinnedFlag(key, false);
      }
    };

    refreshAllDimensionTagsVisibilityRef.current = () => {
      for (const key of dimensionTags.keys()) refreshDimensionTagEntry(key);
      requestRender();
    };

    refreshMeasurementsVisibilityRef.current = () => {
      for (const entry of measurementsRuntime) applyMeasurementEntryVisibility(entry);
      if (measurePendingMarker) measurePendingMarker.visible = tagsVisibleRef.current;
      if (measurePreviewEntry) {
        const visible = tagsVisibleRef.current;
        measurePreviewEntry.markerB.visible = visible;
        measurePreviewEntry.line.visible = visible;
        measurePreviewEntry.legRight.visible = visible;
        measurePreviewEntry.legUp.visible = visible;
        measurePreviewEntry.legDepth.visible = visible;
        measurePreviewEntry.label.visible = visible;
        measurePreviewEntry.legRightLabel.visible = visible;
        measurePreviewEntry.legUpLabel.visible = visible;
        measurePreviewEntry.legDepthLabel.visible = visible;
      }
      requestRender();
    };

    const selectElementFrom = async (raycastPromise) => {
      pressRings.hidePin();
      if (!raycastPromise) {
        clearHighlight();
        selectedHitRef.current = null;
        setSelectedElement(null);
        return;
      }
      setSelectedElementLoading(true);
      try {
        const hit = await raycastPromise;
        if (!hit) {
          clearHighlight();
          selectedHitRef.current = null;
          setSelectedElement(null);
          return;
        }
        clearHighlight();
        modelsGroup.updateMatrixWorld(true);
        selectionTouchedRef.current = true;
        selectionAnchorRef.current = modelsGroup.worldToLocal(hit.point.clone());
        showHighlightFill(hit).catch((err) => console.error("Highlight fill failed", err));
        selectedHitRef.current = { modelId: hit.fragments.modelId, localId: hit.localId };
        const [data] = await hit.fragments.getItemsData([hit.localId], {
          attributesDefault: true,
          relations: {
            IsDefinedBy: { attributes: true, relations: true },
            IsTypedBy: { attributes: true, relations: false },
            HasAssociations: { attributes: true, relations: false },
            ContainedInStructure: { attributes: true, relations: false },
          },
        });
        const modelName = modelNamesRef.current.get(hit.fragments.modelId);
        const formatted = data ? formatElementData(data, modelName) : null;
        if (formatted) {
          formatted.details = buildElementDetails(data, readProjectUnits(modelsRef.current.get(hit.fragments.modelId)?.sourceBytes));
        }
        setSelectedElement(formatted);

        // Non-blocking follow-up: geometry/system/material data getItemsData
        // can't reach at all (see rawIfcQuery.js) — the base panel above
        // already rendered at normal speed, this just fills in extra
        // fields once ready, guarded against the user having since
        // selected something else.
        if (formatted && formatted.guid && isEligibleCategoryName(formatted.category)) {
          const targetGuid = formatted.guid;
          getOrOpenRawIfcHandle(hit.fragments.modelId)
            .then((handle) =>
              handle ? extractElementIfcData(handle.api, handle.modelID, formatted.category, targetGuid) : null,
            )
            .then((ifcInfo) => {
              setSelectedElement((prev) => (prev?.guid === targetGuid ? { ...prev, ifcInfo: ifcInfo ?? null } : prev));
            })
            .catch((err) => {
              setSelectedElement((prev) => (prev?.guid === targetGuid ? { ...prev, ifcInfo: null } : prev));
              // A chunk of Argus that did not download (a dropped connection, a
              // deploy): say so, keep everything open. Never a reload here.
              if (classifyFailure(err, "build") === KIND.APP_ASSET_FAILED) {
                console.warn("Element details could not be loaded: part of Argus did not download", err);
                showToastRef.current?.("Pipe and duct details could not be loaded: part of Argus did not download. Your models stay open. Reloading Argus later brings these details back.", 7000);
              } else {
                console.error("Failed to extract IFC geometry/system/material data", err);
              }
            });
        }

        // Non-blocking follow-up: overall bounding box, for every
        // element regardless of category (unlike ifcInfo above, this
        // isn't limited to the handful of MEP-ish categories — a wall or
        // a proxy has a bounding box just as much as a pipe does).
        // getBoxes already returns world-space boxes (transformed by the
        // model's own matrixWorld), so its size is meaningful regardless
        // of modelsGroup's current rotation. Height is the vertical (Y)
        // extent; length/width are the two horizontal extents sorted
        // largest-first, since there's no reliable way to know which
        // horizontal axis an arbitrary element's own "front" is.
        if (formatted && formatted.guid) {
          const targetGuid = formatted.guid;
          hit.fragments
            .getBoxes([hit.localId])
            .then(([box]) => {
              if (!box) return;
              const size = box.getSize(new THREE.Vector3());
              const [length, width] = [size.x, size.z].sort((a, b) => b - a);
              const boundingBox = { height: size.y * 1000, length: length * 1000, width: width * 1000 };
              setSelectedElement((prev) => (prev?.guid === targetGuid ? { ...prev, boundingBox } : prev));
            })
            .catch((err) => {
              console.error("Failed to compute bounding box", err);
              setSelectedElement((prev) => (prev?.guid === targetGuid ? { ...prev, boundingBox: null } : prev));
            });
        }
      } catch (err) {
        console.error("Failed to fetch element properties", err);
        setSelectedElement(null);
      } finally {
        setSelectedElementLoading(false);
      }
    };

    selectElementFromRef.current = selectElementFrom;

    const handleMeasureClick = async (raycastPromise) => {
      if (!raycastPromise) {
        exitActiveTool();
        return;
      }
      const hit = await raycastPromise;
      if (!hit) {
        exitActiveTool();
        return;
      }
      modelsGroup.updateMatrixWorld(true);
      const localPoint = modelsGroup.worldToLocal(hit.point.clone());
      const localNormal = hit.normal ? localDirectionFromWorld(hit.normal) : null;
      const outcome = measureManager.addPoint(localPoint, localNormal);
      if (outcome === "completed") {
        setMeasurements(measureManager.list());
      } else if (outcome === "rejected") {
        showToastRef.current("Pick a second point away from the first");
      }
    };

    // Only pins the element whose hover dimension tag is currently
    // showing (per the spec: pinning is a Tag-tool click on an element
    // that already has a hover tag, not a general "click anything"
    // action) — clicking anything else while the tool is active is a
    // no-op, matching how Measure mode already tolerates clicks that
    // don't hit usable geometry.
    const handleTagToolClick = async (raycastPromise) => {
      if (!raycastPromise) {
        exitActiveTool();
        return;
      }
      const hit = await raycastPromise;
      if (!hit) {
        exitActiveTool();
        return;
      }
      const key = `${hit.fragments.modelId}::${hit.localId}`;
      // A mouse has already hovered the element (and so built its tag)
      // before the click; a finger tap has not — there is no hover on a
      // touch screen — so build the tag for the tapped element now.
      if (key !== currentHoveredDimensionKey) await handleDimensionHoverResult(hit);
      if (key !== currentHoveredDimensionKey) return;
      const entry = dimensionTags.get(key);
      // Mirrors refreshDimensionTagEntry's own "anything to show?" check
      // — the tag tool works on any element, not just pipes/ducts, so a
      // family-name-only tag (no dimension geometry) must still be
      // pinnable, not just one with a resolvable dimension line.
      const hasDimText = !!formatDimensionTag(entry?.category, entry?.dimData);
      const hasFamilyName = !!(entry && resolveTagDisplayName(entry));
      if (!entry || (!hasDimText && !hasFamilyName)) return;
      if (entry.pinned) return; // already pinned — avoid a duplicate no-op undo entry
      setPinnedFlag(key, true);
      pushUndo({
        undo: () => setPinnedFlag(key, false),
        redo: () => setPinnedFlag(key, true),
      });
    };

    // Hide-category tool: a click just needs to identify which category
    // the clicked element belongs to — setCategoryHidden (declared
    // outside this effect, a stable [] useCallback like pushUndo above)
    // does the actual visibility work and hiddenCategoriesRef bookkeeping.
    // Toggling means a second click on a still-visible instance of an
    // already-hidden category re-shows it; the sidebar's hidden-category
    // list is the only way back once every instance is hidden, since a
    // hidden element can no longer be raycast-clicked at all.
    const handleCategoryHideClick = async (raycastPromise) => {
      if (!raycastPromise) {
        exitActiveTool();
        return;
      }
      const hit = await raycastPromise;
      if (!hit) {
        exitActiveTool();
        return;
      }
      const [data] = await hit.fragments.getItemsData([hit.localId], { attributesDefault: true });
      const category = data?._category?.value;
      if (!category) return;
      const alreadyHidden = hiddenCategoriesRef.current.has(category.toUpperCase());
      await setCategoryHidden(category, !alreadyHidden);
    };

    let activePointerId = null;
    let lastClick = null; // { t, x, y } of the previous plain click, for double-click zoom
    let gestureSeq = 0;
    // True from mousedown until the pivot raycast below resolves (or the
    // gesture ends first) — see onRotateStart for why the gesture waits
    // on this rather than starting from an approximate point.
    let pivotPending = false;

    const onRotateMove = (event) => {
      if ((!rotating && !pivotPending) || event.pointerId !== activePointerId) return;
      pendingNdc = getNdc(event);
    };
    const onRotateEnd = (event) => {
      if (event.pointerId !== activePointerId) return;
      rotating = false;
      pivotPending = false;
      activePointerId = null;
      pendingNdc = null;
      pivotMarker.visible = false;
      requestRender();
      window.removeEventListener("pointermove", onRotateMove);
      window.removeEventListener("pointerup", onRotateEnd);
      window.removeEventListener("pointercancel", onRotateEnd);

      // A "pointercancel" (the browser aborting the gesture mid-drag —
      // an OS/system gesture taking over, a right-click context menu
      // interrupting a left-button drag on some platforms, a touch/pen
      // interaction losing capture — see the `window` "blur" fallback
      // for `middleButtonHeld` above for the same class of "no normal
      // end event ever fires" hazard) only needs the state reset above;
      // treating it as a completed click here would risk selecting an
      // element or placing a measurement point the user never intended.
      if (event.type !== "pointercancel" && typeof event.clientX === "number" && typeof event.clientY === "number") {
        const moved = Math.hypot(event.clientX - downClientX, event.clientY - downClientY);
        if (moved < CLICK_MOVE_THRESHOLD) {
          if (measureModeActiveRef.current) {
            handleMeasureClick(pivotRaycastPromise);
          } else if (tagToolActiveRef.current) {
            handleTagToolClick(pivotRaycastPromise);
          } else if (categoryHideModeActiveRef.current) {
            handleCategoryHideClick(pivotRaycastPromise);
          } else {
            selectElementFrom(pivotRaycastPromise);
            // A second click/tap in the same spot zooms to that element.
            const now = performance.now();
            if (lastClick && now - lastClick.t < 350 && Math.hypot(event.clientX - lastClick.x, event.clientY - lastClick.y) < 24) {
              lastClick = null;
              const promise = pivotRaycastPromise;
              promise?.then((hit) => hit && zoomToHitRef.current(hit));
            } else {
              lastClick = { t: now, x: event.clientX, y: event.clientY };
            }
          }
        }
      }
    };
    // Shift+drag on a clip plane's visible gizmo moves it along its own
    // normal — the standard "cursor projected onto a line" technique
    // single-axis translate handles use: build a plane that CONTAINS the
    // drag axis and faces the camera as much as possible, intersect the
    // cursor ray with THAT (well-defined) plane, then project the result
    // back onto the axis line. Intersecting the 1-D axis line with the
    // ray directly has no well-defined solution in general (skew lines),
    // which is why this indirection is needed.
    const projectRayOntoAxis = (ray, axisPoint, axisDir) => {
      const toOrigin = ray.origin.clone().sub(axisPoint);
      const alongAxis = axisDir.clone().multiplyScalar(toOrigin.dot(axisDir));
      const perp = toOrigin.sub(alongAxis);
      if (perp.lengthSq() < 1e-10) return null; // camera sits exactly on the axis — degenerate
      const auxPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(perp.normalize(), axisPoint);
      const hitPoint = new THREE.Vector3();
      if (!ray.intersectPlane(auxPlane, hitPoint)) return null;
      return axisDir.dot(hitPoint.sub(axisPoint));
    };

    // Dragging an existing measurement's endpoint marker: unlike the
    // clip-plane gizmo's axis-projection math below, this re-raycasts the
    // actual model surface (via the async, worker-backed raycastVisible)
    // so the corrected point stays snapped to real geometry, the same way
    // the point was originally placed. A plain drag (no modifier key) is
    // fine here — markers are small, precise targets, not a large disc
    // that needs shift as an accident-guard.
    let draggingMeasurePoint = null; // { entryId, which: 'A' | 'B' } | null
    let measureDragGeneration = 0; // invalidates a stale in-flight raycast
    let measureDragPendingClient = null; // { clientX, clientY } | null
    let measureDragRaycastBusy = false; // single-flight guard
    let measureDragStartClient = null; // {clientX, clientY} at pointerdown, to tell a click from a drag
    // Becomes true only once the cursor has actually moved past
    // CLICK_MOVE_THRESHOLD since pointerdown — the animate() consumption
    // block below only applies a raycast result once this is true, so a
    // plain click on a marker (down and up with no real movement) never
    // relocates it. Without this, the down-position's own async raycast
    // (queued immediately in tryStartMeasureMarkerDrag, resolved a frame
    // or two later regardless of whether the gesture turns out to be a
    // click) would unconditionally overwrite the marker's position with
    // a tight, exact-geometry hit-test — a different tolerance than the
    // generous 5px sphere used just to select the marker, so a click a
    // pixel or two off-center (routine at a wall/column corner, where
    // dimension endpoints usually sit) could snap the point to an
    // unrelated, distant surface.
    let measureDragMoved = false;

    const applyMeasureMarkerDrag = (hit) => {
      const entry = measurementsRuntime.find((m) => m.id === draggingMeasurePoint.entryId);
      if (!entry) return; // measurement was deleted mid-drag
      modelsGroup.updateMatrixWorld(true);
      const marker = draggingMeasurePoint.which === "A" ? entry.markerA : entry.markerB;
      marker.position.copy(modelsGroup.worldToLocal(hit.point.clone()));
      // Only dragging B re-anchors which surface the measurement is
      // relative to — B is "the surface being measured to" by
      // convention (see createMeasurementEntry above), so dragging A
      // around must keep decomposing against B's original surface.
      if (draggingMeasurePoint.which === "B" && hit.normal) {
        entry.referenceNormal = localDirectionFromWorld(hit.normal);
      }
      recomputeMeasurementEntry(entry);
      setMeasurements(measureManager.list());
    };
    const onMeasureMarkerDragMove = (event) => {
      if (!draggingMeasurePoint) return;
      if (!measureDragMoved && measureDragStartClient) {
        const moved = Math.hypot(
          event.clientX - measureDragStartClient.clientX,
          event.clientY - measureDragStartClient.clientY,
        );
        if (moved >= CLICK_MOVE_THRESHOLD) measureDragMoved = true;
      }
      measureDragPendingClient = { clientX: event.clientX, clientY: event.clientY };
    };
    const onMeasureMarkerDragEnd = (event) => {
      // A "pointercancel" (browser aborting the gesture mid-drag — see
      // onRotateEnd's own comment on this) never counts as a click, only
      // as a reason to drop the drag state below.
      const wasClick =
        event.type !== "pointercancel" &&
        measureDragStartClient &&
        Math.hypot(
          event.clientX - measureDragStartClient.clientX,
          event.clientY - measureDragStartClient.clientY,
        ) < CLICK_MOVE_THRESHOLD;
      const clicked = wasClick ? draggingMeasurePoint : null;
      draggingMeasurePoint = null;
      measureDragStartClient = null;
      measureDragPendingClient = null;
      measureDragMoved = false;
      measureDragGeneration++; // discard any raycast still in flight from this drag
      window.removeEventListener("pointermove", onMeasureMarkerDragMove);
      window.removeEventListener("pointerup", onMeasureMarkerDragEnd);
      window.removeEventListener("pointercancel", onMeasureMarkerDragEnd);
      if (clicked) showMeasureDeletePopupRef.current(clicked.entryId, clicked.which);
      requestRender();
    };
    // Returns true if a drag was started (caller should not also start a
    // rotate gesture, or the measure tool's click-to-place, for this
    // same pointerdown).
    const tryStartMeasureMarkerDrag = (event, fuzzy = false) => {
      if (event.button !== 0 || measurementsRuntime.length === 0) return false;
      const owner = new Map();
      const hittable = [];
      for (const entry of measurementsRuntime) {
        hittable.push(entry.markerA);
        owner.set(entry.markerA, { entry, which: "A" });
        hittable.push(entry.markerB);
        owner.set(entry.markerB, { entry, which: "B" });
      }
      const ndc = getNdc(event);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(hittable, false);
      let hit = hits.length > 0 ? owner.get(hits[0].object) : null;
      // A fingertip is far wider than the marker dot: on touch also accept
      // the nearest marker within a thumb-sized radius on screen.
      if (!hit && fuzzy && event.pointerType === "touch") {
        let best = null;
        for (const marker of hittable) {
          if (!marker.visible) continue;
          const wp = marker.getWorldPosition(new THREE.Vector3());
          const c = worldToClient(wp);
          const dist = Math.hypot(c.x - event.clientX, c.y - event.clientY);
          if (dist <= 24 && (!best || dist < best.dist)) best = { dist, marker };
        }
        if (best) hit = owner.get(best.marker);
      }
      if (!hit) return false;

      event.preventDefault();
      event.stopPropagation();
      setMeasureDeletePopup(null); // don't leave a stale popup from a previous click open
      setMeasureLegEditPopup(null); // the two popups are mutually exclusive
      draggingMeasurePoint = { entryId: hit.entry.id, which: hit.which };
      measureDragGeneration++;
      measureDragStartClient = { clientX: event.clientX, clientY: event.clientY };
      measureDragPendingClient = { clientX: event.clientX, clientY: event.clientY };
      measureDragRaycastBusy = false;
      measureDragMoved = false;
      window.addEventListener("pointermove", onMeasureMarkerDragMove);
      window.addEventListener("pointerup", onMeasureMarkerDragEnd);
      window.addEventListener("pointercancel", onMeasureMarkerDragEnd);
      return true;
    };
    // Offset up-and-right from the marker's own screen position (not
    // centered on top of it) so the marker stays reachable underneath
    // for dragging to a new position, with a small, deliberate gap
    // between the two.
    const MEASURE_DELETE_POPUP_OFFSET = 18;
    const measureDeletePopupPosition = (marker) => {
      const client = worldToClient(marker.getWorldPosition(new THREE.Vector3()));
      return { x: client.x + MEASURE_DELETE_POPUP_OFFSET, y: client.y - MEASURE_DELETE_POPUP_OFFSET };
    };
    showMeasureDeletePopupRef.current = (entryId, which) => {
      const entry = measurementsRuntime.find((m) => m.id === entryId);
      if (!entry) return;
      const marker = which === "A" ? entry.markerA : entry.markerB;
      const { x, y } = measureDeletePopupPosition(marker);
      setMeasureDeletePopup({ entryId, which, x, y });
    };

    const MEASURE_LEG_LABEL_MAP = {
      depth: "legDepthLabel",
      horizontal: "legRightLabel",
      vertical: "legUpLabel",
    };
    const measureLegLabelPosition = (label) => worldToClient(label.getWorldPosition(new THREE.Vector3()));
    // Editing a leg's length is a click on that leg's own floating 3D
    // label — no drag semantics needed (unlike a marker, the label
    // doesn't move), so this is a plain hit-test-and-open rather than a
    // start/move/end trio. Only pinned/visible measurements are
    // clickable — nothing to click when the visibility toggle has
    // hidden them (see tagsVisibleRef, wired in by the visibility-
    // toggle work below).
    const tryClickMeasureLegLabel = (event) => {
      if (!tagsVisibleRef.current) return false;
      if (event.button !== 0 || measurementsRuntime.length === 0) return false;
      const owner = new Map();
      const hittable = [];
      for (const entry of measurementsRuntime) {
        for (const [which, key] of Object.entries(MEASURE_LEG_LABEL_MAP)) {
          hittable.push(entry[key]);
          owner.set(entry[key], { entry, which });
        }
      }
      // Screen-space hit test: a leg label is only 22-30 px tall, so on touch
      // its target is padded out to at least 44 x 44 px around its centre.
      const canvasRect = renderer.domElement.getBoundingClientRect();
      const px = event.clientX - canvasRect.left;
      const py = event.clientY - canvasRect.top;
      const minSide = TOUCH_UI || event.pointerType === "touch" ? 44 : 0;
      let hit = null;
      let bestDist = Infinity;
      for (const label of hittable) {
        if (!label.visible) continue;
        const p = label.getWorldPosition(new THREE.Vector3()).project(camera);
        if (p.z > 1) continue;
        const cx = (p.x * 0.5 + 0.5) * canvasRect.width;
        const cy0 = (-p.y * 0.5 + 0.5) * canvasRect.height;
        const hPx = MEASURE_LEG_LABEL_SMALL_PIXEL_HEIGHT;
        const wPx = hPx * label.userData.aspect;
        // The sprite hangs below (center.y > 0.5) or above its anchor point.
        const cy = cy0 + (label.center.y - 0.5) * hPx;
        const halfW = Math.max(wPx, minSide) / 2;
        const halfH = Math.max(hPx, minSide) / 2;
        if (Math.abs(px - cx) <= halfW && Math.abs(py - cy) <= halfH) {
          const d = Math.hypot(px - cx, py - cy);
          if (d < bestDist) {
            bestDist = d;
            hit = owner.get(label);
          }
        }
      }
      if (!hit) return false;

      event.preventDefault();
      event.stopPropagation();
      setMeasureDeletePopup(null); // the two popups are mutually exclusive
      const { x, y } = measureLegLabelPosition(hit.entry[MEASURE_LEG_LABEL_MAP[hit.which]]);
      setMeasureLegEditPopup({ entryId: hit.entry.id, which: hit.which, x, y });
      return true;
    };
    // Same hit-test as tryStartMeasureMarkerDrag's own raycast (markers
    // are draggable regardless of whether Measure mode is currently
    // toggled on), just on hover rather than pointerdown — flips the
    // cursor to the standard "clickable" pointer so a draggable endpoint
    // (or, now, an editable leg label) reads as such before the user
    // commits to clicking it.
    const onMeasureMarkerHoverCursor = (event) => {
      if (draggingMeasurePoint || measurementsRuntime.length === 0 || !tagsVisibleRef.current) {
        if (!draggingMeasurePoint) renderer.domElement.style.cursor = lastCursor;
        return;
      }
      const hittable = [];
      for (const entry of measurementsRuntime) {
        hittable.push(entry.markerA, entry.markerB, entry.legDepthLabel, entry.legRightLabel, entry.legUpLabel);
      }
      raycaster.setFromCamera(getNdc(event), camera);
      const hits = raycaster.intersectObjects(hittable, false);
      renderer.domElement.style.cursor = hits.length > 0 ? "pointer" : lastCursor;
    };
    renderer.domElement.addEventListener("pointermove", onMeasureMarkerHoverCursor);

    let draggingClipPlaneId = null;
    let dragAxisWorld = null; // THREE.Vector3 | null — world-space plane normal at drag start
    let dragAxisPointWorld = null; // THREE.Vector3 | null — a world-space point on that axis line
    let dragStartLocalConstant = 0;
    // The cursor's own axis-projection at the moment of grab — generally
    // nonzero, since the click can land anywhere on the visible gizmo
    // quad, not necessarily exactly on dragAxisPointWorld. Subtracting
    // this baseline out of every subsequent move's delta is what makes
    // the plane move *relative to where it was grabbed* instead of
    // snapping to the cursor's absolute projected position on the very
    // first move.
    let dragStartDelta = 0;

    const onClipPlaneDragMove = (event) => {
      const entry = clipPlanesRuntime.find((p) => p.id === draggingClipPlaneId);
      if (!entry) return;
      const ndc = getNdc(event);
      raycaster.setFromCamera(ndc, camera);
      const delta = projectRayOntoAxis(raycaster.ray, dragAxisPointWorld, dragAxisWorld);
      if (delta === null) return;
      // Moving the anchor point by `delta` along the world-space normal
      // is the same delta along the *local* normal too — the model's
      // rotation changes the normal's direction but not the relationship
      // between the plane and its own reference point, so this identity
      // holds regardless of modelsGroup's current orientation.
      entry.localPlane.constant = dragStartLocalConstant - (delta - dragStartDelta);
      syncGizmoMesh(entry);
      requestRender();
    };
    const onClipPlaneDragEnd = () => {
      if (draggingClipPlaneId) notifyClipPlanes();
      draggingClipPlaneId = null;
      dragAxisWorld = null;
      dragAxisPointWorld = null;
      window.removeEventListener("pointermove", onClipPlaneDragMove);
      window.removeEventListener("pointerup", onClipPlaneDragEnd);
      window.removeEventListener("pointercancel", onClipPlaneDragEnd);
    };
    // Returns true if a drag was started (caller should not also start a
    // rotate gesture for this same pointerdown).
    const tryStartClipPlaneDrag = (event) => {
      // Shift+drag with a mouse; a plain one-finger drag on touch, which has no Shift key.
      if ((!event.shiftKey && event.pointerType !== "touch") || event.button !== 0) return false;
      // A finger over the section plane is ambiguous (orbit or slide?), so
      // on touch the plane only moves while "Move section" is switched on.
      if (event.pointerType === "touch" && !clipMoveModeRef.current) return false;
      const hittable = clipPlanesRuntime.filter((p) => p.gizmoVisible).map((p) => p.mesh);
      if (hittable.length === 0) return false;
      const ndc = getNdc(event);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(hittable, false);
      if (hits.length === 0) return false;
      let entry = clipPlanesRuntime.find((p) => p.mesh === hits[0].object);
      if (!entry) return false;
      // A finger moves the ACTIVE plane, whichever sheet it landed on; a
      // mouse moves the sheet under the cursor and makes it the active one.
      if (event.pointerType === "touch") entry = clipPlanesRuntime.find((p) => p.id === activeClipId) ?? entry;
      else clipPlaneManager.setActive(entry.id);

      event.preventDefault();
      event.stopPropagation();

      modelsGroup.updateMatrix();
      modelsGroup.matrixWorld.copy(modelsGroup.matrix);
      const worldNormal = entry.localPlane.normal
        .clone()
        .applyQuaternion(modelsGroup.quaternion)
        .normalize();
      const pointOnPlaneLocal = entry.localPlane.normal
        .clone()
        .multiplyScalar(-entry.localPlane.constant);
      const pointOnPlaneWorld = modelsGroup.localToWorld(pointOnPlaneLocal);
      // raycaster.ray is already the exact grab-time ray (set from the
      // same ndc just used for the gizmo hit-test above), so this is the
      // cursor's own starting axis-projection — see dragStartDelta.
      const startDelta = projectRayOntoAxis(raycaster.ray, pointOnPlaneWorld, worldNormal) ?? 0;

      draggingClipPlaneId = entry.id;
      dragAxisWorld = worldNormal;
      dragAxisPointWorld = pointOnPlaneWorld;
      dragStartLocalConstant = entry.localPlane.constant;
      dragStartDelta = startDelta;

      window.addEventListener("pointermove", onClipPlaneDragMove);
      window.addEventListener("pointerup", onClipPlaneDragEnd);
      window.addEventListener("pointercancel", onClipPlaneDragEnd);
      return true;
    };

    const CLIP_PLANE_SCROLL_SENSITIVITY = 0.00025; // fraction of camera-to-plane distance moved per deltaY unit
    const CLIP_PLANE_SCROLL_MAX_STEP = 0.005; // cap: max fraction of camera-to-plane distance per single wheel event
    // Shared by both scroll-to-move gestures below: raycasts `hittable`
    // (a caller-chosen subset of clip-plane meshes) and, on a hit, nudges
    // that plane along its own normal by a capped, gentle amount.
    const moveClipPlaneUnderCursor = (event, hittable) => {
      if (hittable.length === 0) return false;
      raycaster.setFromCamera(getNdc(event), camera);
      const hits = raycaster.intersectObjects(hittable, false);
      if (hits.length === 0) return false;
      const entry = clipPlanesRuntime.find((p) => p.mesh === hits[0].object);
      if (!entry) return false;

      // A synchronous, correct world-space point on the plane — mirrors
      // tryStartClipPlaneDrag's own derivation above rather than
      // entry.mesh.getWorldPosition(), whose matrixWorld is only
      // guaranteed fresh as of the last renderer.render() call, not at
      // arbitrary wheel-handler time.
      modelsGroup.updateMatrix();
      modelsGroup.matrixWorld.copy(modelsGroup.matrix);
      const pointOnPlaneLocal = entry.localPlane.normal.clone().multiplyScalar(-entry.localPlane.constant);
      const pointOnPlaneWorld = modelsGroup.localToWorld(pointOnPlaneLocal);
      const distance = camera.position.distanceTo(pointOnPlaneWorld);
      // Clamp the per-event step to a small fraction of the current
      // camera-to-plane distance — not the whole model's bounding-sphere
      // radius — so movement stays gentle and proportional to how
      // zoomed-in the current view is, regardless of how geometrically
      // large/spread-out the loaded model is. An outsized deltaY spike
      // (trackpad flings can report deltaY in the thousands) still can't
      // move the plane far in one tick.
      const rawStep = -event.deltaY * CLIP_PLANE_SCROLL_SENSITIVITY * distance;
      const maxStep = distance * CLIP_PLANE_SCROLL_MAX_STEP;
      const step = Math.max(-maxStep, Math.min(maxStep, rawStep));

      entry.localPlane.constant += step;
      syncGizmoMesh(entry);
      requestRender();
      return true;
    };
    // Shift+scroll moves whichever clip plane's gizmo is currently under
    // the cursor along its own normal — same disambiguation as the
    // shift+drag gesture above (hit-test the gizmo actually being
    // pointed at), since with multiple planes there's no single
    // unambiguous "the" plane a keyboard-modified scroll could target
    // otherwise (see the removed ctrl+scroll comment near onCtrlWheel).
    // Works regardless of handle visibility, matching middle+scroll
    // below — entry.mesh stays raycastable even with the handle turned
    // off (only material.visible is toggled, see setGizmoVisible above),
    // so there's no reason to require a visible handle just to scroll.
    const tryShiftScrollClipPlane = (event) =>
      moveClipPlaneUnderCursor(event, clipPlanesRuntime.map((p) => p.mesh));
    // Middle-mouse+scroll works even with the handle turned off —
    // intentionally does NOT filter by gizmoVisible, since the whole
    // point is to move a plane you can't see a handle for (unlike
    // shift+scroll above, which requires a visible handle).
    const tryMiddleScrollClipPlane = (event) =>
      moveClipPlaneUnderCursor(event, clipPlanesRuntime.map((p) => p.mesh));

    // A tap (no travel) on a sheet makes that plane the active one. Listens
    // beside the other gestures and never swallows the event.
    let sheetTap = null;
    const onSheetTapDown = (event) => {
      sheetTap = clipPlanesRuntime.length > 1 && event.isPrimary && event.button === 0
        ? { id: event.pointerId, x: event.clientX, y: event.clientY, t: performance.now() }
        : null;
    };
    const onSheetTapUp = (event) => {
      const tap = sheetTap;
      sheetTap = null;
      if (!tap || tap.id !== event.pointerId) return;
      if (performance.now() - tap.t > 500 || Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 8) return;
      raycaster.setFromCamera(getNdc(event), camera);
      const hit = raycaster.intersectObjects(clipPlanesRuntime.filter((p) => p.gizmoVisible).map((p) => p.mesh), false)[0];
      const entry = hit && clipPlanesRuntime.find((p) => p.mesh === hit.object);
      if (entry) clipPlaneManager.setActive(entry.id);
    };
    renderer.domElement.addEventListener("pointerdown", onSheetTapDown, true);
    window.addEventListener("pointerup", onSheetTapUp, true);

    const onRotateStart = (event) => {
      if (tryStartMeasureMarkerDrag(event)) return;
      if (tryClickMeasureLegLabel(event)) return;
      if (tryStartMeasureMarkerDrag(event, true)) return;
      if (tryStartClipPlaneDrag(event)) return;
      // A second touch point landing mid-drag means the gesture just
      // became a pinch/two-finger pan — hand off to OrbitControls' own
      // touch handling instead of continuing to spin the model with the
      // first finger's movement.
      if (event.pointerType === "touch" && !event.isPrimary) {
        if (rotating || pivotPending) onRotateEnd({ pointerId: activePointerId });
        return;
      }
      if (event.button !== 0) return; // only the rotate (left) button / primary touch
      if (modelsGroup.children.length === 0) return;

      const sphere = getGroupSphere();
      if (!sphere) return;
      event.preventDefault();

      downClientX = event.clientX;
      downClientY = event.clientY;
      pivotRaycastPromise = null;

      rotateRadius = Math.max(sphere.radius, 0.001);

      const startNdc = getNdc(event);
      const gestureId = ++gestureSeq;

      // The real, per-triangle hit test (the fragments library's
      // worker-backed raycast) can't run synchronously, but it typically
      // resolves in only a few milliseconds — far below what a person
      // can perceive. Rather than starting the gesture immediately from
      // an approximate point (a bounding-sphere projection, which
      // usually lands off the actual model surface — visibly "floating"
      // in empty space — and would otherwise need a later correction
      // that reads as the rotation jumping to a different point), the
      // gesture waits for this one real result before it begins at all.
      // pendingNdc is kept live by onRotateMove during this brief wait
      // (see its pivotPending check), so the gesture still starts from
      // wherever the cursor actually is by the time the raycast lands,
      // not from the stale mousedown position.
      activePointerId = event.pointerId;
      pendingNdc = startNdc;
      pivotPending = true;
      window.addEventListener("pointermove", onRotateMove);
      window.addEventListener("pointerup", onRotateEnd);
      window.addEventListener("pointercancel", onRotateEnd);

      const pipeline = pipelineRef.current;
      // Also reused by onRotateEnd for element selection if this turns
      // out to be a click rather than a drag — same screen position, no
      // need to raycast twice. raycastVisible skips anything hidden
      // behind an active clip plane, so rotating/selecting after a cut
      // pivots on what's actually on screen.
      pivotRaycastPromise = pipeline ? raycastVisible(event.clientX, event.clientY) : Promise.resolve(null);
      // Thin walls, window frames and edges are easy to miss with a fat
      // finger: when the exact press point misses, a touch pivots on the
      // first hit on a small ring around it instead of on the model centre.
      const pivotHitPromise = pivotRaycastPromise.then(async (hit) => {
        if (hit || !pipeline || event.pointerType !== "touch") return hit;
        // One at a time: the fragments raycast answers null to a call made
        // while another is still in flight.
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          const ringHit = await raycastVisible(event.clientX + Math.cos(a) * PIVOT_RING_PX, event.clientY + Math.sin(a) * PIVOT_RING_PX);
          if (ringHit) return ringHit;
        }
        return null;
      });
      pivotHitPromise
        .then((hit) => {
          // The gesture already ended (a fast click-and-release faster
          // than the raycast) or was superseded by a newer one — nothing
          // left to anchor.
          if (!pivotPending || gestureId !== gestureSeq) return;
          pivotPending = false;
          // Anchor at the press position; the pointer travel buffered in
          // pendingNdc while the raycast ran is applied around the right
          // pivot on the next frame instead of being dropped.
          const ndc = startNdc;
          // hit.point is already expressed in modelsGroup's *current*
          // frame (the fragments library converts its local-space hit
          // to world space using matrixWorld as of when the raycast
          // resolves), which is exactly the frame anchorGesture needs.
          // A miss (click landed on empty space, or the pipeline wasn't
          // ready) falls back to the closest model actually under the
          // cursor, or as a last resort the whole-group bounding sphere.
          // Mouse and touch pivot on the grabbed surface point. A drag that
          // starts on empty space (no hit) orbits the model's centre, so it
          // can never swing the model off screen.
          const pivotPoint = hit ? hit.point : sphere.center.clone();
          anchorGesture(ndc, pivotPoint);
          rotating = true;
        })
        .catch((err) => console.error("Pivot raycast failed", err));
    };
    renderer.domElement.addEventListener("pointerdown", onRotateStart);
    // Any direct camera interaction ends automatic re-framing and any
    // in-flight ease, so the camera never fights the user's hands.
    const onUserCamera = () => {
      autoFramedRef.current = false;
      fitByFocusRef.current = false;
      if (cameraAnimRef.current) {
        cancelAnimationFrame(cameraAnimRef.current);
        cameraAnimRef.current = 0;
      }
    };
    renderer.domElement.addEventListener("pointerdown", onUserCamera);
    renderer.domElement.addEventListener("pointerdown", cancelZoom);
    renderer.domElement.addEventListener("wheel", onUserCamera, { passive: true });

    // Touch has no right-click: a still finger held on the canvas opens
    // the same context menu (create clip plane / hide element). The
    // pending rotate gesture is cancelled so lifting the finger doesn't
    // also select whatever is underneath.
    const LONG_PRESS_SLOP_PX = 10;
    let longPress = null; // { id, x, y, timer } | null
    const cancelLongPress = () => {
      if (!longPress) return;
      clearTimeout(longPress.timer);
      longPress = null;
      pressRings.stopCharge();
      requestRender();
    };
    const onLongPressDown = (event) => {
      cancelLongPress();
      if (event.pointerType !== "touch" || !event.isPrimary) return;
      if (modelsGroup.children.length === 0) return;
      const pressed = { id: event.pointerId, x: event.clientX, y: event.clientY, timer: 0 };
      pressRings.startCharge(pressed.x, pressed.y);
      requestRender();
      pressed.timer = setTimeout(() => {
        longPress = null;
        pressRings.stopCharge();
        longPressFiredAt = Date.now();
        if (activePointerId !== null) onRotateEnd({ pointerId: activePointerId, type: "pointercancel" });
        openContextMenuAt(pressed.x, pressed.y, true);
      }, LONG_PRESS_MS);
      longPress = pressed;
    };
    const onLongPressMove = (event) => {
      if (!longPress || event.pointerId !== longPress.id) return;
      if (Math.hypot(event.clientX - longPress.x, event.clientY - longPress.y) > LONG_PRESS_SLOP_PX) cancelLongPress();
    };
    renderer.domElement.addEventListener("pointerdown", onLongPressDown);
    renderer.domElement.addEventListener("pointermove", onLongPressMove);
    window.addEventListener("pointerup", cancelLongPress);
    // Turning the phone mid-press must not leave a menu behind, opened for a
    // spot that has moved.
    const dropPressAndMenu = () => {
      cancelLongPress();
      setContextMenu(null);
    };
    window.addEventListener("pointercancel", dropPressAndMenu);
    window.addEventListener("resize", dropPressAndMenu);
    window.addEventListener("orientationchange", dropPressAndMenu);
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5);
    directionalLight.position.set(20, 30, 15);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    fillLight.position.set(-20, 10, -15);
    scene.add(ambientLight, directionalLight, fillLight);

    // Compass: projects a "north" direction, fixed in the model's own
    // local frame (recalibrated only by northOffsetRef, never by rotating
    // anything), onto the WORLD's horizontal plane — a fixed pair of
    // world-space axes, not the camera's. The model can be freely tumbled
    // in any direction (see applyRotation's full theta/phi arcball above),
    // so projecting north onto the camera's own screen-plane basis instead
    // degenerates (and visibly jumps) whenever a tumble happens to swing
    // the north vector toward/away from the camera — a direction that
    // depends entirely on incidental camera framing. Dotting against
    // fixed world axes instead means the only singularity is north
    // pointing straight up/down in the real world (dot with both
    // horizontal axes -> 0), a rare, meaningful edge case rather than an
    // arbitrary one, and the reading never depends on the camera's
    // orientation at all. Re-derived from scratch every frame — the dot
    // products are cheap — rather than only on rotation, since a change
    // to northOffsetRef alone (no 3D change at all) still needs to move
    // the needle.
    const compassBaseLocal = new THREE.Vector3(0, 0, -1);
    const compassUpAxis = new THREE.Vector3(0, 1, 0);
    const compassNorthLocal = new THREE.Vector3();
    const compassNorthWorld = new THREE.Vector3();
    const compassWorldRight = new THREE.Vector3(1, 0, 0);
    const compassWorldForward = new THREE.Vector3(0, 0, -1);
    let lastCompassAngle = null;
    // atan2 below only ever returns a value in (-180, 180], so reading it
    // straight into the CSS transform makes the needle spin the long way
    // around every time the true angle crosses the +180/-180 seam (e.g.
    // 179deg -> 181deg reads back as 179deg -> -179deg, a 358deg jump in
    // the raw number even though the physical rotation was only 2deg).
    // Unwrapping accumulates the actual frame-to-frame delta (itself
    // always wrapped into (-180, 180], since real rotation between two
    // consecutive frames is never that fast) onto a continuous running
    // total instead, so the reported angle can exceed +-180 and CSS
    // transitions animate the short way every time.
    let compassUnwrappedAngle = null;
    let lastRawCompassAngle = null;

    let frameId;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      if (rotating && pendingNdc) {
        applyRotation(pendingNdc);
        requestRender();
      }
      // Re-raycasting the model surface is async (worker-backed), unlike
      // rotation's synchronous math above, so only the cheap cursor
      // position is stashed on each pointermove (onMeasureMarkerDragMove);
      // the actual raycast is kicked off here, once per frame, gated by a
      // single-flight guard so overlapping/out-of-order results can't
      // corrupt the drag — always using whichever position is latest once
      // the previous raycast clears. Also gated on measureDragMoved: a
      // plain click's own down-position raycast would otherwise still
      // fire and relocate the marker before pointerup is even processed
      // (see measureDragMoved's own comment above).
      if (draggingMeasurePoint && measureDragMoved && measureDragPendingClient && !measureDragRaycastBusy) {
        const { clientX, clientY } = measureDragPendingClient;
        measureDragPendingClient = null;
        measureDragRaycastBusy = true;
        const myGeneration = measureDragGeneration;
        raycastVisible(clientX, clientY)
          .then((hit) => {
            measureDragRaycastBusy = false;
            if (myGeneration !== measureDragGeneration || !hit) return;
            applyMeasureMarkerDrag(hit);
          })
          .catch((err) => {
            measureDragRaycastBusy = false;
            console.error("Measure drag raycast failed", err);
          });
      }
      // Same one-raycast-per-rendered-frame cap as the drag block above,
      // for the hover dimension tag.
      if (dimHoverPendingClient && !dimHoverRaycastBusy) {
        const { clientX, clientY } = dimHoverPendingClient;
        dimHoverPendingClient = null;
        dimHoverRaycastBusy = true;
        const myGeneration = ++dimHoverGeneration;
        raycastVisible(clientX, clientY)
          .then((hit) => {
            dimHoverRaycastBusy = false;
            if (myGeneration !== dimHoverGeneration) return;
            return handleDimensionHoverResult(hit);
          })
          .catch((err) => {
            dimHoverRaycastBusy = false;
            console.error("Dimension hover raycast failed", err);
          });
      }
      if (nameHoverPending && !nameHoverBusy) {
        const { clientX, clientY } = nameHoverPending;
        nameHoverPending = null;
        nameHoverBusy = true;
        const myGeneration = ++nameHoverGeneration;
        raycastVisible(clientX, clientY)
          .then((hit) => {
            nameHoverBusy = false;
            if (myGeneration !== nameHoverGeneration) return;
            return handleNameHoverResult(hit);
          })
          .catch((err) => {
            nameHoverBusy = false;
            console.error("Name hover raycast failed", err);
          });
      }
      // Same one-raycast-per-rendered-frame cap as the two blocks above,
      // for the measure tool's own live "point B" preview — previously
      // raycast directly inside the pointermove handler behind a plain
      // busy flag, which silently dropped the mouse's final resting
      // position whenever it moved again before the in-flight raycast
      // resolved, freezing the live preview on a stale point.
      if (measurePreviewPendingClient && !measurePreviewRaycastBusy) {
        const { clientX, clientY } = measurePreviewPendingClient;
        measurePreviewPendingClient = null;
        measurePreviewRaycastBusy = true;
        const myGeneration = ++measurePreviewGeneration;
        raycastVisible(clientX, clientY)
          .then((hit) => {
            measurePreviewRaycastBusy = false;
            if (myGeneration !== measurePreviewGeneration || measurePendingPoint === null) return;
            if (!hit) {
              clearMeasurePreview();
              return;
            }
            modelsGroup.updateMatrixWorld(true);
            const b = modelsGroup.worldToLocal(hit.point.clone());
            const localNormal = hit.normal ? localDirectionFromWorld(hit.normal) : null;
            updateMeasurePreview(measurePendingPoint, b, localNormal);
          })
          .catch((err) => {
            measurePreviewRaycastBusy = false;
            console.error("Measure preview raycast failed", err);
          });
      }
      // The delete popup is an HTML overlay anchored to a 3D point, so
      // (unlike the 3D sprites) its screen position needs recomputing
      // every frame the camera could have moved, not just when the
      // marker itself moves.
      if (measureDeletePopupRef.current) {
        const { entryId, which } = measureDeletePopupRef.current;
        const entry = measurementsRuntime.find((m) => m.id === entryId);
        if (!entry) {
          setMeasureDeletePopup(null); // measurement was deleted from elsewhere (e.g. the sidebar)
        } else {
          const marker = which === "A" ? entry.markerA : entry.markerB;
          const { x, y } = measureDeletePopupPosition(marker);
          if (x !== measureDeletePopupRef.current.x || y !== measureDeletePopupRef.current.y) {
            setMeasureDeletePopup({ entryId, which, x, y });
          }
        }
      }
      // Same per-frame screen-position tracking as the delete popup
      // above, for the leg-length edit popup.
      if (measureLegEditPopupRef.current) {
        const { entryId, which } = measureLegEditPopupRef.current;
        const entry = measurementsRuntime.find((m) => m.id === entryId);
        if (!entry) {
          setMeasureLegEditPopup(null); // measurement was deleted from elsewhere
        } else {
          const { x, y } = measureLegLabelPosition(entry[MEASURE_LEG_LABEL_MAP[which]]);
          if (x !== measureLegEditPopupRef.current.x || y !== measureLegEditPopupRef.current.y) {
            setMeasureLegEditPopup({ entryId, which, x, y });
          }
        }
      }
      // Camera never actually moves via user input in this app (see
      // controls.enableRotate = false above) except through pan/dolly,
      // which translate camera+target together and never change its
      // orientation — but updateMatrixWorld() is cheap and keeps this
      // correct even if that ever changes.
      camera.updateMatrixWorld();
      compassNorthLocal.copy(compassBaseLocal).applyAxisAngle(compassUpAxis, (northOffsetRef.current * Math.PI) / 180);
      compassNorthWorld.copy(compassNorthLocal).applyQuaternion(modelsGroup.quaternion);
      const rawCompassAngle =
        (Math.atan2(compassNorthWorld.dot(compassWorldRight), compassNorthWorld.dot(compassWorldForward)) * 180) / Math.PI;
      if (lastRawCompassAngle === null) {
        compassUnwrappedAngle = rawCompassAngle;
      } else {
        const rawDelta = rawCompassAngle - lastRawCompassAngle;
        const wrappedDelta = ((rawDelta + 180) % 360 + 360) % 360 - 180;
        compassUnwrappedAngle += wrappedDelta;
      }
      lastRawCompassAngle = rawCompassAngle;
      const compassAngle = compassUnwrappedAngle;
      if (lastCompassAngle === null || Math.abs(compassAngle - lastCompassAngle) > 0.05) {
        lastCompassAngle = compassAngle;
        setCompassAngleDeg(compassAngle);
      }

      stepZoom(performance.now());
      controls.update();
      enforcePinchLimits();
      pipelineRef.current?.fragments.core.update();
      pumpAnchorVisibility();
      if (!needsRender) return;
      needsRender = false;
      scalePivotMarker();
      updatePressPin();
      scaleMeasureMarkers();
      layoutMeasureLabels();
      scaleDimensionTags();
      if (clipPlanesRuntime.length > 0) {
        // Each plane is authored in modelsGroup's local frame so it
        // rotates together with the model instead of staying fixed in
        // world space — which, since the *camera* never actually moves
        // during a rotate gesture, is what made it look like the plane
        // was stuck to the camera/view instead of the surface it was
        // created on. Re-derive every plane's world-space definition each
        // frame from the model's current pose (the gizmo meshes need no
        // such per-frame work — they're real children of modelsGroup and
        // inherit its rotation through the normal scene graph). Avoids
        // the full recursive updateMatrixWorld(true) (which would also
        // update every child mesh) since only modelsGroup's own matrix is
        // needed here, and its parent (the scene) never moves.
        modelsGroup.updateMatrix();
        modelsGroup.matrixWorld.copy(modelsGroup.matrix);
        for (const entry of clipPlanesRuntime) {
          const localPlane = entry.localPlane;
          const worldNormal = localPlane.normal
            .clone()
            .applyQuaternion(modelsGroup.quaternion)
            .normalize();
          const pointOnPlaneLocal = localPlane.normal
            .clone()
            .multiplyScalar(-localPlane.constant);
          const pointOnPlaneWorld = modelsGroup.localToWorld(pointOnPlaneLocal);
          entry.worldPlane.normal.copy(worldNormal);
          entry.worldPlane.constant = -worldNormal.dot(pointOnPlaneWorld);
        }
      }
      if (cameraClipEnabledRef.current) {
        // Always perpendicular to the view direction, at an adjustable
        // distance in front of the camera — a manual "peel" plane so
        // zooming in doesn't dip inside geometry (ugly backfaces/interior)
        // but instead shows a clean cross-section. Kept region is
        // whatever is *beyond* the plane along the view direction
        // (farther from the camera than cameraClipDistance); the near
        // side (between the camera and the plane) is discarded.
        const forward = camera.getWorldDirection(new THREE.Vector3());
        const planePoint = camera.position
          .clone()
          .addScaledVector(forward, cameraClipDistanceRef.current);
        cameraClipPlaneRef.current.setFromNormalAndCoplanarPoint(forward, planePoint);
      }
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      applyViewInsetRef.current();
      if (autoFramedRef.current || fitByFocusRef.current) refitModelRef.current(false);
      renderer.setSize(width, height);
      measureLineResolution.set(width, height);
      requestRender();
    });
    resizeObserver.observe(container);

    // Loaded lazily so the canvas/UI can paint first — this pulls in
    // @thatopen/components, the fragments worker, and the web-ifc wasm
    // setup, which would otherwise be part of the initial JS the browser
    // has to parse/execute before anything is on screen.
    import("../ifc/setupComponents")
      .then(({ takeIfcPipeline }) => takeIfcPipeline())
      .then((pipeline) => {
        if (disposed) return;
        pipelineRef.current = pipeline;
        performance.mark("viewer-ready");
        setReady(true);
      })
      .catch((err) => {
        console.error("Failed to initialize IFC pipeline", err);
        if (disposed) return;
        // A chunk that did not arrive cannot be fetched again by this page (a
        // failed import() is remembered until reload), so Argus reloads itself
        // once and carries on with what the user asked for (loop guard: once a minute).
        const first = pendingFilesRef.current?.[0];
        const intent = first ? (first.argusIntent ?? { type: "local", name: first.name }) : null;
        setLoadingLabel("Updating Argus…");
        reloadResuming(intent).then((reloading) => {
          if (reloading || disposed) return;
          pendingFilesRef.current = null;
          setIsLoading(false);
          setLoadingLabel("");
          setErrorInfo({ reload: true, intent, details: failureDetails({ kind: KIND.APP_ASSET_FAILED, stage: "boot", message: String(err?.message ?? err) }, { name: "viewer engine", buildId: runningBuildId(), userAgent: navigator.userAgent }) });
          setError("Argus could not start its viewer engine, even after reloading. Check your connection, then try once more.");
        });
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onSheetTapDown, true);
      window.removeEventListener("pointerup", onSheetTapUp, true);
      renderer.domElement.removeEventListener("pointerdown", onRotateStart);
      renderer.domElement.removeEventListener("pointerdown", onLongPressDown);
      renderer.domElement.removeEventListener("pointermove", onLongPressMove);
      window.removeEventListener("pointerup", cancelLongPress);
      window.removeEventListener("pointercancel", dropPressAndMenu);
      window.removeEventListener("resize", dropPressAndMenu);
      window.removeEventListener("orientationchange", dropPressAndMenu);
      pressRings.dispose();
      pressRingsRef.current = null;
      cancelLongPress();
      renderer.domElement.removeEventListener("pointermove", onMeasureMarkerHoverCursor);
      renderer.domElement.style.cursor = "";
      renderer.domElement.removeEventListener(
        "mousedown",
        suppressMiddleClickAutoscroll,
      );
      renderer.domElement.removeEventListener("pointerdown", blurStrayFocus);
      window.removeEventListener("mousedown", onMiddleButtonDown);
      window.removeEventListener("mouseup", onMiddleButtonUp);
      window.removeEventListener("blur", onMiddleButtonReset);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onMeasureKeyDown);
      window.removeEventListener("wheel", onZoomWheel, { capture: true });
      window.removeEventListener("pointerup", onTouchPointerUp);
      window.removeEventListener("pointercancel", onTouchPointerUp);
      renderer.domElement.removeEventListener("pointermove", onZoomHoverMove);
      renderer.domElement.removeEventListener("pointermove", onMeasureHoverMove);
      renderer.domElement.removeEventListener("pointermove", onDimensionHoverMove);
      renderer.domElement.removeEventListener("pointermove", onNameHoverMove);
      renderer.domElement.removeEventListener("pointerleave", clearNameHover);
      renderer.domElement.removeEventListener("pointerdown", clearNameHover);
      renderer.domElement.removeEventListener("wheel", clearNameHover);
      destroyAllDimensionTags();
      clearMeasurePreview();
      window.removeEventListener("wheel", onCtrlWheel, { capture: true });
      window.removeEventListener("pointermove", onRotateMove);
      window.removeEventListener("pointerup", onRotateEnd);
      window.removeEventListener("pointercancel", onRotateEnd);
      window.removeEventListener("pointermove", onClipPlaneDragMove);
      window.removeEventListener("pointerup", onClipPlaneDragEnd);
      window.removeEventListener("pointercancel", onClipPlaneDragEnd);
      window.removeEventListener("pointermove", onMeasureMarkerDragMove);
      window.removeEventListener("pointerup", onMeasureMarkerDragEnd);
      window.removeEventListener("pointercancel", onMeasureMarkerDragEnd);
      for (const entry of clipPlanesRuntime) {
        modelsGroup.remove(entry.mesh);
        entry.mesh.material.dispose();
        modelsGroup.remove(entry.outline);
        entry.outline.material.dispose();
      }
      gizmoGeometry.dispose();
      gizmoOutlineGeometry.dispose();
      controls.removeEventListener("change", requestRender);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      pipelineRef.current?.components.dispose();
      pipelineRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      rendererRef.current = null;
      modelsGroupRef.current = null;
      loadedModels.clear();
      for (const handle of rawIfcHandlesRef.current.values()) closeRawIfcModel(handle);
      rawIfcHandlesRef.current.clear();
    };
    // pushUndo and setCategoryHidden are both stable ([]) useCallbacks,
    // so including them here doesn't change this effect's run-once
    // behavior — it only satisfies exhaustive-deps for the addPoint-
    // internal pushUndo call and handleCategoryHideClick's
    // setCategoryHidden call above.
  }, [pushUndo, setCategoryHidden]);

  useEffect(() => {
    cameraClipEnabledRef.current = cameraClipEnabled;
    // Surface clip planes' enabled state is already applied immediately
    // (imperatively) by clipPlaneManager's own setEnabled/add/remove, but
    // toggling the *camera* clip plane needs to re-run that same
    // composition too, since it shares the same renderer.clippingPlanes
    // array with every surface plane.
    clipPlaneManagerRef.current?.refreshClippingPlanes();
  }, [cameraClipEnabled]);

  useEffect(() => {
    modelNamesRef.current = new Map(models.map((m) => [m.id, m.name]));
  }, [models]);

  useEffect(() => {
    modelColorsRef.current = new Map(models.map((m) => [m.id, m.color]));
  }, [models]);

  useEffect(() => {
    measureDeletePopupRef.current = measureDeletePopup;
  }, [measureDeletePopup]);

  useEffect(() => {
    measureLegEditPopupRef.current = measureLegEditPopup;
  }, [measureLegEditPopup]);

  const setCameraClipEnabled = useCallback((enabled) => {
    if (enabled) {
      // The kept region is whatever lies *beyond* cameraClipDistance along
      // the view direction. The slider runs from the camera (0, nothing
      // cut) to the far side of the scene, sized to the model so it does
      // something at any framing distance, and starts at 0.
      const box = getSceneBox(modelsRef.current.values());
      const camera = cameraRef.current;
      if (box && camera) {
        const centre = box.getCenter(new THREE.Vector3());
        const radius = box.getSize(new THREE.Vector3()).length() / 2;
        setCameraClipMax(Math.max(camera.position.distanceTo(centre) + radius, 1));
      }
      cameraClipDistanceRef.current = 0;
      setCameraClipDistanceState(0);
    }
    setCameraClipEnabledState(enabled);
  }, []);

  const setCameraClipDistance = useCallback((value) => {
    cameraClipDistanceRef.current = value;
    setCameraClipDistanceState(value);
    requestRenderRef.current();
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  // The ring marking the pressed point lives exactly as long as the menu.
  useEffect(() => {
    if (!contextMenu) pressRingsRef.current?.hidePin();
  }, [contextMenu]);
  const closeMeasureDeletePopup = useCallback(() => setMeasureDeletePopup(null), []);
  const closeMeasureLegEditPopup = useCallback(() => setMeasureLegEditPopup(null), []);

  // Shared by the right-click "Create clip plane here" menu item and the
  // "c" keyboard shortcut (which raycasts under the cursor itself rather
  // than a pre-captured context-menu pick, but ends up with the exact
  // same { point, normal } shape).
  const createClipPlaneAt = useCallback((hit) => {
    if (!hit || !hit.normal) return;

    const modelsGroup = modelsGroupRef.current;
    const manager = clipPlaneManagerRef.current;
    if (!modelsGroup || !manager) return;
    modelsGroup.updateMatrixWorld(true);

    // Store the plane in modelsGroup's local frame (see the render loop)
    // so it rotates together with the model instead of staying fixed in
    // world space. "Clip in front of the surface": keep the far/behind
    // side, discard the near side — a THREE.js clipping plane keeps the
    // half-space where normal·X + constant >= 0, so the kept region is
    // the side the surface's own (outward-facing) normal points *away*
    // from.
    const invQuat = modelsGroup.quaternion.clone().invert();
    const localNormal = hit.normal.clone().applyQuaternion(invQuat).negate();
    const localPoint = modelsGroup.worldToLocal(hit.point.clone());
    // Start the cut a hair inside the surface that was picked. A plane
    // lying exactly on that face z-fights with it (a speckled surface).
    const sphere = getSceneBox(modelsRef.current.values());
    const radius = sphere ? sphere.getSize(new THREE.Vector3()).length() / 2 : 1;
    localPoint.addScaledVector(localNormal, Math.max(radius * 0.004, 0.01));

    const idBox = { id: manager.add(localNormal, localPoint) };
    setClipPlanes(manager.list());
    pushUndo({
      undo: () => {
        manager.remove(idBox.id);
        setClipPlanes(manager.list());
      },
      redo: () => {
        idBox.id = manager.add(localNormal, localPoint);
        setClipPlanes(manager.list());
      },
    });
  }, [pushUndo]);

  const createClipPlaneHere = useCallback(async () => {
    const pending = pendingSurfacePickRef.current;
    setContextMenu(null);
    if (!pending) return;
    const hit = await pending.promise;
    createClipPlaneAt(hit);
  }, [createClipPlaneAt]);

  // "c" shortcut: same action as the context-menu item above, but
  // targeting whatever's under the cursor right now instead of a
  // pre-captured right-click pick.
  const createClipPlaneUnderCursor = useCallback(async () => {
    const { x, y } = lastPointerClientRef.current;
    const hit = await raycastVisibleRef.current(x, y);
    createClipPlaneAt(hit);
  }, [createClipPlaneAt]);

  const setActiveClipPlane = useCallback((id) => clipPlaneManagerRef.current?.setActive(id), []);

  const flipClipPlane = useCallback((id) => {
    clipPlaneManagerRef.current?.flip(id);
    // A flip is its own inverse — flipping twice restores the original
    // normal/constant — so undo and redo are literally the same action.
    pushUndo({
      undo: () => clipPlaneManagerRef.current?.flip(id),
      redo: () => clipPlaneManagerRef.current?.flip(id),
    });
  }, [pushUndo]);

  const removeClipPlane = useCallback((id) => {
    const manager = clipPlaneManagerRef.current;
    if (!manager) return;
    const snapshot = manager.getPlaneSnapshot(id);
    manager.remove(id);
    setClipPlanes(manager.list());
    if (!snapshot) return;
    const idBox = { id };
    pushUndo({
      undo: () => {
        idBox.id = manager.add(snapshot.normal, snapshot.point);
        manager.setEnabled(idBox.id, snapshot.enabled);
        manager.setGizmoVisible(idBox.id, snapshot.gizmoVisible);
        setClipPlanes(manager.list());
      },
      redo: () => {
        manager.remove(idBox.id);
        setClipPlanes(manager.list());
      },
    });
  }, [pushUndo]);

  // Measure, Tag, and Hide-category are mutually exclusive — turning one
  // on turns the others off, the same way a real toolbar's tool
  // selection works, rather than letting several fight over clicks/hover
  // at once.
  const toggleMeasureMode = useCallback(() => {
    const next = !measureModeActiveRef.current;
    measureModeActiveRef.current = next;
    setMeasureModeActiveState(next);
    if (!next) {
      measureManagerRef.current?.cancelPending();
    } else {
      if (tagToolActiveRef.current) {
        tagToolActiveRef.current = false;
        setTagToolActiveState(false);
        clearHoveredDimensionTagRef.current?.();
      }
      if (categoryHideModeActiveRef.current) {
        categoryHideModeActiveRef.current = false;
        setCategoryHideModeActiveState(false);
      }
    }
  }, []);

  const toggleTagTool = useCallback(() => {
    const next = !tagToolActiveRef.current;
    tagToolActiveRef.current = next;
    setTagToolActiveState(next);
    if (!next) {
      clearHoveredDimensionTagRef.current?.();
    } else {
      if (measureModeActiveRef.current) {
        measureModeActiveRef.current = false;
        setMeasureModeActiveState(false);
        measureManagerRef.current?.cancelPending();
      }
      if (categoryHideModeActiveRef.current) {
        categoryHideModeActiveRef.current = false;
        setCategoryHideModeActiveState(false);
      }
    }
  }, []);

  const toggleCategoryHideMode = useCallback(() => {
    const next = !categoryHideModeActiveRef.current;
    categoryHideModeActiveRef.current = next;
    setCategoryHideModeActiveState(next);
    if (next) {
      if (measureModeActiveRef.current) {
        measureModeActiveRef.current = false;
        setMeasureModeActiveState(false);
        measureManagerRef.current?.cancelPending();
      }
      if (tagToolActiveRef.current) {
        tagToolActiveRef.current = false;
        setTagToolActiveState(false);
        clearHoveredDimensionTagRef.current?.();
      }
    }
  }, []);

  const toggleTagsVisibility = useCallback(() => {
    const next = !tagsVisibleRef.current;
    tagsVisibleRef.current = next;
    setTagsVisibleState(next);
    refreshAllDimensionTagsVisibilityRef.current?.();
    refreshMeasurementsVisibilityRef.current?.();
    for (const [modelId, color] of modelColorsRef.current) {
      if (!color) continue;
      const entry = modelsRef.current.get(modelId);
      if (entry) applyModelColorOverride(entry.object, next ? color : null);
    }
    requestRenderRef.current();
  }, []);

  const unpinDimensionTag = useCallback((guid) => {
    unpinDimensionTagRef.current?.(guid);
  }, []);

  const clearAllDimensionPins = useCallback(() => {
    clearAllDimensionPinsRef.current?.();
  }, []);

  const removeMeasurement = useCallback((id) => {
    const manager = measureManagerRef.current;
    if (!manager) return;
    const snapshot = manager.getPointsSnapshot(id);
    manager.remove(id);
    setMeasurements(manager.list());
    if (!snapshot) return;
    const idBox = { id };
    pushUndo({
      undo: () => {
        const created = manager.createFromPoints(snapshot.a, snapshot.b, snapshot.normal);
        idBox.id = created.id;
        setMeasurements(manager.list());
      },
      redo: () => {
        manager.remove(idBox.id);
        setMeasurements(manager.list());
      },
    });
  }, [pushUndo]);

  // `which` is "depth" | "horizontal" | "vertical"; `valueMm` the new
  // length typed for that leg. Only point B moves — A and the other two
  // legs' current values stay exactly as they were.
  const setMeasurementLeg = useCallback((id, which, valueMm) => {
    const manager = measureManagerRef.current;
    if (!manager || !Number.isFinite(valueMm) || valueMm <= 0) return;
    const result = manager.setLeg(id, which, valueMm);
    if (!result) return;
    setMeasurements(manager.list());
    const { oldB, newB } = result;
    pushUndo({
      undo: () => {
        manager.setBPosition(id, oldB);
        setMeasurements(manager.list());
      },
      redo: () => {
        manager.setBPosition(id, newB);
        setMeasurements(manager.list());
      },
    });
  }, [pushUndo]);

  const setClipPlaneEnabled = useCallback((id, enabled) => {
    const manager = clipPlaneManagerRef.current;
    if (!manager) return;
    manager.setEnabled(id, enabled);
    setClipPlanes(manager.list());
  }, []);

  const setClipPlaneGizmoVisible = useCallback((id, visible) => {
    const manager = clipPlaneManagerRef.current;
    if (!manager) return;
    manager.setGizmoVisible(id, visible);
    setClipPlanes(manager.list());
  }, []);

  // Shared by the right-click "Hide element here" menu item and the "h"
  // keyboard shortcut. `hit.fragments` is the FragmentsModel instance
  // the element belongs to (a raycast result's field, confusingly
  // named), not the FragmentsManager.
  const hideHit = useCallback(async (hit) => {
    if (!hit || hit.localId == null || !hit.fragments) return;
    renderForAWhile(() => requestRenderRef.current());
    await hit.fragments.setVisible([hit.localId], false);
    // setVisible resolving only means the worker accepted the change, not
    // that the affected tiles have been rebuilt on the main thread yet —
    // forcing that to finish is a best effort (see renderForAWhile above
    // for the actual guarantee).
    await pipelineRef.current?.fragments.core.update(true);
    invalidateGroupSphereRef.current();
    // The hidden element may be the one currently selected/highlighted —
    // if so, clear the selection instead of leaving a highlight/panel
    // pointing at something no longer visible.
    const sel = selectedHitRef.current;
    if (sel && sel.modelId === hit.fragments.modelId && sel.localId === hit.localId) {
      clearHighlightRef.current?.();
      selectedHitRef.current = null;
      setSelectedElement(null);
    }
    requestRenderRef.current();
    const setHidden = async (hidden) => {
      renderForAWhile(() => requestRenderRef.current());
      await hit.fragments.setVisible([hit.localId], !hidden);
      await pipelineRef.current?.fragments.core.update(true);
      invalidateGroupSphereRef.current();
      requestRenderRef.current();
    };
    pushUndo({
      modelId: hit.fragments.modelId,
      undo: () => setHidden(false),
      redo: () => setHidden(true),
    });
  }, [pushUndo]);

  const hideElementHere = useCallback(async () => {
    const pending = pendingSurfacePickRef.current;
    setContextMenu(null);
    if (!pending) return;
    const hit = await pending.promise;
    await hideHit(hit);
  }, [hideHit]);

  // "h" shortcut: hides whatever element is currently selected (the one
  // the info panel is showing), rather than needing a fresh pick —
  // hiding naturally follows "the thing I just selected."
  const hideSelectedElement = useCallback(async () => {
    const sel = selectedHitRef.current;
    if (!sel) return;
    const entry = modelsRef.current.get(sel.modelId);
    if (!entry) return;
    await hideHit({ fragments: entry.model, localId: sel.localId });
  }, [hideHit]);

  const setClipMoveMode = useCallback((on) => {
    clipMoveModeRef.current = on;
    setClipMoveModeState(on);
  }, []);

  const showToast = useCallback((text, ms = 2800) => {
    clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), text });
    toastTimerRef.current = setTimeout(() => setToast(null), ms);
  }, []);
  showToastRef.current = showToast;
  const dismissToast = useCallback(() => {
    clearTimeout(toastTimerRef.current);
    setToast(null);
  }, []);

  // The part of the canvas not covered by the info sheet / side panel, as a
  // fraction of the canvas size (see computeFit).
  const getVisibleFrac = useCallback(() => {
    const container = containerRef.current;
    const w = container?.clientWidth || 1;
    const h = container?.clientHeight || 1;
    const insetB = Math.min(viewInsetBottomRef.current, h * 0.8);
    const insetR = Math.min(viewInsetRightRef.current, w * 0.6);
    return { x: Math.max(0.2, 1 - insetR / w), y: Math.max(0.2, 1 - insetB / h) };
  }, []);

  const cancelCameraAnim = useCallback(() => {
    zoomCancelRef.current();
    if (cameraAnimRef.current) cancelAnimationFrame(cameraAnimRef.current);
    cameraAnimRef.current = 0;
  }, []);

  // Smoothly moves the camera to `pose` (position + target) instead of
  // snapping, so a re-fit never reads as a jump.
  const easeToPose = useCallback(
    (pose, ms = 280) => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera || !controls) return;
      cancelCameraAnim();
      applyViewInsetRef.current();
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        applyPose(camera, controls, pose);
        requestRenderRef.current();
        return;
      }
      const fromPos = camera.position.clone();
      const fromTarget = controls.target.clone();
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ms);
        const e = k * k * (3 - 2 * k);
        applyPose(camera, controls, {
          position: fromPos.clone().lerp(pose.position, e),
          target: fromTarget.clone().lerp(pose.target, e),
          distance: undefined,
        });
        requestRenderRef.current();
        cameraAnimRef.current = k < 1 ? requestAnimationFrame(step) : 0;
      };
      cameraAnimRef.current = requestAnimationFrame(step);
    },
    [cancelCameraAnim],
  );

  // Re-fits the whole model into the visible area, keeping the current
  // viewing direction. Used when the sheet changes size before the user has
  // touched the camera.
  const refitModel = useCallback(
    (animate) => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera || !controls || modelsRef.current.size === 0) return;
      const box = getSceneBox(modelsRef.current.values());
      if (!box) return;
      const dir = camera.position.clone().sub(controls.target);
      if (dir.lengthSq() < 1e-9) return;
      dir.normalize();
      const pose = computeFit(camera, box, getVisibleFrac(), dir);
      if (animate) easeToPose(pose);
      else {
        applyViewInsetRef.current();
        applyPose(camera, controls, pose);
      }
      requestRenderRef.current();
    },
    [easeToPose, getVisibleFrac],
  );

  refitModelRef.current = refitModel;

  // Eases the camera so `box` (world space) fills the visible area, keeping
  // the current viewing direction.
  const zoomToBox = useCallback(
    (box) => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera || !controls || !box || box.isEmpty()) return;
      const dir = camera.position.clone().sub(controls.target);
      if (dir.lengthSq() < 1e-9) return;
      autoFramedRef.current = false;
      fitByFocusRef.current = false;
      const pose = computeFit(camera, box, getVisibleFrac(), dir.normalize(), 0.6);
      // Same closest approach as the wheel: never end up inside or touching
      // the element when it is small.
      const m = zoomMetricsRef.current();
      if (m) {
        const r = box.getBoundingSphere(new THREE.Sphere()).radius;
        const least = r + m.min;
        if (pose.distance < least) {
          pose.distance = least;
          pose.position = pose.target.clone().addScaledVector(dir, least);
        }
      }
      easeToPose(pose);
    },
    [easeToPose, getVisibleFrac],
  );

  const zoomToHit = useCallback(
    async (hit) => {
      if (!hit) return;
      const [box] = await hit.fragments.getBoxes([hit.localId]);
      zoomToBox(box);
    },
    [zoomToBox],
  );
  const zoomToHitRef = useRef(zoomToHit);
  zoomToHitRef.current = zoomToHit;

  const zoomToSelection = useCallback(() => {
    const sel = selectedHitRef.current;
    if (!sel) return false;
    const entry = modelsRef.current.get(sel.modelId);
    if (!entry) return false;
    zoomToHit({ fragments: entry.model, localId: sel.localId });
    return true;
  }, [zoomToHit]);

  const resetVisibility = useCallback(async () => {
    // Also exits isolate mode — otherwise the search checkboxes would
    // stay checked while a subsequent toggle silently re-applies the
    // stale isolation set, undoing this reset. Same reasoning for the
    // hide-category tool's own bookkeeping below.
    setIsolatedKeys(new Set());
    hiddenCategoriesRef.current.clear();
    setHiddenCategories([]);
    const entries = [...modelsRef.current.values()];
    renderForAWhile(() => requestRenderRef.current());
    await Promise.all(entries.map(({ model }) => model.resetVisible()));
    await spaces.keepHidden(); // spaces stay off unless "Show spaces" is on
    await pipelineRef.current?.fragments.core.update(true);
    invalidateGroupSphereRef.current();
    requestRenderRef.current();
  }, [spaces.keepHidden]);

  // Recomputes every loaded model's visibility from scratch based on the
  // given isolated-keys set: hide everything, then re-show just the
  // isolated subset per model. An empty set means "not isolating" —
  // falls back to a plain full reset.
  const applyIsolation = useCallback(async (keys) => {
    if (keys.size === 0) {
      await resetVisibility();
      return;
    }
    renderForAWhile(() => requestRenderRef.current());
    const entries = [...modelsRef.current.entries()];
    await Promise.all(
      entries.map(async ([modelId, { model }]) => {
        const idsToShow = [];
        for (const key of keys) {
          const sep = key.lastIndexOf("::");
          if (key.slice(0, sep) === modelId) idsToShow.push(Number(key.slice(sep + 2)));
        }
        const visibleIds = spaces.filterIds(modelId, idsToShow);
        await model.setVisible(undefined, false);
        if (visibleIds.length > 0) await model.setVisible(visibleIds, true);
        // Isolating a set that excludes the currently selected/highlighted
        // element leaves the same stale highlight/panel as hiding just that
        // one element does (see hideHit/setVisible above) — the highlight
        // overlay is a separate mesh outside fragments' own visibility
        // system, so it doesn't disappear on its own just because the
        // underlying element got hidden.
        const sel = selectedHitRef.current;
        if (sel && sel.modelId === modelId && !visibleIds.includes(sel.localId)) {
          clearHighlightRef.current?.();
          selectedHitRef.current = null;
          setSelectedElement(null);
        }
      }),
    );
    await pipelineRef.current?.fragments.core.update(true);
    invalidateGroupSphereRef.current();
    requestRenderRef.current();
  }, [resetVisibility, spaces.filterIds]);

  // Accepts either a single key or an array of keys (e.g. every element in
  // a search result category toggled together as one group): if every key
  // in the batch is already isolated, the whole batch is removed;
  // otherwise every key in the batch is added. That makes a single
  // checkbox driving many keys behave like a normal tri-state group
  // toggle (all-on <-> all-off) instead of getting out of sync per-key.
  const toggleIsolate = useCallback(
    (keyOrKeys) => {
      const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
      setIsolatedKeys((prev) => {
        const next = new Set(prev);
        const allIsolated = keys.every((key) => next.has(key));
        for (const key of keys) {
          if (allIsolated) next.delete(key);
          else next.add(key);
        }
        applyIsolation(next);
        return next;
      });
    },
    [applyIsolation],
  );

  const isolatedKeysRef = useRef(isolatedKeys);
  isolatedKeysRef.current = isolatedKeys;
  const spaceControl = {
    shown: spaces.shown,
    available: spaces.hasSpaces,
    setShown: (on) =>
      spaces.setSpacesShown(on, isolatedKeysRef.current.size > 0 ? () => applyIsolation(isolatedKeysRef.current) : null),
  };

  const clearIsolation = useCallback(() => {
    setIsolatedKeys(new Set());
    resetVisibility();
  }, [resetVisibility]);

  // Escape leaves isolation once nothing else (a tool, the selection, a
  // popover) wanted the key first.
  useEffect(() => {
    if (isolatedKeys.size === 0) return undefined;
    const onKey = (event) => {
      if (event.key !== "Escape" || event.ifcEscHandled || event.defaultPrevented) return;
      if (document.querySelector(".context-menu, .confirm-dialog-backdrop, .measure-leg-edit-popup")) return;
      clearIsolation();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isolatedKeys, clearIsolation]);

  // Replaces the whole isolate set at once (used by the Levels control).
  const isolateKeys = useCallback(
    (keys) => {
      const next = new Set(keys);
      setIsolatedKeys(next);
      applyIsolation(next);
    },
    [applyIsolation],
  );

  // Isolates / un-isolates the selected element (same keys as the search
  // checkboxes use, so both stay in sync).
  const isolateSelection = useCallback(() => {
    const sel = selectedHitRef.current;
    if (!sel) {
      showToast("Select an element first, then press I to isolate it");
      return;
    }
    toggleIsolate(`${sel.modelId}::${sel.localId}`);
  }, [toggleIsolate, showToast]);

  // Right-click / long-press menu actions on the element that was picked.
  const withPendingHit = useCallback(async (fn) => {
    const pending = pendingSurfacePickRef.current;
    setContextMenu(null);
    if (!pending) return;
    const hit = await pending.promise;
    if (hit) await fn(hit);
  }, []);
  const zoomToElementHere = useCallback(() => withPendingHit((hit) => zoomToHit(hit)), [withPendingHit, zoomToHit]);
  const isolateElementHere = useCallback(
    () => withPendingHit((hit) => toggleIsolate(`${hit.fragments.modelId}::${hit.localId}`)),
    [withPendingHit, toggleIsolate],
  );
  const copyGuidHere = useCallback(
    () =>
      withPendingHit(async (hit) => {
        const [guid] = await hit.fragments.getGuidsByLocalIds([hit.localId]);
        if (!guid) {
          showToast("This element has no GUID");
          return;
        }
        try {
          await navigator.clipboard.writeText(guid);
          showToast("GUID copied");
        } catch {
          showToast(`GUID: ${guid}`, 6000);
        }
      }),
    [withPendingHit, showToast],
  );

  // Global keyboard shortcuts: "h" hide the selection, "c" create a clip
  // plane under the cursor, "m" toggle measure mode, Ctrl+Z undo,
  // Ctrl+Y/Ctrl+Shift+Z redo (Cmd on macOS via metaKey). Guarded against
  // typing in the search box (or any future text input) and against
  // other modifier combos, which should fall through to the browser/OS
  // as normal rather than being hijacked.
  useEffect(() => {
    const onKeyDown = (event) => {
      const target = document.activeElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if (mod && (key === "y" || (key === "z" && event.shiftKey))) {
        event.preventDefault();
        redo();
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      switch (key) {
        case "h":
          hideSelectedElement();
          break;
        case "f":
          if (!zoomToSelection()) showToast("Select an element first, then press F to zoom to it");
          break;
        case "i":
          isolateSelection();
          break;
        case "c":
          createClipPlaneUnderCursor();
          break;
        case "m":
          toggleMeasureMode();
          break;
        case "t":
          toggleTagTool();
          break;
        case "g":
          toggleCategoryHideMode();
          break;
        case "v":
          toggleTagsVisibility();
          break;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hideSelectedElement, zoomToSelection, showToast, isolateSelection, createClipPlaneUnderCursor, toggleMeasureMode, toggleTagTool, toggleCategoryHideMode, toggleTagsVisibility, undo, redo]);


  const runSearch = useCallback(async (query) => {
    // One query entry per whitespace-separated term, each independently
    // substring-matched against Name (case-insensitive) — the default
    // "exclusive" aggregation in getItemsByQuery requires an item to match
    // every entry, so this finds names containing all the typed words in
    // any order, rather than the whole query as one exact-order phrase.
    const trimmed = query.trim();
    const terms = trimmed.split(/\s+/).filter(Boolean);
    const termQueries = terms.map((term) => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return { name: /^Name$/, value: new RegExp(escaped, "i") };
    });
    // Also match the whole query against the element's category/type (e.g.
    // typing "IfcBuildingElementProxy" or just "proxy") — Name and category
    // are unrelated fields, so the Name-only query above never finds
    // anything for a type name unless it coincidentally also appears in
    // some element's Name. Unanchored substring match, unlike the exact
    // `^key$` regex the hide-category tool uses, since here we don't
    // already know the exact category name being searched for.
    const categoryEscaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const categoryRegex = new RegExp(categoryEscaped, "i");
    const rows = [];
    for (const [modelId, { model }] of modelsRef.current) {
      if (rows.length >= 50) break;
      let nameIds = [];
      try {
        nameIds = await model.getItemsByQuery({ attributes: { queries: termQueries } });
      } catch (err) {
        console.error("Search query failed", err);
      }
      let categoryIds = [];
      try {
        const idsByCategory = await model.getItemsOfCategories([categoryRegex]);
        categoryIds = Object.values(idsByCategory).flat();
      } catch (err) {
        console.error("Category search failed", err);
      }
      // Property sets, types and the like match by name too, but have no
      // geometry to isolate or select, so only offer drawn elements.
      const drawn = new Set(await model.getItemsIdsWithGeometry());
      const ids = [...new Set([...(nameIds ?? []), ...categoryIds])].filter((id) => drawn.has(id));
      if (ids.length === 0) continue;
      const capped = ids.slice(0, 50 - rows.length);
      const items = await model.getItemsData(capped, { attributesDefault: true });
      const modelName = modelNamesRef.current.get(modelId);
      for (let i = 0; i < capped.length; i++) {
        rows.push({
          key: `${modelId}::${capped[i]}`,
          modelId,
          localId: capped[i],
          name: items[i]?.Name?.value ?? "(unnamed)",
          category: items[i]?._category?.value ?? "",
          modelName,
        });
      }
    }
    setSearchResults(rows);
  }, []);

  useEffect(() => {
    // Stale results left in state when the query drops below 2 chars are
    // harmless — SearchBar itself only renders the dropdown once the
    // (trimmed) query is at least 2 characters, so there's nothing to
    // clear here; that avoids a synchronous setState during the effect.
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) return;
    const handle = setTimeout(() => runSearch(trimmed), 250);
    return () => clearTimeout(handle);
  }, [searchQuery, runSearch]);

  const setVisible = useCallback(
    (modelId, visible) => {
      const entry = modelsRef.current.get(modelId);
      if (entry) entry.object.visible = visible;
      invalidateGroupSphereRef.current();
      // Hiding a whole model whose element is currently selected leaves
      // the same kind of stale highlight/panel as hiding just that one
      // element does — clear it the same way.
      if (!visible && selectedHitRef.current?.modelId === modelId) {
        clearHighlightRef.current?.();
        selectedHitRef.current = null;
        setSelectedElement(null);
      }
      requestRenderRef.current();
      setModels((prev) =>
        prev.map((m) => (m.id === modelId ? { ...m, visible } : m)),
      );
    },
    [],
  );

  // Visual-only per-model color override, picked from the sidebar.
  // `color` is a hex string, or `null` to clear it. Stores the choice in
  // `models` state regardless of whether overlays ("V") are currently
  // shown — only actually paints it on screen when they are, so a color
  // picked while overlays are hidden shows up as soon as "V" is pressed,
  // without needing to be re-picked (see toggleTagsVisibility below).
  const setModelColor = useCallback((modelId, color) => {
    setModels((prev) => prev.map((m) => (m.id === modelId ? { ...m, color } : m)));
    const entry = modelsRef.current.get(modelId);
    if (entry && tagsVisibleRef.current) {
      applyModelColorOverride(entry.object, color);
      requestRenderRef.current();
    }
  }, []);

  // The library renamed a file that is open: the loaded row (and the name a
  // saved .ifcZIP gets) follows it.
  const renameLoadedModel = useCallback((oldName, newName) => {
    for (const entry of modelsRef.current.values()) if (entry.fileName === oldName) entry.fileName = newName;
    setModels((prev) => prev.map((m) => (m.name === oldName ? { ...m, name: newName } : m)));
  }, []);

  // Everything in the scene that is not tied to one model: measurements, section
  // planes, hidden categories, isolation, and the undo history. Used when the
  // whole scene is replaced or the last model is removed.
  const clearSceneState = useCallback(() => {
    const measures = measureManagerRef.current;
    if (measures) {
      for (const m of measures.list()) measures.remove(m.id);
      setMeasurements(measures.list());
    }
    const planes = clipPlaneManagerRef.current;
    if (planes) {
      for (const p of planes.list()) planes.remove(p.id);
      setClipPlanes(planes.list());
    }
    hiddenCategoriesRef.current.clear();
    setHiddenCategories([]);
    setIsolatedKeys(new Set());
    undoStackRef.current = [];
    redoStackRef.current = [];
    syncHistoryCounts();
    requestRenderRef.current();
  }, [syncHistoryCounts]);

  // Takes the given models out of the scene together: every one is gone from the
  // viewer's state before any is disposed, so nothing reads a model that is being
  // disposed. `refit` frames what is left.
  const removeModels = useCallback(async (modelIds, { refit = true } = {}) => {
    const pipeline = pipelineRef.current;
    const modelsGroup = modelsGroupRef.current;
    const ids = new Set(modelIds);
    for (const modelId of ids) {
      const entry = modelsRef.current.get(modelId);
      // The selection (highlight box and Info panel) may belong to this model.
      if (selectedHitRef.current?.modelId === modelId) {
        clearHighlightRef.current?.();
        selectedHitRef.current = null;
        setSelectedElement(null);
      }
      if (entry && modelsGroup) modelsGroup.remove(entry.object);
      if (entry?.onViewUpdatedHandler) entry.model.onViewUpdated.remove(entry.onViewUpdatedHandler);
      modelsRef.current.delete(modelId);
      clearDimensionTagsForModelRef.current?.(modelId);
      const rawHandle = rawIfcHandlesRef.current.get(modelId);
      if (rawHandle) {
        closeRawIfcModel(rawHandle);
        rawIfcHandlesRef.current.delete(modelId);
      }
    }
    // Undo steps that act on the removed models' elements can no longer run.
    undoStackRef.current = undoStackRef.current.filter((e) => !ids.has(e.modelId));
    redoStackRef.current = redoStackRef.current.filter((e) => !ids.has(e.modelId));
    syncHistoryCounts();
    invalidateGroupSphereRef.current();
    requestRenderRef.current();
    setModels((prev) => prev.filter((m) => !ids.has(m.id)));
    setSearchResults((prev) => prev.filter((r) => !ids.has(r.modelId)));
    setIsolatedKeys((prev) => {
      const next = new Set([...prev].filter((key) => ![...ids].some((id) => key.startsWith(`${id}::`))));
      return next.size === prev.size ? prev : next;
    });
    // Nothing left to measure or cut: the empty state starts from a clean scene.
    if (modelsRef.current.size === 0) clearSceneState();
    // The rest of the models fill the view again.
    else if (refit) refitModelRef.current(true);

    await Promise.all(
      [...ids].map(async (modelId) => {
        try {
          await pipeline?.fragments.core.disposeModel(modelId);
        } catch (err) {
          console.error(`Failed to dispose model ${modelId}`, err);
        }
      }),
    );
  }, [syncHistoryCounts, clearSceneState]);

  const removeModel = useCallback((modelId, options) => removeModels([modelId], options), [removeModels]);

  const removeAllModels = useCallback(() => removeModels([...modelsRef.current.keys()], { refit: false }), [removeModels]);

  // Shows the "replace existing file?" modal and resolves to the user's
  // choice; ConfirmDialog (rendered from the `confirmReplace` state)
  // calls back into `resolve` via confirmReplaceAnswer below. The resolver
  // lives in a ref so Cancel can close the question it belongs to.
  const confirmRef = useRef(null); // { name, resolve } | null
  const confirmReplaceFile = useCallback((name) => {
    return new Promise((resolve) => {
      confirmRef.current = { name, resolve };
      setConfirmReplace({ name });
    });
  }, []);

  const confirmReplaceAnswer = useCallback((replace) => {
    const pending = confirmRef.current;
    confirmRef.current = null;
    setConfirmReplace(null);
    pending?.resolve(replace);
  }, []);

  // Files waiting to be opened. A file picked (or a library download that
  // finishes) while another is opening joins the end of the queue; nothing is
  // dropped silently and nothing is cancelled behind the user's back.
  const loadQueueRef = useRef(new LoadQueue());
  const loadRunningRef = useRef(false);

  // Opens everything in the queue, one file after the other, then frames the
  // camera. One run at a time (loadRunningRef); Cancel ends it and empties the queue.
  const runLoadQueue = useCallback(async () => {
    const pipeline = pipelineRef.current;
    const modelsGroup = modelsGroupRef.current;
    const queue = loadQueueRef.current;
    loadRunningRef.current = true;
    const token = ++loadTokenRef.current;
    const abandoned = () => token !== loadTokenRef.current;
    // Rejects when the user presses Cancel, so a stuck parse never traps them.
    let cancelImport = () => {};
    const cancelled = new Promise((_, reject) => {
      cancelLoadRef.current = () => {
        cancelImport(); // kills the import worker, so Cancel really stops the work
        reject(new Error("cancelled"));
      };
    });
    cancelled.catch(() => {});

    setError(null);
    setErrorInfo(null);
    setLoadFailed(false);
    setIsLoading(true);

    // Only the files that failed are opened again by Retry (never one that loaded).
    const failedFiles = [];
    // `info` ({ details, intent }) is the technical text for the banner's
    // Details and, with `intent`, a Reload button that reopens the model after.
    const appendError = (message, retryable = false, info = null) => {
      if (retryable) setLoadFailed(true);
      if (info) setErrorInfo(info);
      setError((prev) => (prev ? `${prev} · ${message}` : message));
    };
    // What to reopen if Argus has to reload itself (a File cannot survive a reload).
    let currentIntent = null;
    // How the file being opened joins the scene (see loadFiles): a "replace" batch
    // swaps out what was loaded when it started, once its first model is in.
    let currentBatch = null;

    // Replace batches whose old models are hidden and not yet removed.
    const swaps = [];
    const finalizeSwaps = async () => {
      for (const batch of swaps.splice(0)) {
        const old = batch.hidden.filter((id) => modelsRef.current.has(id));
        if (batch.newIds.some((id) => modelsRef.current.has(id))) {
          if (old.length) {
            await removeModels(old, { refit: false });
            clearSceneState();
          }
        } else {
          // Nothing of the new set survived: the old scene stays.
          for (const id of old) modelsRef.current.get(id).object.visible = true;
        }
        requestRenderRef.current();
      }
    };

    // A model the fragments worker builds for a load that was given up (Cancel,
    // the build watchdog) must not stay in memory: abort the build, or dispose
    // the model once it exists.
    const discardModel = (core, modelId, building) => {
      try {
        core.abort?.(modelId);
      } catch {
        // not loading any more
      }
      building?.then(() => core.disposeModel(modelId)).catch(() => {});
    };

    // Parses one .ifc into a model and wires it into the scene — shared by a
    // directly-selected/dropped .ifc file and by each .ifc entry unpacked
    // from an archive below, so both paths get identical handling (including
    // retaining the original bytes for "Save as .ifcZIP", see saveAsIfcZip).
    // `source` is a Blob or File (read inside the import worker; handed over
    // by reference, so an attempt that starts over costs no copy).
    // `retryFile` is what Retry opens again if this one fails.
    const loadOneIfc = async (source, displayName, retryFile) => {
      const batch = currentBatch;
      const replacing = !!batch && !batch.add && !batch.swapped;
      let existingId = [...modelNamesRef.current.entries()].find(([, name]) => name === displayName)?.[0];
      // A model of the scene being replaced goes with the swap below, without a question.
      if (existingId && replacing && batch.oldIds.includes(existingId)) existingId = undefined;
      if (existingId) {
        const replace = await confirmReplaceFile(displayName);
        if (abandoned()) return;
        if (!replace) {
          appendError(`Skipped "${displayName}": a model with that name is already loaded.`);
          return;
        }
        // The old model stays until the new one has loaded (see below), so a
        // failed import never leaves the user with neither.
      }
      const modelId = nextId();
      // `building`/`buildCore`: the current attempt's fragments build, so a
      // load that is given up can dispose what it made.
      let building = null;
      let buildCore = null;
      try {
        // A worker that hangs is restarted by the client's progress watchdog
        // (stallMs below; on an insecure origin, where Web Locks are missing,
        // it is the only detector), one that dies is noticed through its Web
        // Lock; a fragments build that never finishes by the build watchdog.
        const stallMs = stallLimitMs(source.size ?? source.byteLength);
        const shortName = displayName.length > 28 ? `${displayName.slice(0, 25)}…` : displayName;
        // The wasm conversion runs in a worker (see ifc/ifcImportClient.js) so
        // the page stays responsive; the finished fragments are then handed
        // to the fragments worker like ifcLoader.load would have done.
        // Some IFC exporters produce geometry with inconsistent winding
        // (a face's front side doesn't reliably match its outward
        // normal), which front-face-only rendering shows as missing or
        // "inside-out" surfaces. Render both faces so those surfaces
        // are never invisible, at the cost of some fill-rate.
        const { wasm, webIfc } = pipeline.ifcLoader.settings; // see setupComponents.js
        // One attempt: a worker converts the file, the result goes to the
        // fragments worker. `fresh` skips the prewarmed worker.
        const runImport = async (fresh, allSchemas) => {
          const input = source instanceof Blob ? { file: source } : { bytes: source.slice() };
          const importJob = importIfcInWorker(input, {
            wasm: { path: wasm.path, absolute: wasm.absolute },
            webIfcSettings: { ...webIfc },
            doubleSidedMaterials: true,
            fresh,
            allSchemas,
            stallMs,
            onProgress: (fraction, process) => {
              const stage = { geometries: "shapes", attributes: "properties", relations: "structure", conversion: "finishing" }[process];
              if (stage) setLoadingLabel(`Opening ${shortName}: ${stage} ${Math.min(99, Math.floor(fraction * 100))}%`);
            },
          });
          cancelImport = importJob.cancel;
          const loadPromise = importJob.promise.then(async ({ fragments, source: originalBytes }) => {
            sourceBytes = originalBytes;
            setLoadingLabel(`Drawing ${shortName}…`);
            const core = pipeline.fragments.core; // read now: a restart replaces it
            core.settings.autoCoordinate = true;
            buildCore = core;
            building = core.load(fragments, { modelId });
            building.catch(() => {});
            // The fragments worker gets a size-scaled time to build the model;
            // past that it is taken as hung and the attempt starts over.
            const limit = buildLimitMs(fragments.byteLength);
            let timer = 0;
            const hung = new Promise((_, reject) => {
              timer = setTimeout(() => {
                const error = new ImportError(KIND.TIMEOUT, `The 3D engine did not finish building the model in ${Math.round(limit / 1000)} s`, { stage: "build" });
                reject(Object.assign(error, { buildHung: true, stalledMs: limit }));
              }, limit);
            });
            try {
              return await Promise.race([building, hung]);
            } finally {
              clearTimeout(timer);
            }
          });
          loadPromise.catch(() => {});
          try {
            return await Promise.race([loadPromise, cancelled]);
          } catch (err) {
            // Given up (Cancel, the build watchdog): whatever the build makes is thrown away.
            if (building) discardModel(buildCore, modelId, building);
            building = null;
            throw err;
          } finally {
            importJob.cancel(); // no-op once finished; stops an import that lost the race
          }
        };
        let model;
        let sourceBytes;
        // A missing file of Argus's own, a dead or stalled worker and a memory
        // squeeze are usually momentary: the import starts over by itself in a
        // fresh worker (0 s, 1 s, 3 s) and the user only sees progress text.
        let freedMemory = false;
        // After an unexpected error (UNKNOWN: a wasm trap, a TypeError) the next
        // attempt loads every schema's tables, in case the header sniff was wrong.
        let allSchemas = false;
        // Time lost to stalls so far; capped (see mayRetryStall) so a file too
        // big for the device ends in minutes, not three full stall limits.
        let stalledMs = 0;
        for (let attempt = 1; ; attempt++) {
          try {
            model = await runImport(attempt > 1, allSchemas);
            break;
          } catch (err) {
            const failure = toImportError(err);
            const memory = failure.kind === KIND.OUT_OF_MEMORY;
            if (failure.kind === KIND.CANCELLED || abandoned()) throw failure;
            if (failure.kind === KIND.TIMEOUT) {
              stalledMs += err?.stalledMs ?? stallMs;
              failure.stalledMs = stalledMs;
            }
            const another =
              attempt < BACKOFF_MS.length &&
              isRetryable(failure.kind) &&
              (failure.kind !== KIND.TIMEOUT || mayRetryStall(stalledMs, err?.stalledMs ?? stallMs));
            if (!(memory ? !freedMemory : another)) throw failure;
            if (failure.kind === KIND.UNKNOWN) allSchemas = true;
            console.warn(`Import of ${displayName} failed (${failure.kind}), starting over`, err);
            // This tab may simply be older than the deployed build: then a reload, not a retry, is the cure.
            if (failure.kind === KIND.APP_ASSET_FAILED && attempt === 1 && (await isStaleBuild())) {
              failure.stale = true;
              throw failure;
            }
            // The fragments worker stopped answering: start a fresh one, which
            // is only possible while no other model lives in it.
            if (err?.buildHung && modelsRef.current.size === 0) pipeline.fragments.restart?.();
            if (memory) {
              freedMemory = true;
              releaseImporterMemory();
              setLoadingLabel(`Freeing memory and loading again: ${shortName}`);
              await Promise.race([sleep(1000), cancelled]);
            } else {
              setLoadingLabel(`${attemptText("Loading", attempt + 1, BACKOFF_MS.length)}: ${shortName}`);
              await Promise.all([refreshFailedAssets(/wasm/i.test(failure.message) ? `${failure.message} ${location.origin}${import.meta.env.BASE_URL}wasm/web-ifc.wasm` : failure.message), Promise.race([sleep(BACKOFF_MS[attempt]), cancelled])]);
            }
            if (abandoned()) throw new ImportError(KIND.CANCELLED, "cancelled");
          }
        }
        // Loaded for a load that was cancelled meanwhile: dispose it again.
        if (abandoned()) {
          discardModel(buildCore, modelId, building);
          return;
        }
        // Replace: only now that the new model is in does the old one go.
        if (existingId && modelsRef.current.has(existingId)) await removeModel(existingId);
        // Replace: the first model of the batch to load takes the old scene out of
        // view; finalizeSwaps below removes it once the new model is known to have
        // geometry (a file with none must not cost the user the model they had).
        if (replacing && !batch.swapped) {
          batch.swapped = true;
          batch.hidden = batch.oldIds.filter((oldId) => modelsRef.current.has(oldId));
          for (const oldId of batch.hidden) modelsRef.current.get(oldId).object.visible = false;
          swaps.push(batch);
        }
        if (abandoned()) {
          discardModel(buildCore, modelId, building);
          return;
        }

        if (cameraRef.current) model.useCamera(cameraRef.current);
        modelsGroup.add(model.object);
        const entry = { model, object: model.object, sourceBytes, fileName: displayName };
        modelsRef.current.set(modelId, entry);
        batch?.newIds.push(modelId);
        await spaces.hideOnLoad(modelId); // rooms start hidden; not an undo step
        // Tiles regenerate in the background (LOD/visibility changes),
        // which would otherwise silently drop a manual color override on
        // whatever tile gets rebuilt — reapply it every time using
        // whatever's currently stored, not what it was when this model
        // first loaded.
        const handleViewUpdated = () => {
          const color = tagsVisibleRef.current ? (modelColorsRef.current.get(modelId) ?? null) : null;
          if (color) applyModelColorOverride(entry.object, color);
        };
        model.onViewUpdated.add(handleViewUpdated);
        entry.onViewUpdatedHandler = handleViewUpdated;
        invalidateGroupSphereRef.current();
        requestRenderRef.current();

        setModels((prev) => [
          ...prev,
          { id: modelId, name: displayName, visible: true, color: null },
        ]);
      } catch (err) {
        const failure = toImportError(err);
        if (failure.kind === KIND.CANCELLED) return;
        console.error(`Failed to load ${displayName}`, err);
        // The retry above did not help. If this tab is simply older than the
        // deployed build, reloading fixes it and reopens the model by itself,
        // but only when nothing else would be lost: with a model open (or more
        // files waiting) the user decides, through the Reload button.
        let reloading = false;
        let staleBuild = false;
        if (failure.kind === KIND.APP_ASSET_FAILED && !abandoned()) {
          if (failure.stale || (await isStaleBuild())) {
            staleBuild = true;
            if (modelsRef.current.size === 0 && queue.size === 0) {
              reloading = await reloadResuming(currentIntent, () => setError(describeFailure(failure, { name: displayName, reloading: true })));
            }
          }
        }
        if (reloading || abandoned()) return;
        // Every automatic attempt has failed: only now are buttons offered.
        // A file the importer rejected gets no Retry (it would fail again), only "Choose another file".
        const invalid = failure.kind === KIND.INVALID_FILE;
        if (!invalid && retryFile) failedFiles.push(retryFile);
        const info = {
          details: failureDetails(failure, { name: displayName, buildId: runningBuildId(), userAgent: navigator.userAgent }),
          // A failure that a fresh page may cure gets a Reload button.
          intent: isRetryable(failure.kind) || staleBuild ? currentIntent : undefined,
          reload: isRetryable(failure.kind) || staleBuild,
          chooseAnother: invalid,
        };
        appendError(describeFailure(failure, { name: displayName, retried: true, staleBuild, stalledMs: failure.stalledMs }), !invalid, info);
      }
    };

    // One picked file: an .ifc, or an archive (.ifcZIP, or a .zip that holds an .ifc).
    const openFile = async (file) => {
      currentIntent = file.argusIntent ?? { type: "local", name: file.name };
      currentBatch = file.argusBatch ?? null;
      if (currentBatch && !currentBatch.add && !currentBatch.oldIds) currentBatch.oldIds = [...modelsRef.current.keys()];
      const kind = fileKind(file.name);
      if (kind === "zip") {
        setLoadingLabel(`Unpacking ${file.name}…`);
        let unzipped;
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (!isZip(bytes)) {
            appendError(`"${file.name}" is not a ZIP archive, so it cannot be opened as an .ifcZIP.`, false, { chooseAnother: true });
            return;
          }
          unzipped = await new Promise((resolve, reject) => {
            unzip(bytes, (err, result) => (err ? reject(err) : resolve(result)));
          });
        } catch (err) {
          console.warn(`Failed to unpack ${file.name}`, err);
          appendError(`Could not unpack "${file.name}": it doesn't look like a valid .ifcZIP file.`, false, { chooseAnother: true });
          return;
        }
        const innerNames = ifcEntries(Object.keys(unzipped));
        if (innerNames.length === 0) {
          appendError(`"${file.name}" does not contain an .ifc file.`, false, { chooseAnother: true });
          return;
        }
        for (const innerName of innerNames) {
          // Base name only (ifcZIP entries are commonly flat, but a
          // path prefix would otherwise leak into the model list).
          const baseName = innerName.split("/").pop();
          // A Blob, so a restarted attempt needs no copy of the bytes; the
          // unpacked array is let go at once.
          const blob = new Blob([unzipped[innerName]]);
          delete unzipped[innerName];
          const retryFile = new File([blob], baseName);
          retryFile.argusIntent = currentIntent;
          retryFile.argusBatch = currentBatch;
          setLoadingLabel(`Reading ${baseName}…`);
          await loadOneIfc(blob, baseName, retryFile);
          if (abandoned()) return;
        }
        return;
      }

      const name = file.displayName ?? file.name;
      if (kind !== "ifc") {
        appendError(`"${name}" is not an .ifc, .ifcZIP or .zip file.`, false, { chooseAnother: true });
        return;
      }
      if (file.size === 0) {
        appendError(`"${name}" is empty.`, false, { chooseAnother: true });
        return;
      }
      if (file.size > MAX_IFC_BYTES) {
        appendError(`"${name}" is ${Math.round(file.size / 1048576)} MB, which is too large to open in a browser. Try splitting the model or exporting a lighter one.`);
        return;
      }
      // Every IFC (STEP) file starts with an ISO-10303-21 header (after a BOM,
      // whitespace or comments, so the first 64 KB are read), so anything else
      // can be rejected immediately instead of after a long parse.
      const head = await file.slice(0, HEAD_BYTES).arrayBuffer().then((b) => new Uint8Array(b)).catch(() => new Uint8Array());
      if (!hasStepHeader(head)) {
        appendError(`"${name}" is not a valid IFC file (no ISO-10303-21 header).`, false, { chooseAnother: true });
        return;
      }
      if (file.size > 150 * 1048576) setToast({ id: Date.now(), text: `Large file (${Math.round(file.size / 1048576)} MB). This can take a few minutes.` });
      setLoadingLabel(`Reading ${name}…`);
      await loadOneIfc(file, name, file);
    };

    try {
      for (;;) {
        for (let file = queue.next(); file; file = queue.next()) {
          await openFile(file);
          if (abandoned()) return;
        }

        // Let a few frames of streamed geometry land before measuring bounds.
        await Promise.race([pipeline.fragments.core.update(true), new Promise((resolve) => setTimeout(resolve, 15000))]);
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (abandoned()) return;
        const geometryless = [];
        for (const [id, entry] of modelsRef.current.entries()) {
          if (entry.localBox !== undefined) continue;
          try {
            const measured = await computeModelLocalBox(entry.model, modelsGroup);
            entry.localBox = measured ? measured.box : null;
            entry.fullLocalBox = measured ? measured.full : null;
            if (entry.localBox === null) geometryless.push([id, entry.fileName]);
          } catch (err) {
            console.error("Could not measure model bounds", err);
            entry.localBox = null;
          }
        }
        // A valid IFC that carries no 3D geometry would otherwise sit in the list
        // as an invisible model: say so and take it out again.
        for (const [id, name] of geometryless) {
          await removeModel(id, { refit: false });
          appendError(`"${name}" has no 3D geometry to show.`);
        }
        await finalizeSwaps();
        if (cameraRef.current && controlsRef.current) {
          autoFramedRef.current = true;
          frameCameraOnScene(
            cameraRef.current,
            controlsRef.current,
            modelsRef.current.values(),
            getVisibleFrac(),
          );
        }
        if (abandoned()) return;
        // Files picked while this one was being framed: open them too.
        if (queue.size === 0) break;
      }

      lastLoadFilesRef.current = failedFiles.length ? failedFiles : null;
      performance.mark("model-shown");
      setIsLoading(false);
      setLoadingLabel("");
    } finally {
      await finalizeSwaps();
      if (!abandoned()) loadRunningRef.current = false;
    }
  }, [confirmReplaceFile, removeModel, removeModels, clearSceneState, getVisibleFrac, spaces.hideOnLoad]);

  // Opening replaces what is loaded, as a set: the new file(s) load first, and only
  // when the first one is in does the old scene go (a failed open keeps the old
  // model). { add: true } puts them next to what is loaded instead. A file that is
  // opened again after a failure keeps the way its batch was opening.
  const loadFiles = useCallback((fileList, options = {}) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    const prev = files[0].argusBatch;
    const add = options.add ?? (prev ? prev.add || !!prev.swapped : false);
    const batch = { add, oldIds: null, swapped: false, hidden: [], newIds: [] };
    for (const file of files) file.argusBatch = batch;
    if (!pipelineRef.current || !modelsGroupRef.current) {
      // Still booting: keep the choice and load it as soon as the viewer is
      // ready (see the effect after cancelLoad).
      pendingFilesRef.current = [...(pendingFilesRef.current ?? []), ...files];
      setIsLoading(true);
      setLoadingLabel("Starting the viewer…");
      return;
    }
    loadQueueRef.current.add(files);
    if (loadRunningRef.current) {
      showToastRef.current(queuedText(files));
      return;
    }
    runLoadQueue();
  }, [runLoadQueue]);

  // Counts for tests and bug reports (read-only): models the fragments engine
  // holds, models in the scene, files waiting. Equal first two = nothing leaked.
  useEffect(() => {
    window.__argusLoadStats = () => ({
      engine: pipelineRef.current?.fragments.core.models.list.size ?? 0,
      open: modelsRef.current.size,
      queued: loadQueueRef.current.size,
    });
    return () => {
      delete window.__argusLoadStats;
    };
  }, []);

  // Argus reloaded itself to get a newer version while a file from this device
  // was being opened: the browser cannot keep a File across a reload, so ask again.
  useEffect(() => {
    const resumed = startupIntent();
    if (resumed?.type === "local") setError(`Argus was updated. Pick "${resumed.name}" again to open it.`);
  }, []);

  useEffect(() => {
    if (!ready || !pendingFilesRef.current) return;
    const files = pendingFilesRef.current;
    pendingFilesRef.current = null;
    loadFiles(files);
  }, [ready, loadFiles]);

  // Cancel stops the running import (its worker is killed), drops the files
  // waiting behind it, and closes a "replace?" question that belongs to it
  // (the old model stays).
  const cancelLoad = useCallback(() => {
    pendingFilesRef.current = null;
    loadQueueRef.current.clear();
    cancelLoadRef.current();
    loadTokenRef.current += 1;
    loadRunningRef.current = false;
    const question = confirmRef.current;
    confirmRef.current = null;
    setConfirmReplace(null);
    question?.resolve(false);
    setIsLoading(false);
    setLoadingLabel("");
    setError(null);
    setErrorInfo(null);
    setLoadFailed(false);
  }, []);

  // The last-resort Retry (shown only after every automatic attempt failed)
  // opens again only the files that failed, never one that already loaded.
  const retryLoad = useCallback(() => {
    const files = lastLoadFilesRef.current;
    lastLoadFilesRef.current = null;
    if (files?.length) loadFiles(files);
  }, [loadFiles]);

  // Bundles every currently-loaded model's original bytes back into a
  // single buildingSMART-style .ifcZIP (a plain ZIP of the .ifc files —
  // no geometry re-encoding), and triggers a browser download. Models
  // loaded from an .ifcZIP or as plain .ifc files are handled identically
  // here since both retain sourceBytes/fileName in modelsRef (see
  // loadOneIfc above).
  const saveAsIfcZip = useCallback(async () => {
    const entries = [...modelsRef.current.values()].filter((entry) => entry.sourceBytes);
    if (entries.length === 0) return;

    // Zip entry names must be unique even if two loaded models share a
    // filename (e.g. loaded from different folders).
    const usedNames = new Set();
    const files = {};
    for (const entry of entries) {
      const baseName = IFC_EXTENSION.test(entry.fileName) ? entry.fileName : `${entry.fileName}.ifc`;
      let name = baseName;
      let suffix = 2;
      while (usedNames.has(name)) {
        name = baseName.replace(IFC_EXTENSION, `-${suffix}.ifc`);
        suffix += 1;
      }
      usedNames.add(name);
      files[name] = entry.sourceBytes;
    }

    const zipped = await new Promise((resolve, reject) => {
      zip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)));
    });

    const blob = new Blob([zipped], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = entries.length === 1 ? entries[0].fileName.replace(IFC_EXTENSION, "") + ".ifczip" : "models.ifczip";
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  // "Home": back to the same framing new files get on load, with the
  // model's own orientation reset too (rotation is the only transform
  // the arcball drag ever applies to modelsGroup — it's never
  // translated by hand — see the position reset below).
  const resetView = useCallback(() => {
    const modelsGroup = modelsGroupRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    cancelCameraAnim();
    applyViewInsetRef.current();
    autoFramedRef.current = true;
    const startQuat = modelsGroup ? modelsGroup.quaternion.clone() : null;
    const startPos = modelsGroup ? modelsGroup.position.clone() : null;
    if (modelsGroup) {
      // A drag rotates the group about a pivot, which also moves its
      // position, so both are reset. The world matrices are refreshed so
      // the framing below measures the reset pose, not last frame's.
      modelsGroup.quaternion.identity();
      modelsGroup.position.set(0, 0, 0);
      modelsGroup.updateMatrixWorld(true);
    }
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const box = getSceneBox(modelsRef.current.values());
    if (!modelsGroup || !box || reduceMotion) {
      frameCameraOnScene(camera, controls, modelsRef.current.values(), getVisibleFrac());
      requestRenderRef.current();
      return;
    }
    // Ease there: the model turns back and the camera glides to the framing.
    const pose = computeFit(camera, box, getVisibleFrac(), DEFAULT_VIEW_DIR);
    modelsGroup.quaternion.copy(startQuat);
    modelsGroup.position.copy(startPos);
    modelsGroup.updateMatrixWorld(true);
    const fromCamPos = camera.position.clone();
    const fromTarget = controls.target.clone();
    const identity = new THREE.Quaternion();
    const zero = new THREE.Vector3();
    const t0 = performance.now();
    const ms = 420;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = k * k * (3 - 2 * k);
      modelsGroup.quaternion.copy(startQuat).slerp(identity, e);
      modelsGroup.position.copy(startPos).lerp(zero, e);
      modelsGroup.updateMatrixWorld(true);
      applyPose(camera, controls, {
        position: fromCamPos.clone().lerp(pose.position, e),
        target: fromTarget.clone().lerp(pose.target, e),
        distance: undefined,
      });
      requestRenderRef.current();
      cameraAnimRef.current = k < 1 ? requestAnimationFrame(step) : 0;
      if (k >= 1) applyPose(camera, controls, pose);
    };
    cameraAnimRef.current = requestAnimationFrame(step);
  }, [cancelCameraAnim, getVisibleFrac]);

  // Part of the viewport can be covered by UI that sits over it (on a phone,
  // the info bottom sheet). Rather than shrinking the canvas — which would
  // also shrink the model on screen — shift the camera's projection so the
  // model is centred in the part that is still visible.
  const applyViewInset = useCallback(() => {
    const camera = cameraRef.current;
    const container = containerRef.current;
    if (!camera || !container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    const insetBottom = Math.min(viewInsetBottomRef.current, height * 0.8);
    const insetRight = Math.min(viewInsetRightRef.current, width * 0.6);
    if (insetBottom > 0 || insetRight > 0) camera.setViewOffset(width, height, insetRight / 2, insetBottom / 2, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    requestRenderRef.current();
  }, []);
  applyViewInsetRef.current = applyViewInset;
  // True while the whole model is on screen at a sensible size (not zoomed in
  // on a detail, not a speck): then a change in the free area, like the info
  // sheet folding away, should re-fit it to the new area.
  const wholeModelInView = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera || modelsRef.current.size === 0) return false;
    const box = getSceneBox(modelsRef.current.values());
    if (!box) return false;
    const b = withoutViewOffset(camera, () => ndcBounds(camera, boxCorners(box)));
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    return w <= 2.05 && h <= 2.05 && Math.max(w, h) >= 0.7;
  }, []);
  const setViewInsets = useCallback(
    ({ bottom = 0, right = 0 }) => {
      viewInsetBottomRef.current = Math.max(0, bottom || 0);
      viewInsetRightRef.current = Math.max(0, right || 0);
      // Once something has been selected the sheet opening and closing must not move the camera at all:
      // the insets are only remembered, and the next explicit camera move (Home, zoom to, views) applies them.
      if (selectionTouchedRef.current) return;
      applyViewInset();
      if (autoFramedRef.current || fitByFocusRef.current || wholeModelInView()) refitModel(true);
    },
    [applyViewInset, refitModel, wholeModelInView],
  );

  // One linear zoom step (positive = in) toward the middle of the view, for
  // the + / - buttons and keys.
  const zoomStep = useCallback((direction) => {
    zoomStepRef.current(direction * ZOOM.keyNotches);
  }, []);
  // + / = zoom in, - zoom out, 0 fits the whole model (Home).
  useEffect(() => {
    const onKey = (event) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === "+" || event.key === "=") zoomStep(1);
      else if (event.key === "-" || event.key === "_") zoomStep(-1);
      else if (event.key === "0") resetView();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomStep, resetView]);

  const clearError = useCallback(() => {
    setError(null);
    setErrorInfo(null);
    setLoadFailed(false);
  }, []);
  const clearSelection = useCallback(() => {
    clearHighlightRef.current?.();
    selectedHitRef.current = null;
    setSelectedElement(null);
  }, []);

  const viewFeatures = useViewFeatures({
    cameraRef,
    controlsRef,
    modelsGroupRef,
    modelsRef,
    rendererRef,
    sceneRef,
    requestRenderRef,
    autoFramedRef,
    cameraAnimRef,
    cancelCameraAnim,
    getVisibleFrac,
    helpers: { getSceneBox, computeFit, applyPose },
    models,
    isLoading,
    isolatedKeys,
    isolateKeys,
    showToast,
    clipPlaneManagerRef,
    clipPlanes,
    setClipPlanes,
    pushUndo,
    flipClipPlane,
    removeClipPlane,
    zoomStep,
    zoomLimit,
  });

  const browser = useModelBrowser({
    models,
    selectedElement,
    modelsRef,
    pipelineRef,
    requestRenderRef,
    invalidateGroupSphereRef,
    selectedHitRef,
    clearSelection,
    selectElementFromRef,
    pushUndo,
    renderForAWhile,
  });

  // Cases (src/cases/viewerAdapter.js): capture/restore the view and the picture. Reads the latest refs lazily.
  const casesDepsRef = useRef(null);
  casesDepsRef.current = {
    cameraRef, controlsRef, modelsGroupRef, modelsRef, rendererRef, sceneRef, requestRenderRef, clipPlaneManagerRef, setClipPlanes,
    hiddenCategoriesRef, isolatedKeysRef, setIsolatedKeys, applyIsolation, setCategoryHidden, cancelCameraAnim, cameraAnimRef, autoFramedRef, applyPose,
    clearSelection, pipelineRef, invalidateGroupSphereRef, setFlat: viewFeatures.setFlat, raycastVisibleRef, getVisibleFrac,
    levels: () => viewFeatures.levels,
    models: () => models,
    spacesShown: () => spaces.shown,
    levelSel: () => viewFeatures.levels.find((l) => l.id === viewFeatures.levelSel?.id) || null,
  };
  const casesAdapterRef = useRef(null);
  casesAdapterRef.current ||= createViewerAdapter(() => casesDepsRef.current);

  return {
    cases: casesAdapterRef.current,
    viewFeatures,
    spaceControl,
    browser,
    containerRef,
    models,
    isLoading,
    loadingLabel,
    error,
    ready,
    loadFiles,
    saveAsIfcZip,
    confirmReplace,
    confirmReplaceAnswer,
    setVisible,
    setModelColor,
    removeModel,
    removeAllModels,
    renameLoadedModel,
    resetView,
    clearError,
    setError,
    clipPlanes,
    setClipPlaneEnabled,
    setClipPlaneGizmoVisible,
    flipClipPlane,
    removeClipPlane,
    contextMenu,
    closeContextMenu,
    createClipPlaneHere,
    setActiveClipPlane,
    hideElementHere,
    resetVisibility,
    cameraClipEnabled,
    setCameraClipEnabled,
    cameraClipDistance,
    cameraClipMax,
    setCameraClipDistance,
    selectedElement,
    selectedElementLoading,
    clearSelection,
    measurements,
    measureModeActive,
    toggleMeasureMode,
    removeMeasurement,
    setMeasurementLeg,
    measureDeletePopup,
    closeMeasureDeletePopup,
    measureLegEditPopup,
    closeMeasureLegEditPopup,
    searchQuery,
    setSearchQuery,
    searchResults,
    isolatedKeys,
    toggleIsolate,
    clearIsolation,
    northOffsetDeg,
    setNorthOffset,
    compassAngleDeg,
    tagToolActive,
    toggleTagTool,
    tagsVisible,
    toggleTagsVisibility,
    categoryHideModeActive,
    toggleCategoryHideMode,
    hiddenCategories,
    setCategoryHidden,
    pinnedDimensionTags,
    unpinDimensionTag,
    clearAllDimensionPins,
    undo,
    redo,
    canUndo: historyCounts.undo > 0,
    canRedo: historyCounts.redo > 0,
    hideSelectedElement,
    setViewInsets,
    clipMoveMode,
    setClipMoveMode,
    toast,
    dismissToast,
    showToast,
    zoomToSelection,
    isolateSelection,
    zoomToElementHere,
    isolateElementHere,
    copyGuidHere,
    hoverLabelRef,
    loadFailed,
    errorInfo,
    retryLoad,
    cancelLoad,
  };
}

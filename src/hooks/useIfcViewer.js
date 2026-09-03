import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const IFC_EXTENSION = /\.ifc$/i;

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
function renderForAWhile(requestRender, durationMs = 1000) {
  const deadline = performance.now() + durationMs;
  const tick = () => {
    requestRender();
    if (performance.now() < deadline) requestAnimationFrame(tick);
  };
  tick();
}

// `object` reflects the *current* world transform (including any rotation
// applied by the arcball drag below), unlike the fragments library's own
// `model.box`, which is fixed at load time and would go stale once the
// model group starts rotating.
function getSceneBox(entries) {
  const box = new THREE.Box3();
  let hasContent = false;
  for (const { object } of entries) {
    if (!object.visible) continue;
    const objectBox = new THREE.Box3().setFromObject(object);
    if (!objectBox.isEmpty()) {
      box.union(objectBox);
      hasContent = true;
    }
  }
  return hasContent ? box : null;
}

function frameCameraOnScene(camera, controls, entries) {
  const box = getSceneBox(entries);
  if (!box) return;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const distance = maxDim * 1.5;

  controls.target.copy(center);
  camera.position.set(
    center.x + distance,
    center.y + distance * 0.8,
    center.z + distance,
  );
  camera.near = Math.max(distance / 1000, 0.01);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  controls.update();
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
  const modelNamesRef = useRef(new Map()); // modelId -> display name, kept in sync with `models` state
  const invalidateGroupSphereRef = useRef(() => {});
  const requestRenderRef = useRef(() => {});
  const pendingSurfacePickRef = useRef(null); // { id, promise } | null
  const clearHighlightRef = useRef(() => {});
  const cameraClipPlaneRef = useRef(new THREE.Plane());
  const cameraClipEnabledRef = useRef(false);
  const cameraClipDistanceRef = useRef(1);
  const measureManagerRef = useRef(null); // { addPoint, cancelPending, remove, list } | null
  const measureModeActiveRef = useRef(false);

  const [models, setModels] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("");
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [clipPlanes, setClipPlanes] = useState([]); // [{ id, enabled, gizmoVisible }]
  const [contextMenu, setContextMenu] = useState(null); // { x, y } | null
  const [cameraClipEnabled, setCameraClipEnabledState] = useState(false);
  const [cameraClipDistance, setCameraClipDistanceState] = useState(1);
  const [selectedElement, setSelectedElement] = useState(null);
  const [selectedElementLoading, setSelectedElementLoading] = useState(false);
  const [measureModeActive, setMeasureModeActiveState] = useState(false);
  const [measurements, setMeasurements] = useState([]); // [{ id, dx, dy, dz }]

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let disposed = false;
    const loadedModels = modelsRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1b1e24);
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
    let lastZoomTickPos = null; // { clientX, clientY } | null
    let lastZoomDistance = null; // number | null
    const invalidateGroupSphere = () => {
      groupSphereLocal = null;
      modelSpheresLocal = null;
      zoomHitCache = null;
      lastZoomTickPos = null;
      lastZoomDistance = null;
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
        spheres.push({
          center: modelsGroup.localToWorld(local.center.clone()),
          radius: Math.max(local.radius, 0.001),
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

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.localClippingEnabled = true;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    // Mouse-wheel zoom is intercepted and replaced by the cursor-relative
    // version below (see onZoomWheel), but zoomToCursor/enableZoom stay
    // on so two-finger touch pinch-zoom — which OrbitControls handles
    // via an entirely separate (non-'wheel') code path gated on these
    // same flags — keeps working on mobile exactly as before.
    controls.zoomToCursor = true;
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
    const gizmoGeometry = new THREE.PlaneGeometry(1, 1);
    const GIZMO_UP = new THREE.Vector3(0, 0, 1); // PlaneGeometry lies in XY, facing +Z

    const refreshClippingPlanes = () => {
      const planes = clipPlanesRuntime.filter((p) => p.enabled).map((p) => p.worldPlane);
      if (cameraClipEnabledRef.current) planes.push(cameraClipPlaneRef.current);
      renderer.clippingPlanes = planes;
      requestRender();
    };

    // Repositions/reorients/rescales a plane's gizmo mesh from its local
    // plane definition. Only needs to run when the local plane itself
    // changes (creation, flip, drag) or the model's overall scale
    // reference changes — not every frame, since the mesh is parented
    // under modelsGroup and inherits its rotation automatically.
    const syncGizmoMesh = (entry) => {
      const { localPlane, mesh } = entry;
      const sphere = getGroupSphere();
      const scale = sphere ? Math.max(sphere.radius * 2.6, 1) : 10;
      const pointOnPlaneLocal = localPlane.normal.clone().multiplyScalar(-localPlane.constant);
      // The gizmo sits exactly at the clip plane's own boundary — which
      // this very plane also clips against — so at that exact distance,
      // GPU floating-point clip-distance evaluation is right at the
      // zero/epsilon threshold and flickers per-fragment (a sparse,
      // dithered dropout pattern) between clipped and kept. Nudge it a
      // hair into the kept region (along +normal) so it renders solidly;
      // the offset is far too small relative to the gizmo's own size to
      // be visually distinguishable from sitting exactly on the plane.
      const KEPT_SIDE_EPSILON = scale * 0.002;
      mesh.position.copy(pointOnPlaneLocal).addScaledVector(localPlane.normal, KEPT_SIDE_EPSILON);
      mesh.quaternion.setFromUnitVectors(GIZMO_UP, localPlane.normal);
      // PlaneGeometry(1, 1) is a unit square (half-width 0.5), so scale by
      // ~2x the radius to get a comparable span to what a radius-1.3x
      // circle would have covered.
      mesh.scale.setScalar(scale);
    };

    const clipPlaneManager = {
      add: (localNormal, localPoint) => {
        const id = `clip-${++clipPlaneUid}`;
        const localPlane = new THREE.Plane();
        localPlane.normal.copy(localNormal);
        localPlane.constant = -localPlane.normal.dot(localPoint);
        const material = new THREE.MeshBasicMaterial({
          color: 0x3b82f6,
          transparent: true,
          opacity: 0.25,
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
        const entry = {
          id,
          localPlane,
          worldPlane: new THREE.Plane(),
          mesh,
          enabled: true,
          gizmoVisible: true,
        };
        syncGizmoMesh(entry);
        clipPlanesRuntime.push(entry);
        refreshClippingPlanes();
        return id;
      },
      remove: (id) => {
        const index = clipPlanesRuntime.findIndex((p) => p.id === id);
        if (index === -1) return;
        const [entry] = clipPlanesRuntime.splice(index, 1);
        modelsGroup.remove(entry.mesh);
        entry.mesh.material.dispose();
        refreshClippingPlanes();
      },
      flip: (id) => {
        const entry = clipPlanesRuntime.find((p) => p.id === id);
        if (!entry) return;
        entry.localPlane.normal.negate();
        entry.localPlane.constant *= -1;
        syncGizmoMesh(entry);
        requestRender();
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
        entry.mesh.visible = visible;
        requestRender();
      },
      list: () =>
        clipPlanesRuntime.map((p) => ({ id: p.id, enabled: p.enabled, gizmoVisible: p.gizmoVisible })),
      refreshClippingPlanes,
    };
    clipPlaneManagerRef.current = clipPlaneManager;

    // Measure tool: click point A, then point B, and record the local-space
    // (modelsGroup frame) difference between them. Points/line/markers are
    // parented under modelsGroup (like the clip-plane gizmos above) so they
    // inherit model rotation for free instead of needing per-frame transform
    // math the way the transient, world-fixed pivotMarker does.
    const measurementsRuntime = []; // { id, markerA, markerB, line, legX, legY, legZ, label, dx, dy, dz, length }
    const measureMarkerGeometry = new THREE.SphereGeometry(1, 12, 12);
    const MEASURE_MARKER_PIXELS = 5;
    const MEASURE_LABEL_PIXEL_HEIGHT = 28;
    let measurePendingPoint = null; // THREE.Vector3 (modelsGroup-local) | null
    let measurePendingMarker = null; // THREE.Mesh | null
    let measureUid = 0;

    const createMeasureMarker = () => {
      const marker = new THREE.Mesh(
        measureMarkerGeometry,
        new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
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
      const geometry = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const material = new THREE.LineBasicMaterial({ color, depthTest: false });
      const leg = new THREE.Line(geometry, material);
      leg.renderOrder = 999;
      modelsGroup.add(leg);
      return leg;
    };

    // A billboard-style text label showing a measurement's length and
    // ΔX/ΔY/ΔZ (colored to match the sidebar), drawn onto one shared canvas
    // per measurement and rescaled per frame like the markers above.
    // THREE.Sprite auto-faces the camera, so no projection math is
    // needed. Dragging an endpoint (below) redraws this same canvas in
    // place via updateMeasureLabelText rather than recreating it.
    const drawMeasureLabelCanvas = (canvas, ctx, lines) => {
      const font = "600 26px sans-serif";
      const lineHeight = 32;
      const paddingX = 20;
      const paddingY = 12;
      ctx.font = font;
      const width = Math.max(...lines.map((l) => ctx.measureText(l.text).width));
      canvas.width = Math.ceil(width + paddingX * 2);
      canvas.height = Math.ceil(lineHeight * lines.length + paddingY * 2);
      // Resizing the canvas resets all context state, so font/fill/etc.
      // must be re-applied below.
      ctx.font = font;
      ctx.fillStyle = "rgba(27, 30, 36, 0.85)";
      ctx.beginPath();
      ctx.roundRect(0, 0, canvas.width, canvas.height, 10);
      ctx.fill();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      lines.forEach((line, i) => {
        ctx.fillStyle = line.color;
        ctx.fillText(line.text, canvas.width / 2, paddingY + lineHeight * (i + 0.5));
      });
    };
    const createMeasureLabel = (lines) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      drawMeasureLabelCanvas(canvas, ctx, lines);

      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
      const sprite = new THREE.Sprite(material);
      sprite.renderOrder = 1000;
      sprite.userData = { canvas, ctx, aspect: canvas.width / canvas.height };
      modelsGroup.add(sprite);
      return sprite;
    };
    const updateMeasureLabelText = (sprite, lines) => {
      drawMeasureLabelCanvas(sprite.userData.canvas, sprite.userData.ctx, lines);
      sprite.userData.aspect = sprite.userData.canvas.width / sprite.userData.canvas.height;
      sprite.material.map.needsUpdate = true;
    };
    const measureLabelLines = (dx, dy, dz, length) => [
      { text: `${length.toFixed(3)} m`, color: "#e8eaed" },
      { text: `ΔX: ${dx.toFixed(3)} m`, color: "#ef4444" },
      { text: `ΔY: ${dy.toFixed(3)} m`, color: "#22c55e" },
      { text: `ΔZ: ${dz.toFixed(3)} m`, color: "#3b82f6" },
    ];

    const measureManager = {
      // Returns "started" after recording point A, "completed" after B
      // finishes a measurement.
      addPoint: (localPoint) => {
        if (measurePendingPoint === null) {
          measurePendingPoint = localPoint;
          measurePendingMarker = createMeasureMarker();
          measurePendingMarker.position.copy(localPoint);
          requestRender();
          return "started";
        }
        const a = measurePendingPoint;
        const b = localPoint;
        const markerA = measurePendingMarker;
        const markerB = createMeasureMarker();
        markerB.position.copy(b);
        const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
        const material = new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false });
        const line = new THREE.Line(geometry, material);
        line.renderOrder = 999;
        modelsGroup.add(line);
        // Right-angle "dogleg" path from a to b via two corners, visually
        // breaking the straight-line hypotenuse above into its X/Y/Z
        // axis contributions (each leg's own length equals dx/dy/dz).
        const cornerX = new THREE.Vector3(b.x, a.y, a.z);
        const cornerXY = new THREE.Vector3(b.x, b.y, a.z);
        const legX = createMeasureLeg(a, cornerX, 0xef4444);
        const legY = createMeasureLeg(cornerX, cornerXY, 0x22c55e);
        const legZ = createMeasureLeg(cornerXY, b, 0x3b82f6);
        const length = a.distanceTo(b);
        const dx = Math.abs(b.x - a.x);
        const dy = Math.abs(b.y - a.y);
        const dz = Math.abs(b.z - a.z);
        const label = createMeasureLabel(measureLabelLines(dx, dy, dz, length));
        label.position.copy(a).add(b).multiplyScalar(0.5);
        measurementsRuntime.push({
          id: `measure-${++measureUid}`,
          markerA,
          markerB,
          line,
          legX,
          legY,
          legZ,
          label,
          dx,
          dy,
          dz,
          length,
        });
        measurePendingPoint = null;
        measurePendingMarker = null;
        requestRender();
        return "completed";
      },
      cancelPending: () => {
        if (measurePendingMarker) {
          modelsGroup.remove(measurePendingMarker);
          measurePendingMarker.material.dispose();
          measurePendingMarker = null;
        }
        measurePendingPoint = null;
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
          entry.legX,
          entry.legY,
          entry.legZ,
          entry.label,
        );
        entry.markerA.material.dispose();
        entry.markerB.material.dispose();
        entry.line.geometry.dispose();
        entry.line.material.dispose();
        entry.legX.geometry.dispose();
        entry.legX.material.dispose();
        entry.legY.geometry.dispose();
        entry.legY.material.dispose();
        entry.legZ.geometry.dispose();
        entry.legZ.material.dispose();
        // Not entry.label.geometry: THREE.Sprite shares one module-level
        // geometry singleton across every sprite instance in the app —
        // disposing it here would break every other sprite too.
        entry.label.material.map.dispose();
        entry.label.material.dispose();
        requestRender();
      },
      list: () =>
        measurementsRuntime.map((m) => ({ id: m.id, dx: m.dx, dy: m.dy, dz: m.dz, length: m.length })),
    };
    measureManagerRef.current = measureManager;

    // Constant on-screen size for measurement markers (same technique as
    // scalePivotMarker below), since — unlike the transient pivot marker —
    // these persist and need to stay a sane size at any zoom level.
    const measureScratchVec3 = new THREE.Vector3();
    const scaleMeasureMarkers = () => {
      const worldPerPixelAt = (object) => {
        const distance = camera.position.distanceTo(object.getWorldPosition(measureScratchVec3));
        return (2 * Math.tan((camera.fov * Math.PI) / 360) * distance) / renderer.domElement.clientHeight;
      };
      const scaleOne = (marker) => {
        marker.scale.setScalar(worldPerPixelAt(marker) * MEASURE_MARKER_PIXELS);
      };
      const scaleLabel = (label) => {
        const height = worldPerPixelAt(label) * MEASURE_LABEL_PIXEL_HEIGHT;
        label.scale.set(height * label.userData.aspect, height, 1);
      };
      if (measurePendingMarker) scaleOne(measurePendingMarker);
      for (const entry of measurementsRuntime) {
        scaleOne(entry.markerA);
        scaleOne(entry.markerB);
        scaleLabel(entry.label);
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
      const activePlanes = renderer.clippingPlanes;
      if (activePlanes.length === 0) {
        const pipeline = pipelineRef.current;
        return pipeline ? pipeline.fragments.raycast(data) : null;
      }
      const allHits = [];
      for (const entry of modelsRef.current.values()) {
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

    // Right-click opens a context menu (see App.jsx) instead of the
    // browser's native one. Kick off the surface raycast immediately so
    // it's ready (or close to it) by the time the user picks a menu item;
    // the menu itself opens without waiting on it.
    let contextMenuSeq = 0;
    const onContextMenu = (event) => {
      event.preventDefault();
      const id = ++contextMenuSeq;
      const promise = raycastVisible(event.clientX, event.clientY).catch((err) => {
        console.error("Surface pick failed", err);
        return null;
      });
      pendingSurfacePickRef.current = { id, promise };
      setContextMenu({ x: event.clientX, y: event.clientY });
    };
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    // Escape while measuring: cancel just the pending point A if one's
    // been placed (so the tool stays armed for a fresh A), otherwise exit
    // measure mode entirely.
    const onMeasureKeyDown = (event) => {
      if (event.key !== "Escape") return;
      if (measurePendingPoint !== null) {
        measureManager.cancelPending();
      } else if (measureModeActiveRef.current) {
        measureModeActiveRef.current = false;
        setMeasureModeActiveState(false);
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
      new THREE.MeshBasicMaterial({ color: 0xff6a00, depthTest: false }),
    );
    pivotMarker.visible = false;
    pivotMarker.renderOrder = 999;
    scene.add(pivotMarker);

    const scalePivotMarker = () => {
      if (!pivotMarker.visible) return;
      const distance = camera.position.distanceTo(pivotMarker.position);
      const worldPerPixel =
        (2 * Math.tan((camera.fov * Math.PI) / 360) * distance) /
        renderer.domElement.clientHeight;
      pivotMarker.scale.setScalar(worldPerPixel * PIVOT_MARKER_PIXELS);
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
    const cameraQuatStart = new THREE.Quaternion();
    const groupQuatStart = new THREE.Quaternion();
    const groupPosStart = new THREE.Vector3();
    const raycaster = new THREE.Raycaster();
    const WORLD_UP = new THREE.Vector3(0, 1, 0);
    const EPS = 0.001;

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
      if (event.ctrlKey) return; // handled by onCtrlWheel instead
      if (event.target !== renderer.domElement && !renderer.domElement.contains(event.target)) {
        return;
      }
      if (event.shiftKey) {
        if (tryShiftScrollClipPlane(event)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        // Shift held but the cursor isn't over any clip-plane gizmo —
        // fall through to normal zoom below.
      }
      event.preventDefault();
      event.stopPropagation();
      const ndc = getNdc(event);
      raycaster.setFromCamera(ndc, camera);
      const dir = raycaster.ray.direction; // camera -> into the scene, through the cursor

      const cacheValid =
        zoomHitCache &&
        Math.hypot(
          zoomHitCache.clientX - event.clientX,
          zoomHitCache.clientY - event.clientY,
        ) <= CACHE_PIXEL_TOLERANCE;

      let cursorPoint;
      if (cacheValid) {
        cursorPoint = zoomHitCache.point;
      } else {
        const hit = nearestModelHit(raycaster.ray.origin, dir);
        const sphere = getGroupSphere();
        cursorPoint = hit
          ? hit.point
          : sphere
            ? raySphereProject(ndc, sphere.center, sphere.radius)
            : controls.target;
      }

      const rawPrevDistance = camera.position.distanceTo(cursorPoint);
      const samePositionAsLastTick =
        lastZoomTickPos &&
        Math.hypot(
          lastZoomTickPos.clientX - event.clientX,
          lastZoomTickPos.clientY - event.clientY,
        ) <= CACHE_PIXEL_TOLERANCE;

      let prevDistance = rawPrevDistance;
      if (samePositionAsLastTick && lastZoomDistance != null) {
        // Bound how far the distance basis can jump in a single tick
        // relative to where the last tick left off. A legitimate zoom
        // tick only moves the camera by a small fraction of prevDistance
        // (scale is always close to 1 for a normal wheel delta), so this
        // only ever engages for a genuinely anomalous jump — e.g. a
        // raycast that skipped through a window's missing glazing to a
        // wall meters behind it — without limiting normal zoom speed at
        // all, in either direction.
        const MAX_TICK_RATIO = 1.5;
        prevDistance = Math.min(
          Math.max(rawPrevDistance, lastZoomDistance / MAX_TICK_RATIO),
          lastZoomDistance * MAX_TICK_RATIO,
        );
      }
      // Same formula OrbitControls' own default zoomSpeed uses, so
      // scroll "feel" (speed scaling with how hard/fast you scroll) is
      // unchanged — only the distance basis changes.
      const scale = Math.pow(0.95, Math.abs(event.deltaY) * 0.01);
      const zoomingIn = event.deltaY < 0;
      const rawDistance = zoomingIn ? prevDistance * scale : prevDistance / scale;
      const minDistance = Math.max(camera.near * 4, 1e-3);
      const newDistance = Math.max(rawDistance, minDistance);
      const radiusDelta = prevDistance - newDistance;

      camera.position.addScaledVector(dir, radiusDelta);

      // Keep target exactly on the camera's *current* forward axis (not
      // at cursorPoint, which is generally off-center) so the next
      // controls.update()'s unconditional object.lookAt(target) is a
      // no-op and doesn't reorient the camera — only its distance
      // changes. Mirrors what OrbitControls' own zoomToCursor does after
      // a cursor-biased dolly.
      const forward = camera.getWorldDirection(new THREE.Vector3());
      controls.target.copy(camera.position).addScaledVector(forward, newDistance);

      lastZoomTickPos = { clientX: event.clientX, clientY: event.clientY };
      lastZoomDistance = newDistance;

      requestRender();

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
      refreshZoomHitCache(event.clientX, event.clientY);
    };
    renderer.domElement.addEventListener("pointermove", onZoomHoverMove);

    const applyRotation = (ndc) => {
      const theta = startTheta - Math.PI * (ndc.x - startNdcX);
      // + on the elevation term: ndc.y grows upward, and dragging up
      // should tip the model's top away from you (equivalently, raise
      // the virtual camera), matching OrbitControls' vertical direction.
      const phi = Math.max(
        EPS,
        Math.min(Math.PI - EPS, startPhi + Math.PI * (ndc.y - startNdcY)),
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
      color: new THREE.Color(0xff0000),
      transparent: true,
      opacity: 0.45,
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
        overlay.geometry.dispose();
        overlay.material.dispose();
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

    const selectElementFrom = async (raycastPromise) => {
      if (!raycastPromise) {
        clearHighlight();
        setSelectedElement(null);
        return;
      }
      setSelectedElementLoading(true);
      try {
        const hit = await raycastPromise;
        if (!hit) {
          clearHighlight();
          setSelectedElement(null);
          return;
        }
        clearHighlight();
        showHighlightFill(hit).catch((err) => console.error("Highlight fill failed", err));
        const [data] = await hit.fragments.getItemsData([hit.localId], {
          attributesDefault: true,
          relations: {
            IsDefinedBy: { attributes: true, relations: true },
            IsTypedBy: { attributes: true, relations: false },
          },
        });
        const modelName = modelNamesRef.current.get(hit.fragments.modelId);
        setSelectedElement(data ? formatElementData(data, modelName) : null);
      } catch (err) {
        console.error("Failed to fetch element properties", err);
        setSelectedElement(null);
      } finally {
        setSelectedElementLoading(false);
      }
    };

    const handleMeasureClick = async (raycastPromise) => {
      if (!raycastPromise) return;
      const hit = await raycastPromise;
      if (!hit) return;
      modelsGroup.updateMatrixWorld(true);
      const localPoint = modelsGroup.worldToLocal(hit.point.clone());
      if (measureManager.addPoint(localPoint) === "completed") {
        setMeasurements(measureManager.list());
      }
    };

    let activePointerId = null;
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

      if (typeof event.clientX === "number" && typeof event.clientY === "number") {
        const moved = Math.hypot(event.clientX - downClientX, event.clientY - downClientY);
        if (moved < CLICK_MOVE_THRESHOLD) {
          if (measureModeActiveRef.current) {
            handleMeasureClick(pivotRaycastPromise);
          } else {
            selectElementFrom(pivotRaycastPromise);
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

    const applyMeasureMarkerDrag = (hit) => {
      const entry = measurementsRuntime.find((m) => m.id === draggingMeasurePoint.entryId);
      if (!entry) return; // measurement was deleted mid-drag
      modelsGroup.updateMatrixWorld(true);
      const marker = draggingMeasurePoint.which === "A" ? entry.markerA : entry.markerB;
      marker.position.copy(modelsGroup.worldToLocal(hit.point.clone()));

      const a = entry.markerA.position;
      const b = entry.markerB.position;
      const pos = entry.line.geometry.attributes.position;
      pos.setXYZ(0, a.x, a.y, a.z);
      pos.setXYZ(1, b.x, b.y, b.z);
      pos.needsUpdate = true;
      entry.line.geometry.computeBoundingSphere();

      const cornerX = { x: b.x, y: a.y, z: a.z };
      const cornerXY = { x: b.x, y: b.y, z: a.z };
      const setLeg = (leg, p1, p2) => {
        const legPos = leg.geometry.attributes.position;
        legPos.setXYZ(0, p1.x, p1.y, p1.z);
        legPos.setXYZ(1, p2.x, p2.y, p2.z);
        legPos.needsUpdate = true;
        leg.geometry.computeBoundingSphere();
      };
      setLeg(entry.legX, a, cornerX);
      setLeg(entry.legY, cornerX, cornerXY);
      setLeg(entry.legZ, cornerXY, b);

      entry.dx = Math.abs(b.x - a.x);
      entry.dy = Math.abs(b.y - a.y);
      entry.dz = Math.abs(b.z - a.z);
      entry.length = a.distanceTo(b);
      entry.label.position.copy(a).add(b).multiplyScalar(0.5);
      updateMeasureLabelText(entry.label, measureLabelLines(entry.dx, entry.dy, entry.dz, entry.length));

      setMeasurements(measureManager.list());
      requestRender();
    };
    const onMeasureMarkerDragMove = (event) => {
      if (!draggingMeasurePoint) return;
      measureDragPendingClient = { clientX: event.clientX, clientY: event.clientY };
    };
    const onMeasureMarkerDragEnd = () => {
      draggingMeasurePoint = null;
      measureDragPendingClient = null;
      measureDragGeneration++; // discard any raycast still in flight from this drag
      window.removeEventListener("pointermove", onMeasureMarkerDragMove);
      window.removeEventListener("pointerup", onMeasureMarkerDragEnd);
      requestRender();
    };
    // Returns true if a drag was started (caller should not also start a
    // rotate gesture, or the measure tool's click-to-place, for this
    // same pointerdown).
    const tryStartMeasureMarkerDrag = (event) => {
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
      if (hits.length === 0) return false;
      const hit = owner.get(hits[0].object);
      if (!hit) return false;

      event.preventDefault();
      event.stopPropagation();
      draggingMeasurePoint = { entryId: hit.entry.id, which: hit.which };
      measureDragGeneration++;
      measureDragPendingClient = { clientX: event.clientX, clientY: event.clientY };
      measureDragRaycastBusy = false;
      window.addEventListener("pointermove", onMeasureMarkerDragMove);
      window.addEventListener("pointerup", onMeasureMarkerDragEnd);
      return true;
    };

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
      draggingClipPlaneId = null;
      dragAxisWorld = null;
      dragAxisPointWorld = null;
      window.removeEventListener("pointermove", onClipPlaneDragMove);
      window.removeEventListener("pointerup", onClipPlaneDragEnd);
    };
    // Returns true if a drag was started (caller should not also start a
    // rotate gesture for this same pointerdown).
    const tryStartClipPlaneDrag = (event) => {
      if (!event.shiftKey || event.button !== 0) return false;
      const hittable = clipPlanesRuntime.filter((p) => p.gizmoVisible).map((p) => p.mesh);
      if (hittable.length === 0) return false;
      const ndc = getNdc(event);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(hittable, false);
      if (hits.length === 0) return false;
      const entry = clipPlanesRuntime.find((p) => p.mesh === hits[0].object);
      if (!entry) return false;

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
      return true;
    };

    const CLIP_PLANE_SCROLL_SENSITIVITY = 0.00025; // fraction of model radius moved per deltaY unit
    const CLIP_PLANE_SCROLL_MAX_STEP = 0.005; // cap: max fraction of model radius per single wheel event
    // Shift+scroll moves whichever clip plane's gizmo is currently under
    // the cursor along its own normal — same disambiguation as the
    // shift+drag gesture above (hit-test the gizmo actually being
    // pointed at), since with multiple planes there's no single
    // unambiguous "the" plane a keyboard-modified scroll could target
    // otherwise (see the removed ctrl+scroll comment near onCtrlWheel).
    const tryShiftScrollClipPlane = (event) => {
      const hittable = clipPlanesRuntime.filter((p) => p.gizmoVisible).map((p) => p.mesh);
      if (hittable.length === 0) return false;
      raycaster.setFromCamera(getNdc(event), camera);
      const hits = raycaster.intersectObjects(hittable, false);
      if (hits.length === 0) return false;
      const entry = clipPlanesRuntime.find((p) => p.mesh === hits[0].object);
      if (!entry) return false;

      const sphere = getGroupSphere();
      const radius = sphere ? sphere.radius : 1;
      // Clamp the per-event step to a small fraction of the model's own
      // size, so an outsized deltaY spike (trackpad flings can report
      // deltaY in the thousands) can never move the plane far in one
      // tick — movement always stays gentle regardless of input device.
      const rawStep = -event.deltaY * CLIP_PLANE_SCROLL_SENSITIVITY * radius;
      const maxStep = radius * CLIP_PLANE_SCROLL_MAX_STEP;
      const step = Math.max(-maxStep, Math.min(maxStep, rawStep));

      entry.localPlane.constant += step;
      syncGizmoMesh(entry);
      requestRender();
      return true;
    };

    const onRotateStart = (event) => {
      if (tryStartMeasureMarkerDrag(event)) return;
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

      const pipeline = pipelineRef.current;
      // Also reused by onRotateEnd for element selection if this turns
      // out to be a click rather than a drag — same screen position, no
      // need to raycast twice. raycastVisible skips anything hidden
      // behind an active clip plane, so rotating/selecting after a cut
      // pivots on what's actually on screen.
      pivotRaycastPromise = pipeline ? raycastVisible(event.clientX, event.clientY) : Promise.resolve(null);
      pivotRaycastPromise
        .then((hit) => {
          // The gesture already ended (a fast click-and-release faster
          // than the raycast) or was superseded by a newer one — nothing
          // left to anchor.
          if (!pivotPending || gestureId !== gestureSeq) return;
          pivotPending = false;
          const ndc = pendingNdc ?? startNdc;
          // hit.point is already expressed in modelsGroup's *current*
          // frame (the fragments library converts its local-space hit
          // to world space using matrixWorld as of when the raycast
          // resolves), which is exactly the frame anchorGesture needs.
          // A miss (click landed on empty space, or the pipeline wasn't
          // ready) falls back to the closest model actually under the
          // cursor, or as a last resort the whole-group bounding sphere.
          let pivotPoint = hit ? hit.point : null;
          if (!pivotPoint) {
            raycaster.setFromCamera(ndc, camera);
            pivotPoint =
              nearestModelHit(raycaster.ray.origin, raycaster.ray.direction)?.point ??
              raySphereProject(ndc, sphere.center, rotateRadius);
          }
          anchorGesture(ndc, pivotPoint);
          rotating = true;
        })
        .catch((err) => console.error("Pivot raycast failed", err));
    };
    renderer.domElement.addEventListener("pointerdown", onRotateStart);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5);
    directionalLight.position.set(20, 30, 15);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    fillLight.position.set(-20, 10, -15);
    scene.add(ambientLight, directionalLight, fillLight);

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
      // the previous raycast clears.
      if (draggingMeasurePoint && measureDragPendingClient && !measureDragRaycastBusy) {
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
      controls.update();
      pipelineRef.current?.fragments.core.update();
      if (!needsRender) return;
      needsRender = false;
      scalePivotMarker();
      scaleMeasureMarkers();
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
      renderer.setSize(width, height);
      requestRender();
    });
    resizeObserver.observe(container);

    // Loaded lazily so the canvas/UI can paint first — this pulls in
    // @thatopen/components, the fragments worker, and the web-ifc wasm
    // setup, which would otherwise be part of the initial JS the browser
    // has to parse/execute before anything is on screen.
    import("../ifc/setupComponents")
      .then(({ createIfcPipeline }) => createIfcPipeline())
      .then((pipeline) => {
        if (disposed) return;
        pipelineRef.current = pipeline;
        setReady(true);
      })
      .catch((err) => {
        console.error("Failed to initialize IFC pipeline", err);
        if (!disposed) {
          setError(
            "Failed to initialize the IFC parsing engine. Try reloading the page.",
          );
        }
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onRotateStart);
      renderer.domElement.removeEventListener(
        "mousedown",
        suppressMiddleClickAutoscroll,
      );
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onMeasureKeyDown);
      window.removeEventListener("wheel", onZoomWheel, { capture: true });
      renderer.domElement.removeEventListener("pointermove", onZoomHoverMove);
      window.removeEventListener("wheel", onCtrlWheel, { capture: true });
      window.removeEventListener("pointermove", onRotateMove);
      window.removeEventListener("pointerup", onRotateEnd);
      window.removeEventListener("pointermove", onClipPlaneDragMove);
      window.removeEventListener("pointerup", onClipPlaneDragEnd);
      window.removeEventListener("pointermove", onMeasureMarkerDragMove);
      window.removeEventListener("pointerup", onMeasureMarkerDragEnd);
      for (const entry of clipPlanesRuntime) {
        modelsGroup.remove(entry.mesh);
        entry.mesh.material.dispose();
      }
      gizmoGeometry.dispose();
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
    };
  }, []);

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

  const setCameraClipEnabled = useCallback((enabled) => {
    if (enabled) {
      // The kept region is whatever lies *beyond* cameraClipDistance
      // along the view direction. The slider's fixed range is [1, 2]
      // (the user's own chosen bounds, not scene-derived), so default to
      // its minimum on enable rather than 0, which is now out of range.
      cameraClipDistanceRef.current = 1;
      setCameraClipDistanceState(1);
    }
    setCameraClipEnabledState(enabled);
  }, []);

  const setCameraClipDistance = useCallback((value) => {
    cameraClipDistanceRef.current = value;
    setCameraClipDistanceState(value);
    requestRenderRef.current();
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const createClipPlaneHere = useCallback(async () => {
    const pending = pendingSurfacePickRef.current;
    setContextMenu(null);
    if (!pending) return;
    const hit = await pending.promise;
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

    manager.add(localNormal, localPoint);
    setClipPlanes(manager.list());
  }, []);

  const flipClipPlane = useCallback((id) => {
    clipPlaneManagerRef.current?.flip(id);
  }, []);

  const removeClipPlane = useCallback((id) => {
    const manager = clipPlaneManagerRef.current;
    if (!manager) return;
    manager.remove(id);
    setClipPlanes(manager.list());
  }, []);

  const toggleMeasureMode = useCallback(() => {
    const next = !measureModeActiveRef.current;
    measureModeActiveRef.current = next;
    setMeasureModeActiveState(next);
    if (!next) measureManagerRef.current?.cancelPending();
  }, []);

  const removeMeasurement = useCallback((id) => {
    const manager = measureManagerRef.current;
    if (!manager) return;
    manager.remove(id);
    setMeasurements(manager.list());
  }, []);

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

  const hideElementHere = useCallback(async () => {
    const pending = pendingSurfacePickRef.current;
    setContextMenu(null);
    if (!pending) return;
    const hit = await pending.promise;
    if (!hit || hit.localId == null) return;
    renderForAWhile(() => requestRenderRef.current());
    await hit.fragments.setVisible([hit.localId], false);
    // setVisible resolving only means the worker accepted the change, not
    // that the affected tiles have been rebuilt on the main thread yet —
    // forcing that to finish is a best effort (see renderForAWhile above
    // for the actual guarantee).
    await pipelineRef.current?.fragments.core.update(true);
    invalidateGroupSphereRef.current();
    requestRenderRef.current();
  }, []);

  const resetVisibility = useCallback(async () => {
    const entries = [...modelsRef.current.values()];
    renderForAWhile(() => requestRenderRef.current());
    await Promise.all(entries.map(({ model }) => model.resetVisible()));
    await pipelineRef.current?.fragments.core.update(true);
    invalidateGroupSphereRef.current();
    requestRenderRef.current();
  }, []);

  const loadFiles = useCallback(async (fileList) => {
    const pipeline = pipelineRef.current;
    const modelsGroup = modelsGroupRef.current;
    if (!pipeline || !modelsGroup) {
      setError("The viewer is still starting up. Please try again in a moment.");
      return;
    }

    const files = Array.from(fileList);
    if (files.length === 0) return;

    setError(null);
    setIsLoading(true);

    for (const file of files) {
      setLoadingLabel(`Parsing ${file.name}…`);
      if (!IFC_EXTENSION.test(file.name)) {
        setError((prev) =>
          prev
            ? `${prev} · "${file.name}" is not an .ifc file`
            : `"${file.name}" is not an .ifc file`,
        );
        continue;
      }

      const modelId = nextId();
      try {
        const buffer = await file.arrayBuffer();
        const data = new Uint8Array(buffer);
        const model = await pipeline.ifcLoader.load(data, true, modelId, {
          // Some IFC exporters produce geometry with inconsistent winding
          // (a face's front side doesn't reliably match its outward
          // normal), which front-face-only rendering shows as missing or
          // "inside-out" surfaces — visible from one side only, or only
          // when looking at the model from an angle that happens to hit
          // the actual front face. Render both faces so those surfaces
          // are never invisible, at the cost of some fill-rate.
          instanceCallback: (importer) => {
            importer.doubleSidedMaterials = true;
          },
        });

        if (cameraRef.current) model.useCamera(cameraRef.current);
        modelsGroup.add(model.object);
        modelsRef.current.set(modelId, { model, object: model.object });
        invalidateGroupSphereRef.current();
        requestRenderRef.current();

        setModels((prev) => [
          ...prev,
          { id: modelId, name: file.name, visible: true },
        ]);
      } catch (err) {
        console.error(`Failed to load ${file.name}`, err);
        setError((prev) => {
          const message = `Could not parse "${file.name}" — it doesn't look like a valid IFC file.`;
          return prev ? `${prev} · ${message}` : message;
        });
      }
    }

    // Let a few frames of streamed geometry land before measuring bounds.
    await pipeline.fragments.core.update(true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (cameraRef.current && controlsRef.current) {
      frameCameraOnScene(
        cameraRef.current,
        controlsRef.current,
        modelsRef.current.values(),
      );
    }

    setIsLoading(false);
    setLoadingLabel("");
  }, []);

  const setVisible = useCallback(
    (modelId, visible) => {
      const entry = modelsRef.current.get(modelId);
      if (entry) entry.object.visible = visible;
      invalidateGroupSphereRef.current();
      requestRenderRef.current();
      setModels((prev) =>
        prev.map((m) => (m.id === modelId ? { ...m, visible } : m)),
      );
    },
    [],
  );

  const removeModel = useCallback(async (modelId) => {
    const pipeline = pipelineRef.current;
    const modelsGroup = modelsGroupRef.current;
    const entry = modelsRef.current.get(modelId);

    if (entry && modelsGroup) modelsGroup.remove(entry.object);
    modelsRef.current.delete(modelId);
    invalidateGroupSphereRef.current();
    requestRenderRef.current();
    setModels((prev) => prev.filter((m) => m.id !== modelId));

    try {
      await pipeline?.fragments.core.disposeModel(modelId);
    } catch (err) {
      console.error(`Failed to dispose model ${modelId}`, err);
    }
  }, []);

  // "Home": back to the same framing new files get on load, with the
  // model's own orientation reset too (rotation is the only transform
  // the arcball drag ever applies to modelsGroup — it's never
  // translated — so resetting its quaternion to identity is enough to
  // undo any amount of dragging).
  const resetView = useCallback(() => {
    const modelsGroup = modelsGroupRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    if (modelsGroup) modelsGroup.quaternion.identity();
    frameCameraOnScene(camera, controls, modelsRef.current.values());
    requestRenderRef.current();
  }, []);

  const clearError = useCallback(() => setError(null), []);
  const clearSelection = useCallback(() => {
    clearHighlightRef.current?.();
    setSelectedElement(null);
  }, []);

  return {
    containerRef,
    models,
    isLoading,
    loadingLabel,
    error,
    ready,
    loadFiles,
    setVisible,
    removeModel,
    resetView,
    clearError,
    clipPlanes,
    setClipPlaneEnabled,
    setClipPlaneGizmoVisible,
    flipClipPlane,
    removeClipPlane,
    contextMenu,
    closeContextMenu,
    createClipPlaneHere,
    hideElementHere,
    resetVisibility,
    cameraClipEnabled,
    setCameraClipEnabled,
    cameraClipDistance,
    setCameraClipDistance,
    selectedElement,
    selectedElementLoading,
    clearSelection,
    measurements,
    measureModeActive,
    toggleMeasureMode,
    removeMeasurement,
  };
}

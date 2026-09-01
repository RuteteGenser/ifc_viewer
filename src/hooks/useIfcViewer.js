import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const IFC_EXTENSION = /\.ifc$/i;

let uid = 0;
function nextId() {
  uid += 1;
  return `model-${Date.now()}-${uid}`;
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
  const cameraClipPlaneRef = useRef(new THREE.Plane());
  const cameraClipEnabledRef = useRef(false);
  const cameraClipDistanceRef = useRef(1);

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

    // Ctrl+scroll used to move the (single) clip plane along its own
    // normal; that's now done by shift+dragging its gizmo instead (see
    // onClipPlaneDragMove below), since with multiple planes there's no
    // single unambiguous "the" plane for a keyboard-modified scroll to
    // target. Ctrl+wheel is still swallowed here (rather than left
    // unhandled) so it doesn't fall through to the browser's own
    // page-zoom — attached to `window` with `capture: true` so it runs,
    // and can stop the event, before OrbitControls' own wheel listener on
    // `renderer.domElement`; registration order alone wouldn't guarantee
    // that, since both would otherwise be listening on the very same
    // element.
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
    // Updated on every pointermove during a rotate gesture, so the async
    // pivot refinement below (which can resolve ~300ms after mousedown)
    // can tell whether the user has already moved enough for a pivot
    // swap to be a noticeable, unpredictable jump rather than an
    // invisible refinement.
    let lastClientX = 0;
    let lastClientY = 0;
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
        setSelectedElement(null);
        return;
      }
      setSelectedElementLoading(true);
      try {
        const hit = await raycastPromise;
        if (!hit) {
          setSelectedElement(null);
          return;
        }
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

    let activePointerId = null;
    let gestureSeq = 0;

    const onRotateMove = (event) => {
      if (!rotating || event.pointerId !== activePointerId) return;
      pendingNdc = getNdc(event);
      lastClientX = event.clientX;
      lastClientY = event.clientY;
    };
    const onRotateEnd = (event) => {
      if (event.pointerId !== activePointerId) return;
      rotating = false;
      activePointerId = null;
      pendingNdc = null;
      pivotMarker.visible = false;
      requestRender();
      window.removeEventListener("pointermove", onRotateMove);
      window.removeEventListener("pointerup", onRotateEnd);

      if (typeof event.clientX === "number" && typeof event.clientY === "number") {
        const moved = Math.hypot(event.clientX - downClientX, event.clientY - downClientY);
        if (moved < CLICK_MOVE_THRESHOLD) {
          selectElementFrom(pivotRaycastPromise);
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

    let draggingClipPlaneId = null;
    let dragAxisWorld = null; // THREE.Vector3 | null — world-space plane normal at drag start
    let dragAxisPointWorld = null; // THREE.Vector3 | null — a world-space point on that axis line
    let dragStartLocalConstant = 0;

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
      entry.localPlane.constant = dragStartLocalConstant - delta;
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

      draggingClipPlaneId = entry.id;
      dragAxisWorld = worldNormal;
      dragAxisPointWorld = pointOnPlaneWorld;
      dragStartLocalConstant = entry.localPlane.constant;

      window.addEventListener("pointermove", onClipPlaneDragMove);
      window.addEventListener("pointerup", onClipPlaneDragEnd);
      return true;
    };

    const onRotateStart = (event) => {
      if (tryStartClipPlaneDrag(event)) return;
      // A second touch point landing mid-drag means the gesture just
      // became a pinch/two-finger pan — hand off to OrbitControls' own
      // touch handling instead of continuing to spin the model with the
      // first finger's movement.
      if (event.pointerType === "touch" && !event.isPrimary) {
        if (rotating) onRotateEnd({ pointerId: activePointerId });
        return;
      }
      if (event.button !== 0) return; // only the rotate (left) button / primary touch
      if (modelsGroup.children.length === 0) return;

      const sphere = getGroupSphere();
      if (!sphere) return;
      event.preventDefault();

      downClientX = event.clientX;
      downClientY = event.clientY;
      lastClientX = event.clientX;
      lastClientY = event.clientY;
      pivotRaycastPromise = null;

      rotateRadius = Math.max(sphere.radius, 0.001);

      const startNdc = getNdc(event);
      const gestureId = ++gestureSeq;

      // Prefer whatever the hover-raycast cache (zoomHitCache, kept warm
      // by onZoomHoverMove on every pointermove — see below) already
      // resolved for this cursor position: it's the real, accurate
      // surface point, usually already sitting there from before the
      // click, so using it means the pivot starts correct immediately
      // with no async wait at all — which is exactly what a fast drag
      // needs, since it won't survive long enough for a fresh raycast
      // fired now to land (see the movedSinceStart gate below). Only
      // fall back to the coarse sphere estimate when the cache is empty
      // or too stale for this click (e.g. the pointer just entered the
      // canvas with no prior hover, or the last hover raycast is still
      // in flight). nearestModelHit is preferred over the whole-group
      // sphere in that fallback case since the sphere can be dominated
      // by a much larger co-loaded model (e.g. a landscape alongside a
      // building) and land the pivot far from where the user clicked.
      const cachedHit =
        zoomHitCache &&
        Math.hypot(
          zoomHitCache.clientX - event.clientX,
          zoomHitCache.clientY - event.clientY,
        ) <= CACHE_PIXEL_TOLERANCE
          ? zoomHitCache.point
          : null;
      raycaster.setFromCamera(startNdc, camera);
      const startHit =
        cachedHit ?? nearestModelHit(raycaster.ray.origin, raycaster.ray.direction)?.point;
      anchorGesture(startNdc, startHit ?? raySphereProject(startNdc, sphere.center, rotateRadius));

      const pipeline = pipelineRef.current;
      if (pipeline) {
        // Also reused by onRotateEnd for element selection if this turns
        // out to be a click rather than a drag — same screen position, no
        // need to raycast twice. raycastVisible skips anything hidden
        // behind an active clip plane, so rotating/selecting after a cut
        // pivots on what's actually on screen.
        pivotRaycastPromise = raycastVisible(event.clientX, event.clientY);
        pivotRaycastPromise
          .then((hit) => {
            // Ignore a result that arrives after this gesture ended or
            // was superseded by a newer one.
            if (!hit || !rotating || gestureId !== gestureSeq) return;
            // Once the user has already moved past the click threshold,
            // this is an unambiguous, in-progress drag: swapping the
            // pivot now would silently change what future movement
            // orbits around, which reads as the rotation jumping to a
            // different object partway through a fast gesture — the
            // very thing this guard exists to prevent. Only refine the
            // pivot while the gesture is still small enough (typically
            // because the user started the drag slowly) that the swap
            // goes unnoticed.
            const movedSinceStart = Math.hypot(
              lastClientX - downClientX,
              lastClientY - downClientY,
            );
            if (movedSinceStart >= CLICK_MOVE_THRESHOLD) return;
            // hit.point is already expressed in modelsGroup's *current*
            // frame (the fragments library converts its local-space hit
            // to world space using matrixWorld as of when the raycast
            // resolves), which is exactly the frame anchorGesture needs:
            // it re-captures groupPosStart/groupQuatStart from the
            // model's current live pose, so the pivot must be consistent
            // with "now", not with the pose at mousedown.
            anchorGesture(pendingNdc ?? startNdc, hit.point);
          })
          .catch((err) => console.error("Pivot raycast failed", err));
      }

      rotating = true;
      activePointerId = event.pointerId;
      pendingNdc = startNdc;
      window.addEventListener("pointermove", onRotateMove);
      window.addEventListener("pointerup", onRotateEnd);
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
      controls.update();
      pipelineRef.current?.fragments.core.update();
      if (!needsRender) return;
      needsRender = false;
      scalePivotMarker();
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
      window.removeEventListener("wheel", onZoomWheel, { capture: true });
      renderer.domElement.removeEventListener("pointermove", onZoomHoverMove);
      window.removeEventListener("wheel", onCtrlWheel, { capture: true });
      window.removeEventListener("pointermove", onRotateMove);
      window.removeEventListener("pointerup", onRotateEnd);
      window.removeEventListener("pointermove", onClipPlaneDragMove);
      window.removeEventListener("pointerup", onClipPlaneDragEnd);
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
    await hit.fragments.setVisible([hit.localId], false);
    invalidateGroupSphereRef.current();
    requestRenderRef.current();
  }, []);

  const resetVisibility = useCallback(async () => {
    const entries = [...modelsRef.current.values()];
    await Promise.all(entries.map(({ model }) => model.resetVisible()));
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
  const clearSelection = useCallback(() => setSelectedElement(null), []);

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
  };
}

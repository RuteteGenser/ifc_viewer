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
  const clipPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)); // world-space, derived each frame from clipPlaneLocalRef
  const clipPlaneLocalRef = useRef(new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)); // modelsGroup-local space, source of truth
  const modelsRef = useRef(new Map()); // modelId -> { model: FragmentsModel, object: THREE.Object3D }
  const invalidateGroupSphereRef = useRef(() => {});
  const getGroupSphereRef = useRef(() => null);
  const nearestModelHitRef = useRef(() => null);
  const requestRenderRef = useRef(() => {});
  const hasClipPlaneRef = useRef(false);
  const pendingSurfacePickRef = useRef(null); // { id, promise } | null
  const cameraClipPlaneRef = useRef(new THREE.Plane());
  const cameraClipEnabledRef = useRef(false);
  const cameraClipDistanceRef = useRef(10);

  const [models, setModels] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("");
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [clipEnabled, setClipEnabled] = useState(false);
  const [hasClipPlane, setHasClipPlane] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { x, y } | null
  const [cameraClipEnabled, setCameraClipEnabledState] = useState(false);
  const [cameraClipDistance, setCameraClipDistanceState] = useState(10);
  const [cameraClipRange, setCameraClipRange] = useState({ min: 0, max: 20 });
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
    const invalidateGroupSphere = () => {
      groupSphereLocal = null;
      modelSpheresLocal = null;
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
    getGroupSphereRef.current = getGroupSphere;
    nearestModelHitRef.current = nearestModelHit;

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
    // clipPlaneRef/cameraClipPlaneRef are already built around.
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

    // Ctrl+scroll moves the active clip plane along its own normal instead
    // of zooming (and instead of the browser's page-zoom). Attached to
    // `window` with `capture: true` so it runs — and can stop the event —
    // before OrbitControls' own wheel listener on `renderer.domElement`;
    // registration order alone wouldn't guarantee that, since both would
    // otherwise be listening on the very same element.
    const CLIP_SCROLL_SENSITIVITY = 0.004;
    const onCtrlWheel = (event) => {
      if (!event.ctrlKey) return;
      if (event.target !== renderer.domElement && !renderer.domElement.contains(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!hasClipPlaneRef.current) return;
      // Move the plane in its own local frame — same reasoning as the
      // render loop's re-derivation: the local plane is the source of
      // truth, and the world-space clipPlaneRef is only ever a per-frame
      // projection of it.
      clipPlaneLocalRef.current.constant -= event.deltaY * CLIP_SCROLL_SENSITIVITY;
      requestRender();
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

    // Custom zoom, intercepting mouse-wheel events before OrbitControls'
    // own built-in wheel-zoom ever sees them (same window+capture-phase
    // trick as onCtrlWheel above, needed since both would otherwise be
    // listening on the very same element). OrbitControls' own dolly
    // always scales by a percentage of the distance to controls.target,
    // never to whatever's actually under the cursor — for a large model
    // where target sits far from the pointed-at detail, that makes zoom
    // feel wildly too coarse or too fine. This uses the distance to the
    // point under the cursor as the basis instead, found via
    // nearestModelHit against each loaded model's own bounding sphere
    // (not one sphere spanning every loaded model — critical once models
    // of very different scale, e.g. a building plus a much larger
    // landscape, are loaded together: a combined sphere is dominated by
    // the largest model and gives a wildly wrong distance for anything
    // else). Falls back to the old whole-group projection only when the
    // cursor is over genuinely empty space (no model hit at all). Touch
    // pinch-zoom is untouched — it's a completely separate code path in
    // OrbitControls that never dispatches 'wheel' events, so
    // enableZoom/zoomToCursor are left on for it.
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
      const hit = nearestModelHit(raycaster.ray.origin, dir);
      const sphere = getGroupSphere();
      const cursorPoint = hit
        ? hit.point
        : sphere
          ? raySphereProject(ndc, sphere.center, sphere.radius)
          : controls.target;

      const prevDistance = camera.position.distanceTo(cursorPoint);
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

      requestRender();
    };
    window.addEventListener("wheel", onZoomWheel, { capture: true, passive: false });

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

    const formatElementData = (data) => {
      const psets = Array.isArray(data.IsDefinedBy) ? data.IsDefinedBy : [];
      return {
        category: data._category?.value ?? "Unknown",
        name: data.Name?.value ?? null,
        guid: data._guid?.value ?? null,
        objectType: data.ObjectType?.value ?? null,
        tag: data.Tag?.value ?? null,
        propertySets: psets
          .filter((pset) => Array.isArray(pset.HasProperties))
          .map((pset) => ({
            name: pset.Name?.value ?? "Property set",
            properties: pset.HasProperties.map((prop) => ({
              name: prop.Name?.value ?? "",
              value: prop.NominalValue?.value ?? prop.Value?.value ?? null,
            })),
          })),
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
          relations: { IsDefinedBy: { attributes: true, relations: true } },
        });
        setSelectedElement(data ? formatElementData(data) : null);
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
    const onRotateStart = (event) => {
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
      pivotRaycastPromise = null;

      rotateRadius = Math.max(sphere.radius, 0.001);

      const startNdc = getNdc(event);
      const gestureId = ++gestureSeq;

      // Start on a provisional pivot so the drag is responsive
      // immediately, then swap to the real surface point under the
      // cursor once the async geometry raycast returns. Prefer the
      // model actually under the cursor (nearestModelHit) over the
      // whole-group sphere, which can be dominated by a much larger
      // co-loaded model (e.g. a landscape alongside a building) and
      // land the provisional pivot far from where the user clicked.
      raycaster.setFromCamera(startNdc, camera);
      const startHit = nearestModelHit(raycaster.ray.origin, raycaster.ray.direction);
      anchorGesture(
        startNdc,
        startHit ? startHit.point : raySphereProject(startNdc, sphere.center, rotateRadius),
      );

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
      if (hasClipPlaneRef.current) {
        // The clip plane is authored in modelsGroup's local frame so it
        // rotates together with the model instead of staying fixed in
        // world space — which, since the *camera* never actually moves
        // during a rotate gesture, is what made it look like the plane
        // was stuck to the camera/view instead of the surface it was
        // created on. Re-derive the world-space plane every frame from
        // the model's current pose. Avoids the full recursive
        // updateMatrixWorld(true) (which would also update every child
        // mesh) since only modelsGroup's own matrix is needed here, and
        // its parent (the scene) never moves.
        modelsGroup.updateMatrix();
        modelsGroup.matrixWorld.copy(modelsGroup.matrix);
        const localPlane = clipPlaneLocalRef.current;
        const worldNormal = localPlane.normal
          .clone()
          .applyQuaternion(modelsGroup.quaternion)
          .normalize();
        const pointOnPlaneLocal = localPlane.normal
          .clone()
          .multiplyScalar(-localPlane.constant);
        const pointOnPlaneWorld = modelsGroup.localToWorld(pointOnPlaneLocal);
        clipPlaneRef.current.normal.copy(worldNormal);
        clipPlaneRef.current.constant = -worldNormal.dot(pointOnPlaneWorld);
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
      window.removeEventListener("wheel", onCtrlWheel, { capture: true });
      window.removeEventListener("pointermove", onRotateMove);
      window.removeEventListener("pointerup", onRotateEnd);
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
    hasClipPlaneRef.current = hasClipPlane;
  }, [hasClipPlane]);

  useEffect(() => {
    cameraClipEnabledRef.current = cameraClipEnabled;
  }, [cameraClipEnabled]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const planes = [];
    if (clipEnabled && hasClipPlane) planes.push(clipPlaneRef.current);
    if (cameraClipEnabled) planes.push(cameraClipPlaneRef.current);
    renderer.clippingPlanes = planes;
    requestRenderRef.current();
  }, [clipEnabled, hasClipPlane, cameraClipEnabled]);

  const setCameraClipEnabled = useCallback((enabled) => {
    if (enabled) {
      // The kept region is whatever lies *beyond* cameraClipDistance
      // along the view direction, so a distance at/before the model's
      // near edge keeps everything (nothing clipped) and increasing it
      // peels away more of the near side. Bound the range around where
      // the model actually is (roughly its near-to-far extent) rather
      // than [0, far] — for a model framed the usual way (camera pulled
      // back to several times the model's size) the sphere radius is a
      // small fraction of the camera distance, so a [0, far] range left
      // almost the whole slider doing nothing and the small part that
      // mattered moving fast per pixel/step. The lower bound reaches
      // well past the near edge, toward the camera, so the plane can
      // also be pulled in tight against the camera itself.
      //
      // Prefer whatever model is actually in front of the camera
      // (nearestModelHit) over the whole-group sphere for dist/radius —
      // with several models of very different scale loaded together
      // (e.g. a building plus a much larger landscape), the combined
      // sphere is dominated by the largest one and produces a range
      // sized for the whole scene rather than for what's being looked
      // at, which is why this could otherwise span e.g. 10-100 while
      // only values under 10 were ever useful for the model in view.
      const camera = cameraRef.current;
      const forward = camera ? camera.getWorldDirection(new THREE.Vector3()) : null;
      const hit =
        camera && forward ? nearestModelHitRef.current(camera.position, forward) : null;
      const sphere = getGroupSphereRef.current();
      const dist = hit
        ? hit.t
        : camera && sphere
          ? camera.position.distanceTo(sphere.center)
          : 10;
      const radius = hit ? hit.radius : sphere ? sphere.radius : 5;
      const near = Math.max(dist - radius, 0);
      const far = dist + radius;
      const margin = radius * 0.1;
      // Reach much closer to the camera than the model's own near
      // surface, so the plane can be pulled in tight against the lens
      // (e.g. when zoomed in close) instead of only ranging across the
      // model itself.
      const min = Math.max(near / 5, 0);
      const max = far + margin;
      setCameraClipRange({ min, max });
      setCameraClipDistanceState(min);
      cameraClipDistanceRef.current = min;
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
    if (!modelsGroup) return;
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

    const plane = clipPlaneLocalRef.current;
    plane.normal.copy(localNormal);
    plane.constant = -plane.normal.dot(localPoint);

    setHasClipPlane(true);
    setClipEnabled(true);
    requestRenderRef.current();
  }, []);

  const flipClipPlane = useCallback(() => {
    const plane = clipPlaneLocalRef.current;
    plane.normal.negate();
    plane.constant *= -1;
    requestRenderRef.current();
  }, []);

  const clearClipPlane = useCallback(() => {
    setHasClipPlane(false);
    setClipEnabled(false);
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
        const model = await pipeline.ifcLoader.load(data, true, modelId);

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
    clearError,
    clipEnabled,
    setClipEnabled,
    hasClipPlane,
    flipClipPlane,
    clearClipPlane,
    contextMenu,
    closeContextMenu,
    createClipPlaneHere,
    cameraClipEnabled,
    setCameraClipEnabled,
    cameraClipDistance,
    setCameraClipDistance,
    cameraClipRange,
    selectedElement,
    selectedElementLoading,
    clearSelection,
  };
}

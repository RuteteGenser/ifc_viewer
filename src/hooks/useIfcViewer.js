import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createIfcPipeline } from "../ifc/setupComponents";

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
  const clipPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, -1, 0), 0));
  const modelsRef = useRef(new Map()); // modelId -> { model: FragmentsModel, object: THREE.Object3D }

  const [models, setModels] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("");
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [clipEnabled, setClipEnabled] = useState(false);
  const [clipInverted, setClipInverted] = useState(false);
  const [clipHeight, setClipHeight] = useState(0);
  const [clipRange, setClipRange] = useState({ min: -5, max: 5 });

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
    controls.zoomToCursor = true;
    controls.mouseButtons = {
      LEFT: null, // handled by the arcball model-rotation below
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.touches = {
      ONE: null, // single-finger drag is handled by the arcball rotation below too
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // "Grab the model and spin it" rotation (left mouse button): the
    // camera never moves during this gesture — instead we rotate the
    // model group around a fixed pivot (its own bounding-sphere center)
    // using classic arcball math (map cursor position to a point on that
    // sphere via ray-sphere intersection, then rotate so the point picked
    // at drag start tracks the current cursor exactly). Recomputing the
    // rotation fresh from the drag-start snapshot every frame — rather
    // than integrating small per-frame deltas — means there's no drift
    // and no dependency on frame timing.
    let rotating = false;
    let pendingNdc = null;
    const rotatePivot = new THREE.Vector3();
    let rotateRadius = 1;
    const rotateV0 = new THREE.Vector3();
    const groupQuatStart = new THREE.Quaternion();
    const groupPosStart = new THREE.Vector3();
    const raycaster = new THREE.Raycaster();

    const getNdc = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };

    // Projects a screen point onto the sphere (rotatePivot, rotateRadius),
    // falling back to the closest point on the sphere to the cursor ray
    // when the ray misses entirely (dragging past the model's silhouette)
    // so the rotation stays smooth and well-defined at any drag distance.
    const raySphereProject = (ndc) => {
      raycaster.setFromCamera(ndc, camera);
      const origin = raycaster.ray.origin;
      const dir = raycaster.ray.direction;
      const oc = origin.clone().sub(rotatePivot);
      const b = oc.dot(dir);
      const c = oc.dot(oc) - rotateRadius * rotateRadius;
      const discriminant = b * b - c;
      const t = discriminant >= 0 ? -b - Math.sqrt(discriminant) : -b;
      return origin
        .clone()
        .addScaledVector(dir, t)
        .sub(rotatePivot)
        .setLength(rotateRadius)
        .add(rotatePivot);
    };

    const applyRotation = (ndc) => {
      const v1 = raySphereProject(ndc).sub(rotatePivot).normalize();
      const v0 = rotateV0.clone().normalize();
      const deltaQ = new THREE.Quaternion().setFromUnitVectors(v0, v1);

      modelsGroup.quaternion.copy(deltaQ).multiply(groupQuatStart);
      const offset = groupPosStart.clone().sub(rotatePivot).applyQuaternion(deltaQ);
      modelsGroup.position.copy(rotatePivot).add(offset);
    };

    let activePointerId = null;

    const onRotateMove = (event) => {
      if (!rotating || event.pointerId !== activePointerId) return;
      pendingNdc = getNdc(event);
    };
    const onRotateEnd = (event) => {
      if (event.pointerId !== activePointerId) return;
      rotating = false;
      activePointerId = null;
      pendingNdc = null;
      window.removeEventListener("pointermove", onRotateMove);
      window.removeEventListener("pointerup", onRotateEnd);
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

      const box = new THREE.Box3().setFromObject(modelsGroup);
      if (box.isEmpty()) return;
      event.preventDefault();

      const sphere = box.getBoundingSphere(new THREE.Sphere());
      rotatePivot.copy(sphere.center);
      rotateRadius = Math.max(sphere.radius, 0.001);
      groupQuatStart.copy(modelsGroup.quaternion);
      groupPosStart.copy(modelsGroup.position);

      const startNdc = getNdc(event);
      rotateV0.copy(raySphereProject(startNdc)).sub(rotatePivot);

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

    const axes = new THREE.AxesHelper(5);
    scene.add(axes);

    let frameId;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      if (rotating && pendingNdc) applyRotation(pendingNdc);
      controls.update();
      pipelineRef.current?.fragments.core.update();
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
    });
    resizeObserver.observe(container);

    createIfcPipeline()
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
      window.removeEventListener("pointermove", onRotateMove);
      window.removeEventListener("pointerup", onRotateEnd);
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
    const renderer = rendererRef.current;
    const plane = clipPlaneRef.current;
    if (!renderer) return;

    if (clipInverted) {
      plane.normal.set(0, 1, 0);
      plane.constant = -clipHeight;
    } else {
      plane.normal.set(0, -1, 0);
      plane.constant = clipHeight;
    }
    renderer.clippingPlanes = clipEnabled ? [plane] : [];
  }, [clipEnabled, clipHeight, clipInverted]);

  const clipTouchedRef = useRef(false);

  const refreshClipRange = useCallback(() => {
    const box = getSceneBox(modelsRef.current.values());
    if (!box) return;
    const min = box.min.y;
    const max = box.max.y;
    setClipRange({ min, max });
    setClipHeight((prev) =>
      clipTouchedRef.current ? Math.min(Math.max(prev, min), max) : max,
    );
  }, []);

  const handleSetClipHeight = useCallback((value) => {
    clipTouchedRef.current = true;
    setClipHeight(value);
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
    refreshClipRange();

    setIsLoading(false);
    setLoadingLabel("");
  }, [refreshClipRange]);

  const setVisible = useCallback(
    (modelId, visible) => {
      const entry = modelsRef.current.get(modelId);
      if (entry) entry.object.visible = visible;
      setModels((prev) =>
        prev.map((m) => (m.id === modelId ? { ...m, visible } : m)),
      );
      refreshClipRange();
    },
    [refreshClipRange],
  );

  const removeModel = useCallback(async (modelId) => {
    const pipeline = pipelineRef.current;
    const modelsGroup = modelsGroupRef.current;
    const entry = modelsRef.current.get(modelId);

    if (entry && modelsGroup) modelsGroup.remove(entry.object);
    modelsRef.current.delete(modelId);
    setModels((prev) => prev.filter((m) => m.id !== modelId));
    refreshClipRange();

    try {
      await pipeline?.fragments.core.disposeModel(modelId);
    } catch (err) {
      console.error(`Failed to dispose model ${modelId}`, err);
    }
  }, [refreshClipRange]);

  const clearError = useCallback(() => setError(null), []);

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
    clipInverted,
    setClipInverted,
    clipHeight,
    setClipHeight: handleSetClipHeight,
    clipRange,
  };
}

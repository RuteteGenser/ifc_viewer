import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { decodeViewHash, encodeViewHash, sameNames, screenshotFileName, STANDARD_VIEWS } from "../ifc/viewHelpers";
import { readLevels } from "../ifc/storeys";

// Narrow field of view: the view looks parallel (no vanishing points) while
// the real camera stays a perspective one, so picking, clipping and
// measuring keep working unchanged.
const FLAT_FOV = 5;
const NORMAL_FOV = 60;

// Section axes are in the model's own frame (the frame clip planes are
// stored in). The viewer's Y axis is vertical, so a "plan" cut is across Y.
const SECTION_AXES = { plan: 1, side: 0, front: 2 };

const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function isTyping() {
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

/**
 * Standard views, flat projection, levels, screenshot and view links.
 * Everything here reads the viewer through the refs/helpers handed in by
 * useIfcViewer, so the big hook only gains one call.
 */
export function useViewFeatures(ctx) {
  const { models, isLoading, isolatedKeys, isolateKeys, showToast } = ctx;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const [flat, setFlat] = useState(false);
  const [levels, setLevels] = useState([]);
  const [levelSel, setLevelSel] = useState(null); // { id, mode: "only" | "below", size } | null
  const [busy, setBusy] = useState(false);

  // Eases the camera, the model's own turn, and the field of view together.
  // `dir` null keeps the current viewing direction; `resetModel` turns the
  // model back to its load pose first (standard views are defined for it).
  const flyTo = useCallback(({ dir, fov, resetModel }) => {
    const { cameraRef, controlsRef, modelsGroupRef, modelsRef, requestRenderRef, autoFramedRef, cameraAnimRef, cancelCameraAnim, getVisibleFrac, helpers } = ctxRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const group = modelsGroupRef.current;
    if (!camera || !controls || !group || modelsRef.current.size === 0) return;
    cancelCameraAnim();
    autoFramedRef.current = false;

    const startQuat = group.quaternion.clone();
    const startPos = group.position.clone();
    const startFov = camera.fov;
    const fromCam = camera.position.clone();
    const fromTarget = controls.target.clone();
    const endQuat = resetModel ? new THREE.Quaternion() : startQuat.clone();
    const endGroupPos = resetModel ? new THREE.Vector3() : startPos.clone();
    const endFov = fov ?? startFov;
    const viewDir = dir ? new THREE.Vector3(...dir).normalize() : fromCam.clone().sub(fromTarget).normalize();

    // Measure the framing for the end state, then put everything back.
    group.quaternion.copy(endQuat);
    group.position.copy(endGroupPos);
    group.updateMatrixWorld(true);
    camera.fov = endFov;
    camera.updateProjectionMatrix();
    const box = helpers.getSceneBox(modelsRef.current.values());
    const pose = box ? helpers.computeFit(camera, box, getVisibleFrac(), viewDir) : null;
    group.quaternion.copy(startQuat);
    group.position.copy(startPos);
    group.updateMatrixWorld(true);
    camera.fov = startFov;
    camera.updateProjectionMatrix();
    if (!pose) return;

    const finish = () => {
      group.quaternion.copy(endQuat);
      group.position.copy(endGroupPos);
      group.updateMatrixWorld(true);
      camera.fov = endFov;
      helpers.applyPose(camera, controls, pose);
      requestRenderRef.current();
    };
    if (reducedMotion()) {
      finish();
      return;
    }
    const t0 = performance.now();
    const ms = 520;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      if (k >= 1) {
        cameraAnimRef.current = 0;
        finish();
        return;
      }
      const e = k * k * (3 - 2 * k);
      group.quaternion.copy(startQuat).slerp(endQuat, e);
      group.position.copy(startPos).lerp(endGroupPos, e);
      group.updateMatrixWorld(true);
      camera.fov = startFov + (endFov - startFov) * e;
      helpers.applyPose(camera, controls, {
        position: fromCam.clone().lerp(pose.position, e),
        target: fromTarget.clone().lerp(pose.target, e),
        distance: undefined,
      });
      requestRenderRef.current();
      cameraAnimRef.current = requestAnimationFrame(step);
    };
    cameraAnimRef.current = requestAnimationFrame(step);
  }, []);

  const goToView = useCallback(
    (id) => {
      const view = STANDARD_VIEWS.find((v) => v.id === id);
      if (view) flyTo({ dir: view.dir, fov: flat ? FLAT_FOV : NORMAL_FOV, resetModel: true });
    },
    [flyTo, flat],
  );

  const setFlatProjection = useCallback(
    (on) => {
      setFlat(on);
      flyTo({ dir: null, fov: on ? FLAT_FOV : NORMAL_FOV, resetModel: false });
    },
    [flyTo],
  );

  // ---- Levels ----

  const modelIds = models.map((m) => m.id).join("|");
  useEffect(() => {
    let cancelled = false;
    const entries = [...ctxRef.current.modelsRef.current.entries()];
    if (entries.length === 0) {
      setLevels([]);
      return undefined;
    }
    readLevels(entries).then((result) => {
      if (!cancelled) setLevels(result);
    });
    return () => {
      cancelled = true;
    };
  }, [modelIds]);

  // The isolate set is shared with the search checkboxes and Reset
  // visibility. When something else changes it, the level highlight goes.
  useEffect(() => {
    setLevelSel((sel) => (sel && isolatedKeys.size !== sel.size ? null : sel));
  }, [isolatedKeys]);

  const showLevels = useCallback(
    (id, mode) => {
      const index = levels.findIndex((l) => l.id === id);
      if (index < 0) return;
      const picked = mode === "below" ? levels.slice(0, index + 1) : [levels[index]];
      const keys = new Set(picked.flatMap((l) => l.keys));
      if (keys.size === 0) {
        showToast("That level has no elements to show");
        return;
      }
      setLevelSel({ id, mode, size: keys.size });
      isolateKeys(keys);
    },
    [levels, isolateKeys, showToast],
  );

  const showAllLevels = useCallback(() => {
    setLevelSel(null);
    isolateKeys(new Set());
  }, [isolateKeys]);

  // ---- Axis-aligned sections ----

  const localBoxOf = () => {
    const box = new THREE.Box3();
    for (const entry of ctxRef.current.modelsRef.current.values()) if (entry.localBox) box.union(entry.localBox);
    return box.isEmpty() ? null : box;
  };

  const addSection = useCallback(
    (kind) => {
      const { clipPlaneManagerRef, setClipPlanes, pushUndo } = ctxRef.current;
      const manager = clipPlaneManagerRef.current;
      const box = localBoxOf();
      const axis = SECTION_AXES[kind];
      if (!manager || !box || axis === undefined) return;
      // Keeps the side below/left/behind the plane, so a plan cut removes the roof first.
      const normal = new THREE.Vector3();
      normal.setComponent(axis, -1);
      const point = box.getCenter(new THREE.Vector3());
      const idBox = { id: manager.add(normal, point) };
      setClipPlanes(manager.list());
      pushUndo({
        undo: () => {
          manager.remove(idBox.id);
          setClipPlanes(manager.list());
        },
        redo: () => {
          idBox.id = manager.add(normal, point);
          setClipPlanes(manager.list());
        },
      });
    },
    [],
  );

  // The newest clip plane, when it lies along one of the model's axes: its
  // position can then be slid with a single slider (0..1 across the model).
  const [sliderTick, setSliderTick] = useState(0);
  const lastPlane = ctx.clipPlanes[ctx.clipPlanes.length - 1];
  let section = null;
  if (lastPlane) {
    const snap = ctx.clipPlaneManagerRef.current?.getPlaneSnapshot(lastPlane.id);
    const box = localBoxOf();
    if (snap && box) {
      for (const [kind, axis] of Object.entries(SECTION_AXES)) {
        if (Math.abs(Math.abs(snap.normal.getComponent(axis)) - 1) > 1e-3) continue;
        const min = box.min.getComponent(axis);
        const max = box.max.getComponent(axis);
        const pos = snap.point.getComponent(axis);
        section = { id: lastPlane.id, kind, axis, min, max, fraction: max > min ? (pos - min) / (max - min) : 0.5, sign: Math.sign(snap.normal.getComponent(axis)) };
      }
    }
  }
  void sliderTick; // only here to re-render while the slider moves a plane

  const setSectionFraction = useCallback((fraction) => {
    const manager = ctxRef.current.clipPlaneManagerRef.current;
    const box = localBoxOf();
    const id = ctxRef.current.clipPlanes[ctxRef.current.clipPlanes.length - 1]?.id;
    const snap = id && manager?.getPlaneSnapshot(id);
    if (!snap || !box) return;
    const axis = [0, 1, 2].find((a) => Math.abs(Math.abs(snap.normal.getComponent(a)) - 1) < 1e-3);
    if (axis === undefined) return;
    const pos = box.min.getComponent(axis) + fraction * (box.max.getComponent(axis) - box.min.getComponent(axis));
    // plane: n.X + c = 0 with n = +-axis, so c = -n_axis * pos
    manager.setConstant(id, -Math.sign(snap.normal.getComponent(axis)) * pos);
    setSliderTick((t) => t + 1);
  }, []);

  // ---- Screenshot ----

  const saveScreenshot = useCallback(async () => {
    const { rendererRef, sceneRef, cameraRef, requestRenderRef } = ctxRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera || ctxRef.current.modelsRef.current.size === 0) {
      showToast("Open a model first");
      return;
    }
    // The drawing buffer is cleared once a frame is shown, so draw again and
    // read it back in the same task. Only the canvas is saved, no controls.
    renderer.render(scene, camera);
    const blob = await new Promise((resolve) => renderer.domElement.toBlob(resolve, "image/png"));
    requestRenderRef.current();
    if (!blob) {
      showToast("Could not save the image");
      return;
    }
    const name = screenshotFileName();
    const file = new File([blob], name, { type: "image/png" });
    const touch = window.matchMedia?.("(pointer: coarse)").matches;
    if (touch && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
        // Sharing failed for another reason: fall back to a download.
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast("Image saved");
  }, [showToast]);

  // ---- View links ----

  const copyViewLink = useCallback(async () => {
    const { cameraRef, controlsRef, modelsGroupRef } = ctxRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const group = modelsGroupRef.current;
    if (!camera || !controls || !group || ctxRef.current.models.length === 0) {
      showToast("Open a model first");
      return;
    }
    const hash = encodeViewHash({
      position: camera.position.toArray(),
      target: controls.target.toArray(),
      groupQuat: group.quaternion.toArray(),
      groupPos: group.position.toArray(),
      fov: camera.fov,
      modelNames: ctxRef.current.models.map((m) => m.name),
    });
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`;
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      const area = document.createElement("textarea");
      area.value = url;
      area.setAttribute("readonly", "");
      area.style.cssText = "position:fixed;opacity:0;top:0;left:0";
      document.body.appendChild(area);
      area.select();
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      area.remove();
    }
    showToast(copied ? "View link copied" : "Could not copy the link");
  }, [showToast]);

  // A link's view is applied once, when the models it was made for are open.
  const pendingViewRef = useRef(typeof window === "undefined" ? null : decodeViewHash(window.location.hash));
  useEffect(() => {
    const pending = pendingViewRef.current;
    if (!pending || isLoading || models.length === 0) return undefined;
    if (!sameNames(pending.modelNames, models.map((m) => m.name))) {
      pendingViewRef.current = null;
      showToast("This view link was made for a different model");
      return undefined;
    }
    const timer = setTimeout(() => {
      pendingViewRef.current = null;
      const { cameraRef, controlsRef, modelsGroupRef, autoFramedRef, cancelCameraAnim, requestRenderRef, helpers } = ctxRef.current;
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      const group = modelsGroupRef.current;
      if (!camera || !controls || !group) return;
      cancelCameraAnim();
      autoFramedRef.current = false;
      group.quaternion.fromArray(pending.groupQuat).normalize();
      group.position.fromArray(pending.groupPos);
      group.updateMatrixWorld(true);
      camera.fov = pending.fov;
      helpers.applyPose(camera, controls, {
        position: new THREE.Vector3(...pending.position),
        target: new THREE.Vector3(...pending.target),
      });
      setFlat(pending.fov < 20);
      requestRenderRef.current();
    }, 250);
    return () => clearTimeout(timer);
  }, [isLoading, models, showToast]);

  // ---- Shortcut: P saves the picture ----

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey || isTyping()) return;
      if (event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      setBusy(true);
      saveScreenshot().finally(() => setBusy(false));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveScreenshot]);

  return {
    hasModels: models.length > 0,
    isolating: isolatedKeys.size > 0,
    flat,
    setFlatProjection,
    goToView,
    levels,
    levelSel,
    showLevels,
    showAllLevels,
    addSection,
    section,
    setSectionFraction,
    flipSection: () => section && ctxRef.current.flipClipPlane(section.id),
    removeSection: () => section && ctxRef.current.removeClipPlane(section.id),
    saveScreenshot,
    copyViewLink,
    busy,
  };
}

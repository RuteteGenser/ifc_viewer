import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { buildTree, categoryCounts, elementIds, hiddenCounts } from "../ifc/spatialTree";
import { readProjectUnits } from "../ifc/elementDetails";

const NAME_CHUNK = 800;
const NAME_INDEX_CAP = 30000; // most elements we will pre-load names for to make the tree filter work

// Everything the structure tree and the model summary need, kept out of
// useIfcViewer.js. It only touches the viewer through the handles passed in,
// and uses the same primitives as the existing tools: FragmentsModel
// setVisible for hide/show (with an undo entry), and the viewer's own
// selectElementFrom + zoomToHit for pick and fly-to.
export default function useModelBrowser({
  models,
  selectedElement,
  modelsRef,
  pipelineRef,
  requestRenderRef,
  invalidateGroupSphereRef,
  selectedHitRef,
  clearSelection,
  selectElementFromRef,
  zoomToHit,
  pushUndo,
  renderForAWhile,
}) {
  const [trees, setTrees] = useState({}); // modelId -> { root, nodes, meta, summary }
  const [nameVersion, setNameVersion] = useState(0);
  const [hiddenVersion, setHiddenVersion] = useState(0);
  const [indexing, setIndexing] = useState(false);
  const namesRef = useRef(new Map()); // `${modelId}/${localId}` -> string
  const pendingRef = useRef(new Set());
  const hiddenRef = useRef(new Map()); // modelId -> Set(localId)
  const hiddenCountsRef = useRef(new Map()); // modelId -> Map(nodeId -> hidden count)
  const treesRef = useRef(trees);
  treesRef.current = trees;

  const loadNames = useCallback(
    async (modelId, ids) => {
      const entry = modelsRef.current.get(modelId);
      if (!entry) return;
      const todo = ids.filter((id) => !namesRef.current.has(`${modelId}/${id}`));
      for (let i = 0; i < todo.length; i += NAME_CHUNK) {
        const chunk = todo.slice(i, i + NAME_CHUNK);
        try {
          const rows = await entry.model.getItemsData(chunk, {
            attributesDefault: false,
            attributes: ["Name"],
            relationsDefault: { attributes: false, relations: false },
          });
          chunk.forEach((id, j) => {
            const v = rows[j]?.Name?.value;
            namesRef.current.set(`${modelId}/${id}`, v ? String(v) : "");
          });
        } catch (err) {
          console.error("Failed to read element names", err);
          chunk.forEach((id) => namesRef.current.set(`${modelId}/${id}`, ""));
        }
      }
      if (todo.length) setNameVersion((v) => v + 1);
    },
    [modelsRef],
  );

  const refreshHidden = useCallback(async () => {
    const entries = [...modelsRef.current.entries()];
    let changed = false;
    await Promise.all(
      entries.map(async ([modelId, { model }]) => {
        const tree = treesRef.current[modelId];
        if (!tree) return;
        let ids = [];
        try {
          ids = await model.getItemsByVisibility(false);
        } catch {
          return;
        }
        const prev = hiddenRef.current.get(modelId);
        if (prev && prev.size === ids.length && ids.every((id) => prev.has(id))) return;
        const set = new Set(ids);
        hiddenRef.current.set(modelId, set);
        hiddenCountsRef.current.set(modelId, hiddenCounts(tree.root, set));
        changed = true;
      }),
    );
    if (changed) setHiddenVersion((v) => v + 1);
  }, [modelsRef]);

  // Build a tree for each newly loaded model, drop trees of removed ones.
  useEffect(() => {
    const present = new Set(models.map((m) => m.id));
    setTrees((prev) => {
      const next = {};
      let changed = false;
      for (const id of Object.keys(prev)) {
        if (present.has(id)) next[id] = prev[id];
        else changed = true;
      }
      return changed ? next : prev;
    });
    for (const id of [...hiddenRef.current.keys()]) {
      if (!present.has(id)) {
        hiddenRef.current.delete(id);
        hiddenCountsRef.current.delete(id);
      }
    }
    for (const m of models) {
      const modelId = m.id;
      if (treesRef.current[modelId] || pendingRef.current.has(modelId)) continue;
      const entry = modelsRef.current.get(modelId);
      if (!entry) continue;
      pendingRef.current.add(modelId);
      (async () => {
        try {
          const [raw, meta] = await Promise.all([entry.model.getSpatialStructure(), entry.model.getMetadata().catch(() => ({}))]);
          const built = buildTree(modelId, raw);
          const spatialIds = [...built.nodes.values()].filter((n) => n.kind === "spatial" && n.localId != null).map((n) => n.localId);
          await loadNames(modelId, spatialIds);
          const counts = categoryCounts(built.root);
          const units = readProjectUnits(entry.sourceBytes);
          const summary = {
            schema: meta?.schema ?? null,
            elementCount: counts.elementCount,
            byCategory: counts.byCategory,
            storeyCount: counts.storeyCount,
            units,
            sizeBytes: entry.sourceBytes?.length ?? null,
          };
          if (!modelsRef.current.has(modelId)) return; // removed while loading
          setTrees((prev) => ({ ...prev, [modelId]: { ...built, meta, summary } }));
        } catch (err) {
          console.error("Failed to read the model structure", err);
          setTrees((prev) => ({ ...prev, [modelId]: { root: null, nodes: new Map(), meta: null, summary: null, failed: true } }));
        } finally {
          pendingRef.current.delete(modelId);
        }
      })();
    }
  }, [models, modelsRef, loadNames]);

  // Keep eye icons honest when other tools (H key, isolate, hide-category,
  // reset, undo/redo) change visibility: re-read after any user input settles.
  const hasTrees = Object.keys(trees).length > 0;
  useEffect(() => {
    if (!hasTrees) return undefined;
    refreshHidden();
    let t1 = 0;
    let t2 = 0;
    const schedule = () => {
      clearTimeout(t1);
      clearTimeout(t2);
      t1 = setTimeout(refreshHidden, 350);
      t2 = setTimeout(refreshHidden, 1500);
    };
    document.addEventListener("pointerup", schedule, true);
    document.addEventListener("keyup", schedule, true);
    return () => {
      document.removeEventListener("pointerup", schedule, true);
      document.removeEventListener("keyup", schedule, true);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [hasTrees, refreshHidden]);

  const nameOf = useCallback((node) => {
    if (node.kind === "group") return null;
    return namesRef.current.get(node.id) ?? undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hiddenState = useCallback(
    (node) => {
      const h = hiddenCountsRef.current.get(node.modelId)?.get(node.id) ?? 0;
      if (h === 0) return "visible";
      return h >= node.leafCount ? "hidden" : "partial";
    },
    // hiddenVersion is read through the ref, depend on it so memoised rows refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hiddenVersion],
  );

  // Hide or show a branch (or one element). `show` true = make visible.
  // Same primitive as the H-key hide: FragmentsModel.setVisible, then force the
  // tiles to rebuild, then an undo entry.
  const setNodeVisible = useCallback(
    async (node, show) => {
      const entry = modelsRef.current.get(node.modelId);
      if (!entry) return;
      const ids = elementIds(node);
      if (ids.length === 0) return;
      const apply = async (visible) => {
        renderForAWhile(() => requestRenderRef.current());
        await entry.model.setVisible(ids, visible);
        await pipelineRef.current?.fragments.core.update(true);
        invalidateGroupSphereRef.current();
        requestRenderRef.current();
        await refreshHidden();
      };
      await apply(show);
      const sel = selectedHitRef.current;
      if (!show && sel && sel.modelId === node.modelId && ids.includes(sel.localId)) clearSelection();
      pushUndo({ undo: () => apply(!show), redo: () => apply(show) });
    },
    [modelsRef, pipelineRef, requestRenderRef, invalidateGroupSphereRef, selectedHitRef, clearSelection, pushUndo, renderForAWhile, refreshHidden],
  );

  // Select one element and fly to it, exactly like clicking it in the view.
  const selectElement = useCallback(
    async (modelId, localId) => {
      const entry = modelsRef.current.get(modelId);
      if (!entry || !selectElementFromRef.current) return;
      const [box] = await entry.model.getBoxes([localId]);
      const point = box && !box.isEmpty() ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
      const hit = { fragments: entry.model, localId, point };
      selectElementFromRef.current(Promise.resolve(hit));
      if (box && !box.isEmpty()) zoomToHit(hit);
    },
    [modelsRef, selectElementFromRef, zoomToHit],
  );

  // Pre-load every element name (capped) so the tree filter can match by name.
  const indexAllNames = useCallback(async () => {
    setIndexing(true);
    try {
      let budget = NAME_INDEX_CAP;
      for (const [modelId, tree] of Object.entries(treesRef.current)) {
        if (!tree.root) continue;
        const ids = elementIds(tree.root).slice(0, budget);
        budget -= ids.length;
        await loadNames(modelId, ids);
        if (budget <= 0) break;
      }
    } finally {
      setIndexing(false);
    }
  }, [loadNames]);

  // selectedHitRef is a ref; reading it while rendering is fine because every
  // selection change also changes selectedElement, which re-renders the viewer.
  const sel = selectedElement ? selectedHitRef.current : null;
  const selectedId = sel ? `${sel.modelId}/${sel.localId}` : null;

  return {
    trees,
    nameVersion,
    hiddenVersion,
    indexing,
    loadNames,
    nameOf,
    hiddenState,
    setNodeVisible,
    selectElement,
    indexAllNames,
    selectedId,
  };
}

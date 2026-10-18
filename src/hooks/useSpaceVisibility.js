import { useCallback, useEffect, useRef, useState } from "react";

// IfcSpace elements are room volumes, not building fabric. Drawn as solid
// translucent blocks they bury the walls, ducts and pipes of MEP and clinic
// models, so they start hidden. "Show spaces" (sidebar and Views panel) turns
// them on for the rest of the session. They stay in the structure tree and in
// search, and hiding them is not an undo step.
//
// The viewer calls hideOnLoad when a model arrives, keepHidden after anything
// that makes everything visible again (Reset visibility), and filterIds when
// it isolates a set of elements (levels, search) so a level does not drag its
// rooms back in.

const STORAGE_KEY = "ifc-viewer.show-spaces";
const SPACE_CATEGORY = /^IFCSPACE$/i;

function readStored() {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function useSpaceVisibility({ models, modelsRef, pipelineRef, requestRenderRef, invalidateGroupSphereRef, renderForAWhile }) {
  const [shown, setShown] = useState(readStored);
  const [hasSpaces, setHasSpaces] = useState(false);
  const shownRef = useRef(shown);
  const idsRef = useRef(new Map()); // modelId -> number[]

  const spaceIdsOf = useCallback(
    async (modelId) => {
      if (idsRef.current.has(modelId)) return idsRef.current.get(modelId);
      const entry = modelsRef.current.get(modelId);
      let ids = [];
      if (entry) {
        try {
          const byCategory = await entry.model.getItemsOfCategories([SPACE_CATEGORY]);
          ids = Object.values(byCategory).flat();
        } catch (err) {
          console.error("Could not list the spaces", err);
        }
      }
      idsRef.current.set(modelId, ids);
      return ids;
    },
    [modelsRef],
  );

  const refreshFlag = useCallback(() => {
    setHasSpaces([...idsRef.current.values()].some((ids) => ids.length > 0));
  }, []);

  const redraw = useCallback(async () => {
    renderForAWhile(() => requestRenderRef.current());
    await pipelineRef.current?.fragments.core.update(true);
    invalidateGroupSphereRef.current();
    requestRenderRef.current();
  }, [pipelineRef, requestRenderRef, invalidateGroupSphereRef, renderForAWhile]);

  const setModelSpaces = useCallback(
    async (modelId, visible) => {
      const ids = await spaceIdsOf(modelId);
      const entry = modelsRef.current.get(modelId);
      if (ids.length > 0 && entry) await entry.model.setVisible(ids, visible);
    },
    [spaceIdsOf, modelsRef],
  );

  // A model just arrived: note its spaces and hide them unless they are on.
  const hideOnLoad = useCallback(
    async (modelId) => {
      const ids = await spaceIdsOf(modelId);
      refreshFlag();
      if (ids.length > 0 && !shownRef.current) {
        await setModelSpaces(modelId, false);
      }
    },
    [spaceIdsOf, refreshFlag, setModelSpaces],
  );

  // After a visibility reset (everything was shown): put the default back.
  const keepHidden = useCallback(async () => {
    if (shownRef.current) return;
    await Promise.all([...modelsRef.current.keys()].map((id) => setModelSpaces(id, false)));
  }, [modelsRef, setModelSpaces]);

  // Isolating a set: leave spaces out unless the set is nothing but spaces
  // (someone asked for a room on purpose).
  const filterIds = useCallback((modelId, ids) => {
    if (shownRef.current || ids.length === 0) return ids;
    const spaces = idsRef.current.get(modelId);
    if (!spaces || spaces.length === 0) return ids;
    const set = new Set(spaces);
    const kept = ids.filter((id) => !set.has(id));
    return kept.length > 0 ? kept : ids;
  }, []);

  // Applies the flag when nothing is isolated. `reisolate` re-runs the active
  // isolation instead (it decides what shows).
  const setSpacesShown = useCallback(
    async (on, reisolate) => {
      shownRef.current = on;
      setShown(on);
      try {
        window.sessionStorage.setItem(STORAGE_KEY, on ? "1" : "0");
      } catch {
        /* private mode: the choice just lasts until reload */
      }
      if (reisolate) await reisolate();
      else await Promise.all([...modelsRef.current.keys()].map((id) => setModelSpaces(id, on)));
      await redraw();
    },
    [modelsRef, setModelSpaces, redraw],
  );

  // Forget the spaces of models that were removed.
  const modelIds = models.map((m) => m.id).join("|");
  useEffect(() => {
    const present = new Set(models.map((m) => m.id));
    for (const id of [...idsRef.current.keys()]) if (!present.has(id)) idsRef.current.delete(id);
    refreshFlag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelIds, refreshFlag]);

  return { shown, hasSpaces, hideOnLoad, keepHidden, filterIds, setSpacesShown };
}

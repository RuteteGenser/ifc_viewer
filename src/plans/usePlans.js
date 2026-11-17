import { useEffect, useRef, useState } from "react";
import { closeRawIfcModel, openRawIfcModel } from "../ifc/rawIfcQuery";
import { extractStoreys } from "./floorPlans";

const FLOOR_MERGE_TOLERANCE_M = 0.25;

// Extracted storeys are cached per model id so switching pages (or other
// models loading) never re-parses a model that's already been processed.
export function usePlans({ active, models, getModelSources }) {
  const cacheRef = useRef(new Map()); // modelId -> { name, storeys, planNorthBearing }
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const modelIds = models.map((m) => m.id).join(",");

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const sources = getModelSources();
    const loaded = new Set(sources.map((s) => s.id));
    let changed = false;
    for (const id of [...cacheRef.current.keys()]) {
      if (!loaded.has(id)) {
        cacheRef.current.delete(id);
        changed = true;
      }
    }
    const todo = sources.filter((s) => !cacheRef.current.has(s.id));
    if (todo.length === 0) {
      if (changed) setVersion((v) => v + 1);
      return undefined;
    }
    (async () => {
      setBusy(true);
      setError(null);
      // Let the "Building plans…" state paint before the (synchronous) extraction.
      await new Promise((r) => setTimeout(r, 30));
      for (const src of todo) {
        if (cancelled) return;
        let handle = null;
        try {
          handle = await openRawIfcModel(src.bytes);
          const { storeys, planNorthBearing } = extractStoreys(handle.api, handle.modelID);
          cacheRef.current.set(src.id, { name: src.name, storeys, planNorthBearing });
        } catch (err) {
          console.error("Floor plan extraction failed", err);
          setError(`Could not build plans for "${src.name}": ${err?.message ?? err}`);
        } finally {
          closeRawIfcModel(handle);
        }
      }
      if (!cancelled) {
        setBusy(false);
        setVersion((v) => v + 1);
      }
    })();
    return () => {
      cancelled = true;
      setBusy(false);
    };
  }, [active, modelIds, getModelSources]);

  // Merge same-level storeys from different models (e.g. architect + HVAC)
  // into one floor so their section lines draw on a single plan.
  const floors = [];
  for (const entry of cacheRef.current.values()) {
    for (const storey of entry.storeys) {
      let floor = floors.find((f) => Math.abs(f.elevation - storey.elevation) <= FLOOR_MERGE_TOLERANCE_M);
      if (!floor) {
        floor = { key: "", name: storey.name, elevation: storey.elevation, height: storey.height, storeys: [] };
        floors.push(floor);
      }
      floor.storeys.push({ modelName: entry.name, storey });
      floor.height = Math.max(floor.height, storey.height);
    }
  }
  floors.sort((a, b) => a.elevation - b.elevation);
  floors.forEach((f) => {
    f.key = f.elevation.toFixed(2);
  });

  const north = [...cacheRef.current.values()].find((e) => e.planNorthBearing !== null)?.planNorthBearing ?? null;
  const modelNames = [...cacheRef.current.values()].map((e) => e.name);

  // `version` is only read to re-render after the cache mutates.
  void version;
  return { floors, planNorthBearing: north, modelNames, busy, error };
}

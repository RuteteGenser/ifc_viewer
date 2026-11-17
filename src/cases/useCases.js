import { useCallback, useEffect, useState } from "react";
import { deleteCaseRecord, loadAllCases, newId, revokeBlobUrl, saveCase } from "./caseStore";

/**
 * React state for all cases, mirrored to IndexedDB. Case shape:
 * { id, title, summary, disciplines: string[], point: [x,y,z] (modelsGroup-
 *   local, same frame as measurements), modelName, element: {name,category,guid}|null,
 *   createdAt, updatedAt, photos: [{ id, name, addedAt, blob, thumb }] }
 */
export function useCases({ onError }) {
  const [cases, setCases] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadAllCases()
      .then((rows) => {
        if (!cancelled) setCases(rows);
      })
      .catch((err) => onError?.(`Could not open saved cases: ${err?.message ?? err}`))
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const upsertCase = useCallback(
    async (draft) => {
      const now = Date.now();
      const record = {
        ...draft,
        id: draft.id ?? newId(),
        createdAt: draft.createdAt ?? now,
        updatedAt: now,
      };
      try {
        await saveCase(record);
      } catch (err) {
        onError?.(`Could not save case: ${err?.message ?? err}`);
        return null;
      }
      setCases((prev) => {
        const without = prev.filter((c) => c.id !== record.id);
        return [record, ...without].sort((a, b) => b.createdAt - a.createdAt);
      });
      return record;
    },
    [onError],
  );

  const removeCase = useCallback(
    async (id) => {
      try {
        await deleteCaseRecord(id);
      } catch (err) {
        onError?.(`Could not delete case: ${err?.message ?? err}`);
        return;
      }
      setCases((prev) => {
        const target = prev.find((c) => c.id === id);
        target?.photos.forEach((p) => {
          revokeBlobUrl(p.blob);
          revokeBlobUrl(p.thumb);
        });
        return prev.filter((c) => c.id !== id);
      });
    },
    [onError],
  );

  return { cases, loaded, upsertCase, removeCase };
}

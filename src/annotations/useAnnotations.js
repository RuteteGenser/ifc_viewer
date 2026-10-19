import { useCallback, useEffect, useRef, useState } from "react";
import { annotationsReducer, initialState } from "./reducer";

// Edits the annotation array of one snapshot. `annotations` is the source of truth when it
// changes from outside (another snapshot: history resets); every edit calls onChange(next).
export function useAnnotations(annotations, onChange) {
  const [state, setState] = useState(() => initialState(annotations || []));
  const ref = useRef(state);
  const emitted = useRef(annotations);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (annotations === emitted.current) return;
    emitted.current = annotations;
    ref.current = initialState(annotations || []);
    setState(ref.current);
  }, [annotations]);

  const dispatch = useCallback((action) => {
    const next = annotationsReducer(ref.current, action);
    if (next === ref.current) return;
    ref.current = next;
    setState(next);
    emitted.current = next.items;
    cb.current?.(next.items);
  }, []);

  return {
    items: state.items,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    add: useCallback((annotation) => dispatch({ type: "add", annotation }), [dispatch]),
    update: useCallback((id, patch) => dispatch({ type: "update", id, patch }), [dispatch]),
    remove: useCallback((id) => dispatch({ type: "remove", id }), [dispatch]),
    undo: useCallback(() => dispatch({ type: "undo" }), [dispatch]),
    redo: useCallback(() => dispatch({ type: "redo" }), [dispatch]),
  };
}

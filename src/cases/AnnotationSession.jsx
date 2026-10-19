// Shows the annotations of one snapshot over the 3D view: editable (toolbar) while annotating, read-only otherwise.
// Edits go to the cases store after a 400 ms pause, and at once when the snapshot changes or this unmounts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AnnotationLayer from "../annotations/AnnotationLayer";
import Annotations from "../annotations/Annotations";
import { store } from "./store";
import { updateSnapshot } from "./caseOps";
import { newId } from "./ids";

const DEBOUNCE_MS = 400;

function Body({ viewer, caseId, snapshotId, items: initial, edit, onDone, onSaveFailed, exportRef }) {
  const [items, setItems] = useState(initial);
  const [selectedId, setSelectedId] = useState(null);
  const pending = useRef(null);
  const timer = useRef(0);
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    try {
      const c = await store.getCase(caseId);
      if (c && c.snapshots.some((s) => s.id === snapshotId)) await store.saveCase(updateSnapshot(c, snapshotId, { annotations: next }));
    } catch { onSaveFailed?.(); }
  }, [caseId, snapshotId, onSaveFailed]);
  useEffect(() => flush, [flush]);
  // "Save snapshot" while annotating: the marks, moved to the live world frame, for the new snapshot.
  const live = useRef(items);
  live.current = items;
  useEffect(() => {
    if (!exportRef || !edit) return undefined;
    exportRef.current = () => live.current.map((a) => ({
      ...a, id: newId(),
      anchor: a.anchor && { ...a.anchor, point: viewer.toWorld(a.anchor.point) },
      target: a.target && { ...a.target, point: viewer.toWorld(a.target.point) },
      path: a.path && a.path.map(viewer.toWorld),
    }));
    return () => { exportRef.current = null; };
  }, [exportRef, edit, viewer]);
  const onChange = useCallback((next) => {
    setItems(next);
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, DEBOUNCE_MS);
  }, [flush]);
  useEffect(() => {
    if (!import.meta.env.VITE_TEST_HOOK) return undefined;
    window.__annotSession = { viewer, caseId, snapshotId, edit, getItems: () => items, flush };
    return () => { delete window.__annotSession; };
  });
  return edit
    ? <Annotations viewer={viewer} annotations={items} onChange={onChange} onDone={onDone} />
    : <AnnotationLayer viewer={viewer} annotations={items} readOnly selectedId={selectedId} onSelect={setSelectedId} />;
}

// target: { caseId, snapshotId }. edit: boolean. viewer: the cases adapter.
export default function AnnotationSession({ viewer, target, edit, onDone, onSaveFailed, exportRef }) {
  const { caseId, snapshotId } = target;
  const [loaded, setLoaded] = useState(null);
  const base = useRef(null);
  const av = useMemo(() => viewer.annotationViewer(() => base.current), [viewer]);
  useEffect(() => {
    let live = true;
    const load = () => store.getCase(caseId).then((c) => {
      const s = c?.snapshots.find((x) => x.id === snapshotId);
      if (!live || !s) return;
      base.current = s.view?.modelPose || null;
      // Read-only: follow edits made elsewhere. Editing: the layer owns the array.
      setLoaded((prev) => (prev && prev.key === `${caseId}/${snapshotId}` && edit ? prev : { key: `${caseId}/${snapshotId}`, items: s.annotations || [] }));
    }, () => {});
    load();
    const off = edit ? null : store.subscribe((e) => { if (!e || e.id === caseId) load(); });
    return () => { live = false; off?.(); };
  }, [caseId, snapshotId, edit]);
  if (!loaded || loaded.key !== `${caseId}/${snapshotId}`) return null;
  return <Body key={`${loaded.key}/${edit}`} viewer={av} caseId={caseId} snapshotId={snapshotId} items={loaded.items} edit={edit} onDone={onDone} onSaveFailed={onSaveFailed} exportRef={exportRef} />;
}

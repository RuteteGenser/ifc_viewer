// The Cases menu: list of cases, new case, import, storage notices. A bottom sheet on phones, a panel on the right on desktop.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import usePresence from "../usePresence";
import useSheetSwipe from "../ui/useSheetSwipe";
import { useLibraryContext } from "../library/LibraryContext";
import ConfirmDialog from "../components/ConfirmDialog";
import CaseView from "./CaseView";
import { store } from "./store";
import { parseBcf } from "./bcf";
import { validateCase } from "./schema";
import { newId } from "./ids";
import { importKind } from "./caseOps";
import { COPY } from "./copy";
import "./cases.css";

const dateText = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); } catch { return ""; } };

function List({ cases, modelName, controller, onOpen, onWarnings, showToast }) {
  const [naming, setNaming] = useState(false);
  const fileRef = useRef(null);
  const create = async (e) => {
    e.preventDefault();
    const name = new FormData(e.currentTarget).get("name");
    const made = await controller.create(name, modelName ? { name: modelName } : {});
    setNaming(false);
    onOpen(made.id);
  };
  const importFile = async (file) => {
    if (!file) return;
    try {
      let result;
      if (importKind(file.name) === "bcf") {
        const parsed = parseBcf(new Uint8Array(await file.arrayBuffer()));
        const v = validateCase(parsed.case);
        if (!v.ok) throw new Error(v.errors[0]);
        const taken = new Set(cases.map((c) => c.id));
        if (taken.has(v.case.id)) v.case.id = newId();
        await store.saveCase(v.case, { touch: false });
        result = { id: v.case.id, warnings: [...parsed.warnings, ...v.warnings] };
      } else result = await controller.importFile(file);
      showToast(COPY.importDone(file.name));
      if (result.warnings.length) onWarnings(result.warnings);
      onOpen(result.id);
    } catch (err) { onWarnings([COPY.importFailed + ": " + (err?.message || "unknown error")]); }
  };
  return (
    <div className="cases__body">
      <div className="cases__bar">
        <button type="button" className="cases__btn" onClick={() => setNaming(true)}>{COPY.newCase}</button>
        <button type="button" className="cases__btn" onClick={() => fileRef.current?.click()}>{COPY.importFile}</button>
        <input ref={fileRef} type="file" hidden accept=".json,.bcf,.bcfzip,.zip,application/json" aria-label={COPY.importFile}
          onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {naming && (
        <form className="cases__row" onSubmit={create}>
          <input name="name" className="cases__input" aria-label={COPY.newCaseName} defaultValue={modelName ? `${modelName} case` : "New case"} maxLength={200} autoFocus />
          <button type="submit" className="cases__btn cases__btn--primary">{COPY.create}</button>
          <button type="button" className="cases__btn" onClick={() => setNaming(false)}>{COPY.cancel}</button>
        </form>
      )}
      {cases.length === 0 ? (
        <p className="cases__empty">{COPY.emptyList}<br /><small>{COPY.emptyListHint}</small></p>
      ) : (
        <ul className="cases__list">
          {cases.map((c) => (
            <li key={c.id}>
              <button type="button" className="cases__case" onClick={() => onOpen(c.id)} aria-label={`${c.name}, ${COPY.snapshots(c.snapshotCount)}`}>
                {c.thumb ? <img src={c.thumb} alt="" draggable="false" /> : <span className="cases__nothumb" />}
                <span className="cases__caseText">
                  <strong>{c.name}</strong>
                  <small>{c.model.name || "No model"}</small>
                  <small>{COPY.snapshots(c.snapshotCount)} · {COPY.updated} {dateText(c.updatedAt)}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Sheet({ state, onClose, cases, viewer, models, showToast, onSaveSnapshot, resume, onShowSnapshot, onAnnotate }) {
  const ref = useRef(null);
  const library = useLibraryContext();
  const [openId, setOpenId] = useState(cases.currentId);
  const [selectedId, setSelectedId] = useState(resume && resume.caseId === cases.currentId ? resume.snapshotId : null);
  const [warnings, setWarnings] = useState(null);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const controller = cases;
  const modelName = models[0]?.name || "";
  const closed = state === "closed";
  const swipe = useSheetSwipe(onClose, ref);
  // Tablet and desktop: the panel starts under the tool row, so the tools stay in reach.
  const [top, setTop] = useState(null);
  useLayoutEffect(() => {
    const place = () => {
      const bar = window.innerWidth > 768 ? document.querySelector(".toolbar") : null;
      const b = bar?.getBoundingClientRect().bottom;
      setTop(b && b > 0 && b < window.innerHeight / 3 ? Math.round(b + 8) : null);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  useEffect(() => {
    if (closed) return undefined;
    const previous = document.activeElement;
    ref.current?.querySelector(".cases__save, .cases__bar button, button")?.focus();
    const onKey = (e) => {
      if (e.key === "Escape" && !document.querySelector(".confirm-dialog-backdrop") && !e.defaultPrevented) { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previous?.isConnected && typeof previous.focus === "function") previous.focus();
    };
  }, [onClose, closed]);

  const open = (id) => { setOpenId(id); setSelectedId(null); if (id) controller.setCurrent(id); };
  const save = async (e) => {
    e.preventDefault();
    const title = new FormData(e.currentTarget).get("title") || "";
    setSaving(true);
    const res = await onSaveSnapshot(title);
    setSaving(false);
    if (res) { setAsking(false); setOpenId(res.caseId); setSelectedId(res.snapshotId); }
  };
  const exists = openId && cases.cases.some((c) => c.id === openId);
  // Tell the app which snapshot is on show, so its own annotations are drawn over the view while the sheet is open.
  const shown = exists && selectedId && !closed ? `${openId}\u0000${selectedId}` : null;
  useEffect(() => {
    onShowSnapshot?.(shown ? { caseId: openId, snapshotId: selectedId } : null);
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div className="cases" data-state={state} data-surface-sheet="cases" role="dialog" aria-label={COPY.title} ref={ref} style={top ? { top } : undefined}>
      <div className="cases__head" {...swipe.head}>
        <h2 className="cases__title">{COPY.title}</h2>
        <button type="button" className="cases__btn cases__btn--quiet" onClick={onClose}>{COPY.done}</button>
      </div>
      {!cases.persistent && <p className="cases__banner cases__banner--warn" role="status">{COPY.notSaved}</p>}
      {cases.error && <p className="cases__banner cases__banner--warn" role="alert">{cases.error}</p>}
      {asking ? (
        <form className="cases__row" onSubmit={save}>
          <input name="title" className="cases__input" aria-label={COPY.saveSnapshotTitle} placeholder={COPY.saveSnapshotTitle} maxLength={200} autoFocus />
          <button type="submit" className="cases__btn cases__btn--primary" disabled={saving}>{COPY.saveHere}</button>
          <button type="button" className="cases__btn" onClick={() => setAsking(false)}>{COPY.cancel}</button>
        </form>
      ) : (
        <button type="button" className="cases__btn cases__btn--primary cases__save" disabled={models.length === 0} onClick={() => setAsking(true)}>{COPY.saveSnapshot}</button>
      )}
      <div className="cases__scroll">
      {exists ? (
        <CaseView
          caseId={openId} viewer={viewer} library={library} controller={controller} showToast={showToast}
          modelKey={models.map((m) => m.id).join("|")}
          selectedId={selectedId} onSelect={setSelectedId}
          onBack={() => open(null)} onOpen={open} onWarnings={setWarnings} onAnnotate={onAnnotate}
        />
      ) : (
        <List cases={cases.cases} modelName={modelName} controller={controller} onOpen={open} onWarnings={setWarnings} showToast={showToast} />
      )}
      </div>
      {warnings && (
        <ConfirmDialog title={COPY.warnings} message={warnings.slice(0, 8).join(" ")} confirmLabel="OK" cancelLabel={COPY.cancel} onConfirm={() => setWarnings(null)} onCancel={() => setWarnings(null)} />
      )}
    </div>,
    document.body,
  );
}

// Stays mounted for the exit animation; `open` false plays it, then unmounts.
export default function CasesPanel({ open, ...props }) {
  const { mounted, state } = usePresence(open, 160);
  const last = useRef(props);
  if (open) last.current = props;
  if (!mounted) return null;
  return <Sheet state={state} onClose={props.onClose} {...(open ? props : last.current)} />;
}

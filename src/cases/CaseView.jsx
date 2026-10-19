// One open case: snapshot strip, previous/next, note editing, model match banner, export. Frontend only.
import { useCallback, useEffect, useRef, useState } from "react";
import { store } from "./store";
import { matchModel, caseGuids } from "./match";
import { buildCasePdf, downloadPdf } from "./pdf";
import { buildBcf } from "./bcf";
import { burnAnnotations } from "./burnAnnotations";
import { slugify } from "./files";
import { downloadBlob } from "./download";
import { moveSnapshot, removeSnapshot, updateSnapshot, indexAfter, caseBytes } from "./caseOps";
import { COPY, localeOf } from "./copy";
import { LIMITS } from "./schema";
import ConfirmDialog from "../components/ConfirmDialog";

const LARGE_BYTES = 10 * 1024 * 1024;

// The full case (with images), reloaded whenever the store reports a change to it.
function useFullCase(id) {
  const [c, setC] = useState(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => store.getCase(id).then((x) => { setC(x); setFailed(!x); }, () => setFailed(true)), [id]);
  useEffect(() => {
    load();
    return store.subscribe((e) => { if (!e || e.id === id) load(); });
  }, [id, load]);
  return [c, failed];
}

// How well the open model fits the case. null while unknown or when there is no model.
function useMatch(c, viewer, modelKey) {
  const [match, setMatch] = useState(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const info = c && (await viewer.getModelInfo());
      if (!live) return;
      if (!info) { setMatch({ level: "nomodel" }); return; }
      const guids = caseGuids(c);
      let set = null;
      if (guids.length) { const { missing } = await viewer.hasGuids(guids); set = new Set(guids.filter((g) => !missing.includes(g))); }
      if (live) setMatch(matchModel(c.model, info, guids, set));
    })();
    return () => { live = false; };
  }, [c?.id, c?.updatedAt, viewer, modelKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return match;
}

function MatchBanner({ c, match, library }) {
  if (!match || match.level === "exact") return null;
  if (match.level === "nomodel") return <p className="cases__banner" role="status">Open the model to jump between snapshots.</p>;
  if (match.level === "name") return <p className="cases__banner" role="status">{COPY.matchName}</p>;
  if (match.level === "guid") return <p className="cases__banner" role="status">{COPY.matchGuid}</p>;
  const item = library?.items?.find((i) => i.name === c.model.name);
  return (
    <div className="cases__banner cases__banner--warn" role="alert">
      <p>{COPY.matchNone(c.model.name)}</p>
      {item && <button type="button" className="cases__btn" onClick={() => library.open(item)}>{COPY.openInLibrary(item.name)}</button>}
    </div>
  );
}

export default function CaseView({ caseId, viewer, library, modelKey, controller, showToast, selectedId, onSelect, onBack, onOpen, onWarnings, onAnnotate }) {
  const [c, failed] = useFullCase(caseId);
  const match = useMatch(c, viewer, modelKey);
  const [notFound, setNotFound] = useState(0);
  const [confirm, setConfirm] = useState(null); // "case" | "snapshot"
  const [exportOpen, setExportOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [quota, setQuota] = useState(false);
  const itemRefs = useRef({});

  const snaps = c?.snapshots || [];
  const index = indexAfter(c || { snapshots: [] }, selectedId, 0);
  const snap = snaps[index];

  useEffect(() => { store.estimateQuota().then((q) => setQuota(!!q && q.ratio > 0.8)); }, [c?.updatedAt]);
  useEffect(() => { if (snap && snap.id !== selectedId) onSelect(snap.id); }, [snap?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = snap && itemRefs.current[snap.id];
    const strip = el?.parentElement;
    if (!strip) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Scroll the strip only (scrollIntoView would also move the panel).
    strip.scrollTo?.({ left: el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2, behavior: reduced ? "auto" : "smooth" });
  }, [snap?.id]);

  const save = (next) => store.saveCase(next).catch(() => showToast(COPY.saveFailed));
  const jump = async (target) => {
    if (!target) return;
    onSelect(target.id);
    const res = await viewer.applyView(target.view, { animate: true });
    setNotFound(res?.missing || 0);
  };
  const go = (i) => { const t = snaps[Math.min(Math.max(i, 0), snaps.length - 1)]; if (t && t.id !== snap?.id) jump(t); };
  const onStripKey = (e) => {
    const to = e.key === "ArrowLeft" ? index - 1 : e.key === "ArrowRight" ? index + 1 : e.key === "Home" ? 0 : e.key === "End" ? snaps.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const t = snaps[Math.min(Math.max(to, 0), snaps.length - 1)];
    if (t) { itemRefs.current[t.id]?.focus(); if (t.id !== snap?.id) jump(t); }
  };

  const doExport = async (kind) => {
    setExportOpen(false);
    try {
      const full = await store.getCase(caseId);
      const base = slugify(full.name);
      if (kind === "pdf") {
        const snapshots = await Promise.all(full.snapshots.map(async (s) => (s.annotations.length ? { ...s, image: await burnAnnotations(s.image || s.thumb, s) } : s)));
        await downloadPdf(buildCasePdf({ ...full, snapshots }, { locale: localeOf() }), `${base}.pdf`);
      }
      else if (kind === "bcf") downloadBlob(new Blob([buildBcf(full)], { type: "application/octet-stream" }), `${base}.bcf`);
      else { const { blob, filename, warnings } = await controller.exportCase(caseId); downloadBlob(blob, filename); if (warnings.length) onWarnings(warnings); }
      showToast(COPY.exported(kind === "pdf" ? "PDF" : kind === "bcf" ? "BCF" : "Case file"));
    } catch { showToast(COPY.exportFailed); }
  };

  if (failed) return <div className="cases__body"><p className="cases__empty">{COPY.loadFailed}</p><button type="button" className="cases__btn" onClick={onBack}>{COPY.back}</button></div>;
  if (!c) return <div className="cases__body" aria-busy="true" />;
  const bytes = caseBytes(c);

  return (
    <div className="cases__body">
      <div className="cases__bar">
        <button type="button" className="cases__btn" onClick={onBack}>{COPY.back}</button>
        <button type="button" className="cases__btn" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((v) => !v)}>{COPY.export}</button>
      </div>
      {exportOpen && (
        <div className="cases__menu" role="menu" aria-label={COPY.export}>
          <button type="button" role="menuitem" className="cases__btn" onClick={() => doExport("pdf")}>{COPY.exportPdf}</button>
          <button type="button" role="menuitem" className="cases__btn" onClick={() => doExport("bcf")}>{COPY.exportBcf}</button>
          <button type="button" role="menuitem" className="cases__btn" onClick={() => doExport("file")}>{COPY.exportFile}</button>
        </div>
      )}
      {renaming ? (
        <form className="cases__row" onSubmit={(e) => { e.preventDefault(); controller.rename(c.id, new FormData(e.currentTarget).get("name")); setRenaming(false); }}>
          <input name="name" className="cases__input" aria-label="Case name" defaultValue={c.name} maxLength={LIMITS.nameChars} autoFocus />
          <button type="submit" className="cases__btn cases__btn--primary">{COPY.saveHere}</button>
        </form>
      ) : (
        <h3 className="cases__name"><button type="button" className="cases__linklike" aria-label={`${COPY.rename} ${c.name}`} onClick={() => setRenaming(true)}>{c.name}</button></h3>
      )}
      <p className="cases__meta">{c.model.name} · {COPY.snapshots(snaps.length)}</p>
      <MatchBanner c={c} match={match} library={library} />
      {bytes > LARGE_BYTES && <p className="cases__banner" role="status">{COPY.large(Math.round(bytes / 1048576))}</p>}
      {quota && <p className="cases__banner cases__banner--warn" role="status">{COPY.quota}</p>}

      {snaps.length === 0 ? <p className="cases__empty">{COPY.emptyCase}</p> : (
        <>
          <div className="cases__nav">
            <button type="button" className="cases__btn cases__btn--big" onClick={() => go(index - 1)} disabled={index <= 0} aria-label={COPY.previous}>&lsaquo; {COPY.previous}</button>
            <span className="cases__count" aria-live="polite">{index + 1} / {snaps.length}</span>
            <button type="button" className="cases__btn cases__btn--big" onClick={() => go(index + 1)} disabled={index >= snaps.length - 1} aria-label={COPY.next}>{COPY.next} &rsaquo;</button>
          </div>
          <div className="cases__strip" role="listbox" aria-label={COPY.stripLabel} aria-orientation="horizontal" onKeyDown={onStripKey}>
            {snaps.map((s, i) => (
              <button
                key={s.id}
                ref={(el) => { itemRefs.current[s.id] = el; }}
                type="button"
                role="option"
                aria-selected={s.id === snap.id}
                aria-label={COPY.snapshotLabel(i + 1, s.title)}
                tabIndex={s.id === snap.id ? 0 : -1}
                className="cases__thumb"
                onClick={() => jump(s)}
              >
                {s.thumb ? <img src={s.thumb} alt="" draggable="false" /> : <span className="cases__nothumb" />}
                <span className="cases__num">{i + 1}</span>
              </button>
            ))}
          </div>
          <div className="cases__detail" key={snap.id}>
            <input
              className="cases__input"
              aria-label={COPY.titleField}
              placeholder={COPY.untitled(index + 1)}
              defaultValue={snap.title}
              maxLength={LIMITS.titleChars}
              onBlur={(e) => e.target.value !== snap.title && save(updateSnapshot(c, snap.id, { title: e.target.value.trim() }))}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <textarea
              className="cases__input cases__note"
              aria-label={COPY.noteField}
              placeholder={COPY.notePlaceholder}
              defaultValue={snap.note}
              maxLength={LIMITS.textChars}
              rows={3}
              onBlur={(e) => e.target.value !== snap.note && save(updateSnapshot(c, snap.id, { note: e.target.value }))}
            />
            {notFound > 0 && <p className="cases__banner cases__banner--warn" role="status">{COPY.notFound(notFound)}</p>}
            {snap.annotations.length > 0 && (
              <div>
                <h4 className="cases__sub">{COPY.annotations} ({snap.annotations.length})</h4>
                <ol className="cases__annos">
                  {snap.annotations.map((a) => <li key={a.id}><span className="cases__dot" style={{ background: a.color }} aria-hidden="true" />{a.type}{a.text ? `: ${a.text}` : ""}</li>)}
                </ol>
              </div>
            )}
            <div className="cases__row">
              <button type="button" className="cases__btn cases__btn--primary" onClick={async () => { await jump(snap); onAnnotate?.({ caseId, snapshotId: snap.id }); }}>{COPY.annotate}</button>
            </div>
            <div className="cases__row">
              <button type="button" className="cases__btn" disabled={index === 0} onClick={() => { save(moveSnapshot(c, snap.id, -1)); }}>{COPY.moveLeft}</button>
              <button type="button" className="cases__btn" disabled={index === snaps.length - 1} onClick={() => { save(moveSnapshot(c, snap.id, 1)); }}>{COPY.moveRight}</button>
              <button type="button" className="cases__btn cases__btn--danger" onClick={() => setConfirm("snapshot")}>{COPY.deleteSnapshot}</button>
            </div>
          </div>
        </>
      )}

      <div className="cases__row">
        <button type="button" className="cases__btn" onClick={() => controller.duplicate(c.id).then((d) => { showToast("Duplicated"); onOpen(d.id); })}>{COPY.duplicate}</button>
        <button type="button" className="cases__btn cases__btn--danger" onClick={() => setConfirm("case")}>{COPY.deleteCase}</button>
      </div>

      {confirm === "case" && (
        <ConfirmDialog title={COPY.deleteCaseTitle} message={COPY.deleteCaseMessage(c.name)} confirmLabel={COPY.delete} cancelLabel={COPY.cancel} initialFocus="cancel" danger
          onCancel={() => setConfirm(null)} onConfirm={async () => { setConfirm(null); await controller.remove(c.id); onOpen(null); }} />
      )}
      {confirm === "snapshot" && snap && (
        <ConfirmDialog title={COPY.deleteSnapshotTitle} message={COPY.deleteSnapshotMessage} confirmLabel={COPY.delete} cancelLabel={COPY.cancel} initialFocus="cancel" danger
          onCancel={() => setConfirm(null)} onConfirm={() => { const next = removeSnapshot(c, snap.id); setConfirm(null); onSelect(next.snapshots[Math.min(index, next.snapshots.length - 1)]?.id || null); save(next); }} />
      )}
    </div>
  );
}

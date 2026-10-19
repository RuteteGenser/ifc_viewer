import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ConfirmDialog from "../components/ConfirmDialog";
import ModelName from "../components/ModelName";
import { useLibraryContext } from "./LibraryContext";
import { formatSize, relativeDate } from "./format";
import { applyOrganize, loadState, saveState } from "./organize";
import OrganizeBar from "./OrganizeBar";
import { FolderBar, FolderRow, MovePicker, dragModel, useFrozen } from "./FolderUI";
import { childrenOf, pathLabel, scopeModels } from "./folders";
import { useAccess } from "../access/AccessProvider";
import { AccountButton } from "../access/AccessUI";
import { quotaText } from "../access/AccountPage";
import { t } from "../access/copy";
import { useListSwap } from "../usePresence";

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function RenameForm({ item, onDone }) {
  const library = useLibraryContext();
  const [value, setValue] = useState(item.name);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => {
    const el = inputRef.current;
    el?.focus();
    // Select the name without the extension so typing replaces just the name.
    const dot = item.name.lastIndexOf(".");
    el?.setSelectionRange(0, dot > 0 ? dot : item.name.length);
  }, [item.name]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const problem = await library.rename(item, value);
    setBusy(false);
    if (problem) setError(problem);
    else onDone();
  };
  return (
    <form
      className="lib-rename"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.nativeEvent.stopPropagation();
          onDone();
        }
      }}
    >
      <label className="lib-rename__label">
        <span className="lib-visually-hidden">New name for {item.name}</span>
        <input
          ref={inputRef}
          className="lib-rename__input"
          value={value}
          maxLength={200}
          aria-invalid={error ? "true" : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
          }}
        />
      </label>
      <button type="submit" className="lib-btn lib-btn--primary" disabled={busy}>
        Save
      </button>
      <button type="button" className="lib-btn" onClick={onDone}>
        Cancel
      </button>
      {error && (
        <p className="lib-rename__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function ModelItem({ item, showPath }) {
  const library = useLibraryContext();
  const frozen = useFrozen();
  const [moving, setMoving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Esc folds the actions away and a finished rename both leave focus on the row's More button, not on the page start.
  const moreRef = useRef(null);
  const wasRenaming = useRef(false);
  useEffect(() => {
    if (wasRenaming.current && !renaming) moreRef.current?.focus();
    wasRenaming.current = renaming;
  }, [renaming]);
  const loaded = library.loadedNames.has(item.name);
  const busy = !!library.download;
  const sample = item.owner === "samples";
  const locked = item.readOnly === true;
  const meta = [formatSize(item.size), relativeDate(item.uploadedAt)].filter(Boolean).join(" · ");
  const canMove = !!library.folders && !sample && !locked;
  const place = showPath && library.folders ? (item.folderId ? pathLabel(library.folders, item.folderId) : "Top level") : "";

  if (renaming) {
    return (
      <li className="lib-row lib-row--editing">
        <RenameForm item={item} onDone={() => setRenaming(false)} />
      </li>
    );
  }
  return (
    <li
      className={`lib-row${loaded ? " lib-row--loaded" : ""}`}
      draggable={canMove && !frozen ? true : undefined}
      onDragStart={canMove && !frozen ? (e) => dragModel.start(e, item) : undefined}
      onDragEnd={canMove && !frozen ? dragModel.end : undefined}
    >
      <div className="lib-row__line">
        <button
          type="button"
          className="lib-row__main"
          disabled={busy && !loaded}
          aria-label={loaded ? `${item.name}, already open` : `Open ${item.name}`}
          onClick={() => library.open(item)}
        >
          <ModelName name={item.name} className="lib-row__name" />
          <span className="lib-row__meta">
            {sample && <span className="lib-badge">{t("lib.sample")}</span>}
            {item.schema && <span className="lib-badge">{item.schema}</span>}
            {meta}
            {loaded && <span className="lib-badge lib-badge--open">Open</span>}
            {place && <span className="lib-row__path" data-testid="lib-path">in {place}</span>}
          </span>
        </button>
        <button
          type="button"
          ref={moreRef}
          className="lib-icon-btn"
          aria-label={`More actions for ${item.name}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <MoreIcon />
        </button>
      </div>
      {expanded && (
        <div
          className="lib-row__actions"
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.nativeEvent.stopPropagation();
            setExpanded(false);
            moreRef.current?.focus();
          }}
        >
          {!loaded && (
            <button
              type="button"
              className="lib-btn"
              disabled={busy}
              onClick={() => {
                setExpanded(false);
                library.open(item);
              }}
            >
              Open
            </button>
          )}
          {!locked && (
            <button
              type="button"
              className="lib-btn"
              onClick={() => {
                setRenaming(true);
                setExpanded(false);
              }}
            >
              Rename
            </button>
          )}
          {!loaded && library.hasModels && (
            <button
              type="button"
              className="lib-btn"
              disabled={busy}
              onClick={() => {
                setExpanded(false);
                library.addToView(item);
              }}
            >
              Add to view
            </button>
          )}
          {canMove && (
            <button type="button" className="lib-btn" disabled={frozen} title={frozen ? "Your plan is read-only right now." : undefined} onClick={() => setMoving(true)}>
              Move to...
            </button>
          )}
          {!sample && (
            <button type="button" className="lib-btn" onClick={() => library.copyLink(item)}>
              Copy link
            </button>
          )}
          {!sample && item.canDelete !== false && (
            <button type="button" className="lib-btn lib-btn--danger" onClick={() => setConfirming(true)}>
              Delete
            </button>
          )}
        </div>
      )}
      {moving && <MovePicker title={`Move "${item.name}" to`} current={item.folderId ?? null} onPick={(target) => library.moveModel(item, target)} onClose={() => setMoving(false)} />}
      {confirming &&
        createPortal(
          <ConfirmDialog
            title="Delete this model?"
            message={`"${item.name}" will be removed from my models on every device. Files on your devices are not affected.`}
            confirmLabel="Delete"
            initialFocus="cancel"
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              library.remove(item);
            }}
          />,
          document.body,
        )}
    </li>
  );
}

function SampleItem() {
  const library = useLibraryContext();
  const loaded = library.loadedNames.has("Sample building");
  return (
    <li className={`lib-row${loaded ? " lib-row--loaded" : ""}`}>
      <div className="lib-row__line">
        <button
          type="button"
          className="lib-row__main"
          aria-label={loaded ? "Sample building, already open" : "Open Sample building"}
          onClick={() => (loaded ? library.open({ name: "Sample building" }) : library.openSample())}
        >
          <span className="lib-row__name">Sample building</span>
          <span className="lib-row__meta">
            Built in
            {loaded && <span className="lib-badge lib-badge--open">Open</span>}
          </span>
        </button>
      </div>
    </li>
  );
}

const SIDEBAR_ROWS = 3;

// While the first fetch is pending: two rows the size of real ones. It appears only if the answer is
// slow (so a fast answer never flashes it) and is replaced in place by the list.
function LibrarySkeleton() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setShow(true), 300);
    return () => clearTimeout(id);
  }, []);
  if (!show) return null;
  return (
    <ul className="lib-list lib-skel" role="status" aria-label="Loading my models">
      {[0, 1].map((i) => (
        <li className="lib-row lib-row--skel" key={i} aria-hidden="true">
          <div className="lib-skel__bar" />
          <div className="lib-skel__bar" />
        </li>
      ))}
    </ul>
  );
}

// variant "empty": inside the start card. variant "sidebar": collapsible section.
export default function LibrarySection({ variant }) {
  const library = useLibraryContext();
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [state, setState] = useState(() => ({ ...loadState() }));
  const listRef = useRef(null);
  useEffect(() => saveState(state), [state]);
  const items = library?.items;
  const loadedNames = library?.loadedNames;
  const access = useAccess();
  const folders = library?.folders ?? null;
  const folderId = library?.folderId ?? null;
  const searching = !!folders && state.query.trim() !== "";
  const allOwn = useMemo(() => (items || []).filter((i) => i.owner !== "samples"), [items]);
  const result = useMemo(
    () =>
      applyOrganize({
        own: scopeModels(allOwn, { folderId, searching, enabled: !!folders }),
        samples: (items || []).filter((i) => i.owner === "samples"),
        state,
        loadedNames: loadedNames || new Set(),
      }),
    [items, allOwn, state, loadedNames, folders, folderId, searching],
  );
  const swapKey = `${folderId}|${state.sort}|${state.dir}|${state.formats}|${state.disciplines}|${state.openNow}`;
  useListSwap(listRef, swapKey);
  if (!library || !library.available) return null;
  if (library.status === "loading") return <LibrarySkeleton />;
  const isSidebar = variant === "sidebar";
  const headingId = `lib-heading-${variant}`;
  const listId = `lib-list-${variant}`;
  // In the drawer the list is part of the one scrolling column, so it shows a
  // few rows and a button for the rest, instead of scrolling inside the scroll.
  const subfolders = folders && !searching ? childrenOf(folders, folderId) : [];
  const sampleRecords = folders && folderId ? [] : result.samples;
  const own = result.own;
  const rows = isSidebar && !showAll ? own.slice(0, SIDEBAR_ROWS) : own;
  const hidden = own.length - rows.length;
  const clear = () => setState((p) => ({ ...p, query: "", formats: [], disciplines: [], openNow: false }));
  const clearSearch = () => setState((p) => ({ ...p, query: "" }));
  const canOpenNow = (items || []).some((i) => i.owner !== "samples" && loadedNames.has(i.name));
  const body = (
    <>
      {library.status === "error" ? (
        <p className="lib-quiet" role="status">
          {library.listError}{" "}
          <button type="button" className="lib-link" onClick={library.refresh}>
            Retry
          </button>
        </p>
      ) : (
        <>
          {(result.total > 1 || (folders && allOwn.length > 1)) && (
            <OrganizeBar id={`lib-org-${variant}`} state={result.state} setState={setState} result={result} canOpenNow={canOpenNow} searchTotal={allOwn.length} />
          )}
          {folders && <FolderBar searching={searching} onClear={clearSearch} />}
          <ul className="lib-list" ref={listRef} id={listId} aria-labelledby={headingId}>
            {access && !(folders && folderId) && <li className="lib__group" aria-hidden="true">{t("lib.samples")}</li>}
            {result.builtIn && !(folders && folderId) && <SampleItem />}
            {sampleRecords.map((item) => (
              <ModelItem key={item.id} item={item} />
            ))}
            {access && (own.length > 0 || subfolders.length > 0) && <li className="lib__group" aria-hidden="true">{t("lib.mine")}</li>}
            {subfolders.map((f) => (
              <FolderRow key={f.id} folder={f} />
            ))}
            {rows.map((item) => (
              <ModelItem key={item.id} item={item} showPath={searching} />
            ))}
          </ul>
          {access && (
            <div className="lib__account">
              <span className="lib__quota" data-testid="lib-quota">{quotaText(access.session)}</span>
              <AccountButton />
            </div>
          )}
          {isSidebar && own.length > SIDEBAR_ROWS && (
            <button type="button" className="lib-btn lib-more" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${own.length} (${hidden} more)`}
            </button>
          )}
          {result.total === 0 && !folders && <p className="lib-quiet">Save a model here to open it from any device.</p>}
          {folders && !searching && result.total === 0 && subfolders.length === 0 && (
            <p className="lib-quiet" data-testid="lib-folder-empty">
              {folderId ? "This folder is empty. Use Move to... on a model to put it here." : "Save a model here to open it from any device."}
            </p>
          )}
          {result.total > 0 && own.length === 0 && (
            <p className="lib-quiet" role="status">
              No models match.{" "}
              <button type="button" className="lib-link" onClick={clear}>
                Clear filters
              </button>
            </p>
          )}
        </>
      )}
    </>
  );
  return (
    <section className={`lib lib--${variant}`} aria-labelledby={headingId} onClick={(e) => e.stopPropagation()}>
      <div className="lib__head">
        {isSidebar ? (
          <button type="button" className="lib__toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((v) => !v)}>
            <span className="lib__chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
            <h2 className="lib__title" id={headingId}>My models</h2>
          </button>
        ) : (
          <h2 className="lib__title" id={headingId}>My models</h2>
        )}
        <button type="button" className="lib-icon-btn" aria-label="Refresh my models" onClick={library.refresh}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 11a8 8 0 1 0-2.3 5.7" />
            <path d="M20 4v7h-7" />
          </svg>
        </button>
      </div>
      {(!isSidebar || open) && body}
    </section>
  );
}

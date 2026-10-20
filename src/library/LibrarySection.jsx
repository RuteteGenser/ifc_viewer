import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ConfirmDialog from "../components/ConfirmDialog";
import ModelName from "../components/ModelName";
import { useLibraryContext } from "./LibraryContext";
import { formatSize, relativeDate } from "./format";
import { applyOrganize, loadState, saveState } from "./organize";
import OrganizeBar from "./OrganizeBar";
import { MovePicker, useFrozen } from "./FolderUI";
import { pathLabel } from "./folders";
import { useAccess } from "../access/AccessProvider";
import { AccountButton } from "../access/AccessUI";
import { LegalLinks } from "../legal/LegalPage";
import { quotaRatio, quotaText } from "../access/AccountPage";
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

export function ModelItem({ item, showPath }) {
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
    <li className={`lib-row${loaded ? " lib-row--loaded" : ""}`}>
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
            danger
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

export function SampleItem() {
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

// Plan usage, the account button and the legal links under the list (only when the access system is on).
export function LibAccount({ button = true }) {
  const access = useAccess();
  if (!access) return null;
  return (
    <div className="lib__account">
      <span className="lib__quota" data-testid="lib-quota">{quotaText(access.session)}</span>
      {quotaRatio(access.session) !== null && (
        <span className="lib__meter" aria-hidden="true">
          <span className="lib__meter-fill" style={{ width: `${Math.round(quotaRatio(access.session) * 100)}%` }} />
        </span>
      )}
      {button && <AccountButton />}
      <LegalLinks docs={["terms", "privacy"]} />
    </div>
  );
}

// While the first fetch is pending: two rows the size of real ones. It appears only if the answer is
// slow (so a fast answer never flashes it) and is replaced in place by the list.
export function LibrarySkeleton({ label = "Loading my models" }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setShow(true), 300);
    return () => clearTimeout(id);
  }, []);
  if (!show) return null;
  return (
    <ul className="lib-list lib-skel" role="status" aria-label={label}>
      {[0, 1].map((i) => (
        <li className="lib-row lib-row--skel" key={i} aria-hidden="true">
          <div className="lib-skel__bar" />
          <div className="lib-skel__bar" />
        </li>
      ))}
    </ul>
  );
}

// The saved models inside the plain start card. Only used when the backend has no projects (an older API) or the
// list could not be loaded; with projects the project browser replaces it.
export default function LibrarySection({ variant = "empty" }) {
  const library = useLibraryContext();
  const [state, setState] = useState(() => ({ ...loadState() }));
  const listRef = useRef(null);
  useEffect(() => saveState(state), [state]);
  const items = library?.items;
  const loadedNames = library?.loadedNames;
  const access = useAccess();
  const result = useMemo(
    () =>
      applyOrganize({
        own: (items || []).filter((i) => i.owner !== "samples"),
        samples: (items || []).filter((i) => i.owner === "samples"),
        state,
        loadedNames: loadedNames || new Set(),
      }),
    [items, state, loadedNames],
  );
  const swapKey = `${state.sort}|${state.dir}|${state.formats}|${state.disciplines}|${state.openNow}`;
  useListSwap(listRef, swapKey);
  if (!library || !library.available) return null;
  if (library.status === "loading") return <LibrarySkeleton />;
  const headingId = `lib-heading-${variant}`;
  const listId = `lib-list-${variant}`;
  const own = result.own;
  const clear = () => setState((p) => ({ ...p, query: "", formats: [], disciplines: [], openNow: false }));
  const canOpenNow = (items || []).some((i) => i.owner !== "samples" && loadedNames.has(i.name));
  return (
    <section className={`lib lib--${variant}`} aria-labelledby={headingId} onClick={(e) => e.stopPropagation()}>
      <div className="lib__head">
        <h2 className="lib__title" id={headingId}>My models</h2>
        <button type="button" className="lib-icon-btn" aria-label="Refresh my models" onClick={library.refresh}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 11a8 8 0 1 0-2.3 5.7" />
            <path d="M20 4v7h-7" />
          </svg>
        </button>
      </div>
      {library.status === "error" ? (
        <p className="lib-quiet" role="status">
          {library.listError}{" "}
          <button type="button" className="lib-link" onClick={library.refresh}>
            Retry
          </button>
        </p>
      ) : (
        <>
          {result.total > 1 && <OrganizeBar id={`lib-org-${variant}`} state={result.state} setState={setState} result={result} canOpenNow={canOpenNow} searchTotal={result.total} />}
          <ul className="lib-list" ref={listRef} id={listId} aria-labelledby={headingId}>
            {access && <li className="lib__group" aria-hidden="true">{t("lib.samples")}</li>}
            {result.builtIn && <SampleItem />}
            {result.samples.map((item) => (
              <ModelItem key={item.id} item={item} />
            ))}
            {access && own.length > 0 && <li className="lib__group" aria-hidden="true">{t("lib.mine")}</li>}
            {own.map((item) => (
              <ModelItem key={item.id} item={item} />
            ))}
          </ul>
          <LibAccount />
          {result.total === 0 && <p className="lib-quiet">No saved models yet.</p>}
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
    </section>
  );
}

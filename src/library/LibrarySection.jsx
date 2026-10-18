import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ConfirmDialog from "../components/ConfirmDialog";
import ModelName from "../components/ModelName";
import { useLibraryContext } from "./LibraryContext";
import { formatSize, relativeDate } from "./format";

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

function ModelItem({ item }) {
  const library = useLibraryContext();
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const loaded = library.loadedNames.has(item.name);
  const busy = !!library.download;
  const meta = [formatSize(item.size), relativeDate(item.uploadedAt)].filter(Boolean).join(" · ");

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
            {item.schema && <span className="lib-badge">{item.schema}</span>}
            {meta}
            {loaded && <span className="lib-badge lib-badge--open">Open</span>}
          </span>
        </button>
        <button
          type="button"
          className="lib-icon-btn"
          aria-label={`More actions for ${item.name}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <MoreIcon />
        </button>
      </div>
      {expanded && (
        <div className="lib-row__actions">
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
          <button type="button" className="lib-btn" onClick={() => library.copyLink(item)}>
            Copy link
          </button>
          <button type="button" className="lib-btn lib-btn--danger" onClick={() => setConfirming(true)}>
            Delete
          </button>
        </div>
      )}
      {confirming &&
        createPortal(
          <ConfirmDialog
            title="Delete this model?"
            message={`"${item.name}" will be removed from my models on every device. Files on your devices are not affected.`}
            confirmLabel="Delete"
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

// variant "empty": inside the start card. variant "sidebar": collapsible section.
export default function LibrarySection({ variant }) {
  const library = useLibraryContext();
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  if (!library || !library.available || library.status === "loading") return null;
  const isSidebar = variant === "sidebar";
  const headingId = `lib-heading-${variant}`;
  const listId = `lib-list-${variant}`;
  // In the drawer the list is part of the one scrolling column, so it shows a
  // few rows and a button for the rest, instead of scrolling inside the scroll.
  const rows = isSidebar && !showAll ? library.items.slice(0, SIDEBAR_ROWS) : library.items;
  const hidden = library.items.length - rows.length;
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
          <ul className="lib-list" id={listId} aria-labelledby={headingId}>
            <SampleItem />
            {rows.map((item) => (
              <ModelItem key={item.id} item={item} />
            ))}
          </ul>
          {isSidebar && library.items.length > SIDEBAR_ROWS && (
            <button type="button" className="lib-btn lib-more" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${library.items.length} (${hidden} more)`}
            </button>
          )}
          {library.items.length === 0 && <p className="lib-quiet">Save a model here to open it from any device.</p>}
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

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ConfirmDialog from "../components/ConfirmDialog";
import Dialog from "../access/Dialog";
import { useAccess } from "../access/AccessProvider";
import { useLibraryContext } from "./LibraryContext";
import { atLimit, canCreateIn, countText, limitHint, pathOf, pickerRows, validName } from "./folders";

const READ_ONLY = "Your plan is read-only right now, so folders cannot be changed.";
// Grace, expired and blocked accounts can look but not change (the server answers 402).
export function useFrozen() {
  const access = useAccess();
  return !!access && ["grace", "expired", "blocked"].includes(access.state);
}

// The model being dragged (a drag only carries text, so the id is kept here).
let dragging = null;
export const dragModel = {
  start: (e, item) => {
    dragging = item;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.name);
  },
  end: () => {
    dragging = null;
  },
  get: () => dragging,
};

const icon = (d) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
export const FolderIcon = () => icon(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />);
const MoreIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);

// One name field: Enter saves, Escape cancels.
function NameForm({ label, initial = "", submitLabel, onSubmit, onDone }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const submit = async (e) => {
    e.preventDefault();
    const bad = validName(value);
    if (bad) return setError(bad);
    if (value.trim() === initial) return onDone();
    setBusy(true);
    const problem = await onSubmit(value);
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
        <span className="lib-visually-hidden">{label}</span>
        <input ref={ref} className="lib-rename__input" value={value} maxLength={80} placeholder="Folder name" aria-invalid={error ? "true" : undefined} onChange={(e) => { setValue(e.target.value); setError(""); }} />
      </label>
      <button type="submit" className="lib-btn lib-btn--primary" disabled={busy}>{submitLabel}</button>
      <button type="button" className="lib-btn" onClick={onDone}>Cancel</button>
      {error && <p className="lib-rename__error" role="alert">{error}</p>}
    </form>
  );
}

// Breadcrumb ("My models / Project A / Drawings") and the New folder control.
export function FolderBar({ searching, onClear }) {
  const library = useLibraryContext();
  const frozen = useFrozen();
  const [creating, setCreating] = useState(false);
  const { folders, folderId, folderLimit } = library;
  const path = pathOf(folders, folderId);
  const full = atLimit(folders.length, folderLimit);
  const tooDeep = !canCreateIn(folders, folderId);
  const reason = frozen ? READ_ONLY : full ? `Folder limit reached (${folders.length} of ${folderLimit}).` : tooDeep ? "Folders can only go 3 levels deep." : "";
  const hint = limitHint(folders.length, folderLimit);
  return (
    <div className="lib-folderbar">
      {searching ? (
        <p className="lib-crumbs" role="status">
          <span>Search results from all folders</span>
          <button type="button" className="lib-link" onClick={onClear}>Clear</button>
        </p>
      ) : (
        path.length > 0 && (
          <nav className="lib-crumbs" aria-label="Folder path">
            <button type="button" className="lib-crumbs__btn" onClick={() => library.setFolder(null)}>My models</button>
            {path.map((f, i) => (
              <span key={f.id} className="lib-crumbs__part">
                <span aria-hidden="true"> / </span>
                {i === path.length - 1 ? (
                  <span className="lib-crumbs__here" aria-current="page">{f.name}</span>
                ) : (
                  <button type="button" className="lib-crumbs__btn" onClick={() => library.setFolder(f.id)}>{f.name}</button>
                )}
              </span>
            ))}
          </nav>
        )
      )}
      {!searching &&
        (creating ? (
          <NameForm label="Name of the new folder" submitLabel="Create" onSubmit={(name) => library.createFolder(name, folderId)} onDone={() => setCreating(false)} />
        ) : (
          <div className="lib-folderbar__row">
            <button type="button" className="lib-btn" disabled={!!reason} aria-describedby={reason ? "lib-folder-reason" : undefined} onClick={() => setCreating(true)}>
              + New folder
            </button>
            {hint && !reason && <span className="lib-quiet" data-testid="lib-folder-hint">{hint}</span>}
            {reason && <span className="lib-quiet" id="lib-folder-reason">{reason}</span>}
          </div>
        ))}
    </div>
  );
}

// Choose where a model or folder goes: the folder tree, the current place marked, "Top level" first.
export function MovePicker({ title, moving = null, current, onPick, onClose }) {
  const library = useLibraryContext();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = pickerRows(library.folders, { moving, current });
  const pick = async (row) => {
    if (row.current) return onClose();
    setBusy(true);
    const problem = await onPick(row.folder ? row.folder.id : null);
    setBusy(false);
    if (problem) setError(problem);
    else onClose();
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <ul className="fpick" aria-label="Folders">
        {rows.map((r) => (
          <li key={r.folder?.id ?? "top"}>
            <button
              type="button"
              className={`fpick__row${r.current ? " fpick__row--current" : ""}`}
              style={{ paddingLeft: 12 + r.depth * 18 }}
              disabled={busy || r.disabled}
              aria-current={r.current ? "true" : undefined}
              title={r.disabled ? "A folder cannot go here" : undefined}
              onClick={() => pick(r)}
              data-autofocus={r.current ? "" : undefined}
            >
              <FolderIcon />
              <span className="fpick__name">{r.folder ? r.folder.name : "Top level"}</span>
              {r.current && <span className="lib-badge">Current</span>}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="lib-rename__error" role="alert">{error}</p>}
    </Dialog>
  );
}

// A folder in the list: tap to open, drop a model on it to move it in.
export function FolderRow({ folder }) {
  const library = useLibraryContext();
  const frozen = useFrozen();
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState(""); // "" | rename | move | delete
  const [over, setOver] = useState(false);
  const [dropError, setDropError] = useState("");
  const close = () => setMode("");
  const dropOk = () => !frozen && !!dragModel.get() && (dragModel.get().folderId ?? null) !== folder.id;
  if (mode === "rename") {
    return (
      <li className="lib-row lib-row--editing">
        <NameForm label={`New name for ${folder.name}`} initial={folder.name} submitLabel="Save" onSubmit={(name) => library.renameFolder(folder.id, name)} onDone={close} />
      </li>
    );
  }
  return (
    <li
      className={`lib-row lib-folder${over ? " lib-folder--over" : ""}`}
      data-folder={folder.name}
      onDragOver={(e) => {
        if (!dropOk()) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setOver(false)}
      onDrop={async (e) => {
        setOver(false);
        if (!dropOk()) return;
        e.preventDefault();
        const item = dragModel.get();
        dragModel.end();
        setDropError(await library.moveModel(item, folder.id));
      }}
    >
      <div className="lib-row__line">
        <button type="button" className="lib-row__main lib-folder__main" aria-label={`Open folder ${folder.name}, ${countText(folder.modelCount ?? 0)}`} onClick={() => library.setFolder(folder.id)}>
          <span className="lib-folder__title"><FolderIcon /><span className="lib-row__name">{folder.name}</span></span>
          <span className="lib-row__meta">{countText(folder.modelCount ?? 0)}</span>
        </button>
        <span className="lib-folder__chev" aria-hidden="true">›</span>
        <button type="button" className="lib-icon-btn" aria-label={`More actions for folder ${folder.name}`} aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          <MoreIcon />
        </button>
      </div>
      {dropError && <p className="lib-rename__error" role="alert">{dropError}</p>}
      {expanded && (
        <div className="lib-row__actions">
          <button type="button" className="lib-btn" disabled={frozen} title={frozen ? READ_ONLY : undefined} onClick={() => { setMode("rename"); setExpanded(false); }}>Rename</button>
          <button type="button" className="lib-btn" disabled={frozen} title={frozen ? READ_ONLY : undefined} onClick={() => setMode("move")}>Move to...</button>
          <button type="button" className="lib-btn lib-btn--danger" disabled={frozen} title={frozen ? READ_ONLY : undefined} onClick={() => setMode("delete")}>Delete</button>
        </div>
      )}
      {mode === "move" && <MovePicker title={`Move "${folder.name}" to`} moving={folder.id} current={folder.parentId ?? null} onPick={(target) => library.moveFolder(folder.id, target)} onClose={close} />}
      {mode === "delete" &&
        createPortal(
          <ConfirmDialog
            title={`Delete folder "${folder.name}"?`}
            message="Models inside move up one level, and so do folders inside it. No models are deleted."
            confirmLabel="Delete folder"
            onCancel={close}
            onConfirm={() => {
              close();
              library.deleteFolder(folder.id);
            }}
          />,
          document.body,
        )}
    </li>
  );
}

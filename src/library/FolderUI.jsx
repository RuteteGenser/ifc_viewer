import { useEffect, useRef, useState } from "react";
import Dialog from "../access/Dialog";
import { useAccess } from "../access/AccessProvider";
import { useLibraryContext } from "./LibraryContext";
import { pickerRows, validName } from "./folders";

// Grace, expired and blocked accounts can look but not change (the server answers 402).
export function useFrozen() {
  const access = useAccess();
  return !!access && ["grace", "expired", "blocked"].includes(access.state);
}

const icon = (d) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
export const FolderIcon = () => icon(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />);

// One name field: Enter saves, Escape cancels.
export function NameForm({ label, initial = "", submitLabel, onSubmit, onDone }) {
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
        {rows.map((r, i) => (
          <li key={r.folder?.id ?? "top"} style={{ "--i": Math.min(i, 8) }}>
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

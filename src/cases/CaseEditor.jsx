import { useEffect, useRef, useState } from "react";
import { blobUrl, DISCIPLINES, processPhotoFile, revokeBlobUrl } from "./caseStore";
import { DISCIPLINE_COLORS } from "./disciplines";

export default function CaseEditor({ initial, onSave, onCancel, onDelete }) {
  const isNew = !initial.id;
  const [title, setTitle] = useState(initial.title ?? "");
  const [summary, setSummary] = useState(initial.summary ?? "");
  const [disciplines, setDisciplines] = useState(initial.disciplines ?? []);
  const [photos, setPhotos] = useState(initial.photos ?? []);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const initialPhotoIds = useRef(new Set((initial.photos ?? []).map((p) => p.id)));
  const photosRef = useRef(photos);
  photosRef.current = photos;

  const cancel = () => {
    // Free URLs of photos added during this session that were never saved.
    photosRef.current.filter((p) => !initialPhotoIds.current.has(p.id)).forEach((p) => {
      revokeBlobUrl(p.blob);
      revokeBlobUrl(p.thumb);
    });
    onCancel();
  };
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") cancelRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const addFiles = async (fileList) => {
    const files = Array.from(fileList ?? []).filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|avif|heic)$/i.test(f.name));
    if (files.length === 0) return;
    setBusy(true);
    setLocalError(null);
    for (const file of files) {
      try {
        const photo = await processPhotoFile(file);
        setPhotos((prev) => [...prev, photo]);
      } catch (err) {
        setLocalError(err.message);
      }
    }
    setBusy(false);
  };

  const removePhoto = (id) => setPhotos((prev) => prev.filter((p) => p.id !== id));

  const toggleDiscipline = (d) =>
    setDisciplines((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : DISCIPLINES.filter((x) => x === d || prev.includes(x))));

  const save = async () => {
    const keptIds = new Set(photos.map((p) => p.id));
    const saved = await onSave({
      ...initial,
      title: title.trim() || "Untitled case",
      summary: summary.trim(),
      disciplines,
      photos,
    });
    if (saved) {
      // Photos removed from an existing case are gone for good — free their URLs.
      (initial.photos ?? []).filter((p) => !keptIds.has(p.id)).forEach((p) => {
        revokeBlobUrl(p.blob);
        revokeBlobUrl(p.thumb);
      });
    }
  };

  const where = initial.floor ? initial.floor.name : null;
  const gps = initial.gps;

  return (
    <div
      className="confirm-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div
        className={`confirm-dialog case-editor${dragOver ? " case-editor--dragover" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
        onPaste={(e) => {
          if (e.clipboardData?.files?.length) addFiles(e.clipboardData.files);
        }}
      >
        <div className="confirm-dialog__title">{isNew ? "New case" : "Edit case"}</div>
        {where && (
          <div className="case-editor__where">
            Location: <strong>{where}</strong>
            {initial.plan ? <> · x {initial.plan[0].toFixed(1)} m, y {initial.plan[1].toFixed(1)} m</> : null}
            {gps ? <> · GPS {gps.lat.toFixed(5)}, {gps.lon.toFixed(5)}</> : null}
          </div>
        )}

        <label className="case-editor__label" htmlFor="case-title">Title</label>
        <input
          id="case-title"
          className="case-editor__input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Duct clashes with beam"
          autoFocus
        />

        <div className="case-editor__label">Discipline</div>
        <div className="case-editor__chips">
          {DISCIPLINES.map((d) => (
            <button
              key={d}
              type="button"
              className={`discipline-chip${disciplines.includes(d) ? " discipline-chip--on" : ""}`}
              style={{ "--chip": DISCIPLINE_COLORS[d] }}
              aria-pressed={disciplines.includes(d)}
              onClick={() => toggleDiscipline(d)}
            >
              {d}
            </button>
          ))}
        </div>

        <label className="case-editor__label" htmlFor="case-summary">Summary</label>
        <textarea
          id="case-summary"
          className="case-editor__input case-editor__textarea"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="What is the case? What needs to happen?"
          rows={4}
        />

        <div className="case-editor__label">Photos ({photos.length})</div>
        <div className="case-editor__photos">
          {photos.map((p) => (
            <div className="case-editor__photo" key={p.id}>
              <img src={blobUrl(p.thumb)} alt={p.name} />
              <button type="button" aria-label="Remove photo" title="Remove photo" onClick={() => removePhoto(p.id)}>
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="case-editor__add-photo" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            {busy ? "Adding…" : "+ Add photos"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        <div className="case-editor__hint">You can also drop or paste images here.</div>
        {localError && <div className="case-editor__error">{localError}</div>}

        <div className="confirm-dialog__buttons case-editor__buttons">
          {!isNew && (
            <button type="button" className="case-editor__delete" onClick={() => onDelete(initial.id)}>
              Delete case
            </button>
          )}
          <span className="case-editor__spacer" />
          <button type="button" className="confirm-dialog__cancel" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="confirm-dialog__confirm" onClick={save} disabled={busy}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

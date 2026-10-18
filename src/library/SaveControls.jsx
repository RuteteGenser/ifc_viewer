import { useLibraryContext } from "./LibraryContext";

// "Also save to my models" next to the Open button. Off by default.
export function SaveToggle({ className = "" }) {
  const library = useLibraryContext();
  if (!library || library.status !== "ready") return null;
  return (
    <label className={`lib-toggle ${className}`.trim()} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={library.alsoSave} onChange={(e) => library.setAlsoSave(e.target.checked)} />
      <span>Also save to my models</span>
    </label>
  );
}

// Shown under a loaded model that came from this device.
export function SaveRowButton({ model }) {
  const library = useLibraryContext();
  if (!library || !library.canSave(model.name)) return null;
  if (library.savedNames.has(model.name)) return <span className="lib-saved">Saved to my models</span>;
  const file = library.fileFor(model.name);
  const saving = library.upload?.name === model.name;
  return (
    <button type="button" className="lib-btn lib-save-btn" disabled={saving} onClick={() => library.saveFiles([file])}>
      {saving ? "Saving…" : "Save to my models"}
    </button>
  );
}

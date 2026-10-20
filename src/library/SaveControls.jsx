import { useState } from "react";
import Dialog from "../access/Dialog";
import { t } from "../access/copy";
import { useLibraryContext } from "./LibraryContext";
import { useFrozen } from "./FolderUI";
import { NewProjectDialog, useProjects } from "./ProjectBrowser";
import { isRealProject } from "./projects";

// Choose a project (or make one) for a model that is only being viewed.
function SaveToProjectDialog({ model, onClose }) {
  const library = useLibraryContext();
  const { projects } = useProjects();
  const [creating, setCreating] = useState(false);
  const real = projects.filter((p) => isRealProject(p.id));
  const save = (id) => {
    library.openProject(id);
    library.saveFiles([library.fileFor(model.name)], id);
    onClose();
  };
  if (creating || real.length === 0) return <NewProjectDialog title={t("proj.saveTo")} submitLabel="Create and save" onClose={onClose} onCreated={(f) => save(f.id)} />;
  return (
    <Dialog title={t("proj.saveTo")} onClose={onClose}>
      <ul className="fpick" aria-label="Projects">
        {real.map((p) => (
          <li key={p.id}>
            <button type="button" className="fpick__row" onClick={() => save(p.id)}>
              <span className="fpick__name">{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="acc-btn acc-btn--full" onClick={() => setCreating(true)}>
        {t("proj.new")}
      </button>
    </Dialog>
  );
}

// A quiet action under a loaded model that came from this device and is not in a project yet.
export function SaveRowButton({ model }) {
  const library = useLibraryContext();
  const frozen = useFrozen();
  const [choosing, setChoosing] = useState(false);
  if (!library || !library.canSave(model.name)) return null;
  // Models are saved inside a project; a backend without projects saves nothing.
  if (!library.folders || library.savedNames.has(model.name)) return null;
  const saving = library.upload?.name === model.name;
  return (
    <>
      <button
        type="button"
        className="lib-btn lib-save-btn"
        disabled={saving || frozen}
        onClick={() => setChoosing(true)}
      >
        {saving ? "Saving…" : t("proj.saveTo")}
      </button>
      {choosing && <SaveToProjectDialog model={model} onClose={() => setChoosing(false)} />}
    </>
  );
}

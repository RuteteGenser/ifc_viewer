import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ConfirmDialog from "../components/ConfirmDialog";
import Dialog from "../access/Dialog";
import { CodeLink } from "../access/AccessUI";
import { t } from "../access/copy";
import { useLibraryContext } from "./LibraryContext";
import { LibAccount, LibrarySkeleton, ModelItem, SampleItem } from "./LibrarySection";
import { NameForm, useFrozen } from "./FolderUI";
import { atLimit, countText } from "./folders";
import { relativeDate } from "./format";
import { DUMMY_ID, DUMMY_NAME, UNSORTED_ID, UNSORTED_NAME, isRealProject, listProjects, projectModels, projectNameError } from "./projects";
import "./Projects.css";

const READ_ONLY = "Your plan is read-only right now, so projects cannot be changed.";

// A neutral building, used wherever a project has no picture.
export const BuildingGlyph = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 21V8l7-4 7 4v13M3 21h18M9 21v-4h6v4M9 11h.01M12 11h.01M15 11h.01M9 14h.01M12 14h.01M15 14h.01" />
  </svg>
);
const MoreIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);

// The projects the user has (real folders plus the virtual Unsorted), from the library context.
export function useProjects() {
  const library = useLibraryContext();
  const own = useMemo(() => (library.items || []).filter((i) => i.owner !== "samples"), [library.items]);
  const projects = useMemo(() => listProjects(library.folders || [], own), [library.folders, own]);
  const full = !!library.folders && atLimit(library.folders.length, library.folderLimit);
  return { projects, own, full };
}

// Asks for a name, creates the project, hands the new folder to onCreated.
export function NewProjectDialog({ onClose, onCreated, title = t("proj.new"), submitLabel = "Create" }) {
  const library = useLibraryContext();
  const { projects } = useProjects();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const bad = projectNameError(value, projects);
    if (bad) return setError(bad);
    setBusy(true);
    const { folder, error: problem } = await library.createProject(value);
    setBusy(false);
    if (problem) setError(problem);
    else onCreated(folder);
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <form className="proj-form" onSubmit={submit}>
        <label className="proj-form__label" htmlFor="proj-name">Project name</label>
        <input
          id="proj-name"
          className="acc-input"
          value={value}
          maxLength={80}
          autoComplete="off"
          placeholder="For example: Harbour Street 12"
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? "proj-name-error" : undefined}
          data-autofocus=""
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
          }}
        />
        {error && (
          <p className="proj-form__error" id="proj-name-error" role="alert">
            {error}
          </p>
        )}
        <div className="proj-form__actions">
          <button type="button" className="acc-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="acc-btn acc-btn--primary" disabled={busy}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// "New project" for a button that may be disabled (plan read-only, folder limit).
function NewProjectButton({ primary = true, onClick }) {
  const frozen = useFrozen();
  const { full } = useProjects();
  const reason = frozen ? READ_ONLY : full ? "You have reached the project limit. Delete one to make room." : "";
  return (
    <>
      <button type="button" className={`acc-btn${primary ? " acc-btn--primary" : ""}`} disabled={!!reason} aria-describedby={reason ? "proj-new-reason" : undefined} onClick={onClick}>
        {t("proj.new")}
      </button>
      {reason && (
        <p className="lib-quiet" id="proj-new-reason">
          {reason}
        </p>
      )}
    </>
  );
}

function ProjectCard({ project }) {
  const library = useLibraryContext();
  return (
    <li>
      <button type="button" className="proj-card" aria-label={`Open project ${project.name}, ${countText(project.count)}`} onClick={() => library.openProject(project.id)}>
        <span className="proj-card__glyph">
          <BuildingGlyph />
        </span>
        <span className="proj-card__name">{project.name}</span>
        <span className="proj-card__meta">
          {countText(project.count)}
          {project.updatedAt ? ` · ${relativeDate(new Date(project.updatedAt).toISOString())}` : ""}
        </span>
      </button>
    </li>
  );
}

function BrowserBody({ onOpenFiles, titleRef }) {
  const library = useLibraryContext();
  const { projects } = useProjects();
  const [creating, setCreating] = useState(false);
  const empty = projects.length === 0;
  const dialog = creating && <NewProjectDialog onClose={() => setCreating(false)} onCreated={(f) => library.openProject(f.id)} />;
  const quiet = (
    <div className="proj__quiet">
      <button type="button" className="acc-link" onClick={() => library.openProject(DUMMY_ID)}>
        {t("proj.dummy")}
      </button>
      <button type="button" className="acc-link" onClick={onOpenFiles}>
        {t("proj.viewOnly")}
      </button>
      <CodeLink />
    </div>
  );
  if (empty) {
    return (
      <section className="proj proj--empty" aria-labelledby="proj-title">
        <BuildingGlyph />
        <h1 className="proj__title" id="proj-title" tabIndex={-1} ref={titleRef}>
          {t("proj.empty.title")}
        </h1>
        <p className="proj__text">{t("proj.empty.text")}</p>
        <NewProjectButton onClick={() => setCreating(true)} />
        <button type="button" className="acc-btn" onClick={() => library.openProject(DUMMY_ID)}>
          {t("proj.dummy")}
        </button>
        <button type="button" className="acc-link" onClick={onOpenFiles}>
          {t("proj.viewOnly")}
        </button>
        <CodeLink />
        <LibAccount button={false} />
        {dialog}
      </section>
    );
  }
  return (
    <section className="proj" aria-labelledby="proj-title">
      <header className="proj__head">
        <h1 className="proj__title" id="proj-title" tabIndex={-1} ref={titleRef}>
          {t("proj.title")}
        </h1>
        <NewProjectButton onClick={() => setCreating(true)} />
      </header>
      <ul className="proj__grid" aria-label="Your projects">
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </ul>
      {quiet}
      <LibAccount button={false} />
      {dialog}
    </section>
  );
}

// Back to the browser, then the title (focus lands on the page you came to).
function PageHead({ title, badge, note, children, titleRef }) {
  const library = useLibraryContext();
  return (
    <header className="proj__pagehead">
      <button type="button" className="acc-btn acc-btn--quiet proj__back" onClick={() => library.openProject(null)}>
        <span aria-hidden="true">‹ </span>
        {t("proj.back")}
      </button>
      <div className="proj__titleline">
        <h1 className="proj__title" id="proj-title" tabIndex={-1} ref={titleRef}>
          {title}
        </h1>
        {badge && <span className="lib-badge">{badge}</span>}
        {children}
      </div>
      {note && <p className="proj__text proj__text--left">{note}</p>}
    </header>
  );
}

function ProjectMenu({ project, onDeleted }) {
  const library = useLibraryContext();
  const frozen = useFrozen();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(""); // "" | rename | delete
  const moreRef = useRef(null);
  const close = () => setMode("");
  if (mode === "rename") {
    return (
      <NameForm
        label={`New name for ${project.name}`}
        initial={project.name}
        submitLabel="Save"
        onSubmit={(name) => library.renameFolder(project.id, name)}
        onDone={() => {
          close();
          setTimeout(() => moreRef.current?.focus(), 0);
        }}
      />
    );
  }
  return (
    <>
      <button type="button" ref={moreRef} className="lib-icon-btn" aria-label={`More actions for project ${project.name}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <MoreIcon />
      </button>
      {open && (
        <div
          className="lib-row__actions proj__menu"
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.nativeEvent.stopPropagation();
            setOpen(false);
            moreRef.current?.focus();
          }}
        >
          <button type="button" className="lib-btn" disabled={frozen} title={frozen ? READ_ONLY : undefined} onClick={() => { setMode("rename"); setOpen(false); }}>
            Rename
          </button>
          <button type="button" className="lib-btn lib-btn--danger" disabled={frozen} title={frozen ? READ_ONLY : undefined} onClick={() => setMode("delete")}>
            Delete
          </button>
        </div>
      )}
      {mode === "delete" &&
        createPortal(
          <ConfirmDialog
            title={`Delete project "${project.name}"?`}
            message="Its models move to Unsorted and its folders become projects. No models are deleted."
            confirmLabel="Delete project"
            danger
            initialFocus="cancel"
            onCancel={close}
            onConfirm={() => {
              close();
              onDeleted();
              library.deleteFolder(project.id);
            }}
          />,
          document.body,
        )}
    </>
  );
}

function ModelList({ models, folders, projectId, emptyText }) {
  return (
    <ul className="lib-list proj__list" aria-label="Models">
      {models.map((m) => (
        <ModelItem key={m.id} item={m} showPath={!!m.folderId && m.folderId !== projectId && !!folders} />
      ))}
      {models.length === 0 && emptyText && <li className="lib-quiet" data-testid="proj-empty">{emptyText}</li>}
    </ul>
  );
}

function ProjectPage({ projectId, onOpenFiles, titleRef }) {
  const library = useLibraryContext();
  const frozen = useFrozen();
  const { projects, own } = useProjects();
  const unsorted = projectId === UNSORTED_ID;
  const project = projects.find((p) => p.id === projectId);
  const models = useMemo(() => projectModels(library.folders || [], own, projectId), [library.folders, own, projectId]);
  const name = unsorted ? UNSORTED_NAME : library.folders?.find((f) => f.id === projectId)?.name;
  // Unsorted that has emptied (everything moved out) goes back to the browser.
  const { openProject } = library;
  useEffect(() => {
    if (unsorted && !project) openProject(null);
  }, [unsorted, project, openProject]);
  const openAll = () => models.forEach((m, i) => (i === 0 ? library.open(m) : library.addToView(m)));
  if (!name) return null;
  const real = isRealProject(projectId);
  return (
    <section className="proj" aria-labelledby="proj-title">
      <PageHead title={name} titleRef={titleRef} note={unsorted ? t("proj.unsortedNote") : null}>
        {real && <ProjectMenu project={{ id: projectId, name }} onDeleted={() => library.openProject(null)} />}
      </PageHead>
      <p className="proj__meta" data-testid="proj-count">{countText(models.length)}</p>
      {(real || models.length > 1) && (
        <div className="proj__actions">
          {real && (
            <button type="button" className="acc-btn acc-btn--primary" disabled={frozen} title={frozen ? READ_ONLY : undefined} onClick={onOpenFiles}>
              {t("proj.add")}
            </button>
          )}
          {models.length > 1 && (
            <button type="button" className="acc-btn" disabled={!!library.download} onClick={openAll}>
              {t("proj.openAll")}
            </button>
          )}
        </div>
      )}
      <ModelList models={models} folders={library.folders} projectId={projectId} emptyText={real ? "No models yet. Add a model to open it and save it here." : null} />
      <LibAccount button={false} />
    </section>
  );
}

function DummyPage({ titleRef }) {
  const library = useLibraryContext();
  const [creating, setCreating] = useState(false);
  const samples = (library.items || []).filter((i) => i.owner === "samples");
  return (
    <section className="proj" aria-labelledby="proj-title">
      <PageHead title={DUMMY_NAME} titleRef={titleRef} badge={t("proj.dummyBadge")} note={t("proj.dummyNote")} />
      <ul className="lib-list proj__list" aria-label="Models">
        <SampleItem />
        {samples.map((m) => (
          <ModelItem key={m.id} item={m} />
        ))}
      </ul>
      <div className="proj__actions">
        <button type="button" className="acc-btn acc-btn--quiet" onClick={() => setCreating(true)}>
          {t("proj.makeOwn")}
        </button>
      </div>
      {creating && <NewProjectDialog onClose={() => setCreating(false)} onCreated={(f) => library.openProject(f.id)} />}
    </section>
  );
}

// The first screen when no model is open: the project browser, or the page of the open project.
// Only used when the backend has folders (status ready); the caller falls back to the old empty state otherwise.
export default function ProjectsHome({ onOpenFiles }) {
  const library = useLibraryContext();
  const titleRef = useRef(null);
  const { projectId } = library;
  const seen = useRef(projectId);
  // Moving between the browser and a page moves focus to its title, but not on the very first render.
  useEffect(() => {
    if (seen.current === projectId) return;
    seen.current = projectId;
    titleRef.current?.focus({ preventScroll: true });
  }, [projectId]);
  return (
    <div className="empty-state empty-state--projects">
      {library.status === "loading" ? (
        <div className="proj"><LibrarySkeleton label="Loading your projects" /></div>
      ) : projectId === DUMMY_ID ? (
        <DummyPage titleRef={titleRef} />
      ) : projectId ? (
        <ProjectPage projectId={projectId} onOpenFiles={onOpenFiles} titleRef={titleRef} />
      ) : (
        <BrowserBody onOpenFiles={onOpenFiles} titleRef={titleRef} />
      )}
    </div>
  );
}

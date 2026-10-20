import { useRef, useState } from "react";
import ClipPlaneControl from "./ClipPlaneControl";
import { LegalLinks } from "../legal/LegalPage";
import ModelInfo from "./ModelInfo";
import ModelName from "./ModelName";
import { disciplineOf, splitModelName } from "../ifc/modelLabel";
import { SaveRowButton } from "../library/SaveControls";
import { hapticsEnabled, setHapticsEnabled } from "../haptics";
import "./Models.css";

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );
}

function ModelRow({ model, onToggleVisible, onRemove, onSetColor }) {
  const discipline = disciplineOf(model.name);
  const { note } = splitModelName(model.name);
  return (
    <li className="model-row">
      <label className="model-row__label">
        <input
          type="checkbox"
          checked={model.visible}
          aria-label={`Show ${model.name}`}
          onChange={(e) => onToggleVisible(model.id, e.target.checked)}
        />
        <span className="model-row__text">
          <ModelName name={model.name} className="model-row__name" />
          {(discipline || note) && (
            <span className="model-row__meta">
              {discipline && (
                <abbr className="model-row__badge" title={discipline.label}>
                  {discipline.code}
                </abbr>
              )}
              {note && <span className="model-row__note">{note}</span>}
            </span>
          )}
        </span>
      </label>
      <div className="model-row__actions">
        <label className="model-row__tint" title={`Tint ${model.name} (visual only). Toggle with V`}>
          <input
            type="color"
            className="model-row__color"
            value={model.color ?? "#ffffff"}
            onChange={(e) => onSetColor(model.id, e.target.value)}
            aria-label="Model tint"
          />
          <span className="model-row__tint-caption" aria-hidden="true">Tint</span>
        </label>
        {model.color && (
          <button
            type="button"
            className="model-row__remove"
            aria-label={`Clear ${model.name}'s color override`}
            title="Clear color override"
            onClick={() => onSetColor(model.id, null)}
          >
            ✕
          </button>
        )}
        <button
          type="button"
          className="model-row__remove model-row__remove--labelled"
          aria-label={`Remove ${model.name}`}
          title="Remove this model from the view"
          onClick={() => onRemove(model.id)}
        >
          <TrashIcon />
          <span>Remove</span>
        </button>
      </div>
      <SaveRowButton model={model} />
    </li>
  );
}

// A category hidden via the hide-category tool can no longer be clicked
// in the 3D view once every instance is hidden (a hidden element isn't
// raycastable), so this list is the only way back for a fully-hidden
// category — "Reset visibility" also works, but clears everything
// (individually hidden elements, isolation) rather than just this one.
function HiddenCategoryRow({ category, onShow }) {
  return (
    <li className="model-row">
      <span className="model-row__name" title={category}>
        {category}
      </span>
      <button
        type="button"
        className="model-row__remove"
        aria-label={`Show ${category}`}
        title="Show this category again"
        onClick={() => onShow(category)}
      >
        ✕
      </button>
    </li>
  );
}

export default function Sidebar({
  className = "",
  models,
  onAddFiles,
  onToggleVisible,
  onRemove,
  onSetModelColor,
  onSaveIfcZip,
  onResetVisibility,
  spaceControl,
  isLoading,
  loadingLabel,
  clipPlanes,
  onSetClipPlaneEnabled,
  onSetClipPlaneGizmoVisible,
  onFlipClipPlane,
  onRemoveClipPlane,
  onSelectClipPlane,
  hiddenCategories,
  onShowCategory,
  browser,
  onRequestClose,
  onOpenHelp,
  onOpenCases,
  onRemoveAll,
}) {
  const [haptics, setHaptics] = useState(hapticsEnabled);
  // Swiping the open drawer to the left closes it again.
  const swipeRef = useRef(null);
  const swipe = {
    onTouchStart: (e) => {
      const t = e.touches[0];
      swipeRef.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchMove: (e) => {
      const start = swipeRef.current;
      if (!start) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (dx < -56 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        swipeRef.current = null;
        onRequestClose?.();
      }
    },
    onTouchEnd: () => {
      swipeRef.current = null;
    },
  };
  return (
    <aside className={`sidebar ${className}`.trim()} data-surface-sheet={className.includes("sidebar--open") ? "menu" : undefined} aria-label="Loaded models" {...swipe}>
      <section className="sb-group" aria-labelledby="sb-loaded-title">
        <div className="sb-group__head">
          <h2 className="sidebar__section-title" id="sb-loaded-title">Loaded models</h2>
          <button
            type="button"
            className="sidebar__save-button"
            onClick={onSaveIfcZip}
            disabled={models.length === 0}
            title="Save all loaded models as a single .ifcZIP"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
            </svg>
            <span>Save .ifcZIP</span>
          </button>
        </div>

        {models.length === 0 ? (
          <p className="sidebar__empty">No models open yet.</p>
        ) : (
          <ul className="model-list">
            {models.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                onToggleVisible={onToggleVisible}
                onRemove={onRemove}
                onSetColor={onSetModelColor}
              />
            ))}
          </ul>
        )}

        <div className="sidebar__top-buttons">
          <button
            type="button"
            className={`sidebar__add-button${models.length > 0 ? " sidebar__add-button--secondary" : ""}`}
            onClick={onAddFiles}
            disabled={isLoading}
          >
            {!isLoading && (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            )}
            <span>{isLoading ? loadingLabel || "Loading…" : models.length > 0 ? "Add another model" : "Open IFC file"}</span>
          </button>
        </div>

        {models.length > 0 && (
          <p className="sidebar__hint">Opening a model replaces the current one. Add another model to view several together.</p>
        )}
        {models.length > 1 && (
          <button type="button" className="lib-btn sidebar__remove-all" onClick={onRemoveAll}>
            Remove all
          </button>
        )}
      </section>

      {browser && models.length > 0 && <ModelInfo models={models} trees={browser.trees} />}

      {models.length > 0 && (
        <section className="sb-group sb-group--view" aria-labelledby="sb-view-title">
          <div className="sb-group__head">
            <h2 className="sidebar__section-title" id="sb-view-title">View</h2>
            <button
              type="button"
              className="sidebar__reset-visibility-button"
              onClick={onResetVisibility}
              title="Show any elements you have hidden"
            >
              Reset visibility
            </button>
          </div>
          {spaceControl?.available && (
            <label className="sidebar__show-spaces">
              <span>Show spaces</span>
              <input type="checkbox" className="ui-switch" checked={spaceControl.shown} onChange={(e) => spaceControl.setShown(e.target.checked)} />
            </label>
          )}
        </section>
      )}

      {hiddenCategories.length > 0 && (
        <>
          <div className="sidebar__section-title">Hidden categories</div>
          <ul className="model-list">
            {hiddenCategories.map((category) => (
              <HiddenCategoryRow key={category} category={category} onShow={onShowCategory} />
            ))}
          </ul>
        </>
      )}

      <ClipPlaneControl
        clipPlanes={clipPlanes}
        onSetClipPlaneEnabled={onSetClipPlaneEnabled}
        onSetClipPlaneGizmoVisible={onSetClipPlaneGizmoVisible}
        onFlipClipPlane={onFlipClipPlane}
        onRemoveClipPlane={onRemoveClipPlane}
        onSelectClipPlane={onSelectClipPlane}
      />

      <div className="sb-footer">
        <button type="button" className="sidebar__help-button" onClick={onOpenCases}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h4l2 2h7A1.5 1.5 0 0 1 20 9.5v8A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5Z" />
          </svg>
          <span>Cases: saved views of the model</span>
        </button>

        <button type="button" className="sidebar__help-button" onClick={onOpenHelp}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2-2.4 3.6M12 17.2h.01" />
          </svg>
          <span>Help: how to move around</span>
        </button>

        <label className="models-sheet__haptics">
          <input type="checkbox" checked={haptics} onChange={(e) => { setHaptics(e.target.checked); setHapticsEnabled(e.target.checked); }} />
          <span>
            Haptics
            <small>A light buzz on main buttons. Works on most Android phones; iPhone has no vibration for web pages.</small>
          </span>
        </label>

        <LegalLinks docs={["terms", "privacy", "cookies"]} className="sidebar__legal" />
      </div>
    </aside>
  );
}

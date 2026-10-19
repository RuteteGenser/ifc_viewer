import { useRef } from "react";
import ClipPlaneControl from "./ClipPlaneControl";
import { LegalLinks } from "../legal/LegalPage";
import ModelInfo from "./ModelInfo";
import ModelName from "./ModelName";
import { disciplineOf, splitModelName } from "../ifc/modelLabel";
import ModelTree from "./ModelTree";
import LibrarySection from "../library/LibrarySection";
import { SaveToggle, SaveRowButton } from "../library/SaveControls";
import { TrashIcon } from "./ModelsSheet";

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
  selectedId,
  onPickElement,
  onRequestClose,
  onOpenHelp,
  onOpenCases,
}) {
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
    <aside className={`sidebar ${className}`.trim()} aria-label="Models and structure" {...swipe}>
      <div className="sidebar__top-buttons">
        <button
          type="button"
          className="sidebar__add-button"
          onClick={onAddFiles}
          disabled={isLoading}
        >
          {isLoading ? loadingLabel || "Loading…" : models.length > 0 ? "Add another model" : "Open IFC file"}
        </button>
        <button
          type="button"
          className="sidebar__save-button"
          onClick={onSaveIfcZip}
          disabled={models.length === 0}
          title="Save all loaded models as a single .ifcZIP"
        >
          Save .ifcZIP
        </button>
      </div>

      {models.length > 0 && (
        <p className="sidebar__hint">Opening a model replaces the current one. Add another model to view several together.</p>
      )}

      <SaveToggle />

      <div className="sidebar__section-title">Loaded models</div>

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

      <LibrarySection variant="sidebar" />

      {browser && models.length > 0 && <ModelInfo models={models} trees={browser.trees} />}

      <button
        type="button"
        className="sidebar__reset-visibility-button"
        onClick={onResetVisibility}
        disabled={models.length === 0}
        title="Show any elements you have hidden"
      >
        Reset visibility
      </button>
      {spaceControl?.available && (
        <label className="sidebar__show-spaces">
          <input type="checkbox" checked={spaceControl.shown} onChange={(e) => spaceControl.setShown(e.target.checked)} />
          <span>Show spaces</span>
        </label>
      )}

      {browser && models.length > 0 && (
        <>
          <div className="sidebar__section-title">Structure</div>
          <ModelTree browser={browser} selectedId={selectedId} onPick={onPickElement} />
        </>
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

      <button type="button" className="sidebar__help-button" onClick={onOpenCases}>
        Cases: saved views of the model
      </button>

      <button type="button" className="sidebar__help-button" onClick={onOpenHelp}>
        Help: how to move around
      </button>

      <LegalLinks docs={["terms", "privacy", "cookies"]} className="sidebar__legal" />
    </aside>
  );
}

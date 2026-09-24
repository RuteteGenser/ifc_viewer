import { useRef } from "react";
import ClipPlaneControl from "./ClipPlaneControl";

function ModelRow({ model, onToggleVisible, onRemove, onSetColor }) {
  return (
    <li className="model-row">
      <label className="model-row__label">
        <input
          type="checkbox"
          checked={model.visible}
          onChange={(e) => onToggleVisible(model.id, e.target.checked)}
        />
        <span className="model-row__name" title={model.name}>
          {model.name}
        </span>
      </label>
      <div className="model-row__actions">
        <input
          type="color"
          className="model-row__color"
          value={model.color ?? "#ffffff"}
          onChange={(e) => onSetColor(model.id, e.target.value)}
          aria-label={`Override ${model.name}'s color`}
          title="Override this model's color (visual only) — toggle with V"
        />
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
          className="model-row__remove"
          aria-label={`Remove ${model.name}`}
          title="Remove model"
          onClick={() => onRemove(model.id)}
        >
          ✕
        </button>
      </div>
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
  onFilesSelected,
  onToggleVisible,
  onRemove,
  onSetModelColor,
  onSaveIfcZip,
  onResetVisibility,
  isLoading,
  loadingLabel,
  clipPlanes,
  onSetClipPlaneEnabled,
  onSetClipPlaneGizmoVisible,
  onFlipClipPlane,
  onRemoveClipPlane,
  hiddenCategories,
  onShowCategory,
}) {
  const fileInputRef = useRef(null);

  return (
    <aside className={`sidebar ${className}`.trim()}>
      <div className="sidebar__top-buttons">
        <button
          type="button"
          className="sidebar__add-button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
        >
          {isLoading ? loadingLabel || "Loading…" : "+ Add file(s)"}
        </button>
        <button
          type="button"
          className="sidebar__save-button"
          onClick={onSaveIfcZip}
          disabled={models.length === 0}
          title="Save all loaded models as a single .ifcZIP"
        >
          Save as .ifcZIP
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".ifc,.ifczip"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFilesSelected(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="sidebar__section-title">Loaded models</div>

      {models.length === 0 ? (
        <p className="sidebar__empty">
          No models loaded yet. Add an .ifc or .ifcZIP file, or drop one
          onto the viewport.
        </p>
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

      <button
        type="button"
        className="sidebar__reset-visibility-button"
        onClick={onResetVisibility}
        disabled={models.length === 0}
        title="Show any elements hidden via right-click"
      >
        Reset visibility
      </button>

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
      />
    </aside>
  );
}

import { useRef } from "react";
import ClipPlaneControl from "./ClipPlaneControl";
import CameraClipControl from "./CameraClipControl";

function ModelRow({ model, onToggleVisible, onRemove }) {
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
      <button
        type="button"
        className="model-row__remove"
        aria-label={`Remove ${model.name}`}
        title="Remove model"
        onClick={() => onRemove(model.id)}
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
  isLoading,
  loadingLabel,
  clipEnabled,
  onSetClipEnabled,
  hasClipPlane,
  onFlipClipPlane,
  onClearClipPlane,
  cameraClipEnabled,
  onSetCameraClipEnabled,
  cameraClipDistance,
  onSetCameraClipDistance,
  cameraClipRange,
}) {
  const fileInputRef = useRef(null);

  return (
    <aside className={`sidebar ${className}`.trim()}>
      <h1 className="sidebar__title">IFC Viewer</h1>

      <button
        type="button"
        className="sidebar__add-button"
        onClick={() => fileInputRef.current?.click()}
        disabled={isLoading}
      >
        {isLoading ? loadingLabel || "Loading…" : "+ Add IFC file(s)"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".ifc"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFilesSelected(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="sidebar__section-title">
        Loaded models {models.length > 0 ? `(${models.length})` : ""}
      </div>

      {models.length === 0 ? (
        <p className="sidebar__empty">
          No models loaded yet. Add an .ifc file or drop one onto the
          viewport.
        </p>
      ) : (
        <ul className="model-list">
          {models.map((model) => (
            <ModelRow
              key={model.id}
              model={model}
              onToggleVisible={onToggleVisible}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}

      <ClipPlaneControl
        clipEnabled={clipEnabled}
        onSetClipEnabled={onSetClipEnabled}
        hasClipPlane={hasClipPlane}
        onFlipClipPlane={onFlipClipPlane}
        onClearClipPlane={onClearClipPlane}
      />

      <CameraClipControl
        cameraClipEnabled={cameraClipEnabled}
        onSetCameraClipEnabled={onSetCameraClipEnabled}
        cameraClipDistance={cameraClipDistance}
        onSetCameraClipDistance={onSetCameraClipDistance}
        cameraClipRange={cameraClipRange}
        disabled={models.length === 0}
      />
    </aside>
  );
}

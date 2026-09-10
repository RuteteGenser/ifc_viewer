import CameraClipControl from "./CameraClipControl";
import Tooltip from "./Tooltip";

function MeasureIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="9" width="18" height="6" rx="1" transform="rotate(-30 12 12)" />
      <path d="M8.5 12.6 L9.7 10.6 M11.3 14.2 L12.5 12.2 M14 15.8 L15.2 13.8" transform="rotate(-30 12 12)" />
    </svg>
  );
}

export default function Toolbar({
  hasModels,
  onResetView,
  measureModeActive,
  onToggleMeasureMode,
  cameraClipEnabled,
  onSetCameraClipEnabled,
  cameraClipDistance,
  onSetCameraClipDistance,
}) {
  return (
    <div className="toolbar">
      <Tooltip description="Reset to the default view">
        <button
          type="button"
          className="top-bar__home-button"
          onClick={onResetView}
          disabled={!hasModels}
        >
          Home
        </button>
      </Tooltip>
      <Tooltip description="Measure — click two points in the view" hotkey="M">
        <button
          type="button"
          className={`top-bar__icon-button${measureModeActive ? " top-bar__icon-button--active" : ""}`}
          onClick={onToggleMeasureMode}
          disabled={!hasModels}
          aria-label="Toggle measure mode"
        >
          <MeasureIcon />
        </button>
      </Tooltip>
      <CameraClipControl
        cameraClipEnabled={cameraClipEnabled}
        onSetCameraClipEnabled={onSetCameraClipEnabled}
        cameraClipDistance={cameraClipDistance}
        onSetCameraClipDistance={onSetCameraClipDistance}
        disabled={!hasModels}
      />
    </div>
  );
}

function ClipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 15 L20 9" />
    </svg>
  );
}

export default function CameraClipControl({
  cameraClipEnabled,
  onSetCameraClipEnabled,
  cameraClipDistance,
  onSetCameraClipDistance,
  disabled,
}) {
  return (
    <div className="camera-clip">
      <button
        type="button"
        className={`top-bar__icon-button${cameraClipEnabled ? " top-bar__icon-button--active" : ""}`}
        onClick={() => onSetCameraClipEnabled(!cameraClipEnabled)}
        disabled={disabled}
        title="Clip in front of camera"
        aria-label="Toggle camera clip"
      >
        <ClipIcon />
      </button>

      {cameraClipEnabled && (
        <div className="camera-clip-popover">
          <input
            type="range"
            className="clip-control__slider"
            min="1"
            max="2"
            step="any"
            value={cameraClipDistance}
            onChange={(e) => onSetCameraClipDistance(Number(e.target.value))}
          />
          <p className="clip-control__hint">
            Distance from camera to the cut plane.
          </p>
        </div>
      )}
    </div>
  );
}

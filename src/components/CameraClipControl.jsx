export default function CameraClipControl({
  cameraClipEnabled,
  onSetCameraClipEnabled,
  cameraClipDistance,
  onSetCameraClipDistance,
  disabled,
}) {
  return (
    <div className="clip-control camera-clip-control">
      <div className="sidebar__section-title">Camera clip</div>
      <label className="clip-control__toggle">
        <input
          type="checkbox"
          checked={cameraClipEnabled}
          disabled={disabled}
          onChange={(e) => onSetCameraClipEnabled(e.target.checked)}
        />
        Clip in front of camera
      </label>

      {cameraClipEnabled && (
        <>
          <input
            type="number"
            className="clip-control__number-input"
            min="0"
            step="0.1"
            value={cameraClipDistance}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (!Number.isNaN(value)) onSetCameraClipDistance(value);
            }}
          />
          <p className="clip-control__hint">
            Distance from camera to the cut plane.
          </p>
        </>
      )}
    </div>
  );
}

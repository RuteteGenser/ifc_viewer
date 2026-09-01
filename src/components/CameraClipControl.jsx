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
        </>
      )}
    </div>
  );
}

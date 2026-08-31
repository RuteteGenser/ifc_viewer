export default function CameraClipControl({
  cameraClipEnabled,
  onSetCameraClipEnabled,
  cameraClipDistance,
  onSetCameraClipDistance,
  cameraClipRange,
  disabled,
}) {
  const { min, max } = cameraClipRange;
  const span = Math.max(max - min, 0.001);

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
            min={min}
            max={max}
            step={span / 200}
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

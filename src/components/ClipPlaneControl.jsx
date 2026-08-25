export default function ClipPlaneControl({
  clipEnabled,
  onSetClipEnabled,
  clipInverted,
  onSetClipInverted,
  clipHeight,
  onSetClipHeight,
  clipRange,
  disabled,
}) {
  const { min, max } = clipRange;
  const span = Math.max(max - min, 0.001);

  return (
    <div className="clip-control">
      <div className="sidebar__section-title">Section</div>
      <label className="clip-control__toggle">
        <input
          type="checkbox"
          checked={clipEnabled}
          disabled={disabled}
          onChange={(e) => onSetClipEnabled(e.target.checked)}
        />
        Enable clip plane
      </label>

      <input
        type="range"
        className="clip-control__slider"
        min={min}
        max={max}
        step={span / 200}
        value={clipHeight}
        disabled={disabled || !clipEnabled}
        onChange={(e) => onSetClipHeight(Number(e.target.value))}
      />

      <button
        type="button"
        className="clip-control__flip"
        disabled={disabled || !clipEnabled}
        onClick={() => onSetClipInverted(!clipInverted)}
      >
        Flip direction
      </button>
    </div>
  );
}

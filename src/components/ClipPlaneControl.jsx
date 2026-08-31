export default function ClipPlaneControl({
  clipEnabled,
  onSetClipEnabled,
  hasClipPlane,
  onFlipClipPlane,
  onClearClipPlane,
}) {
  return (
    <div className="clip-control">
      <div className="sidebar__section-title">Section</div>

      {!hasClipPlane ? (
        <p className="clip-control__hint">
          Right-click a surface to place a clip plane there.
        </p>
      ) : (
        <>
          <label className="clip-control__toggle">
            <input
              type="checkbox"
              checked={clipEnabled}
              onChange={(e) => onSetClipEnabled(e.target.checked)}
            />
            Enable clip plane
          </label>

          <div className="clip-control__buttons">
            <button
              type="button"
              className="clip-control__flip"
              onClick={onFlipClipPlane}
            >
              Flip direction
            </button>
            <button
              type="button"
              className="clip-control__remove"
              onClick={onClearClipPlane}
            >
              Remove
            </button>
          </div>

          <p className="clip-control__hint">Ctrl+scroll to move it.</p>
        </>
      )}
    </div>
  );
}

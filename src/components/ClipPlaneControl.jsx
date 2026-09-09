function FlipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18" strokeDasharray="3 3" />
      <path d="M7 8 4 12 7 16" />
      <path d="M17 8 20 12 17 16" />
    </svg>
  );
}

export default function ClipPlaneControl({
  clipPlanes,
  onSetClipPlaneEnabled,
  onSetClipPlaneGizmoVisible,
  onFlipClipPlane,
  onRemoveClipPlane,
}) {
  return (
    <div className="clip-control">
      <div className="sidebar__section-title">
        {clipPlanes.length > 1 ? "Sections" : "Section"}
      </div>

      {clipPlanes.length === 0 ? (
        <p className="clip-control__hint">
          Right-click a surface to place a clip plane there.
        </p>
      ) : (
        <>
          {clipPlanes.map((plane, i) => (
            <div className="clip-control__plane" key={plane.id}>
              {clipPlanes.length > 1 && (
                <div className="clip-control__plane-title">Plane {i + 1}</div>
              )}
              <label className="clip-control__toggle">
                <input
                  type="checkbox"
                  checked={plane.enabled}
                  onChange={(e) => onSetClipPlaneEnabled(plane.id, e.target.checked)}
                />
                Enable clip plane
              </label>
              <label className="clip-control__toggle">
                <input
                  type="checkbox"
                  checked={plane.gizmoVisible}
                  onChange={(e) => onSetClipPlaneGizmoVisible(plane.id, e.target.checked)}
                />
                Show draggable handle
              </label>

              <div className="clip-control__buttons">
                <button
                  type="button"
                  className="clip-control__flip"
                  aria-label="Flip direction"
                  title="Flip direction"
                  onClick={() => onFlipClipPlane(plane.id)}
                >
                  <FlipIcon />
                </button>
                <button
                  type="button"
                  className="clip-control__remove"
                  aria-label="Remove clip plane"
                  title="Remove clip plane"
                  onClick={() => onRemoveClipPlane(plane.id)}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}

          <p className="clip-control__hint">
            Right-click a surface to add another. Shift+drag a visible
            handle to move it along its own normal.
          </p>
        </>
      )}
    </div>
  );
}

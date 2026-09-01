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
                  onClick={() => onFlipClipPlane(plane.id)}
                >
                  Flip direction
                </button>
                <button
                  type="button"
                  className="clip-control__remove"
                  onClick={() => onRemoveClipPlane(plane.id)}
                >
                  Remove
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

import { colorCss } from "../ifc/sectionPlanes";

function FlipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18" strokeDasharray="3 3" />
      <path d="M7 8 4 12 7 16" />
      <path d="M17 8 20 12 17 16" />
    </svg>
  );
}

// Touch screens have no right-click or Shift key.
const TOUCH_UI = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

export default function ClipPlaneControl({
  clipPlanes,
  onSetClipPlaneEnabled,
  onSetClipPlaneGizmoVisible,
  onFlipClipPlane,
  onRemoveClipPlane,
  onSelectClipPlane,
}) {
  return (
    <div className="clip-control">
      <div className="sidebar__section-title">
        {clipPlanes.length > 1 ? "Sections" : "Section"}
      </div>

      {clipPlanes.length === 0 ? (
        <p className="clip-control__hint">
          {TOUCH_UI ? "Press and hold a surface to cut a section there." : "Right-click a surface to cut a section there."}
        </p>
      ) : (
        <>
          {clipPlanes.map((plane, i) => (
            <div
              className={`clip-control__plane${clipPlanes.length > 1 && plane.active ? " is-active" : ""}`}
              key={plane.id}
              style={{ "--plane-color": colorCss(plane.color) }}
            >
              {clipPlanes.length > 1 && (
                <button
                  type="button"
                  className="clip-control__plane-title clip-control__select"
                  aria-pressed={!!plane.active}
                  aria-label={`Plane ${i + 1}${plane.active ? ", active" : ", make active"}`}
                  onClick={() => onSelectClipPlane?.(plane.id)}
                >
                  <span className="clip-control__swatch" aria-hidden="true" />
                  Plane {i + 1}
                  {plane.active && <span className="clip-control__active"> (active)</span>}
                </button>
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
            {TOUCH_UI
              ? "Press and hold a surface to add another. Drag the blue sheet to move it along its own normal."
              : "Right-click a surface to add another. Shift+drag a visible handle to move it along its own normal."}
          </p>
        </>
      )}
    </div>
  );
}

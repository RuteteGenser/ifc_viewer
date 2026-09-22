// Read-only list of measurements — editing a leg's length happens by
// clicking its own floating label directly in the 3D view (see
// MeasureLegEditPopup.jsx), not here. Deliberately shows nothing while a
// measurement is still in progress (point A placed, point B not yet
// clicked) — that live readout lives only in the 3D view itself; this
// list is for completed measurements only.
export default function MeasureControl({ measurements, onRemoveMeasurement }) {
  return (
    <div className="measure-control">
      {measurements.length === 0 ? (
        <p className="clip-control__hint">
          Turn on Measure, then click two points in the view.
        </p>
      ) : (
        measurements.map((m) => (
          <div className="clip-control__plane" key={m.id}>
            <div className="measure-control__length">Length: {(m.length * 1000).toFixed(1)} mm</div>
            <div className="measure-control__values">
              <span style={{ color: "#ef4444" }} title="Perpendicular distance to the second point's surface — click its label in the 3D view to edit">
                Depth: {(m.depth * 1000).toFixed(1)} mm
              </span>
              <span style={{ color: "#3b82f6" }} title="Click its label in the 3D view to edit">
                Horizontal: {(m.horizontal * 1000).toFixed(1)} mm
              </span>
              <span style={{ color: "#22c55e" }} title="Click its label in the 3D view to edit">
                Vertical: {(m.vertical * 1000).toFixed(1)} mm
              </span>
            </div>
            <div className="clip-control__buttons">
              <button
                type="button"
                className="clip-control__remove"
                aria-label="Remove measurement"
                title="Remove measurement"
                onClick={() => onRemoveMeasurement(m.id)}
              >
                ✕
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

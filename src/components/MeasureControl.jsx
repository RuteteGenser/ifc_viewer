export default function MeasureControl({ measurements, onRemoveMeasurement }) {
  return (
    <div className="measure-control">
      <div className="sidebar__section-title">
        {measurements.length > 1 ? "Measurements" : "Measurement"}
      </div>

      {measurements.length === 0 ? (
        <p className="clip-control__hint">
          Turn on Measure, then click two points in the view.
        </p>
      ) : (
        measurements.map((m) => (
          <div className="clip-control__plane" key={m.id}>
            <div className="measure-control__length">Length: {m.length.toFixed(3)}</div>
            <div className="measure-control__values">
              <span style={{ color: "#ef4444" }}>ΔX: {m.dx.toFixed(3)}</span>
              <span style={{ color: "#22c55e" }}>ΔY: {m.dy.toFixed(3)}</span>
              <span style={{ color: "#3b82f6" }}>ΔZ: {m.dz.toFixed(3)}</span>
            </div>
            <div className="clip-control__buttons">
              <button
                type="button"
                className="clip-control__remove"
                onClick={() => onRemoveMeasurement(m.id)}
              >
                Remove
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

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
              <span style={{ color: "#ef4444" }} title="Perpendicular distance to the second point's surface">Depth: {(m.depth * 1000).toFixed(1)} mm</span>
              <span style={{ color: "#3b82f6" }}>Horizontal: {(m.horizontal * 1000).toFixed(1)} mm</span>
              <span style={{ color: "#22c55e" }}>Vertical: {(m.vertical * 1000).toFixed(1)} mm</span>
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

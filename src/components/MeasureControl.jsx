import { useAddedKeys } from "../usePresence";
import { formatLength } from "../ifc/formatLength";
import { MEASURE_COPY } from "../measure/copy";
import { DIRECTIONS, clearanceValueText } from "../ifc/clearance";

const COARSE = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

// Read-only list of measurements — editing a leg's length happens by
// clicking its own floating label directly in the 3D view (see
// MeasureLegEditPopup.jsx), not here. Deliberately shows nothing while a
// measurement is still in progress (point A placed, point B not yet
// clicked) — that live readout lives only in the 3D view itself; this
// list is for completed measurements only.
export default function MeasureControl({ measurements, onRemoveMeasurement, onStartMeasure }) {
  const added = useAddedKeys(measurements.map((m) => m.id));
  return (
    <div className="measure-control">
      {measurements.length === 0 ? (
        <>
          <p className="clip-control__hint">No measurements yet. {COARSE ? "Tap" : "Click"} two points on the model to measure.</p>
          <button type="button" className="sidebar__reset-visibility-button sidebar__reset-visibility-button--primary" onClick={onStartMeasure}>
            Start measuring
          </button>
        </>
      ) : (
        measurements.map((m) => m.kind === "clearance" ? (
          <div className={`clip-control__plane${added.has(m.id) ? " row-new" : ""}`} key={m.id} data-kind="clearance">
            <div className="measure-control__length measure-control__title">{MEASURE_COPY.clearanceTitle(m.name)}</div>
            <div className="measure-control__values measure-control__values--grid">
              {DIRECTIONS.map((dir) => (
                <span key={dir} data-dir={dir} className={m[dir] == null ? "is-open" : undefined}>
                  {MEASURE_COPY.directions[dir]}: {clearanceValueText(m[dir])}
                </span>
              ))}
            </div>
            <div className="clip-control__buttons">
              <button type="button" className="clip-control__remove" aria-label={MEASURE_COPY.remove} title={MEASURE_COPY.remove} onClick={() => onRemoveMeasurement(m.id)}>
                ✕
              </button>
            </div>
          </div>
        ) : (
          <div className={`clip-control__plane${added.has(m.id) ? " row-new" : ""}`} key={m.id}>
            <div className="measure-control__length">Length: {formatLength(m.length)}</div>
            <div className="measure-control__values">
              <span style={{ color: "#ef4444" }} title="Perpendicular distance to the second point's surface. click its label in the 3D view to edit">
                Depth: {formatLength(m.depth)}
              </span>
              <span style={{ color: "#3b82f6" }} title="Click its label in the 3D view to edit">
                Horizontal: {formatLength(m.horizontal)}
              </span>
              <span style={{ color: "#22c55e" }} title="Click its label in the 3D view to edit">
                Vertical: {formatLength(m.vertical)}
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

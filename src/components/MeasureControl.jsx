import { useState } from "react";

// A leg's mm readout, click-to-edit: clicking swaps the span for a
// number input pre-filled with the current value; Enter or blur commits
// (ignored if not a finite positive number), Escape cancels without
// committing. No such click-to-reveal pattern exists elsewhere in this
// app yet — the closest precedent (Compass's north-offset input) is a
// permanently-visible input instead, which would clutter every
// measurement row here.
function EditableLegValue({ label, valueMm, color, title, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (editing) {
    const commit = () => {
      const value = Number(draft);
      if (Number.isFinite(value) && value > 0) onCommit(value);
      setEditing(false);
    };
    return (
      <span className="measure-control__leg-edit">
        <span style={{ color }}>{label}: </span>
        <input
          type="number"
          step="0.1"
          min="0"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") setEditing(false);
          }}
        />
        <span style={{ color }}> mm</span>
      </span>
    );
  }

  return (
    <span
      style={{ color, cursor: onCommit ? "pointer" : undefined }}
      title={onCommit ? `${title ? title + " — " : ""}click to edit` : title}
      onClick={
        onCommit
          ? () => {
              setDraft(valueMm.toFixed(1));
              setEditing(true);
            }
          : undefined
      }
    >
      {label}: {valueMm.toFixed(1)} mm
    </span>
  );
}

export default function MeasureControl({ measurements, pendingMeasurePreview, onRemoveMeasurement, onSetMeasurementLeg }) {
  return (
    <div className="measure-control">
      {pendingMeasurePreview && (
        <div className="clip-control__plane measure-control__plane--pending">
          <div className="measure-control__length">
            Length: {(pendingMeasurePreview.length * 1000).toFixed(1)} mm
          </div>
          <div className="measure-control__values">
            <span style={{ color: "#ef4444" }} title="Perpendicular distance to the second point's surface">
              Depth: {(pendingMeasurePreview.depth * 1000).toFixed(1)} mm
            </span>
            <span style={{ color: "#3b82f6" }}>Horizontal: {(pendingMeasurePreview.horizontal * 1000).toFixed(1)} mm</span>
            <span style={{ color: "#22c55e" }}>Vertical: {(pendingMeasurePreview.vertical * 1000).toFixed(1)} mm</span>
          </div>
        </div>
      )}
      {measurements.length === 0 && !pendingMeasurePreview ? (
        <p className="clip-control__hint">
          Turn on Measure, then click two points in the view.
        </p>
      ) : (
        measurements.map((m) => (
          <div className="clip-control__plane" key={m.id}>
            <div className="measure-control__length">Length: {(m.length * 1000).toFixed(1)} mm</div>
            <div className="measure-control__values">
              <EditableLegValue
                label="Depth"
                valueMm={m.depth * 1000}
                color="#ef4444"
                title="Perpendicular distance to the second point's surface"
                onCommit={(value) => onSetMeasurementLeg(m.id, "depth", value)}
              />
              <EditableLegValue
                label="Horizontal"
                valueMm={m.horizontal * 1000}
                color="#3b82f6"
                onCommit={(value) => onSetMeasurementLeg(m.id, "horizontal", value)}
              />
              <EditableLegValue
                label="Vertical"
                valueMm={m.vertical * 1000}
                color="#22c55e"
                onCommit={(value) => onSetMeasurementLeg(m.id, "vertical", value)}
              />
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

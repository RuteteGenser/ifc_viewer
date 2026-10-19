import { forwardRef } from "react";
import { PALETTE } from "../cases/schema";

// Small bar for the selected annotation: Edit, Delete, Close and the colour swatches.
const ActionBar = forwardRef(function ActionBar({ annotation, onEdit, onColor, onDelete, onClose }, ref) {
  return (
    <div ref={ref} className="ann-bar" role="toolbar" aria-label="Annotation actions" data-vis="0">
      <div className="ann-bar__row">
        {onEdit && <button type="button" className="ann-btn" onClick={onEdit}>Edit</button>}
        <button type="button" className="ann-btn ann-btn--danger" onClick={onDelete}>Delete</button>
        <button type="button" className="ann-btn" onClick={onClose}>Close</button>
      </div>
      <div className="ann-bar__row" role="group" aria-label="Colour">
        {PALETTE.map((c) => (
          <button key={c} type="button" className="ann-swatch" aria-label={`Colour ${c}`} aria-pressed={annotation.color === c} onClick={() => onColor(c)}>
            <span style={{ background: c }} />
          </button>
        ))}
      </div>
    </div>
  );
});
export default ActionBar;

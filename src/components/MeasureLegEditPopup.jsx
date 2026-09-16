import { useEffect, useRef, useState } from "react";

// Small floating editor shown when a measurement's own 3D leg label
// (Depth/Horizontal/Vertical) is clicked — lets you type a new length
// for that leg without opening the right-side panel. Mirrors
// MeasureDeleteButton's outside-click/Escape-to-close plumbing.
export default function MeasureLegEditPopup({ x, y, label, color, valueMm, onCommit, onClose }) {
  const boxRef = useRef(null);
  const [draft, setDraft] = useState(() => valueMm.toFixed(1));

  useEffect(() => {
    const handlePointerDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) onClose();
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const commit = () => {
    const value = Number(draft);
    if (Number.isFinite(value) && value > 0) onCommit(value);
    else onClose();
  };

  return (
    <div ref={boxRef} className="measure-leg-edit-popup" style={{ left: x, top: y }}>
      <span style={{ color }}>{label}</span>
      <input
        type="number"
        step="0.1"
        min="0"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      <span style={{ color }}>mm</span>
    </div>
  );
}

import { useEffect, useRef } from "react";

// Small "X" popup shown when a measurement's endpoint marker is
// single-clicked (not dragged) — deletes that whole measurement.
export default function MeasureDeleteButton({ x, y, onDelete, onClose }) {
  const buttonRef = useRef(null);

  useEffect(() => {
    const handlePointerDown = (e) => {
      if (buttonRef.current && !buttonRef.current.contains(e.target)) onClose();
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

  const style = { left: x, top: y };

  return (
    <button
      ref={buttonRef}
      type="button"
      className="measure-delete-button"
      style={style}
      onClick={onDelete}
      aria-label="Delete measurement"
      title="Delete measurement"
    >
      ×
    </button>
  );
}

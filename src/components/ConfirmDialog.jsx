import { useEffect } from "react";

// Small centered modal used to confirm replacing an already-loaded
// model when a newly added file shares its name.
export default function ConfirmDialog({ title, message, confirmLabel = "Replace", cancelLabel = "Cancel", onConfirm, onCancel }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="confirm-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="confirm-dialog">
        {title && <div className="confirm-dialog__title">{title}</div>}
        <p className="confirm-dialog__message">{message}</p>
        <div className="confirm-dialog__buttons">
          <button type="button" className="confirm-dialog__cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="confirm-dialog__confirm" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

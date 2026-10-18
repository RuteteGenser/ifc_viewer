import { useEffect, useRef } from "react";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])";

// Small centered modal used to confirm replacing an already-loaded
// model when a newly added file shares its name. Behaves as a real modal:
// labelled dialog, focus moves in and stays in, Esc cancels, and focus goes
// back to whatever had it before.
export default function ConfirmDialog({ title, message, confirmLabel = "Replace", cancelLabel = "Cancel", onConfirm, onCancel, initialFocus = "confirm" }) {
  const dialogRef = useRef(null);
  const confirmRef = useRef(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    (initialFocus === "cancel" ? cancelRef : confirmRef).current?.focus();
    return () => {
      if (previous && previous.isConnected && typeof previous.focus === "function") previous.focus();
    };
  }, [initialFocus]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      const items = [...(dialogRef.current?.querySelectorAll(FOCUSABLE) ?? [])];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!dialogRef.current?.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
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
      <div
        className="confirm-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "confirm-dialog-title" : undefined}
        aria-describedby="confirm-dialog-message"
      >
        {title && (
          <div className="confirm-dialog__title" id="confirm-dialog-title">
            {title}
          </div>
        )}
        <p className="confirm-dialog__message" id="confirm-dialog-message">
          {message}
        </p>
        <div className="confirm-dialog__buttons">
          <button type="button" className="confirm-dialog__cancel" ref={cancelRef} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="confirm-dialog__confirm" ref={confirmRef} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

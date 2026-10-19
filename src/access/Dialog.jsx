import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { t } from "./copy";
import { useExitGhost } from "../usePresence";

// Modal with a labelled title, Escape to close (when closable), focus trap, focus return.
export default function Dialog({ title, onClose, children, wide, sheet }) {
  const ref = useRef(null);
  const backdropRef = useRef(null);
  useExitGhost(backdropRef, "fade", ".acc-dialog");
  // Latest handler without re-running the focus setup (a parent re-render must not pull focus back).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const closable = !!onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const box = ref.current;
    const focusable = () => [...box.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((el) => !el.disabled);
    (box.querySelector("[data-autofocus]") || focusable()[0] || box).focus();
    const onKey = (e) => {
      if (e.key === "Escape" && closeRef.current && !document.querySelector(".confirm-dialog-backdrop")) {
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key === "Tab") {
        const els = focusable();
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    box.addEventListener("keydown", onKey);
    return () => {
      box.removeEventListener("keydown", onKey);
      if (previous && previous.isConnected) previous.focus?.();
    };
  }, [closable]);
  return createPortal(
    <div className="acc-backdrop" ref={backdropRef} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`acc-dialog${wide ? " acc-dialog--wide" : ""}${sheet ? " acc-dialog--sheet" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="acc-dialog__head">
          <h2 className="acc-dialog__title">{title}</h2>
          {onClose && (
            <button type="button" className="acc-btn acc-btn--quiet" onClick={onClose}>
              {t("action.close")}
            </button>
          )}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

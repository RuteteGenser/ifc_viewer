import { useEffect, useRef, useState } from "react";
import usePresence from "../usePresence";
import { hapticsEnabled, setHapticsEnabled } from "../haptics";
import { createPortal } from "react-dom";
import ModelName from "./ModelName";
import { disciplineOf } from "../ifc/modelLabel";
import useSheetSwipe from "../ui/useSheetSwipe";
import "./Models.css";

export const countText = (n) => `${n} model${n === 1 ? "" : "s"}`;

function EyeIcon({ off }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );
}

// The header button that says how many models are loaded and opens the list.
export function ModelsChip({ count, open, onClick, className = "" }) {
  return (
    <button
      type="button"
      className={`models-chip ${className}`.trim()}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3Z" />
        <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
      </svg>
      <span key={count}>{countText(count)}</span>
    </button>
  );
}

function SheetRow({ model, onToggleVisible, onSetColor, onRemove }) {
  const discipline = disciplineOf(model.name);
  return (
    <li className="models-sheet__row" data-model-row>
      <div className="models-sheet__line">
        <ModelName name={model.name} className="models-sheet__name" />
        {discipline && (
          <abbr className="model-row__badge" title={discipline.label}>
            {discipline.code}
          </abbr>
        )}
      </div>
      <div className="models-sheet__controls">
        <button
          type="button"
          className="models-sheet__icon-btn"
          aria-pressed={model.visible}
          aria-label={model.visible ? `Hide ${model.name}` : `Show ${model.name}`}
          title={model.visible ? "Hide" : "Show"}
          onClick={() => onToggleVisible(model.id, !model.visible)}
        >
          <EyeIcon off={!model.visible} />
        </button>
        <label className="models-sheet__tint" title="Tint (visual only)">
          <input
            type="color"
            value={model.color ?? "#ffffff"}
            onChange={(e) => onSetColor(model.id, e.target.value)}
            aria-label={`Tint ${model.name}`}
          />
          <span>Tint</span>
        </label>
        <button type="button" className="models-sheet__remove" aria-label={`Remove ${model.name}`} onClick={() => onRemove(model.id)}>
          <TrashIcon />
          <span>Remove</span>
        </button>
      </div>
    </li>
  );
}

// Every loaded model with a labelled Remove button. A bottom sheet on a phone,
// a popover under the header on a wide screen.
function SheetBody({ state, models, isLoading, onClose, onToggleVisible, onSetColor, onRemove, onRemoveAll, onAdd, onOpenCases }) {
  const ref = useRef(null);
  const swipe = useSheetSwipe(onClose, ref);
  const [haptics, setHaptics] = useState(hapticsEnabled);
  const closed = state === "closed";
  useEffect(() => {
    if (closed) return undefined;
    const previous = document.activeElement;
    ref.current?.querySelector("button")?.focus();
    const onKey = (e) => {
      if (e.key === "Escape" && !document.querySelector(".confirm-dialog-backdrop")) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previous && previous.isConnected && typeof previous.focus === "function") previous.focus();
    };
  }, [onClose, closed]);

  return createPortal(
    <>
      <button type="button" className="models-sheet-backdrop" data-state={state} aria-label="Close models" tabIndex={-1} onClick={onClose} />
      <div className="models-sheet" data-state={state} data-surface-sheet="models" role="dialog" aria-label="Models" ref={ref}>
        <div className="models-sheet__head" {...swipe.head}>
          <h2 className="models-sheet__title">Models <span className="models-sheet__count">{countText(models.length)}</span></h2>
          <button type="button" className="models-sheet__close" onClick={onClose}>
            Done
          </button>
        </div>
        <ul className="models-sheet__list">
          {models.map((model) => (
            <SheetRow key={model.id} model={model} onToggleVisible={onToggleVisible} onSetColor={onSetColor} onRemove={onRemove} />
          ))}
        </ul>
        <p className="models-sheet__hint">Opening a model replaces the ones above. Use Add another model to view several together.</p>
        <div className="models-sheet__actions">
          <button type="button" className="models-sheet__add" onClick={onAdd} disabled={isLoading}>
            Add another model
          </button>
          <button type="button" className="models-sheet__remove-all models-sheet__cases" onClick={onOpenCases}>
            Cases
          </button>
          {models.length > 1 && (
            <button type="button" className="models-sheet__remove-all" onClick={onRemoveAll}>
              Remove all
            </button>
          )}
        </div>
        <label className="models-sheet__haptics">
          <input type="checkbox" checked={haptics} onChange={(e) => { setHaptics(e.target.checked); setHapticsEnabled(e.target.checked); }} />
          <span>
            Haptics
            <small>A light buzz on main buttons. Works on most Android phones; iPhone has no vibration for web pages.</small>
          </span>
        </label>
      </div>
    </>,
    document.body,
  );
}

// Stays mounted for the exit animation; `open` false plays it, then unmounts.
export default function ModelsSheet({ open = true, ...props }) {
  const { mounted, state } = usePresence(open, 160);
  const last = useRef(props);
  if (open) last.current = props;
  if (!mounted) return null;
  return <SheetBody state={state} {...(open ? props : last.current)} />;
}

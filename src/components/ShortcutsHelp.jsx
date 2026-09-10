import { useEffect, useRef, useState } from "react";
import Tooltip from "./Tooltip";

// Every hotkey the app responds to (see the keydown handler in
// useIfcViewer.js) — kept as a plain list here rather than derived, since
// there's no single registry of {key, description} in the hook to read
// from.
const SHORTCUTS = [
  { keys: "H", description: "Hide the selected element" },
  { keys: "C", description: "Create a clip plane under the cursor" },
  { keys: "M", description: "Toggle measure mode" },
  { keys: "Esc", description: "Exit the current tool" },
  { keys: "Ctrl+Z", description: "Undo" },
  { keys: "Ctrl+Y / Ctrl+Shift+Z", description: "Redo" },
];

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .8-1 1.7" />
      <path d="M12 17.2v.1" />
    </svg>
  );
}

export default function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="shortcuts-help" ref={containerRef}>
      <Tooltip description="Keyboard shortcuts" align="right">
        <button
          type="button"
          className="top-bar__icon-button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Keyboard shortcuts"
        >
          <HelpIcon />
        </button>
      </Tooltip>

      {open && (
        <div className="shortcuts-help__popover">
          <div className="shortcuts-help__title">Keyboard shortcuts</div>
          <dl className="shortcuts-help__list">
            {SHORTCUTS.map((s) => (
              <div className="shortcuts-help__row" key={s.keys}>
                <dt>{s.description}</dt>
                <dd>{s.keys}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

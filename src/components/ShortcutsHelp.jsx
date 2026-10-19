import { useCallback, useEffect, useRef } from "react";
import usePopoverGroup from "../hooks/usePopoverGroup";
import Tooltip from "./Tooltip";
import { useExitGhost } from "../usePresence";
import useSheetSwipe from "../ui/useSheetSwipe";

// Every hotkey the app responds to (see the keydown handler in
// useIfcViewer.js) — kept as a plain list here rather than derived, since
// there's no single registry of {key, description} in the hook to read
// from.
const SHORTCUTS = [
  { keys: "Click / tap", description: "Select an element" },
  { keys: "Double-click", description: "Zoom to the element" },
  { keys: "Right-click / press and hold", description: "Menu: zoom, isolate, hide, cut a section" },
  { keys: "Scroll / pinch", description: "Zoom at a steady speed, to the cursor" },
  { keys: "+ / -", description: "Zoom in / out" },
  { keys: "0", description: "Fit the whole model (Home)" },
  { keys: "F", description: "Zoom to the selected element" },
  { keys: "H", description: "Hide the selected element" },
  { keys: "I", description: "Isolate the selected element" },
  { keys: "C", description: "Cut a section under the cursor" },
  { keys: "M", description: "Measure two points" },
  { keys: "T", description: "Tag tool (pin a tag on an element)" },
  { keys: "G", description: "Hide a whole category" },
  { keys: "V", description: "Show or hide tags, measurements and colours" },
  { keys: "P", description: "Save the current view as an image" },
  { keys: "Esc", description: "Exit the current tool or clear the selection" },
  { keys: "Ctrl+Z", description: "Undo" },
  { keys: "Ctrl+Y / Ctrl+Shift+Z", description: "Redo" },
];

// Phones and tablets have no keyboard: the same help is a list of gestures.
const GESTURES = [
  { gesture: "Tap", description: "Select an element" },
  { gesture: "Hold", description: "Menu: zoom, isolate, hide, cut a section" },
  { gesture: "Drag", description: "Turn the model, around the point you touch" },
  { gesture: "Pinch", description: "Zoom" },
  { gesture: "Two fingers", description: "Drag to move the view" },
  { gesture: "Double-tap", description: "Zoom to the element" },
];

const COARSE = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .8-1 1.7" />
      <path d="M12 17.2v.1" />
    </svg>
  );
}

export function GestureSheet({ onClose }) {
  const scrimRef = useRef(null);
  const sheetRef = useRef(null);
  useExitGhost(scrimRef, "fade");
  useExitGhost(sheetRef, "sheet");
  const swipe = useSheetSwipe(onClose, sheetRef);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <button type="button" className="help-sheet__scrim" ref={scrimRef} aria-label="Close help" onClick={onClose} />
      <div className="help-sheet" ref={sheetRef} data-surface-sheet="help" role="dialog" aria-label="How to move around">
        <div className="help-sheet__title" {...swipe.head}>How to move around</div>
        <dl className="help-sheet__list">
          {GESTURES.map((g) => (
            <div className="help-sheet__row" key={g.gesture}>
              <dt>{g.gesture}</dt>
              <dd>{g.description}</dd>
            </div>
          ))}
        </dl>
        <button type="button" className="help-sheet__close" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
    </>
  );
}

function ShortcutsPopover() {
  const ref = useRef(null);
  useExitGhost(ref);
  return (
    <div className="shortcuts-help__popover" ref={ref}>
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
  );
}

// `open` is controlled by the app, so the menu drawer can open the same help
// on phones where the toolbar has no room for the button.
export default function ShortcutsHelp({ open, onOpenChange }) {
  const containerRef = useRef(null);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  usePopoverGroup("help", open, close);

  useEffect(() => {
    if (!open || COARSE) return undefined;
    const handlePointerDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) close();
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, close]);

  return (
    <div className="shortcuts-help" ref={containerRef}>
      <Tooltip description={COARSE ? "How to move around" : "Keyboard shortcuts"} align="right">
        <button
          type="button"
          className="top-bar__icon-button"
          onClick={() => onOpenChange(!open)}
          aria-label={COARSE ? "Help: how to move around" : "Keyboard shortcuts"}
          aria-expanded={open}
        >
          <HelpIcon />
          <span className="top-bar__caption" aria-hidden="true">Help</span>
        </button>
      </Tooltip>

      {open && !COARSE && (
        <ShortcutsPopover />
      )}
    </div>
  );
}

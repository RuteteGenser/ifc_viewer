import { useEffect, useRef, useState } from "react";
import Tooltip from "./Tooltip";
import { STANDARD_VIEWS } from "../ifc/viewHelpers";
import { formatElevation } from "../ifc/storeys";
import "./ViewTools.css";

const svgProps = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

function CubeIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg {...svgProps}>
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

// Closes a popover on an outside press or Escape, the same way the
// shortcuts popover does.
function useDismiss(open, setOpen, rootRef) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen, rootRef]);
}

const SECTION_KINDS = [
  { id: "plan", label: "Plan", aria: "Cut a horizontal plan section through the middle" },
  { id: "side", label: "Side", aria: "Cut a vertical section from left to right" },
  { id: "front", label: "Front", aria: "Cut a vertical section from front to back" },
];

const COARSE = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

function ViewsPanel({ views, onClose }) {
  const { flat, setFlatProjection, goToView, levels, levelSel, showLevels, showAllLevels } = views;
  // On a touch screen the panel covers much of the model, so it gets out of
  // the way once a choice is made. With a mouse it stays for quick flipping.
  const after = (fn) => (...args) => {
    fn(...args);
    if (COARSE) onClose();
  };
  const ordered = [...levels].reverse(); // highest level first, like a section drawing
  return (
    <div className="view-tools__panel" role="dialog" aria-label="Views and levels">
      <div className="view-tools__heading">Views</div>
      <div className="view-tools__grid">
        {STANDARD_VIEWS.map((v) => (
          <button key={v.id} type="button" className="view-tools__chip" onClick={() => {
              goToView(v.id);
              onClose();
            }} aria-label={`${v.label} view`}>
            {v.label}
          </button>
        ))}
      </div>
      <label className="view-tools__switch">
        <input type="checkbox" checked={flat} onChange={after((e) => setFlatProjection(e.target.checked))} />
        <span>
          Flat view
          <small>Parallel lines, no perspective</small>
        </span>
      </label>

      <div className="view-tools__heading">Section</div>
      <div className="view-tools__grid">
        {SECTION_KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            className="view-tools__chip"
            onClick={() => {
              views.addSection(k.id);
              if (COARSE) onClose();
            }}
            aria-label={k.aria}
          >
            {k.label}
          </button>
        ))}
      </div>
      {views.section && (
        <div className="view-tools__slider">
          <input
            type="range"
            min="0"
            max="1"
            step="0.005"
            value={views.section.fraction}
            onChange={(e) => views.setSectionFraction(Number(e.target.value))}
            aria-label="Move the section plane"
          />
          <button type="button" className="view-tools__mini" onClick={views.flipSection} aria-label="Flip the section direction">
            Flip
          </button>
          <button type="button" className="view-tools__mini" onClick={views.removeSection} aria-label="Remove the section">
            Remove
          </button>
        </div>
      )}

      <div className="view-tools__heading">Levels</div>
      {levels.length === 0 ? (
        <p className="view-tools__note">This model has no building storeys.</p>
      ) : (
        <ul className="view-tools__levels">
          <li className="view-tools__level">
            <button
              type="button"
              className={`view-tools__level-name${levelSel ? "" : " is-active"}`}
              onClick={after(showAllLevels)}
              aria-pressed={!levelSel}
            >
              All levels
            </button>
          </li>
          {ordered.map((level) => {
            const onlyActive = levelSel?.id === level.id && levelSel.mode === "only";
            const belowActive = levelSel?.id === level.id && levelSel.mode === "below";
            return (
              <li key={level.id} className="view-tools__level">
                <span className="view-tools__level-label">
                  <span className="view-tools__level-title">{level.name}</span>
                  <span className="view-tools__level-elev">{formatElevation(level.elevation)}</span>
                </span>
                <button
                  type="button"
                  className={`view-tools__mini${onlyActive ? " is-active" : ""}`}
                  onClick={after(() => showLevels(level.id, "only"))}
                  aria-pressed={onlyActive}
                  aria-label={`Show only ${level.name}`}
                >
                  Only
                </button>
                <button
                  type="button"
                  className={`view-tools__mini${belowActive ? " is-active" : ""}`}
                  onClick={after(() => showLevels(level.id, "below"))}
                  aria-pressed={belowActive}
                  aria-label={`Show ${level.name} and everything below`}
                >
                  And below
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="view-tools__close" onClick={onClose}>
        Done
      </button>
    </div>
  );
}

function SharePanel({ views, onClose }) {
  const canShareFiles = typeof navigator !== "undefined" && typeof navigator.canShare === "function" && window.matchMedia?.("(pointer: coarse)").matches;
  return (
    <div className="view-tools__panel view-tools__panel--menu" role="menu" aria-label="Save and share">
      <button
        type="button"
        role="menuitem"
        className="view-tools__action"
        onClick={() => {
          onClose();
          views.saveScreenshot();
        }}
      >
        <span>{canShareFiles ? "Share or save image" : "Save image"}</span>
        <kbd>P</kbd>
      </button>
      <button
        type="button"
        role="menuitem"
        className="view-tools__action"
        onClick={() => {
          onClose();
          views.copyViewLink();
        }}
      >
        <span>Copy view link</span>
      </button>
    </div>
  );
}

// Floating controls at the top right of the 3D view: the views/levels
// panel and the save/share menu. Kept out of the toolbar, which is already
// full on a phone.
export default function ViewTools({ views }) {
  const [open, setOpen] = useState(null); // "views" | "share" | null
  const rootRef = useRef(null);
  useDismiss(open !== null, () => setOpen(null), rootRef);
  const disabled = !views.hasModels;
  const toggle = (name) => setOpen((cur) => (cur === name ? null : name));

  return (
    <div className={`view-tools${views.isolating ? " view-tools--lower" : ""}`} ref={rootRef}>
      <div className="view-tools__buttons">
        <Tooltip description={disabled ? "Open a model first" : "Views and levels"} align="right">
          <button
            type="button"
            className={`view-tools__button${open === "views" ? " is-open" : ""}`}
            onClick={() => !disabled && toggle("views")}
            aria-disabled={disabled}
            aria-expanded={open === "views"}
            aria-haspopup="dialog"
            aria-label="Views and levels"
          >
            <CubeIcon />
          </button>
        </Tooltip>
        <Tooltip description={disabled ? "Open a model first" : "Save image or copy view link"} hotkey="P" align="right">
          <button
            type="button"
            className={`view-tools__button${open === "share" ? " is-open" : ""}`}
            onClick={() => !disabled && toggle("share")}
            aria-disabled={disabled}
            aria-expanded={open === "share"}
            aria-haspopup="menu"
            aria-label="Save image or copy view link"
          >
            <CameraIcon />
          </button>
        </Tooltip>
      </div>
      {open === "views" && <ViewsPanel views={views} onClose={() => setOpen(null)} />}
      {open === "share" && <SharePanel views={views} onClose={() => setOpen(null)} />}
    </div>
  );
}

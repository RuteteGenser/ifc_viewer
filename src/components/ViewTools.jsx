import { useCallback, useEffect, useRef, useState } from "react";
import usePopoverGroup from "../hooks/usePopoverGroup";
import Tooltip from "./Tooltip";
import { useExitGhost } from "../usePresence";
import { nextIndex } from "../a11y";
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

function PlusIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg {...svgProps}>
      <path d="M5 12h14" />
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

function ViewsPanel({ views, spaceControl, onClose }) {
  const panelRef = useRef(null);
  useExitGhost(panelRef);
  const { flat, setFlatProjection, goToView, levels, levelSel, showLevels, showAllLevels } = views;
  // A dialog takes focus when it opens (its trigger gets it back on close).
  useEffect(() => {
    panelRef.current?.querySelector("button")?.focus();
  }, []);
  const [mode, setMode] = useState(levelSel?.mode ?? "only");
  // On a touch screen the panel covers much of the model, so it gets out of
  // the way once a choice is made. With a mouse it stays for quick flipping.
  const after = (fn) => (...args) => {
    fn(...args);
    if (COARSE) onClose();
  };
  const ordered = [...levels].reverse(); // highest level first, like a section drawing
  const chooseMode = (next) => {
    setMode(next);
    if (levelSel) showLevels(levelSel.id, next);
  };
  return (
    <div className="view-tools__panel" ref={panelRef} role="dialog" aria-label="Views and levels">
      <div className="view-tools__head">
        <span className="view-tools__heading">Views and levels</span>
        <button type="button" className="view-tools__close" onClick={onClose}>
          Done
        </button>
      </div>

      {levels.length > 0 && (
        <>
          <div className="view-tools__row">
            <span className="view-tools__heading">Levels</span>
            <div className="view-tools__seg" role="group" aria-label="Which levels to show">
              <button type="button" className={mode === "only" ? "is-active" : ""} aria-pressed={mode === "only"} onClick={() => chooseMode("only")}>
                Only
              </button>
              <button type="button" className={mode === "below" ? "is-active" : ""} aria-pressed={mode === "below"} onClick={() => chooseMode("below")}>
                And below
              </button>
            </div>
          </div>
          <div className="view-tools__chips view-tools__chips--scroll" role="group" aria-label="Levels">
            <button type="button" className={`view-tools__chip${levelSel ? "" : " is-active"}`} aria-pressed={!levelSel} onClick={after(showAllLevels)}>
              All
            </button>
            {ordered.map((level) => {
              const active = levelSel?.id === level.id;
              return (
                <button
                  key={level.id}
                  type="button"
                  className={`view-tools__chip${active ? " is-active" : ""}`}
                  aria-pressed={active}
                  title={`${level.name}, ${formatElevation(level.elevation)}`}
                  aria-label={`${mode === "below" ? "Show" : "Only"} ${level.name}${mode === "below" ? " and below" : ""}`}
                  onClick={after(() => showLevels(level.id, mode))}
                >
                  {level.name}
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="view-tools__row">
        <span className="view-tools__heading">Views</span>
        <button type="button" role="switch" aria-checked={flat} className={`view-tools__toggle${flat ? " is-active" : ""}`} title="Parallel lines, no perspective" onClick={after(() => setFlatProjection(!flat))}>
          Flat view
        </button>
      </div>
      <div className="view-tools__chips">
        {STANDARD_VIEWS.map((v) => (
          <button key={v.id} type="button" className="view-tools__chip" onClick={() => {
              goToView(v.id);
              onClose();
            }} aria-label={`${v.label} view`}>
            {v.id === "iso" ? "Iso" : v.label}
          </button>
        ))}
      </div>

      <div className="view-tools__heading">Section</div>
      <div className="view-tools__chips view-tools__chips--three">
        {SECTION_KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            className={`view-tools__chip${views.section?.kind === k.id ? " is-active" : ""}`}
            aria-pressed={views.section?.kind === k.id}
            onClick={() => {
              views.addSection(k.id);
              onClose();
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

      {spaceControl?.available && (
        <label className="view-tools__switch">
          <input type="checkbox" checked={spaceControl.shown} onChange={(e) => spaceControl.setShown(e.target.checked)} />
          <span>Show spaces</span>
        </label>
      )}
      {levels.length === 0 && <p className="view-tools__note">This model has no building storeys.</p>}
    </div>
  );
}

function SharePanel({ views, onClose, onSaveSnapshot, onOpenCases }) {
  const panelRef = useRef(null);
  useExitGhost(panelRef);
  // A menu: focus lands on the first item, Up/Down/Home/End move between items.
  useEffect(() => {
    panelRef.current?.querySelector('[role="menuitem"]')?.focus();
  }, []);
  const menuKeys = (e) => {
    const items = [...panelRef.current.querySelectorAll('[role="menuitem"]')];
    const next = nextIndex(e.key, items.indexOf(document.activeElement), items.length, false);
    if (next < 0) return;
    e.preventDefault();
    items[next].focus();
  };
  const canShareFiles = typeof navigator !== "undefined" && typeof navigator.canShare === "function" && window.matchMedia?.("(pointer: coarse)").matches;
  return (
    <div className="view-tools__panel view-tools__panel--menu" ref={panelRef} role="menu" aria-label="Save and share" onKeyDown={menuKeys}>
      <button
        type="button"
        role="menuitem"
        className="view-tools__action"
        onClick={() => {
          onClose();
          onSaveSnapshot?.("");
        }}
      >
        <span>Save snapshot to case</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="view-tools__action"
        onClick={() => {
          onClose();
          views.saveScreenshot();
        }}
      >
        <span>{canShareFiles ? "Share or download image" : "Download image (.png)"}</span>
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
      <button
        type="button"
        role="menuitem"
        className="view-tools__action"
        onClick={() => {
          onClose();
          onOpenCases?.();
        }}
      >
        <span>Open Cases</span>
      </button>
      <p className="view-tools__hint">The link shares the camera view only.</p>
    </div>
  );
}

// Floating controls at the top right of the 3D view: the views/levels
// panel and the save/share menu. Kept out of the toolbar, which is already
// full on a phone.
export default function ViewTools({ views, spaceControl, onOpenChange, onSaveSnapshot, onOpenCases }) {
  const [open, setOpen] = useState(null); // "views" | "share" | null
  const rootRef = useRef(null);
  // Closing from inside a panel (Esc, Done, a menu item) hands focus back to the button that opened it.
  const close = useCallback(() => {
    const root = rootRef.current;
    if (root && document.activeElement?.closest?.(".view-tools__panel")) root.querySelector('.view-tools__buttons [aria-expanded="true"]')?.focus();
    setOpen(null);
  }, []);
  useDismiss(open !== null, close, rootRef);
  usePopoverGroup("view-tools", open !== null, close);
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  const disabled = !views.hasModels;
  const toggle = (name) => setOpen((cur) => (cur === name ? null : name));
  const atMin = views.zoomLimit === "min";
  const atMax = views.zoomLimit === "max";

  return (
    <div className={`view-tools${views.isolating ? " view-tools--lower" : ""}`} ref={rootRef}>
      <div className="view-tools__buttons">
        <Tooltip description={disabled ? "Open a model first" : "Views and levels"} align="right">
          <button
            type="button"
            className={`view-tools__button view-tools__button--cap${open === "views" ? " is-open" : ""}`}
            onClick={() => !disabled && toggle("views")}
            aria-disabled={disabled}
            aria-expanded={open === "views"}
            aria-haspopup="dialog"
            aria-label="Views and levels"
          >
            <CubeIcon />
            <span className="view-tools__caption" aria-hidden="true">Views</span>
          </button>
        </Tooltip>
        <Tooltip description={disabled ? "Open a model first" : "Save image or copy view link"} hotkey="P" align="right">
          <button
            type="button"
            className={`view-tools__button view-tools__button--cap${open === "share" ? " is-open" : ""}`}
            onClick={() => !disabled && toggle("share")}
            aria-disabled={disabled}
            aria-expanded={open === "share"}
            aria-haspopup="menu"
            aria-label="Save image or copy view link"
          >
            <CameraIcon />
            <span className="view-tools__caption" aria-hidden="true">Share</span>
          </button>
        </Tooltip>
        <div className="view-tools__zoom" role="group" aria-label="Zoom">
          <Tooltip description={disabled ? "Open a model first" : "Zoom out"} hotkey="-" align="right">
            <button
              type="button"
              className="view-tools__button"
              onClick={() => !disabled && views.zoomOut()}
              aria-disabled={disabled || atMax}
              aria-label="Zoom out"
            >
              <MinusIcon />
            </button>
          </Tooltip>
          <Tooltip description={disabled ? "Open a model first" : "Zoom in"} hotkey="+" align="right">
            <button
              type="button"
              className="view-tools__button"
              onClick={() => !disabled && views.zoomIn()}
              aria-disabled={disabled || atMin}
              aria-label="Zoom in"
            >
              <PlusIcon />
            </button>
          </Tooltip>
        </div>
      </div>
      {open === "views" && <ViewsPanel views={views} spaceControl={spaceControl} onClose={close} />}
      {open === "share" && <SharePanel views={views} onClose={close} onSaveSnapshot={onSaveSnapshot} onOpenCases={onOpenCases} />}
    </div>
  );
}

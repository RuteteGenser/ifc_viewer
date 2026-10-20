import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Tooltip from "./Tooltip";
import usePopoverGroup from "../hooks/usePopoverGroup";
import { useSurfaceFlag, useSurfaces } from "../ui/surfaces";
import { nextIndex } from "../a11y";
import { MEASURE_TOOLS, toolById } from "../measure/tools";
import { MEASURE_COPY } from "../measure/copy";
import "../styles/clearance.css";

const svgProps = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

export function MeasureIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="9" width="18" height="6" rx="1" transform="rotate(-30 12 12)" />
      <path d="M8.5 12.6 L9.7 10.6 M11.3 14.2 L12.5 12.2 M14 15.8 L15.2 13.8" transform="rotate(-30 12 12)" />
    </svg>
  );
}

function DistanceIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="5.5" cy="17.5" r="1.8" />
      <circle cx="18.5" cy="6.5" r="1.8" />
      <path d="M7 16.2 17 7.8" />
    </svg>
  );
}

function ClearanceIcon() {
  return (
    <svg {...svgProps}>
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M12 8V3M10.2 4.8 12 3l1.8 1.8M12 16v5M10.2 19.2 12 21l1.8-1.8M8 12H3M4.8 10.2 3 12l1.8 1.8M16 12h5M19.2 10.2 21 12l-1.8 1.8" />
    </svg>
  );
}

function CaretIcon() {
  return (
    <svg {...svgProps} strokeWidth={2}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...svgProps} strokeWidth={2}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

const ICONS = { distance: DistanceIcon, clearance: ClearanceIcon };

function MenuPanel({ tool, anchorRef, phone, onChoose, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  // Under the button on a desktop (kept inside the window); a compact sheet at the bottom on a phone.
  useLayoutEffect(() => {
    if (phone) return;
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = ref.current?.offsetWidth ?? 280;
    setPos({ top: Math.round(rect.bottom + 6), left: Math.max(8, Math.min(Math.round(rect.left), window.innerWidth - width - 8)) });
  }, [phone, anchorRef]);
  // Focus lands on the chosen tool once the menu is placed (a hidden element cannot take focus).
  const placed = phone || pos !== null;
  useEffect(() => {
    if (!placed) return;
    const items = ref.current?.querySelectorAll('[role="menuitemradio"]');
    const selected = [...(items ?? [])].findIndex((el) => el.getAttribute("aria-checked") === "true");
    items?.[Math.max(0, selected)]?.focus();
  }, [placed]);
  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation(); // closes the menu only; the armed tool stays
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Tab") {
      onClose();
      return;
    }
    const items = [...ref.current.querySelectorAll('[role="menuitemradio"]')];
    const next = nextIndex(e.key, items.indexOf(document.activeElement), items.length, false);
    if (next < 0) return;
    e.preventDefault();
    items[next].focus();
  };
  return createPortal(
    <div
      ref={ref}
      className={`measure-menu${phone ? " measure-menu--sheet" : ""}`}
      style={phone ? undefined : pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
      role="menu"
      aria-label={MEASURE_COPY.menuLabel}
      data-surface-sheet="measure"
      onKeyDown={onKeyDown}
    >
      {MEASURE_TOOLS.map((t) => {
        const Icon = ICONS[t.id];
        const on = t.id === tool;
        return (
          <button key={t.id} type="button" role="menuitemradio" aria-checked={on} className={`measure-menu__item${on ? " is-on" : ""}`} data-tool={t.id} onClick={() => onChoose(t.id)}>
            <span className="measure-menu__icon">{Icon && <Icon />}</span>
            <span className="measure-menu__text">
              <span className="measure-menu__name">{t.name}</span>
              <span className="measure-menu__hint">{t.hint}</span>
            </span>
            <span className="measure-menu__check">{on && <CheckIcon />}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

// The Measure control in the tool row. Desktop: the icon arms the tool used last, the arrow beside it opens the list of
// measure tools. Phone: the cells are too narrow for an arrow that is also a 44 px target, so a tap opens the list.
export default function MeasureMenu({ hasModels, active, tool, onToggle, onChoose, onBlocked }) {
  const { phone } = useSurfaces();
  const rootRef = useRef(null);
  const mainRef = useRef(null);
  const caretRef = useRef(null);
  const triggerRef = phone ? mainRef : caretRef;
  const closeRef = useRef(() => {});
  const [open, setOpen] = useSurfaceFlag("measure", () => closeRef.current());
  const close = useCallback(
    () => {
      // Closing from inside the menu hands focus back to the button that opened it.
      const panel = document.querySelector('[data-surface-sheet="measure"]');
      if (panel?.contains(document.activeElement)) triggerRef.current?.focus();
      setOpen(false);
    },
    [setOpen, triggerRef],
  );
  closeRef.current = close;
  usePopoverGroup("measure-menu", open, useCallback(() => setOpen(false), [setOpen]));
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      const panel = document.querySelector('[data-surface-sheet="measure"]');
      if (rootRef.current?.contains(e.target) || panel?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open, setOpen]);
  useEffect(() => {
    if (!hasModels && open) setOpen(false);
  }, [hasModels, open, setOpen]);

  const current = toolById(tool);
  const choose = (id) => {
    onChoose(id);
    setOpen(false);
    triggerRef.current?.focus();
  };
  const onMain = () => {
    if (!hasModels) return onBlocked?.();
    if (phone && !active) setOpen((v) => !v);
    else onToggle();
  };
  const onCaret = () => {
    if (!hasModels) return onBlocked?.();
    setOpen((v) => !v);
  };
  const locked = (text) => (hasModels ? text : "Open a model first");
  return (
    <div className={`measure-split${open ? " is-open" : ""}`} ref={rootRef}>
      <Tooltip description={locked(phone ? MEASURE_COPY.tooltipHint : MEASURE_COPY.tooltip(current.name))} hotkey="M">
        <button
          ref={mainRef}
          type="button"
          className={`top-bar__icon-button measure-split__main${active ? " top-bar__icon-button--active" : ""}${hasModels ? "" : " is-blocked"}`}
          onClick={onMain}
          aria-disabled={!hasModels}
          aria-label={phone && !active ? MEASURE_COPY.menuLabel : "Toggle measure mode"}
          aria-pressed={phone && !active ? undefined : active}
          aria-haspopup={phone ? "menu" : undefined}
          aria-expanded={phone ? open : undefined}
        >
          <MeasureIcon />
          <span className="top-bar__caption" aria-hidden="true">Measure</span>
        </button>
      </Tooltip>
      {!phone && (
        <Tooltip description={locked(MEASURE_COPY.caretLabel)}>
          <button
            ref={caretRef}
            type="button"
            className={`measure-split__caret${hasModels ? "" : " is-blocked"}`}
            onClick={onCaret}
            aria-disabled={!hasModels}
            aria-label={MEASURE_COPY.caretLabel}
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <CaretIcon />
          </button>
        </Tooltip>
      )}
      {open && hasModels && <MenuPanel tool={tool} anchorRef={rootRef} phone={phone} onChoose={choose} onClose={close} />}
    </div>
  );
}

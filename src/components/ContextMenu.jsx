import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useExitGhost } from "../usePresence";
import { nextIndex } from "../a11y";

// One stroke family with the toolbar (24 grid, 1.75 stroke).
const ICONS = {
  zoom: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.9-4.9M10.5 8v5M8 10.5h5" /></>,
  isolate: <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>,
  hide: <><path d="M3 3l18 18" /><path d="M10.6 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a13.4 13.4 0 0 1-3.1 3.9M6.6 6.6C4 8.3 2 12 2 12s3.5 7 10 7a10.6 10.6 0 0 0 4.4-.9" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  cut: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 15 20 9" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
};
const Icon = ({ name }) => (
  <svg className="context-menu__icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICONS[name]}
  </svg>
);

export default function ContextMenu({ x, y, touch = false, onCreateClipPlane, onHideElement, onZoomTo, onIsolate, onCopyGuid, onClose }) {
  const menuRef = useRef(null);
  useExitGhost(menuRef);

  useEffect(() => {
    const handlePointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
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

  // Keyboard: focus enters the menu once it is placed, Up/Down/Home/End move, Esc closes and focus goes back.
  useEffect(() => {
    const previous = document.activeElement;
    return () => {
      if (previous && previous.isConnected && previous !== document.body && document.activeElement?.closest?.(".context-menu")) previous.focus?.({ preventScroll: true });
    };
  }, []);
  const onMenuKeys = (e) => {
    const items = [...menuRef.current.querySelectorAll('[role="menuitem"]')];
    const next = nextIndex(e.key, items.indexOf(document.activeElement), items.length, false);
    if (next < 0) return;
    e.preventDefault();
    items[next].focus();
  };

  // Placed from the menu's measured size so it always lands fully inside
  // the window. A mouse menu opens at the pointer, flipping left/up at the
  // edges. Under a finger it opens beside the press point (so the thing
  // being acted on stays visible), falling back to above or below it.
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    const { offsetWidth: w, offsetHeight: h } = menuRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const MARGIN = 8;
    const GAP = touch ? 36 : 0; // keep clear of the fingertip
    const clampX = (left) => Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
    const clampY = (top) => Math.max(MARGIN, Math.min(top, vh - h - MARGIN));
    let left;
    let top;
    if (!touch) {
      left = clampX(x + w + MARGIN > vw ? x - w : x);
      top = clampY(y + h + MARGIN > vh ? y - h : y);
    } else if (x + GAP + w + MARGIN <= vw) {
      left = x + GAP;
      top = clampY(y - h / 2);
    } else if (x - GAP - w >= MARGIN) {
      left = x - GAP - w;
      top = clampY(y - h / 2);
    } else {
      left = clampX(x - w / 2);
      top = y - GAP - h >= MARGIN ? y - GAP - h : clampY(y + GAP);
    }
    setPosition({ left, top });
  }, [x, y, touch]);
  // Focus goes in once the menu is visible (a hidden element cannot take focus).
  const placed = position !== null;
  useEffect(() => {
    if (placed) menuRef.current?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [placed]);
  const style = position ?? { left: 0, top: 0, visibility: "hidden" };

  return (
    <ul ref={menuRef} className="context-menu" style={style} role="menu" aria-label="Element actions" onKeyDown={onMenuKeys}>
      <li>
        <button type="button" role="menuitem" onClick={onZoomTo}>
          <Icon name="zoom" />
          <span className="context-menu__label">Zoom to element</span> <kbd>F</kbd>
        </button>
      </li>
      <li>
        <button type="button" role="menuitem" onClick={onIsolate}>
          <Icon name="isolate" />
          <span className="context-menu__label">Isolate element</span> <kbd>I</kbd>
        </button>
      </li>
      <li>
        <button type="button" role="menuitem" onClick={onHideElement}>
          <Icon name="hide" />
          <span className="context-menu__label">Hide element</span> <kbd>H</kbd>
        </button>
      </li>
      <li>
        <button type="button" role="menuitem" onClick={onCreateClipPlane}>
          <Icon name="cut" />
          <span className="context-menu__label">Cut a section here</span> <kbd>C</kbd>
        </button>
      </li>
      <li className="context-menu__sep" role="separator" />
      <li>
        <button type="button" role="menuitem" onClick={onCopyGuid}>
          <Icon name="copy" />
          <span className="context-menu__label">Copy GUID</span>
        </button>
      </li>
    </ul>
  );
}

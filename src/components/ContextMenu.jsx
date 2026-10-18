import { useEffect, useLayoutEffect, useRef, useState } from "react";

export default function ContextMenu({ x, y, touch = false, onCreateClipPlane, onHideElement, onZoomTo, onIsolate, onCopyGuid, onClose }) {
  const menuRef = useRef(null);

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
  const style = position ?? { left: 0, top: 0, visibility: "hidden" };

  return (
    <ul ref={menuRef} className="context-menu" style={style} role="menu">
      <li>
        <button type="button" role="menuitem" onClick={onZoomTo}>
          Zoom to element <kbd>F</kbd>
        </button>
      </li>
      <li>
        <button type="button" role="menuitem" onClick={onIsolate}>
          Isolate element <kbd>I</kbd>
        </button>
      </li>
      <li>
        <button type="button" role="menuitem" onClick={onHideElement}>
          Hide element <kbd>H</kbd>
        </button>
      </li>
      <li>
        <button type="button" role="menuitem" onClick={onCreateClipPlane}>
          Cut a section here <kbd>C</kbd>
        </button>
      </li>
      <li>
        <button type="button" role="menuitem" onClick={onCopyGuid}>
          Copy GUID
        </button>
      </li>
    </ul>
  );
}

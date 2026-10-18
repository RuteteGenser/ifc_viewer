import { useEffect, useRef, useState } from "react";

const KEY = "ifcViewer.hintSeen";
const COARSE = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

function seen() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

const TOUCH_ROWS = [
  ["Drag", "turn the model"],
  ["Pinch", "zoom"],
  ["Two fingers", "move the view"],
  ["Tap", "select an element"],
  ["Press and hold", "cut a section or hide"],
];
const MOUSE_ROWS = [
  ["Drag", "turn the model"],
  ["Scroll", "zoom"],
  ["Middle drag", "move the view"],
  ["Click", "select an element"],
  ["Double-click", "zoom to an element"],
  ["Right-click", "cut a section or hide"],
];

// One dismissible card, shown the first time a model opens.
export default function FirstRunHint({ visible }) {
  const [dismissed, setDismissed] = useState(seen);
  const cardRef = useRef(null);
  const active = visible && !dismissed;
  // Touching the model itself means they already found their way around.
  useEffect(() => {
    if (!active) return undefined;
    const onDown = (e) => {
      if (cardRef.current?.contains(e.target)) return;
      if (e.target.closest?.(".toolbar, .element-panel, .sidebar")) return;
      close();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  });
  if (!active) return null;
  function close() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // private mode: it will simply show again next visit
    }
    setDismissed(true);
  }
  const rows = COARSE ? TOUCH_ROWS : MOUSE_ROWS;
  return (
    <div className="first-run" ref={cardRef} role="dialog" aria-label="How to move around">
      <div className="first-run__title">Getting around</div>
      <dl className="first-run__list">
        {rows.map(([gesture, action]) => (
          <div key={gesture} className="first-run__row">
            <dt>{gesture}</dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
      <button type="button" className="first-run__button" onClick={close}>
        Got it
      </button>
    </div>
  );
}

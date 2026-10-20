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
  ["Drag", "turns"],
  ["Pinch", "zooms"],
  ["Tap", "selects"],
];
const MOUSE_ROWS = [
  ["Drag", "turns"],
  ["Scroll", "zooms"],
  ["Click", "selects"],
  ["Space + drag", "moves"],
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
      close();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  });
  useEffect(() => {
    if (!active) return undefined;
    const t = setTimeout(close, 9000);
    return () => clearTimeout(t);
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
    <div className="first-run" ref={cardRef} role="status" aria-label="How to move around">
      <ul className="first-run__list">
        {rows.map(([gesture, action]) => (
          <li key={gesture} className="first-run__row">
            <b>{gesture}</b> {action}
          </li>
        ))}
      </ul>
      <button type="button" className="first-run__close" onClick={close} aria-label="Dismiss tips">
        <span aria-hidden="true">&times;</span>
      </button>
    </div>
  );
}

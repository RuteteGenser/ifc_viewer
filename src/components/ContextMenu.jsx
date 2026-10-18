import { useEffect, useRef } from "react";

export default function ContextMenu({ x, y, touch = false, onCreateClipPlane, onHideElement, onClose }) {
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

  // Under a finger the menu would be hidden by the hand, so a touch menu
  // opens above the press point (or below it when there's no room above).
  const MENU_HEIGHT = touch ? 130 : 110;
  const top = touch
    ? y - MENU_HEIGHT - 24 >= 8
      ? y - MENU_HEIGHT - 24
      : Math.min(y + 24, window.innerHeight - MENU_HEIGHT)
    : Math.min(y, window.innerHeight - MENU_HEIGHT);
  const style = {
    left: Math.max(8, Math.min(x - (touch ? 115 : 0), window.innerWidth - 260)),
    top,
  };

  return (
    <ul ref={menuRef} className="context-menu" style={style}>
      <li>
        <button type="button" onClick={onCreateClipPlane}>
          Create clip plane here
        </button>
      </li>
      <li>
        <button type="button" onClick={onHideElement}>
          Hide element
        </button>
      </li>
    </ul>
  );
}

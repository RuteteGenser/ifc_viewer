import { useEffect, useRef } from "react";

export default function ContextMenu({ x, y, onCreateClipPlane, onClose }) {
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

  const style = {
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - 60),
  };

  return (
    <ul ref={menuRef} className="context-menu" style={style}>
      <li>
        <button type="button" onClick={onCreateClipPlane}>
          Create clip plane here
        </button>
      </li>
    </ul>
  );
}

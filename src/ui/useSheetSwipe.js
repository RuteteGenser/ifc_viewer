import { useRef } from "react";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// Drag a bottom sheet down by its head to dismiss it. Touch and pen only; a mouse has the Done button.
// Spread `head` on the non-scrolling head of the sheet; `ref` is the sheet element (else put `rootRef` on it). The sheet follows the finger
// with the `translate` property (no layout), springs back under 80 px / a slow flick, and otherwise calls onClose.
export default function useSheetSwipe(onClose, ref) {
  const own = useRef(null);
  const rootRef = ref || own;
  const drag = useRef(null);
  const swiped = useRef(false);
  const head = {
    style: { touchAction: "none" },
    onPointerDown: (e) => {
      if (e.pointerType === "mouse" || !rootRef.current) return;
      drag.current = { id: e.pointerId, y: e.clientY, t: performance.now(), dy: 0, v: 0, moved: false };
      swiped.current = false;
      rootRef.current.style.transition = "none";
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dy = Math.max(0, e.clientY - d.y);
      if (!d.moved) {
        if (dy < 8) return;
        d.moved = true;
        swiped.current = true;
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      }
      const now = performance.now();
      d.v = (dy - d.dy) / Math.max(1, now - d.t);
      d.dy = dy;
      d.t = now;
      rootRef.current.style.translate = `0 ${dy}px`;
    },
    onPointerUp: () => {
      const d = drag.current;
      drag.current = null;
      const el = rootRef.current;
      if (!d || !el) return;
      if (d.moved && dismisses(d.dy, d.v)) {
        onClose(); // translate stays, so the exit starts where the finger left it
        return;
      }
      el.style.transition = reduced() ? "none" : "translate var(--dur-2) var(--ease)";
      el.style.translate = "";
    },
    onPointerCancel: () => {
      drag.current = null;
      if (rootRef.current) {
        rootRef.current.style.transition = "none";
        rootRef.current.style.translate = "";
      }
    },
    onClickCapture: (e) => {
      if (swiped.current) {
        swiped.current = false;
        e.stopPropagation();
        e.preventDefault();
      }
    },
  };
  return { rootRef, head };
}

// Pure, for tests: does a release at `dy` px with speed `v` px/ms dismiss?
export const dismisses = (dy, v) => dy > 80 || v > 0.6;

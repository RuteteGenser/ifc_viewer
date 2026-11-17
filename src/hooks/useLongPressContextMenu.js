import { useEffect } from "react";

// Touch devices have no right-click. Android Chrome turns a long-press into a
// native "contextmenu" event (which the viewer already handles for
// "Create clip plane here" / "Hide element"), but iOS Safari doesn't. This
// fires a synthetic contextmenu after a ~600 ms press that hasn't moved,
// unless the browser already sent a real one.
const HOLD_MS = 600;
const MOVE_TOLERANCE_PX = 10;

export function useLongPressContextMenu(containerRef, enabled = true) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return undefined;
    let timer = null;
    let start = null;
    let nativeFired = false;

    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const onDown = (e) => {
      if (e.pointerType !== "touch") return;
      if (!e.isPrimary) {
        cancel();
        return;
      }
      nativeFired = false;
      start = { x: e.clientX, y: e.clientY };
      cancel();
      timer = setTimeout(() => {
        timer = null;
        if (nativeFired) return;
        const canvas = container.querySelector("canvas");
        canvas?.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: start.x, clientY: start.y }),
        );
      }, HOLD_MS);
    };
    const onMove = (e) => {
      if (!timer || !start) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE_PX) cancel();
    };
    const onNative = (e) => {
      if (e.isTrusted) nativeFired = true;
    };

    container.addEventListener("pointerdown", onDown);
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", cancel);
    container.addEventListener("pointercancel", cancel);
    container.addEventListener("contextmenu", onNative, true);
    return () => {
      cancel();
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", cancel);
      container.removeEventListener("pointercancel", cancel);
      container.removeEventListener("contextmenu", onNative, true);
    };
  }, [containerRef, enabled]);
}

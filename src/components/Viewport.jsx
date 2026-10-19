import { useEffect } from "react";

const NOTE_ID = "viewport-note";

// The 3D canvas is drawn by the engine, so the wrapper carries its name and a text alternative. Keyboard users
// select through the search box and the structure list; the keys are listed in the shortcuts help.
export default function Viewport({ containerRef, reveal = false }) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const label = () => {
      for (const c of el.querySelectorAll("canvas")) {
        c.setAttribute("role", "img");
        c.setAttribute("aria-label", "3D model view");
        c.setAttribute("aria-describedby", NOTE_ID);
      }
    };
    label();
    const mo = new MutationObserver(label);
    mo.observe(el, { childList: true });
    return () => mo.disconnect();
  }, [containerRef]);
  return (
    <>
      <div className={`viewport${reveal ? " viewport--reveal" : ""}`} ref={containerRef} />
      <p id={NOTE_ID} className="sr-only">
        Interactive 3D view of the building model. Without a mouse, select elements with the search box or the structure list, zoom with plus and minus, and press 0 to fit the model.
      </p>
    </>
  );
}

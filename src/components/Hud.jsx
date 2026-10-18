import { useEffect, useRef } from "react";

// The armed-tool note and the camera-clip slider share one column under the
// toolbar, note on top, so neither covers the other and "Done" is always in
// reach. The column's height is published as --hud-h for the floating
// buttons, which sit below it.
export default function Hud({ children }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const publish = () => {
      const h = el.offsetHeight;
      document.documentElement.style.setProperty("--hud-h", h > 0 ? `${h + 8}px` : "0px");
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.setProperty("--hud-h", "0px");
    };
  }, []);
  return (
    <div className="hud" ref={ref}>
      {children}
    </div>
  );
}

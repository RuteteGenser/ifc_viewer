import { useEffect, useState } from "react";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// Keeps an element mounted for `ms` after `open` turns false so its exit can play.
// Returns { mounted, state } where state is "open" or "closed" (use as data-state).
// Reopening during the exit cancels it. With reduced motion it unmounts at once.
export default function usePresence(open, ms = 160) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return undefined;
    }
    if (reduced()) {
      setMounted(false);
      return undefined;
    }
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  return { mounted: open || mounted, state: open ? "open" : "closed" };
}

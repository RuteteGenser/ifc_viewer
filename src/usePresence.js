import { useEffect, useLayoutEffect, useRef, useState } from "react";

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

// ---- Exit ghosts -------------------------------------------------------------
// Overlays that React unmounts at once (popovers, menus, dialogs) leave a
// pointer-less, inert clone behind that fades out and removes itself. The real
// component is gone immediately, so no handler, focus or tap target is delayed.
const EXITS = {
  pop: [{}, { opacity: 0, translate: "0 -6px", scale: 0.97 }],
  sheet: [{}, { opacity: 0, translate: "0 24px" }],
  fade: [{}, { opacity: 0 }],
};
const EXIT_MS = 140;

export function ghostExit(node, kind = "pop", inner) {
  if (!node || !node.isConnected || !node.parentNode || reduced() || typeof node.animate !== "function") return null;
  const ghost = node.cloneNode(true);
  for (const el of [ghost, ...ghost.querySelectorAll("[id]")]) el.removeAttribute("id");
  ghost.setAttribute("aria-hidden", "true");
  ghost.setAttribute("inert", "");
  ghost.classList.add("m-ghost");
  ghost.style.animation = "none";
  ghost.style.pointerEvents = "none";
  node.parentNode.insertBefore(ghost, node.nextSibling);
  const done = () => ghost.remove();
  const play = (el, k) => {
    const a = el.animate(EXITS[k], { duration: EXIT_MS, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "forwards" });
    a.onfinish = a.oncancel = done;
  };
  if (inner) {
    const box = ghost.querySelector(inner);
    if (box) {
      box.style.animation = "none";
      play(box, "pop");
    }
  }
  play(ghost, kind);
  setTimeout(done, EXIT_MS + 120);
  return ghost;
}

// Put on a component that mounts and unmounts as a whole overlay. `ref` is its root element.
export function useExitGhost(ref, kind = "pop", inner) {
  useLayoutEffect(() => {
    const t0 = performance.now();
    const node = ref.current; // set by now: the host child's ref attaches before this layout effect
    return () => {
      // Skip StrictMode's immediate dev-only unmount.
      if (!import.meta.env.DEV || performance.now() - t0 > 80) ghostExit(node, kind, inner);
    };
  }, [ref, kind, inner]);
}

// Replays a short staggered enter on `selector` children of the list when `key` changes
// (folder open/close, sort, filters). The first render is left alone.
export function useListSwap(ref, key, selector = ":scope > li") {
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const list = ref.current;
    if (!list || reduced() || typeof list.animate !== "function") return;
    [...list.querySelectorAll(selector)].slice(0, 12).forEach((el, i) => {
      el.animate([{ opacity: 0, translate: "0 6px" }, { opacity: 1, translate: "0 0" }], { duration: 220, delay: i * 16, easing: "cubic-bezier(0, 0, 0, 1)", fill: "backwards" });
    });
  }, [ref, key, selector]);
}

// Keys that appear after the first render (for a one-time highlight on new rows).
// A key stays marked while its row exists; the CSS animation only plays on insert.
export function useAddedKeys(keys) {
  const seen = useRef(null);
  const marked = useRef(new Set());
  if (seen.current === null) seen.current = new Set(keys);
  for (const k of keys) if (!seen.current.has(k)) marked.current.add(k);
  useEffect(() => {
    keys.forEach((k) => seen.current.add(k));
  });
  return marked.current;
}

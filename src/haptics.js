// Optional haptics: a short buzz when a primary button is pressed. One delegated listener, no per-button
// code. Does nothing where navigator.vibrate is missing (iOS Safari), for mouse, with reduced motion,
// or when the user turned it off (Models sheet).
const KEY = "argus.haptics";
const SELECTOR = "button.btn-primary, .toolbar button, .models-sheet__add, .sidebar__reset-visibility-button--primary";
const MIN_GAP_MS = 120;

export function hapticsEnabled() {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setHapticsEnabled(on) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch { /* storage blocked: the choice lasts until reload */ }
}

export function shouldBuzz({ enabled, reduced, pointerType, hit, disabled, now, last }) {
  return !!enabled && !reduced && pointerType !== "mouse" && !!hit && !disabled && now - last >= MIN_GAP_MS;
}

let last = -Infinity;
export function initHaptics() {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  window.addEventListener(
    "pointerdown",
    (e) => {
      const btn = e.target instanceof Element ? e.target.closest(SELECTOR) : null;
      const now = performance.now();
      const ok = shouldBuzz({
        enabled: hapticsEnabled(),
        reduced: !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
        pointerType: e.pointerType,
        hit: btn,
        disabled: btn?.disabled || btn?.getAttribute("aria-disabled") === "true",
        now,
        last,
      });
      if (!ok) return;
      last = now;
      navigator.vibrate(8);
    },
    { passive: true, capture: true },
  );
}

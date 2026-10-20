// Desktop hand tool (hold Space, drag to pan) and the "names on hover" preference.

const HOVER_KEY = "ifcViewer.hoverNames";
let hoverNames = null; // read lazily, then kept in memory so a storage failure still holds for the session
const listeners = new Set();

export function hoverNamesOn() {
  if (hoverNames === null) {
    try {
      hoverNames = localStorage.getItem(HOVER_KEY) === "1";
    } catch {
      hoverNames = false;
    }
  }
  return hoverNames;
}

export function setHoverNames(on) {
  hoverNames = !!on;
  try {
    localStorage.setItem(HOVER_KEY, hoverNames ? "1" : "0");
  } catch {
    // private mode: the choice holds until the page closes
  }
  for (const fn of listeners) fn(hoverNames);
}

export function subscribeHoverNames(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// True when Space belongs to something else: typing, a keyboard-focused control, or an open dialog.
// A button that only has focus because the pointer clicked it (focusedByPointer) does not keep Space (the hand still works
// after arming a tool); the caller cancels the key's click on release.
export function spaceBelongsToPage(active, dialogOpen, focusedByPointer = false) {
  if (dialogOpen) return true;
  if (!active) return false;
  const tag = String(active.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || active.isContentEditable) return true;
  const role = active.getAttribute?.("role");
  const control = tag === "BUTTON" || tag === "SUMMARY" || tag === "A" || ["button", "switch", "checkbox", "menuitem", "tab", "textbox", "slider"].includes(role);
  if (role === "textbox" || role === "slider") return true;
  if (!control) return false;
  return !focusedByPointer;
}

export const DIALOG_SELECTOR = '[role="dialog"], [aria-modal="true"], .context-menu, .confirm-dialog-backdrop, .measure-leg-edit-popup';

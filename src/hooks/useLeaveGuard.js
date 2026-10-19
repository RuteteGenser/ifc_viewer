import { useCallback, useEffect, useRef, useState } from "react";

// Swiping back (or pressing the browser's back button) from the viewer would
// drop the user on the previous page and throw away the model they have open,
// and a long drag on a phone makes that swipe easy to trigger by accident.
// A guard history entry sits on top of the viewer's own: going back lands on
// the viewer's real entry, which asks first instead of leaving.
//
// Browsers ignore history entries added without a user gesture, so the guard
// is added on the first touch/click/key press and again after "Stay".
// `onBack` (optional) closes the topmost open surface and returns true; then Back does only that, no question.
export default function useLeaveGuard(onBack) {
  const [asking, setAsking] = useState(false);
  const askingRef = useRef(false);
  askingRef.current = asking;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const leavingRef = useRef(false);
  const hashRef = useRef(typeof window === "undefined" ? "" : window.location.hash);

  const arm = useCallback(() => {
    try {
      if (!window.history.state?.ifcGuard) window.history.pushState({ ifcGuard: true }, "", window.location.href);
    } catch {
      // history is not available (sandboxed frame): the app just behaves as before
    }
  }, []);

  useEffect(() => {
    const onFirstGesture = () => arm();
    const onPop = (event) => {
      if (leavingRef.current) return;
      const hash = window.location.hash;
      const hashOnly = hash !== hashRef.current;
      hashRef.current = hash;
      // Back onto the guard entry itself, or a link whose only change is the
      // part after #: nothing to ask about.
      if (event.state?.ifcGuard || hashOnly) return;
      if (!askingRef.current && onBackRef.current?.()) {
        arm();
        return;
      }
      // The guard went with this Back. Put it straight back so that a second
      // Back, while the question is still open, asks again instead of leaving.
      arm();
      setAsking(true);
    };
    window.addEventListener("pointerdown", onFirstGesture, { once: true });
    window.addEventListener("keydown", onFirstGesture, { once: true });
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
      window.removeEventListener("popstate", onPop);
    };
  }, [arm]);

  const stay = useCallback(() => {
    setAsking(false);
    arm();
  }, [arm]);

  const leave = useCallback(() => {
    leavingRef.current = true;
    setAsking(false);
    // Over the guard entry and the viewer's own.
    window.history.go(window.history.state?.ifcGuard ? -2 : -1);
    // Nothing before the viewer to go back to (it was opened directly): stay put.
    setTimeout(() => {
      leavingRef.current = false;
    }, 1500);
  }, []);

  return { asking, stay, leave };
}

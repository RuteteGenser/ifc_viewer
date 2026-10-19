import { useRef } from "react";
import usePresence from "../usePresence";

export default function Toast({ toast }) {
  const { mounted, state } = usePresence(!!toast, 160);
  const last = useRef(toast);
  if (toast) last.current = toast;
  const shown = toast || last.current;
  if (!mounted || !shown) return null;
  return (
    <div className="toast" role="status" aria-live="polite" key={shown.id} data-state={state}>
      {shown.text}
    </div>
  );
}

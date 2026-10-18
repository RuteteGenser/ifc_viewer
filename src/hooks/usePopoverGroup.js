import { useEffect } from "react";

// Only one popover is open at a time. A popover announces itself when it
// opens; every other one in the group closes. Arming a tool announces "tool",
// which closes them all.
const EVENT = "argus-popover";

export function announcePopover(name) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: name }));
}

export default function usePopoverGroup(name, open, close) {
  useEffect(() => {
    if (open) announcePopover(name);
  }, [name, open]);
  useEffect(() => {
    const onAnnounce = (e) => {
      if (e.detail !== name) close();
    };
    window.addEventListener(EVENT, onAnnounce);
    return () => window.removeEventListener(EVENT, onAnnounce);
  }, [name, close]);
}

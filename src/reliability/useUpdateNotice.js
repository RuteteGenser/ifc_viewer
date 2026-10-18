import { useEffect, useRef, useState } from "react";
import { fetchNewerBuildId, runningBuildId } from "./recovery";

const MIN_GAP_MS = 5 * 60_000; // never ask the server more often than this

// True once a newer build is deployed. Looks when the tab comes back to the
// front (focus / visible), at most every five minutes; errors are ignored.
export function useUpdateNotice() {
  const [available, setAvailable] = useState(false);
  const lastRef = useRef(0);
  useEffect(() => {
    if (!import.meta.env.PROD || !runningBuildId()) return undefined;
    const check = async () => {
      if (document.visibilityState !== "visible" || Date.now() - lastRef.current < MIN_GAP_MS) return;
      lastRef.current = Date.now();
      if (await fetchNewerBuildId()) setAvailable(true);
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, []);
  return available;
}

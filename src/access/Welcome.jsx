import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccess } from "./AccessProvider";
import { durationParts } from "./state";
import { startupIntent } from "../reliability/recovery";
import { legalHash } from "../legal/route";
import { t } from "./copy";

// The first screen of the app, shown once per device while a free trial is running and the
// visitor has not tapped Start. Never in legacy mode (no session, so no AccessProvider value).
const KEY = "argus.welcome.v1";
const seen = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const remember = () => { try { localStorage.setItem(KEY, "1"); } catch { /* private window: shown again next visit */ } };
// Links that already say what to open: ?model=, ?demo=1, a resumed reload. They go straight to the viewer.
const deepLink = () => {
  const q = new URLSearchParams(window.location.search);
  return !!(q.get("model") || q.get("demo") === "1" || startupIntent());
};
const onLegal = () => /^#\/legal/.test(window.location.hash);

export default function Welcome({ hasWork }) {
  const a = useAccess();
  const [skip] = useState(deepLink);
  const [acked, setAcked] = useState(seen);
  const [legal, setLegal] = useState(onLegal);
  const [frozen, setFrozen] = useState(null); // { ms }: the length shown, fixed at the first render
  const startRef = useRef(null);
  const show = !!a && a.state === "anonymous_trial" && !acked && !skip && !hasWork && !legal;

  useEffect(() => {
    const f = () => setLegal(onLegal());
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  useEffect(() => {
    if (show && !frozen) setFrozen({ ms: Date.parse(a.session.entitlement.endsAt) - a.nowMs });
  }, [show, frozen, a]);
  // The viewer behind is not reachable while the welcome is up (the legal pages and dialogs live elsewhere).
  useEffect(() => {
    if (!show) return undefined;
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    return () => root?.removeAttribute("inert");
  }, [show]);
  // Focus lands on the primary button only when nothing else (a dialog opened from here) holds it.
  useEffect(() => {
    if (show && !a.dialog) startRef.current?.focus({ preventScroll: true });
  }, [show, !!a?.dialog]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!show || !frozen) return null;
  const d = durationParts(frozen.ms);
  const start = () => { remember(); setAcked(true); };
  const open = (dialog) => a.open({ ...dialog, from: "welcome" });
  return createPortal(
    <div className="acc-welcome" role="region" aria-labelledby="acc-welcome-title" data-testid="welcome">
      <div className="acc-welcome__card">
        <h1 id="acc-welcome-title" className="acc-welcome__title">{t("welcome.title", { duration: t(d.key, { n: d.n }) })}</h1>
        <p className="acc-welcome__lead">{t("welcome.started")}</p>
        <div className="acc-welcome__actions">
          <button type="button" ref={startRef} className="acc-btn acc-btn--primary" onClick={start}>{t("welcome.start")}</button>
          <button type="button" className="acc-btn" onClick={() => open({ kind: "code" })}>{t("welcome.code")}</button>
          <button type="button" className="acc-btn" onClick={() => open({ kind: "auth", mode: "login" })}>{t("welcome.login")}</button>
        </div>
        <p className="acc-welcome__included">{t("welcome.included")}</p>
        <nav className="acc-welcome__legal" aria-label={t("welcome.links")}>
          <a className="acc-link" href={legalHash("terms")}>{t("welcome.terms")}</a>
          <a className="acc-link" href={legalHash("privacy")}>{t("welcome.privacy")}</a>
        </nav>
      </div>
    </div>,
    document.body,
  );
}

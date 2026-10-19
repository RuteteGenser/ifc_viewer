import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { bootstrapRaw, verifyEmail, verifyMagic } from "./api";
import { bannerFor, currentState, paywallNow, parseSession } from "./state";
import { setLocale, t } from "./copy";

const AccessContext = createContext(null);
// null in legacy mode (no new backend): every access component renders nothing.
export const useAccess = () => useContext(AccessContext);

const REFRESH_MS = 5 * 60 * 1000;
const HANDLED = ["checkout", "chk", "reset", "account", "code", "verify", "magic"];

export function AccessProvider({ children }) {
  const [session, setSession] = useState(null); // null = loading or legacy
  const [now, setNow] = useState(() => Date.now());
  const [dialog, setDialog] = useState(null); // { kind: "paywall"|"auth"|"account"|"code", ... }
  const [toast, setToast] = useState("");
  const [dismissed, setDismissed] = useState(() => new Set());
  const [prefillCode, setPrefillCode] = useState("");
  const [overlayHidden, setOverlayHidden] = useState(false);
  const fetchedAt = useRef(0);
  const whoRef = useRef("");

  const apply = useCallback((raw) => {
    const s = parseSession(raw);
    if (s) {
      // A different account (login, logout, sign-up) means a different model list.
      const who = `${s.account.id}:${s.account.kind}`;
      if (whoRef.current && whoRef.current !== who) window.dispatchEvent(new Event("argus:library-refresh"));
      whoRef.current = who;
      setSession(s);
      // A visitor without an account has only the backend's default "en": the browser language decides.
      setLocale(s.account.kind === "registered" ? s.account.locale : /^(nb|nn|no)\b/i.test(globalThis.navigator?.language || "") ? "nb" : "en");
    }
    return s;
  }, []);

  const refresh = useCallback(async () => {
    fetchedAt.current = Date.now();
    return apply(await bootstrapRaw());
  }, [apply]);

  // Merge an entitlement (and usage) returned by another call, then do a full refresh.
  const applyEntitlement = useCallback(
    (entitlement, account) => {
      setSession((s) => (s && entitlement ? { ...s, entitlement, account: account || s.account, ui: { ...s.ui, paywall: false } } : s));
      refresh();
    },
    [refresh],
  );

  useEffect(() => {
    refresh();
    const params = new URLSearchParams(window.location.search);
    if (params.get("code")) {
      setPrefillCode(params.get("code"));
      setDialog({ kind: "code" });
    }
    if (params.get("reset")) setDialog({ kind: "auth", mode: "reset", token: params.get("reset") });
    if (params.get("account")) setDialog({ kind: "account" });
    const co = params.get("checkout");
    if (co === "cancel") setToast(t("pay.cancelled"));
    else if (co === "declined") setDialog({ kind: "declined" });
    else if (co) setToast(t("toast.paid"));
    // Links from the (demo) inbox: confirm the email, or sign in with a magic link. Both work once.
    if (params.get("verify")) {
      verifyEmail(params.get("verify")).then(() => { setToast(t("verify.ok")); refresh(); }, () => setToast(t("verify.bad")));
    }
    if (params.get("magic")) {
      verifyMagic(params.get("magic")).then(() => { setToast(t("toast.loggedIn")); refresh(); window.dispatchEvent(new Event("argus:library-refresh")); }, () => setToast(t("magic.bad")));
    }
    if (HANDLED.some((k) => params.has(k))) {
      HANDLED.forEach((k) => params.delete(k));
      const q = params.toString();
      history.replaceState(history.state, "", window.location.pathname + (q ? `?${q}` : "") + window.location.hash);
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - fetchedAt.current > REFRESH_MS) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const tick = setInterval(() => setNow(Date.now()), 30000);
    // library/api.js reports a 402 or a changed library through window events
    const onUpgrade = (e) => {
      e.preventDefault(); // tells the library the plans sheet explains this one
      if (e.detail?.entitlement) setSession((s) => (s ? { ...s, entitlement: e.detail.entitlement } : s));
      setDialog((d) => d || { kind: "paywall", sheet: true, code: e.detail?.code });
      refresh();
    };
    const onChanged = () => refresh();
    window.addEventListener("argus:upgrade", onUpgrade);
    window.addEventListener("argus:library-changed", onChanged);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      clearInterval(tick);
      window.removeEventListener("argus:upgrade", onUpgrade);
      window.removeEventListener("argus:library-changed", onChanged);
    };
  }, [refresh]);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const nowMs = now + (session?.offsetMs || 0);
  const value = useMemo(() => {
    if (!session) return null;
    const state = currentState(session, nowMs);
    return {
      session,
      state,
      nowMs,
      banner: bannerFor(session, nowMs),
      expired: paywallNow(session, nowMs),
      registered: session.account.kind === "registered" || !!session.account.email,
      dialog,
      toast,
      prefillCode,
      dismissed,
      dismiss: (kind) => setDismissed((d) => new Set(d).add(kind)),
      say: setToast,
      refresh,
      applyEntitlement,
      open: (d) => setDialog(d),
      close: () => setDialog(null),
      overlayHidden,
      setOverlayHidden,
    };
  }, [session, nowMs, dialog, toast, prefillCode, dismissed, overlayHidden, refresh, applyEntitlement]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

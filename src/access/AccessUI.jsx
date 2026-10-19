import { useEffect, useRef, useState } from "react";
import { useAccess } from "./AccessProvider";
import { t } from "./copy";
import Paywall from "./Paywall";
import AuthForms from "./AuthForms";
import AccountPage from "./AccountPage";
import CodeEntry from "./CodeEntry";
import Dialog from "./Dialog";
import { DemoBar, useNarrow, DemoTools, DemoInbox, CheckEmail } from "./Demo";
import "./access.css";

import { timeLeft, formatDay as fmtDate } from "./state";

// What a banner says and offers, shared by the wide bar and the phone's slim bar.
function bannerText(b, a) {
  const key = b.kind === "grace" && b.source === "code" ? "banner.grace.code" : `banner.${b.kind}`;
  return t(key, { timeLeft: b.target ? timeLeft(b.target, a.nowMs) : "", date: fmtDate(b.target) });
}
function bannerItems(b, a) {
  const kind = b?.kind;
  const guest = !a.registered;
  return [
    kind === "trial" && guest && [t("action.keepWork"), { kind: "auth", mode: "signup" }],
    (kind === "trial" || kind === "grace" || kind === "trial_limit") && [t("action.haveCode"), { kind: "code" }],
    kind === "trial_limit" && guest && [t("action.login"), { kind: "auth", mode: "login" }],
    kind === "payment_failed" && [t("action.payAgain"), { kind: "paywall", sheet: true }],
    kind === "first_payment_failed" && [t("action.tryCard"), { kind: "paywall", sheet: true }],
    (kind === "grace" || kind === "code_trial") && [t("action.seePlans"), { kind: "paywall", sheet: true }],
  ].filter(Boolean);
}

function Banner() {
  const a = useAccess();
  const b = a?.banner;
  const narrow = useNarrow();
  if (narrow || !b || a.dismissed.has(b.kind) || a.expired) return null;
  const kindClass = b.tone === "warning" || b.tone === "urgent" ? "acc-banner--warn" : "";
  return (
    <div className={`acc-banner ${kindClass}`} role="status" data-testid="acc-banner" data-kind={b.kind}>
      <span className="acc-banner__text">{bannerText(b, a)}</span>
      <span className="acc-banner__actions">
        {bannerItems(b, a).map(([label, d]) => <button key={label} type="button" className="acc-link" onClick={() => a.open(d)}>{label}</button>)}
        {b.dismissible && <button type="button" className="acc-link" aria-label={t("banner.dismiss")} onClick={() => a.dismiss(b.kind)}>×</button>}
      </span>
    </div>
  );
}

// Phones: one slim line (state text + one menu button) replaces the demo bar and the banner.
function SlimBar() {
  const a = useAccess();
  const [menu, setMenu] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) setMenu(false); };
    const esc = (e) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [menu]);
  const b = a.banner && !a.dismissed.has(a.banner.kind) && !a.expired ? a.banner : null;
  if (!b && !a.session.demo) return null;
  const text = b ? bannerText(b, a) : "";
  const warn = b && (b.tone === "warning" || b.tone === "urgent");
  const items = [...(b ? bannerItems(b, a) : []), a.session.demo && [t("action.demoTools"), { kind: "demo" }]].filter(Boolean);
  return (
    <div ref={ref} className={`acc-slim ${warn ? "acc-slim--warn" : ""}`} role="status" data-testid="acc-banner" data-kind={b?.kind || "demo"}>
      {a.session.demo && <span className="acc-slim__demo" data-testid="demo-bar">{t("banner.demoShort")}</span>}
      <span className="acc-slim__text" title={text}>{text}</span>
      <button type="button" className="acc-slim__menu" aria-label={t("banner.menu")} aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>
      {menu && (
        <div className="acc-slim__pop" role="group" aria-label={t("banner.menu")}>
          {items.map(([label, d]) => <button key={label} type="button" className="acc-slim__item" onClick={() => { setMenu(false); a.open(d); }}>{label}</button>)}
          {b?.dismissible && <button type="button" className="acc-slim__item" onClick={() => { setMenu(false); a.dismiss(b.kind); }}>{t("banner.dismiss")}</button>}
        </div>
      )}
    </div>
  );
}

// The bars above the viewer publish their height as --acc-bars-h, so the fixed details panel
// starts below them (like --hud-h for the floating buttons).
function Bars({ children }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const publish = () => document.documentElement.style.setProperty("--acc-bars-h", `${el.offsetHeight}px`);
    publish();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    ro?.observe(el);
    return () => { ro?.disconnect(); document.documentElement.style.setProperty("--acc-bars-h", "0px"); };
  }, []);
  return <div className="acc-bars" ref={ref}>{children}</div>;
}

// Everything the access system draws, in one place. Renders nothing in legacy mode.
export default function AccessUI({ hasWork }) {
  const a = useAccess();
  if (!a) return null;
  const d = a.dialog;
  const narrow = useNarrow();
  return (
    <>
      <Bars>
        <DemoBar />
        <Banner />
        {narrow && <SlimBar />}
      </Bars>
      {a.expired && d?.kind !== "paywall" && <Paywall hasWork={hasWork} />}
      {d?.kind === "paywall" && <Paywall hasWork={hasWork} />}
      {d?.kind === "auth" && <AuthForms mode={d.mode} token={d.token} />}
      {d?.kind === "account" && <AccountPage />}
      {d?.kind === "demo" && <DemoTools />}
      {d?.kind === "inbox" && <DemoInbox email={d.email} />}
      {d?.kind === "checkemail" && <CheckEmail email={d.email} />}
      {d?.kind === "declined" && (
        <Dialog title={t("pay.declinedTitle")} onClose={a.close}>
          <p role="alert">{t("pay.declinedBody")}</p>
          <button type="button" className="acc-btn acc-btn--primary acc-btn--full" data-autofocus onClick={() => a.open({ kind: "paywall", sheet: true })}>{t("pay.tryAgain")}</button>
        </Dialog>
      )}
      {d?.kind === "code" && (
        <Dialog title={t("action.haveCode")} onClose={a.close}>
          <CodeEntry onDone={a.close} initial={a.prefillCode} />
        </Dialog>
      )}
      {a.toast && <div className="acc-toast" role="status">{a.toast}</div>}
    </>
  );
}

// Small entry points other components embed; null in legacy mode.
export function AccountButton({ className = "" }) {
  const a = useAccess();
  if (!a) return null;
  return (
    <button type="button" className={`acc-btn acc-account-btn ${className}`.trim()} onClick={() => a.open({ kind: "account" })}>
      {t("action.account")}
    </button>
  );
}

export function CodeLink() {
  const a = useAccess();
  if (!a || a.state === "active") return null;
  return (
    <button type="button" className="acc-link acc-codelink" onClick={(e) => { e.stopPropagation(); a.open({ kind: "code" }); }}>
      {t("action.haveCode")}
    </button>
  );
}

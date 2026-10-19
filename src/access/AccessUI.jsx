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

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" }) : "");
// Plain English for how long is left; shared with the unit-tested helper in state.js.
import { timeLeft } from "./state";

function Banner() {
  const a = useAccess();
  const b = a?.banner;
  const narrow = useNarrow();
  if (narrow || !b || a.dismissed.has(b.kind) || a.expired) return null;
  const text = t(`banner.${b.kind}`, { timeLeft: b.target ? timeLeft(b.target, a.nowMs) : "", date: fmtDate(b.target) });
  const kindClass = b.tone === "warning" || b.tone === "urgent" ? "acc-banner--warn" : "";
  return (
    <div className={`acc-banner ${kindClass}`} role="status" data-testid="acc-banner" data-kind={b.kind}>
      <span className="acc-banner__text">{text}</span>
      <span className="acc-banner__actions">
        {(b.kind === "trial") && <button type="button" className="acc-link" onClick={() => a.open({ kind: "auth", mode: "signup" })}>{t("action.keepWork")}</button>}
        {(b.kind === "trial" || b.kind === "grace") && <button type="button" className="acc-link" onClick={() => a.open({ kind: "code" })}>{t("action.haveCode")}</button>}
        {b.kind === "payment_failed" && <button type="button" className="acc-link" onClick={() => a.open({ kind: "paywall", sheet: true })}>{t("action.payAgain")}</button>}
        {(b.kind === "grace" || b.kind === "code_trial") && <button type="button" className="acc-link" onClick={() => a.open({ kind: "paywall", sheet: true })}>{t("action.seePlans")}</button>}
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
  const text = b ? t(`banner.${b.kind}`, { timeLeft: b.target ? timeLeft(b.target, a.nowMs) : "", date: fmtDate(b.target) }) : "";
  const warn = b && (b.tone === "warning" || b.tone === "urgent");
  const kind = b?.kind;
  const items = [
    kind === "trial" && [t("action.keepWork"), { kind: "auth", mode: "signup" }],
    (kind === "trial" || kind === "grace") && [t("action.haveCode"), { kind: "code" }],
    kind === "payment_failed" && [t("action.payAgain"), { kind: "paywall", sheet: true }],
    (kind === "grace" || kind === "code_trial") && [t("action.seePlans"), { kind: "paywall", sheet: true }],
    a.session.demo && [t("action.demoTools"), { kind: "demo" }],
  ].filter(Boolean);
  return (
    <div ref={ref} className={`acc-slim ${warn ? "acc-slim--warn" : ""}`} role="status" data-testid="acc-banner" data-kind={kind || "demo"}>
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

// Everything the access system draws, in one place. Renders nothing in legacy mode.
export default function AccessUI({ hasWork }) {
  const a = useAccess();
  if (!a) return null;
  const d = a.dialog;
  const narrow = useNarrow();
  return (
    <>
      <DemoBar />
      <Banner />
      {narrow && <SlimBar />}
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

import { useEffect, useState } from "react";
import Dialog from "./Dialog";
import CodeEntry from "./CodeEntry";
import { useAccess } from "./AccessProvider";
import { deleteAccount, getAccount, logout, openPortal, resendVerify } from "./api";
import { downloadAccountData, downloadAllModels } from "./download";
import { formatBytes as mb, formatDay as fmtDate, mapError, subscriptionLine } from "./state";
import { t } from "./copy";
import { LegalLinks } from "../legal/LegalPage";
import { lt } from "../legal/strings";


export function quotaText(session) {
  const { limits = {} } = session.entitlement;
  const u = session.usage;
  return limits.maxStoredModels
    ? t("account.quota", { used: u.storedModels, max: limits.maxStoredModels, bytes: mb(u.bytes), maxBytes: mb(limits.maxBytesTotal || 0) })
    : t("account.quotaOpen", { used: u.storedModels, bytes: mb(u.bytes) });
}

function stateLine(access) {
  const e = access.session.entitlement;
  const s = access.state;
  if (s === "anonymous_trial" || s === "code_trial") return t(`account.state.${s}`, { date: fmtDate(e.endsAt) });
  if (s === "active" && e.flags?.paymentFailed) return t("account.sub.past_due");
  if (s === "active" && e.flags?.cancelAtPeriodEnd) return t("account.sub.ending", { date: fmtDate(e.endsAt) });
  if (s === "active") return e.endsAt ? t("account.state.activeEnds", { date: fmtDate(e.endsAt) }) : t("account.state.active");
  return t(`account.state.${s}`, { date: fmtDate(e.graceEndsAt) });
}

export default function AccountPage() {
  const access = useAccess();
  const s = access.session;
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [codeOpen, setCodeOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [word, setWord] = useState("");
  const [pw, setPw] = useState("");
  const [sub, setSub] = useState(null);
  useEffect(() => { if (access.registered) getAccount().then((r) => setSub(r?.subscription || null), () => {}); }, [access.registered, s.entitlement.state]);

  const subKey = subscriptionLine(s, sub, access.state);

  const run = (name, fn) => async () => {
    setError("");
    setBusy(name);
    try { await fn(); } catch (err) { setError(t(mapError(err.status, err.code))); }
    setBusy("");
  };
  const portal = run("portal", async () => window.location.assign((await openPortal("manage")).url));
  const cancel = run("cancel", async () => window.location.assign((await openPortal("cancel")).url));
  // A running subscription that is not already ending: one tap to the provider's cancel step.
  const canCancel = access.registered && s.entitlement.state === "active" && !!sub && sub.status !== "canceled" && !sub.cancelAtPeriodEnd && !s.entitlement.flags?.cancelAtPeriodEnd;
  const downloadAll = run("dl", async () => {
    const n = await downloadAllModels((i, total) => setBusy(t("account.downloading", { i, n: total })));
    if (!n) setError(t("account.noModels"));
  });
  const doLogout = run("out", async () => {
    await logout();
    await access.refresh();
    access.say(t("toast.loggedOut"));
    access.close();
  });
  const doDelete = run("del", async () => {
    await deleteAccount(access.registered ? pw : undefined);
    await access.refresh();
    access.close();
  });
  const label = (name, text) => (busy === name ? t("code.checking") : text);

  return (
    <Dialog title={t("account.title")} onClose={access.close} wide>
      <section className="acc-box">
        <p><strong>{access.registered ? s.account.email : t("account.notSignedIn")}</strong>
          {access.registered && <span className="acc-chip" data-testid="verified-badge">{s.account.emailVerified ? t("verify.badge") : t("verify.not")}</span>}</p>
        {access.registered && !s.account.emailVerified && (
          <button type="button" className="acc-link" onClick={run("verify", async () => { await resendVerify(); access.say(t("verify.resent")); })}>{t("verify.resend")}</button>
        )}
        {!access.registered && (
          <div className="acc-row">
            <button type="button" className="acc-btn acc-btn--primary" onClick={() => access.open({ kind: "auth", mode: "signup" })}>{t("action.signup")}</button>
            <button type="button" className="acc-btn" onClick={() => access.open({ kind: "auth", mode: "login" })}>{t("action.login")}</button>
          </div>
        )}
      </section>
      <section className="acc-box">
        <h3 className="acc-h3">{t("account.plan")}: {s.entitlement.planName}</h3>
        <p data-testid="acc-state">{stateLine(access)}</p>
        {subKey && <p className="acc-hint" data-testid="acc-sub">{t(subKey)}</p>}
        {canCancel && <p className="acc-hint">{lt("cancel.hint")}</p>}
        <p className="acc-hint">{quotaText(s)}</p>
        <div className="acc-row">
          {access.registered && s.entitlement.state === "active" && <button type="button" className="acc-btn" disabled={!!busy} onClick={portal}>{label("portal", t("action.manageBilling"))}</button>}
          {canCancel && <button type="button" className="acc-btn" disabled={!!busy} onClick={cancel} data-testid="cancel-subscription">{label("cancel", lt("cancel.button"))}</button>}
          {s.entitlement.flags?.paymentFailed && <button type="button" className="acc-btn acc-btn--primary" onClick={() => access.open({ kind: "paywall", sheet: true })}>{t("action.payAgain")}</button>}
          {access.state !== "active" && <button type="button" className="acc-btn" onClick={() => access.open({ kind: "paywall", sheet: true })}>{t("action.seePlans")}</button>}
        </div>
        {codeOpen ? <CodeEntry onDone={() => setCodeOpen(false)} /> : <button type="button" className="acc-link" onClick={() => setCodeOpen(true)}>{t("action.haveCode")}</button>}
      </section>
      <section className="acc-box">
        <button type="button" className="acc-btn acc-btn--full" disabled={!!busy} onClick={downloadAll}>{busy.startsWith("Down") ? busy : t("account.downloadAll")}</button>
        <button type="button" className="acc-btn acc-btn--full" disabled={!!busy} onClick={run("export", downloadAccountData)}>{t("account.exportData")}</button>
      </section>
      {error && <p className="acc-error" role="alert">{error}</p>}
      {s.demo && <button type="button" className="acc-btn acc-btn--full" onClick={() => access.open({ kind: "demo" })}>{t("action.demoTools")}</button>}
      <div className="acc-links">
        {access.registered && <button type="button" className="acc-btn" disabled={!!busy} onClick={doLogout}>{t("action.logout")}</button>}
        <button type="button" className="acc-btn acc-btn--danger" onClick={() => setDeleting(true)}>{t("account.delete")}</button>
      </div>
      <LegalLinks docs={["terms", "privacy", "purchase-info", "withdrawal-form", "cookies", "dpa"]} />
      {deleting && (
        <Dialog title={t("account.deleteTitle")} onClose={() => setDeleting(false)}>
          <p>{t("account.deleteConfirm")}</p>
          <input className="acc-input" aria-label="DELETE" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" data-autofocus />
          {access.registered && <input className="acc-input" type="password" aria-label={t("auth.password")} placeholder={t("auth.password")} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />}
          <button type="button" className="acc-btn acc-btn--danger acc-btn--full" disabled={word !== "DELETE" || !!busy} onClick={doDelete}>{t("account.deleteGo")}</button>
        </Dialog>
      )}
    </Dialog>
  );
}

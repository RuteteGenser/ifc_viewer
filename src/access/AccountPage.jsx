import { useState } from "react";
import Dialog from "./Dialog";
import CodeEntry from "./CodeEntry";
import { useAccess } from "./AccessProvider";
import { deleteAccount, logout, openPortal } from "./api";
import { downloadAccountData, downloadAllModels } from "./download";
import { mapError } from "./state";
import { t } from "./copy";

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" }) : "");
const mb = (n) => `${Math.round(n / 1048576)} MB`;

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

  const run = (name, fn) => async () => {
    setError("");
    setBusy(name);
    try { await fn(); } catch (err) { setError(t(mapError(err.status, err.code))); }
    setBusy("");
  };
  const portal = run("portal", async () => window.location.assign((await openPortal("manage")).url));
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
        <p><strong>{access.registered ? s.account.email : t("account.notSignedIn")}</strong></p>
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
        <p className="acc-hint">{quotaText(s)}</p>
        <div className="acc-row">
          {access.registered && s.entitlement.state === "active" && <button type="button" className="acc-btn" disabled={!!busy} onClick={portal}>{label("portal", t("action.manageBilling"))}</button>}
          {access.state !== "active" && <button type="button" className="acc-btn" onClick={() => access.open({ kind: "paywall", sheet: true })}>{t("action.seePlans")}</button>}
        </div>
        {codeOpen ? <CodeEntry onDone={() => setCodeOpen(false)} /> : <button type="button" className="acc-link" onClick={() => setCodeOpen(true)}>{t("action.haveCode")}</button>}
      </section>
      <section className="acc-box">
        <button type="button" className="acc-btn acc-btn--full" disabled={!!busy} onClick={downloadAll}>{busy.startsWith("Down") ? busy : t("account.downloadAll")}</button>
        <button type="button" className="acc-btn acc-btn--full" disabled={!!busy} onClick={run("export", downloadAccountData)}>{t("account.exportData")}</button>
      </section>
      {error && <p className="acc-error" role="alert">{error}</p>}
      <div className="acc-links">
        {access.registered && <button type="button" className="acc-btn" disabled={!!busy} onClick={doLogout}>{t("action.logout")}</button>}
        <button type="button" className="acc-btn acc-btn--danger" onClick={() => setDeleting(true)}>{t("account.delete")}</button>
      </div>
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

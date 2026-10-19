import { useEffect, useState } from "react";
import Dialog from "./Dialog";
import CodeEntry from "./CodeEntry";
import { useAccess } from "./AccessProvider";
import { getPlans, startCheckout } from "./api";
import { downloadAllModels } from "./download";
import { mapError } from "./state";
import { t } from "./copy";

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" }) : "");
const mb = (n) => `${Math.round(n / 1048576)} MB`;

export function priceText(p) {
  const amount = new Intl.NumberFormat(undefined, { style: "currency", currency: p.currency }).format(p.amountMinor / 100);
  if (p.kind !== "recurring") return t("paywall.priceOnce", { amount, days: p.accessDays });
  return t(p.interval === "year" ? "paywall.priceYear" : "paywall.priceMonth", { amount });
}

export default function Paywall({ hasWork }) {
  const access = useAccess();
  const d = access.dialog;
  const sheet = d?.kind === "paywall";
  const e = access.session.entitlement;
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState(false);
  const [consent, setConsent] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getPlans().then((r) => setPlan(r?.plans?.[0] || null)).catch(() => setPlanError(true));
  }, []);

  // The expired overlay may be set aside only while a model is open, so work is never hidden for good.
  if (!sheet && access.overlayHidden) return null;
  const price = plan?.prices?.[0];
  const limits = plan?.limits || {};
  const closable = sheet || (hasWork && e.state !== "blocked");
  const close = sheet ? access.close : () => access.setOverlayHidden(true);
  const title = access.state === "expired" || access.state === "blocked" ? t("paywall.title.expired") : d?.code?.startsWith("quota") ? t("paywall.title.quota") : t("paywall.title.grace");

  const subscribe = async () => {
    setError("");
    setBusy("pay");
    try {
      const r = await startCheckout(price.lookupKey, access.session.public.termsVersion);
      window.location.assign(r.url);
    } catch (err) {
      if (err.code === "signup_required") access.open({ kind: "auth", mode: "signup" });
      else if (err.code === "already_active") access.refresh();
      else setError(err.code === "consent_required" ? t(mapError(422, "terms_required")) : t(mapError(err.status, err.code)));
      setBusy("");
    }
  };
  const download = async () => {
    setError("");
    setBusy("dl");
    try {
      const n = await downloadAllModels((i, total) => setBusy(t("account.downloading", { i, n: total })));
      if (!n) setError(t("account.noModels"));
    } catch { setError(t("error.generic")); }
    setBusy("");
  };

  return (
    <Dialog title={title} onClose={closable ? close : undefined} wide>
      {d?.message && <p className="acc-note">{d.message}</p>}
      <section className="acc-box">
        <p>{e.purgeAt ? t("paywall.keepUntil", { date: fmtDate(e.purgeAt) }) : t("paywall.keep")}</p>
        <button type="button" className="acc-btn acc-btn--full" onClick={download} disabled={!!busy} data-autofocus>
          {busy && busy !== "pay" && busy !== "dl" ? busy : t("action.downloadMine")}
        </button>
      </section>
      <section className="acc-box">
        {plan && price ? (
          <>
            <h3 className="acc-h3">{plan.name} {price.placeholder && <span className="acc-chip">{t("paywall.notFinal")}</span>}</h3>
            <p className="acc-price">{priceText(price)}</p>
            <ul className="acc-bullets">
              {limits.maxStoredModels && <li>{t("paywall.bullet.models", { n: limits.maxStoredModels })}</li>}
              {limits.maxBytesTotal && <li>{t("paywall.bullet.bytes", { size: mb(limits.maxBytesTotal) })}</li>}
              <li>{t("paywall.bullet.devices")}</li>
            </ul>
            <label className="acc-check">
              <input type="checkbox" checked={consent} onChange={(ev) => setConsent(ev.target.checked)} />
              {t("paywall.consent", { days: access.session.public.refundWindowDays || 14 })}
            </label>
            <button type="button" className="acc-btn acc-btn--primary acc-btn--full" disabled={!consent || !!busy} onClick={subscribe}>
              {busy === "pay" ? t("code.checking") : t("action.subscribe")}
            </button>
            {access.session.billing.testMode && <p className="acc-note">{t("paywall.testNote")}</p>}
          </>
        ) : (
          <p className="acc-hint">{planError || plan === null ? t("paywall.noPlans") : ""}</p>
        )}
        {error && <p className="acc-error" role="alert">{error}</p>}
      </section>
      <div className="acc-links">
        {codeOpen ? <CodeEntry onDone={() => { setCodeOpen(false); if (sheet) access.close(); }} initial={access.prefillCode} /> : (
          <button type="button" className="acc-link" onClick={() => setCodeOpen(true)}>{t("action.haveCode")}</button>
        )}
        {!access.registered && <button type="button" className="acc-link" onClick={() => access.open({ kind: "auth", mode: "login" })}>{t("action.login")}</button>}
        {closable && !sheet && <button type="button" className="acc-link" onClick={close}>{t("action.keepLooking")}</button>}
      </div>
    </Dialog>
  );
}

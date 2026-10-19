import { useEffect, useState } from "react";
import Dialog from "./Dialog";
import CodeEntry from "./CodeEntry";
import { useAccess } from "./AccessProvider";
import { getPlans, startCheckout } from "./api";
import { deleteAllModels, downloadAllModels } from "./download";
import { formatBytes, formatDay as fmtDate, mapError, paymentFailure } from "./state";
import { t } from "./copy";
import { TermsConsent } from "../legal/LegalPage";
import { lt, priceSummary } from "../legal/strings";


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
  const [terms, setTerms] = useState(false);
  const [waiver, setWaiver] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    getPlans().then((r) => setPlan(r?.plans?.[0] || null)).catch(() => setPlanError(true));
  }, []);

  // The expired overlay may be set aside only while a model is open, so work is never hidden for good.
  if (!sheet && access.overlayHidden) return null;
  const price = plan?.prices?.[0];
  const limits = plan?.limits || {};
  // Never a dead end: the overlay can always be set aside (a blocked account is the one exception),
  // so files on this device can still be opened and nothing is hidden for good.
  const closable = sheet || e.state !== "blocked";
  const close = sheet ? access.close : () => access.setOverlayHidden(true);
  const failure = paymentFailure(access.session);
  const failed = failure === "renewal";
  const ended = access.state === "expired" || access.state === "blocked";
  const title = failure === "first" ? t("paywall.title.firstFailed")
    : failed ? t("paywall.title.failed")
    : ended ? t("paywall.title.expired")
    : d?.code?.startsWith("quota") ? t("paywall.title.quota")
    : access.state === "grace" ? t("paywall.title.grace")
    : t("paywall.title.plans");
  const whyKey = `paywall.why.${d?.code}`;
  const why = d?.code ? (t(whyKey) === whyKey ? t("paywall.why.upgrade_required") : t(whyKey)) : "";
  const keep = e.purgeAt
    ? access.state === "grace" && e.graceEndsAt ? t("paywall.keepGrace", { open: fmtDate(e.graceEndsAt), date: fmtDate(e.purgeAt) }) : t("paywall.keepUntil", { date: fmtDate(e.purgeAt) })
    : t("paywall.keep");

  const subscribe = async () => {
    setError("");
    setBusy("pay");
    try {
      const r = await startCheckout(price.lookupKey, access.session.public.termsVersion, { withdrawalWaiver: waiver });
      window.location.assign(r.url);
    } catch (err) {
      if (err.code === "signup_required") access.open({ kind: "auth", mode: "signup" });
      else if (err.code === "already_active") access.refresh();
      else setError(err.code === "consent_required" ? t(mapError(422, "terms_required")) : t(mapError(err.status, err.code)));
      setBusy("");
    }
  };
  const deleteMine = async () => {
    setError("");
    setConfirmDelete(false);
    setBusy("del");
    try {
      const n = await deleteAllModels();
      window.dispatchEvent(new Event("argus:library-refresh"));
      access.refresh();
      access.say(t(n ? "deleteModels.done" : "deleteModels.none"));
    } catch { setError(t("error.generic")); }
    setBusy("");
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
      {why && <p className="acc-note" data-testid="paywall-why">{why}</p>}
      {failure === "first" && <p className="acc-note" data-testid="paywall-failed">{t("pay.firstFailed")}</p>}
      {failed && <p className="acc-note">{t("paywall.failedNote")}</p>}
      <section className="acc-box">
        <p>{keep}</p>
        <button type="button" className="acc-btn acc-btn--full" onClick={download} disabled={!!busy} data-autofocus>
          {busy && busy !== "pay" && busy !== "dl" && busy !== "del" ? busy : t("action.downloadMine")}
        </button>
        {ended && access.session.usage.storedModels > 0 && (
          <button type="button" className="acc-btn acc-btn--danger acc-btn--full" onClick={() => setConfirmDelete(true)} disabled={!!busy}>{t("action.deleteMine")}</button>
        )}
      </section>
      <section className="acc-box">
        {plan && price ? (
          <>
            <h3 className="acc-h3">{plan.name} {price.placeholder && <span className="acc-chip">{t("paywall.notFinal")}</span>}</h3>
            <p className="acc-price">{priceText(price)}</p>
            <ul className="acc-bullets">
              {limits.maxStoredModels && <li>{t("paywall.bullet.models", { n: limits.maxStoredModels })}</li>}
              {limits.maxBytesTotal && <li>{t("paywall.bullet.bytes", { size: formatBytes(limits.maxBytesTotal) })}</li>}
              <li>{t("paywall.bullet.devices")}</li>
            </ul>
            <TermsConsent checked={terms} onChange={setTerms} extraDocs={["purchase-info", "withdrawal-form"]} />
            <label className="acc-check" data-testid="consent-waiver">
              <input type="checkbox" checked={waiver} onChange={(ev) => setWaiver(ev.target.checked)} />
              <span>{lt("consent.waiver")}</span>
            </label>
            <p className="acc-price-line" data-testid="price-summary">{priceSummary(price)}</p>
            <button type="button" className="acc-btn acc-btn--primary acc-btn--full" disabled={!terms || !waiver || !!busy} onClick={subscribe}>
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
        {access.session.demo && <button type="button" className="acc-link" onClick={() => access.open({ kind: "demo" })}>{t("action.demoTools")}</button>}
        {closable && !sheet && <button type="button" className="acc-link" onClick={close}>{t(hasWork ? "action.keepLooking" : "action.keepLookingEmpty")}</button>}
      </div>
      {confirmDelete && (
        <Dialog title={t("deleteModels.title")} onClose={() => setConfirmDelete(false)}>
          <p>{t("deleteModels.body")}</p>
          <div className="acc-row">
            <button type="button" className="acc-btn" data-autofocus onClick={() => setConfirmDelete(false)}>{t("deleteModels.cancel")}</button>
            <button type="button" className="acc-btn acc-btn--danger" onClick={deleteMine}>{t("deleteModels.go")}</button>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}

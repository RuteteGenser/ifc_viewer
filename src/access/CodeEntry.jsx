import { useEffect, useState } from "react";
import { redeemCode } from "./api";
import { useAccess } from "./AccessProvider";
import { mapError } from "./state";
import { t } from "./copy";

const longDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" });

export default function CodeEntry({ onDone, initial = "" }) {
  const access = useAccess();
  const [code, setCode] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  useEffect(() => setCode((c) => c || initial), [initial]);
  if (!access) return null;
  const submit = async (e) => {
    e.preventDefault();
    if (!code.trim()) return setError(t("code.empty"));
    setBusy(true);
    setError("");
    try {
      const res = await redeemCode(code.trim());
      setOk(t("code.ok", { date: longDate(res.entitlement?.endsAt || res.grant?.endsAt) }));
      access.applyEntitlement(res.entitlement);
      setTimeout(() => onDone?.(), 1800);
    } catch (err) {
      const key = mapError(err.status, err.code);
      setError(key === "rate" ? t("code.rate") : t(key === "error.generic" || key === "error.network" ? key : key));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="acc-code" onSubmit={submit} noValidate>
      <label className="acc-label" htmlFor="acc-code-input">{t("code.label")}</label>
      <div className="acc-row">
        <input id="acc-code-input" className="acc-input" value={code} autoComplete="off" autoCapitalize="characters" spellCheck={false}
          aria-invalid={error ? "true" : undefined} aria-describedby={error ? "acc-code-msg" : undefined}
          onChange={(e) => { setCode(e.target.value); setError(""); }} data-autofocus />
        <button type="submit" className="acc-btn acc-btn--primary" disabled={busy || !!ok}>
          {busy ? t("code.checking") : t("action.useCode")}
        </button>
      </div>
      {error && <p id="acc-code-msg" className="acc-error" role="alert">{error}</p>}
      {ok && <p className="acc-ok" role="status">{ok}</p>}
    </form>
  );
}

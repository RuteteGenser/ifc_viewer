import { useState } from "react";
import Dialog from "./Dialog";
import { useAccess } from "./AccessProvider";
import { claimDeviceModels, confirmReset, login, requestReset, signup } from "./api";
import { mapError } from "./state";
import { t } from "./copy";

function Field({ id, label, type = "text", value, onChange, autoComplete, hint, error, autoFocus }) {
  return (
    <div className="acc-field">
      <label className="acc-label" htmlFor={id}>{label}</label>
      <input id={id} className="acc-input" type={type} value={value} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? "true" : undefined} aria-describedby={`${id}-d`} data-autofocus={autoFocus ? "" : undefined} />
      <p id={`${id}-d`} className="acc-hint">{hint}</p>
    </div>
  );
}

// mode: signup | login | forgot | reset
export default function AuthForms({ mode: first = "signup", token }) {
  const access = useAccess();
  const [mode, setMode] = useState(first);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [claim, setClaim] = useState(0);
  const termsVersion = access.session.public.termsVersion;

  const fail = (err) => {
    const key = mapError(err.status, err.code);
    setError(key === "rate" ? t("error.rate", { minutes: Math.max(1, Math.ceil((err.retryAfter || 60) / 60)) }) : t(key));
  };
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (mode === "signup" && !terms) return setError(t("auth.error.terms"));
    setBusy(true);
    try {
      if (mode === "forgot") {
        await requestReset(email);
        setSent(true);
        return;
      }
      if (mode === "reset") await confirmReset(token, password);
      else if (mode === "signup") await signup({ email, password, displayName: "", acceptTerms: true, termsVersion });
      else {
        const res = await login({ email, password });
        if (res?.deviceModels > 0) {
          setClaim(res.deviceModels);
          await access.refresh();
          return;
        }
      }
      await access.refresh();
      access.say(t("toast.loggedIn"));
      access.close();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const move = async () => {
    try { await claimDeviceModels(); } catch { /* shown in the list */ }
    window.dispatchEvent(new Event("argus:library-changed"));
    access.close();
  };
  const titles = { signup: t("action.signup"), login: t("action.login"), forgot: t("auth.forgot"), reset: t("auth.saveNew") };

  if (claim) {
    return (
      <Dialog title={t("action.login")}>
        <p>{`Move ${claim} ${claim === 1 ? "model" : "models"} from this browser into your account?`}</p>
        <div className="acc-row">
          <button type="button" className="acc-btn acc-btn--primary" onClick={move} data-autofocus>Move them</button>
          <button type="button" className="acc-btn" onClick={access.close}>Not now</button>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog title={titles[mode]} onClose={access.close}>
      {access.session.public.insecureTransport && mode !== "forgot" && <p className="acc-note">{t("auth.insecure")}</p>}
      {mode === "signup" && <p className="acc-hint">{t("auth.keepNote")}</p>}
      <form onSubmit={submit} noValidate>
        {mode !== "reset" && <Field id="acc-email" label={t("auth.email")} type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />}
        {mode !== "forgot" && (
          <>
            <Field id="acc-pw" label={mode === "reset" ? t("auth.newPassword") : t("auth.password")} type={show ? "text" : "password"} value={password} onChange={setPassword}
              autoComplete={mode === "login" ? "current-password" : "new-password"} hint={mode === "login" ? "" : t("auth.passwordHint")} autoFocus={mode === "reset"} />
            <label className="acc-check"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> {t("auth.showPassword")}</label>
          </>
        )}
        {mode === "signup" && (
          <label className="acc-check"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} /> {t("auth.terms")}</label>
        )}
        {error && <p className="acc-error" role="alert">{error}</p>}
        {sent && <p className="acc-ok" role="status">{t("auth.resetSent")} {t("auth.resetDemo")}</p>}
        <button type="submit" className="acc-btn acc-btn--primary acc-btn--full" disabled={busy}>
          {mode === "forgot" ? t("auth.sendLink") : titles[mode]}
        </button>
      </form>
      <div className="acc-links">
        {mode === "login" && <button type="button" className="acc-link" onClick={() => { setError(""); setMode("forgot"); }}>{t("auth.forgot")}</button>}
        {mode === "login" && <button type="button" className="acc-link" onClick={() => { setError(""); setMode("signup"); }}>{t("auth.noAccount")}</button>}
        {mode !== "login" && mode !== "reset" && <button type="button" className="acc-link" onClick={() => { setError(""); setSent(false); setMode("login"); }}>{t("auth.haveAccount")}</button>}
      </div>
    </Dialog>
  );
}

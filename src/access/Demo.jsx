// Demo mode only: slim bar, Demo tools panel, demo inbox, "check your email" screen. Nothing renders unless the backend says demo.
import { useCallback, useEffect, useState } from "react";
import Dialog from "./Dialog";
import { useAccess } from "./AccessProvider";
import { demoOutbox, demoReset, demoTravel } from "./api";
import { mapError } from "./state";
import { t } from "./copy";

const KEY = "argus_demo_email";
const remember = (email) => { try { sessionStorage.setItem(KEY, email); } catch { /* private mode */ } };
const remembered = () => { try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; } };
export const rememberDemoEmail = remember;

// True on phones and portrait tablets, where one slim bar replaces the demo bar and the banner.
export function useNarrow() {
  const q = "(max-width: 768px)";
  const get = () => typeof window !== "undefined" && !!window.matchMedia?.(q).matches;
  const [n, setN] = useState(get);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return undefined;
    const f = () => setN(m.matches);
    m.addEventListener("change", f); f();
    return () => m.removeEventListener("change", f);
  }, []);
  return n;
}

export function DemoBar() {
  const a = useAccess();
  const narrow = useNarrow();
  if (!a?.session.demo || narrow) return null;
  return (
    <div className="acc-demobar" data-testid="demo-bar">
      <span>{t("banner.demo")}</span>
      <button type="button" className="acc-link" onClick={() => a.open({ kind: "demo" })}>{t("action.demoTools")}</button>
    </div>
  );
}

const HOURS = [["demo.h12", 12], ["demo.d1", 24], ["demo.d7", 168], ["demo.d30", 720]];

export function DemoTools() {
  const a = useAccess();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = async (h) => {
    setBusy(true); setError("");
    try {
      const r = await demoTravel(h);
      await a.refresh();
      window.dispatchEvent(new Event("argus:library-refresh"));
      a.close();
      a.say(t("demo.moved", { state: r.entitlement.state.replace("_", " ") }));
    } catch (err) { setError(t(mapError(err.status, err.code))); setBusy(false); }
  };
  const reset = async () => {
    setBusy(true);
    try { await demoReset(); } catch { /* reload anyway */ }
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    window.location.assign("/app/");
  };
  return (
    <Dialog title={t("demo.title")} onClose={a.close}>
      <p className="acc-hint">{t("demo.intro")}</p>
      <section className="acc-box">
        <button type="button" className="acc-btn acc-btn--full" onClick={() => a.open({ kind: "inbox" })}>{t("action.openInbox")}</button>
      </section>
      <section className="acc-box">
        <h3 className="acc-h3">{t("demo.forward")}</h3>
        <div className="acc-row">
          {HOURS.map(([k, h]) => <button key={k} type="button" className="acc-btn" disabled={busy} onClick={() => go(h)}>{t(k)}</button>)}
        </div>
      </section>
      <section className="acc-box">
        <button type="button" className="acc-btn acc-btn--danger acc-btn--full" disabled={busy} onClick={reset}>{t("demo.reset")}</button>
        <p className="acc-hint">{t("demo.resetHint")}</p>
      </section>
      {error && <p className="acc-error" role="alert">{error}</p>}
    </Dialog>
  );
}

// Links in mails point at the host the API saw; open them on the host the browser is on.
const local = (link) => { try { const u = new URL(link); return u.pathname + u.search; } catch { return link; } };

export function DemoInbox({ email: first = "" }) {
  const a = useAccess();
  const own = a.registered ? a.session.account.email : "";
  const [email, setEmail] = useState(own || first || remembered());
  const [mails, setMails] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(async (to) => {
    setError("");
    try { setMails((await demoOutbox(own ? "" : to)).mails); } catch (err) { setMails(null); setError(t(mapError(err.status, err.code))); }
  }, [own]);
  useEffect(() => { if (own || email) load(email); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog title={t("demo.inbox")} onClose={a.close} wide>
      <p className="acc-hint">{t("demo.inboxHint")}</p>
      {!own && (
        <form className="acc-row" onSubmit={(e) => { e.preventDefault(); if (email.trim()) { remember(email.trim()); load(email.trim()); } else setError(t("demo.needEmail")); }}>
          <input className="acc-input" type="email" aria-label={t("demo.emailLabel")} placeholder={t("auth.email")} value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className="acc-btn">{t("demo.show")}</button>
        </form>
      )}
      <button type="button" className="acc-link" onClick={() => load(email.trim())}>{t("demo.refresh")}</button>
      {error && <p className="acc-error" role="alert">{error}</p>}
      {mails && !mails.length && <p className="acc-hint">{t("demo.empty")}</p>}
      {mails?.map((m, i) => (
        <section className="acc-box" key={i} data-testid="demo-mail">
          <p><strong>{m.subject}</strong></p>
          <p className="acc-hint">{m.to}, {new Date(m.created_at).toLocaleTimeString()}</p>
          <p>{m.body.split("\n\n")[0]}</p>
          {m.links.map((l) => <a key={l} className="acc-btn acc-btn--primary acc-btn--full acc-mail-link" href={local(l)}>{m.subject}</a>)}
        </section>
      ))}
    </Dialog>
  );
}

export function CheckEmail({ email }) {
  const a = useAccess();
  return (
    <Dialog title={t("demo.checkTitle")} onClose={a.close}>
      <p>{t("demo.checkBody", { email })}</p>
      <button type="button" className="acc-btn acc-btn--primary acc-btn--full" data-autofocus onClick={() => { remember(email); a.open({ kind: "inbox", email }); }}>{t("action.openInbox")}</button>
    </Dialog>
  );
}

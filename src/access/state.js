// Pure helpers: session parsing, countdown, which banner / overlay applies.
// No React, no network, so node:test can load it.

// A reply counts as the new backend only if it carries a real session.
// Anything else (404, 401 challenge, HTML, old server) means legacy mode.
export function parseSession(body) {
  if (!body || typeof body !== "object") return null;
  const { account, entitlement } = body;
  if (!account || typeof account !== "object") return null;
  if (!entitlement || typeof entitlement.state !== "string") return null;
  return {
    account,
    entitlement,
    usage: body.usage || { storedModels: 0, bytes: 0 },
    ui: body.ui || {},
    billing: body.billing || {},
    public: body.public || {},
    demo: body.demo === true,
    deviceModels: body.ui?.deviceModels || 0,
    offsetMs: Number.isFinite(Date.parse(body.serverTime)) ? Date.parse(body.serverTime) - Date.now() : 0,
  };
}

export function timeLeft(targetIso, nowMs) {
  const ms = Date.parse(targetIso) - nowMs;
  if (!Number.isFinite(ms)) return "";
  const h = ms / 3600000;
  if (h > 48) return `${Math.floor(h / 24)} days`;
  if (h > 1) return `${Math.floor(h)} h`;
  const m = Math.max(1, Math.ceil(ms / 60000));
  return `${m} min`;
}

// The state as the clock says it is now (a tab left open past the end moves on).
export function currentState(session, nowMs) {
  const e = session.entitlement;
  let state = e.state;
  const past = (iso) => iso && Date.parse(iso) <= nowMs;
  if ((state === "anonymous_trial" || state === "code_trial") && past(e.endsAt)) state = "grace";
  if (state === "grace" && e.graceEndsAt && past(e.graceEndsAt)) state = "expired";
  return state;
}

export function bannerFor(session, nowMs) {
  if (!session) return null;
  const e = session.entitlement;
  const state = currentState(session, nowMs);
  const kind = state !== e.state ? state : session.ui.banner;
  if (kind === "trial" || state === "anonymous_trial") return { kind: "trial", tone: "quiet", target: e.endsAt, dismissible: true };
  if (kind === "code_trial" || state === "code_trial") {
    const urgent = Date.parse(e.endsAt) - nowMs < 3 * 86400000;
    return { kind: "code_trial", tone: urgent ? "urgent" : "quiet", target: e.endsAt, dismissible: true };
  }
  if (kind === "grace" || state === "grace") return { kind: "grace", tone: "warning", target: e.graceEndsAt, dismissible: false };
  if (kind === "payment_failed") return { kind, tone: "warning", target: e.graceEndsAt || e.endsAt, dismissible: false };
  if (kind === "plan_ending") return { kind, tone: "quiet", target: e.endsAt, dismissible: true };
  if (kind === "demo_http") return { kind, tone: "info", dismissible: true };
  return null;
}

export const paywallNow = (session, nowMs) => {
  if (!session) return false;
  const state = currentState(session, nowMs);
  return state === "expired" || state === "blocked" || session.ui.paywall === true;
};

export function mapError(status, code) {
  if (status === 429) return "rate";
  if (code === "invalid_credentials") return "auth.error.credentials";
  if (code === "email_taken") return "auth.error.taken";
  if (code === "weak_password") return "auth.error.weak";
  if (code === "invalid_email") return "auth.error.email";
  if (code === "terms_required") return "auth.error.terms";
  if (code === "signups_closed") return "auth.error.closed";
  if (code === "token_invalid") return "auth.error.token";
  if (code === "email_required") return "demo.needEmail";
  if (code === "blocked") return "error.blocked";
  if (code === "code_invalid" || code === "invalid_format") return "code.invalid";
  if (code === "code_already_used") return "code.used";
  if (code === "signup_required") return "code.needsAccount";
  if (status === 503) return "error.billing";
  if (status === 0) return "error.network";
  return "error.generic";
}

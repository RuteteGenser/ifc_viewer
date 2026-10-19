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

// "first": a declined FIRST payment (never paid, nothing was granted); "renewal": a paid account whose renewal failed.
export function paymentFailure(session) {
  if (!session) return null;
  const b = session.billing || {};
  if (b.paymentFailureReason === "first_payment_failed") return "first";
  if (b.paymentFailureReason === "renewal_failed") return "renewal";
  if (b.lastPaymentFailed || session.entitlement?.flags?.paymentFailed) return "renewal";
  return null;
}

// This device's network used up today's free trials: the viewer and samples stay open, no paywall.
export const isTrialLimit = (session) => !!session && session.entitlement.state === "expired" && session.entitlement.reason === "trial_limit";

// Where a grace period came from, for the wording: "code" for an access code, else "trial".
export const graceSource = (session) => (/code/.test(session?.entitlement?.reason || "") || session?.entitlement?.planKey === "code_trial" ? "code" : "trial");

export function bannerFor(session, nowMs) {
  if (!session) return null;
  const e = session.entitlement;
  const state = currentState(session, nowMs);
  if (isTrialLimit(session)) return { kind: "trial_limit", tone: "warning", dismissible: false };
  if (paymentFailure(session) === "first" && state !== "active" && state !== "expired" && state !== "blocked") {
    return { kind: "first_payment_failed", tone: "warning", dismissible: false };
  }
  const kind = state !== e.state ? state : session.ui.banner;
  if (kind === "trial" || state === "anonymous_trial") return { kind: "trial", tone: "quiet", target: e.endsAt, dismissible: true };
  if (kind === "code_trial" || state === "code_trial") {
    const urgent = Date.parse(e.endsAt) - nowMs < 3 * 86400000;
    return { kind: "code_trial", tone: urgent ? "urgent" : "quiet", target: e.endsAt, dismissible: true };
  }
  if (kind === "grace" || state === "grace") return { kind: "grace", tone: "warning", target: e.graceEndsAt, dismissible: false, source: graceSource(session) };
  if (kind === "payment_failed") return { kind, tone: "warning", target: e.graceEndsAt || e.endsAt, dismissible: false };
  if (kind === "plan_ending") return { kind, tone: "quiet", target: e.endsAt, dismissible: true };
  if (kind === "demo_http") return { kind, tone: "info", dismissible: true };
  return null;
}

export const paywallNow = (session, nowMs) => {
  if (!session) return false;
  if (isTrialLimit(session) && session.ui.canUseSamples !== false) return false;
  const state = currentState(session, nowMs);
  return state === "expired" || state === "blocked" || session.ui.paywall === true;
};

export function mapError(status, code, message = "") {
  if (status === 429) return "rate";
  if (code === "invalid_credentials") return "auth.error.credentials";
  if (code === "email_taken") return "auth.error.taken";
  if (code === "weak_password") return /common/i.test(message) ? "auth.error.common" : "auth.error.weak";
  if (code === "invalid_name") return "folder.error.invalid";
  if (code === "name_taken") return "folder.error.taken";
  if (code === "quota_folders") return "folder.error.quota";
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

// Sizes for people: MB under 1 GB, else GB with at most one decimal ("10 GB", "0.5 GB").
export function formatBytes(n) {
  const v = Number(n) || 0;
  if (v >= 1073741824) return `${(Math.round((v / 1073741824) * 10) / 10).toString()} GB`;
  return `${Math.round(v / 1048576)} MB`;
}

// The one extra "subscription" line the Account panel may add under the plan line, or null when it would repeat it.
export function subscriptionLine(session, sub, state) {
  const failure = paymentFailure(session);
  if (failure === "first") return "pay.firstFailed";
  const e = session.entitlement;
  if (sub?.status === "canceled" && !(state === "active" && e.flags?.cancelAtPeriodEnd)) return "account.sub.canceled";
  if (sub?.status === "past_due" && !(state === "active" && e.flags?.paymentFailed)) return "account.sub.past_due";
  return null;
}

// "2026-11-02T..." -> "2 November" (the same words everywhere a date is shown).
export const formatDay = (iso) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" }) : "");

// A length of time in words, as { key, n } for copy.js: "dur.hours" 6, "dur.days" 3, "dur.minutes" 40.
// Rounds to what people say (the session gives only an end time, so a trial seen a few seconds
// after it began is a few seconds short of its length).
export function durationParts(ms) {
  const h = ms / 3600000;
  if (!(h > 0)) return { key: "dur.minutes", n: 1 };
  if (h >= 48) return { key: "dur.days", n: Math.round(h / 24) };
  if (h >= 0.98) return { key: "dur.hours", n: Math.round(h) };
  return { key: "dur.minutes", n: Math.max(1, Math.round(h * 60)) };
}

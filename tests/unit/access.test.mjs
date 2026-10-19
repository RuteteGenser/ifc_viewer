import test from "node:test";
import assert from "node:assert/strict";
import { parseSession, timeLeft, currentState, bannerFor, paywallNow, mapError, paymentFailure, isTrialLimit, formatBytes, subscriptionLine } from "../../src/access/state.js";
import { bootstrapRaw } from "../../src/access/api.js";
import { t, setLocale } from "../../src/access/copy.js";
import { renameModel, uploadModel, downloadModel, LibraryError } from "../../src/library/api.js";

const NOW = Date.parse("2026-10-19T09:00:00Z");
const iso = (ms) => new Date(NOW + ms).toISOString();
const H = 3600000;
const raw = (state, over = {}, ui = {}) => ({
  account: { id: "a", kind: "anonymous", locale: "en" },
  entitlement: { state, planName: "x", endsAt: iso(23 * H), graceEndsAt: iso(23 * H + 7 * 24 * H), limits: {}, ...over },
  usage: { storedModels: 1, bytes: 10 },
  ui: { banner: "trial", paywall: false, ...ui },
  serverTime: iso(0),
});

test("parseSession accepts a real session and rejects everything else", () => {
  assert.ok(parseSession(raw("anonymous_trial")));
  for (const bad of [null, undefined, "<html>", {}, { account: {} }, { entitlement: { state: "x" } }, { account: {}, entitlement: {} }, []]) {
    assert.equal(parseSession(bad), null);
  }
});

test("timeLeft: days over 48 h, hours over 1 h, else minutes, no seconds", () => {
  assert.equal(timeLeft(iso(30 * 24 * H), NOW), "30 days");
  assert.equal(timeLeft(iso(49 * H), NOW), "2 days");
  assert.equal(timeLeft(iso(23 * H + 1000), NOW), "23 h");
  assert.equal(timeLeft(iso(30 * 60000), NOW), "30 min");
  assert.equal(timeLeft(iso(5000), NOW), "1 min");
});

test("state moves on by the clock: trial, grace, expired", () => {
  const s = parseSession(raw("anonymous_trial"));
  assert.equal(currentState(s, NOW), "anonymous_trial");
  assert.equal(currentState(s, NOW + 24 * H), "grace");
  assert.equal(currentState(s, NOW + 24 * H + 8 * 24 * H), "expired");
  assert.equal(paywallNow(s, NOW), false);
  assert.equal(paywallNow(s, NOW + 24 * H), false);
  assert.equal(paywallNow(s, NOW + 24 * H + 8 * 24 * H), true);
});

test("banner per state", () => {
  assert.deepEqual(
    (({ kind, tone }) => ({ kind, tone }))(bannerFor(parseSession(raw("anonymous_trial")), NOW)),
    { kind: "trial", tone: "quiet" },
  );
  const code = parseSession(raw("code_trial", { endsAt: iso(2 * 24 * H) }, { banner: "code_trial" }));
  assert.equal(bannerFor(code, NOW).tone, "urgent");
  const grace = bannerFor(parseSession(raw("grace", {}, { banner: "grace" })), NOW);
  assert.equal(grace.kind, "grace");
  assert.equal(grace.dismissible, false);
  assert.equal(bannerFor(parseSession(raw("active", {}, { banner: "none" })), NOW), null);
});

test("server paywall flag wins", () => {
  assert.equal(paywallNow(parseSession(raw("expired", {}, { paywall: true })), NOW), true);
});

test("copy: wording and variables", () => {
  setLocale("en");
  assert.equal(t("banner.trial", { timeLeft: "23 h" }), "Free trial. 23 h left.");
  assert.equal(t("banner.code_trial", { timeLeft: "29 days" }), "Access code active. 29 days left.");
  setLocale("nb");
  assert.match(t("action.login"), /Logg inn/);
  assert.match(t("code.empty"), /code/); // falls back to English
  setLocale("en");
  for (const key of ["banner.trial", "banner.grace", "paywall.consent"]) assert.ok(!/[–—]/.test(t(key)));
});

test("mapError", () => {
  assert.equal(mapError(401, "invalid_credentials"), "auth.error.credentials");
  assert.equal(mapError(404, "code_invalid"), "code.invalid");
  assert.equal(mapError(429, ""), "rate");
});

// ---- legacy-mode fallback: bootstrap never throws and never reports a session
const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });
const res = (status, body, type = "application/json") => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });

test("legacy: 404, 401, 405, html, network error all give null", async () => {
  for (const make of [() => res(404, { error: "x" }), () => res(401, "Unauthorized", "text/plain"), () => res(405, ""), () => res(200, "<html></html>", "text/html"), () => { throw new TypeError("network"); }]) {
    globalThis.fetch = async () => make();
    assert.equal(await bootstrapRaw(), null);
  }
});

test("legacy: a hanging answer is given up after 3 s", async () => {
  globalThis.fetch = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const t0 = Date.now();
  assert.equal(await bootstrapRaw(), null);
  const ms = Date.now() - t0;
  assert.ok(ms >= 2900 && ms < 4500, `took ${ms}`);
});

test("session JSON passes through and the request is a GET with credentials", async () => {
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url, init }; return res(200, raw("anonymous_trial")); };
  assert.ok(parseSession(await bootstrapRaw()));
  assert.equal(seen.url, "/api/session");
  assert.equal(seen.init.credentials, "same-origin");
  assert.equal(seen.init.headers["X-Argus-Client"], undefined);
});

// ---- library api: write header, 402 mapping
test("library writes carry X-Argus-Client; a 402 keeps the server message and body", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push(init); return res(402, { error: "you have reached 3 saved models", code: "quota_models", entitlement: { state: "active" } }); };
  await assert.rejects(renameModel("a", "b.ifc"), (err) => err instanceof LibraryError && err.status === 402 && /3 saved models/.test(err.message) && err.body.code === "quota_models");
  assert.equal(calls[0].headers["X-Argus-Client"], "1");
});

test("demo flag is carried from the session; copy has the demo strings without dashes", () => {
  assert.equal(parseSession({ ...raw("anonymous_trial"), demo: true }).demo, true);
  assert.equal(parseSession(raw("anonymous_trial")).demo, false);
  assert.equal(mapError(400, "email_required"), "demo.needEmail");
  for (const k of ["banner.demo", "demo.checkBody", "pay.declinedBody", "verify.bad", "magic.bad", "demo.moved"]) {
    assert.ok(!/[–—]/.test(t(k)), k);
  }
});

// ---- QA3 frontend fixes
test("trial_limit: own banner, no paywall while samples are usable, still a paywall without them", () => {
  const limited = parseSession(raw("expired", { reason: "trial_limit", planKey: "none" }, { paywall: true, canUseSamples: true, banner: "expired" }));
  assert.equal(isTrialLimit(limited), true);
  assert.equal(paywallNow(limited, NOW), false);
  assert.deepEqual((({ kind, tone, dismissible }) => ({ kind, tone, dismissible }))(bannerFor(limited, NOW)), { kind: "trial_limit", tone: "warning", dismissible: false });
  setLocale("en");
  assert.equal(t("banner.trial_limit"), "Free trials from this network are used up today. Enter an access code or log in.");
  // an ordinary expired account still gets the paywall and no banner
  const ended = parseSession(raw("expired", { reason: "trial_ended" }, { paywall: true, canUseSamples: true, banner: "expired" }));
  assert.equal(isTrialLimit(ended), false);
  assert.equal(paywallNow(ended, NOW), true);
  assert.equal(bannerFor(ended, NOW), null);
  assert.equal(paywallNow(parseSession(raw("expired", { reason: "trial_limit" }, { paywall: true, canUseSamples: false })), NOW), true);
});

test("payment failure: first vs renewal, with the exact copy", () => {
  const first = parseSession({ ...raw("anonymous_trial"), billing: { lastPaymentFailed: true, paymentFailureReason: "first_payment_failed" } });
  assert.equal(paymentFailure(first), "first");
  assert.equal(bannerFor(first, NOW).kind, "first_payment_failed");
  setLocale("en");
  assert.equal(t("banner.first_payment_failed"), "Your payment did not go through. Try another card.");
  assert.equal(t("pay.firstFailed"), "Your payment did not go through. Try another card.");
  assert.ok(!/last payment/i.test(t("banner.first_payment_failed") + t("pay.firstFailed") + t("paywall.title.firstFailed")));
  const renewal = parseSession({ ...raw("active", { flags: { paymentFailed: true } }, { banner: "payment_failed" }), billing: { lastPaymentFailed: true, paymentFailureReason: "renewal_failed" } });
  assert.equal(paymentFailure(renewal), "renewal");
  assert.equal(bannerFor(renewal, NOW).kind, "payment_failed");
  assert.equal(t("banner.payment_failed", { date: "2 November" }), "We could not take your last payment. Update your card by 2 November to keep saving models.");
  assert.equal(paymentFailure(parseSession(raw("anonymous_trial"))), null);
});

test("grace banner names an access code", () => {
  const code = bannerFor(parseSession(raw("grace", { reason: "invite_code_ended" }, { banner: "grace" })), NOW);
  assert.equal(code.source, "code");
  assert.equal(bannerFor(parseSession(raw("grace", { reason: "anonymous_trial_ended" }, { banner: "grace" })), NOW).source, "trial");
  assert.match(t("banner.grace.code", { date: "2 November" }), /^Your access code has ended\./);
});

test("mapError: friendly keys for the new backend codes", () => {
  assert.equal(mapError(400, "weak_password", "Choose a less common password."), "auth.error.common");
  assert.equal(mapError(400, "weak_password", "password must be at least 10 characters"), "auth.error.weak");
  assert.equal(mapError(400, "invalid_name"), "folder.error.invalid");
  assert.equal(mapError(409, "name_taken"), "folder.error.taken");
  assert.equal(mapError(402, "quota_folders"), "folder.error.quota");
  assert.equal(t("auth.error.common"), "Choose a less common password.");
});

test("formatBytes: MB under 1 GB, GB above", () => {
  assert.equal(formatBytes(0), "0 MB");
  assert.equal(formatBytes(2570803), "2 MB");
  assert.equal(formatBytes(2048 * 1048576), "2 GB");
  assert.equal(formatBytes(10240 * 1048576), "10 GB");
  assert.equal(formatBytes(1.5 * 1073741824), "1.5 GB");
});

test("Account panel: one subscription line, never a repeat of the plan line", () => {
  const active = parseSession(raw("active"));
  assert.equal(subscriptionLine(active, { status: "active" }, "active"), null);
  assert.equal(subscriptionLine(parseSession(raw("active", { flags: { paymentFailed: true } })), { status: "past_due" }, "active"), null);
  assert.equal(subscriptionLine(parseSession(raw("active", { flags: { cancelAtPeriodEnd: true } })), { status: "canceled" }, "active"), null);
  assert.equal(subscriptionLine(parseSession(raw("expired")), { status: "canceled" }, "expired"), "account.sub.canceled");
  const first = parseSession({ ...raw("anonymous_trial"), billing: { paymentFailureReason: "first_payment_failed" } });
  assert.equal(subscriptionLine(first, { status: "past_due" }, "anonymous_trial"), "pay.firstFailed");
});

test("library: friendly folder errors and the plans sheet takes over a 402 without a duplicate toast", async () => {
  const { createFolder } = await import("../../src/library/api.js");
  for (const [status, code, expected] of [[400, "invalid_name", /folder name does not work/], [409, "name_taken", /already exists here/], [402, "quota_folders", /folder limit/]]) {
    globalThis.fetch = async () => res(status, { error: "raw server text", code });
    await assert.rejects(createFolder("x"), (err) => expected.test(err.message) && !/raw server text/.test(err.message));
  }
  // a 402 for a model: the access layer cancels the event => err.handled
  const seen = [];
  globalThis.window = { dispatchEvent: (e) => { seen.push(e.type); e.preventDefault(); return !e.defaultPrevented; }, location: { origin: "x" } };
  globalThis.fetch = async () => res(402, { error: "limit", code: "quota_models" });
  try {
    await assert.rejects(renameModel("a", "b.ifc"), (err) => err.handled === true);
    assert.deepEqual(seen, ["argus:upgrade"]);
  } finally { delete globalThis.window; }
});

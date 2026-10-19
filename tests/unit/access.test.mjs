import test from "node:test";
import assert from "node:assert/strict";
import { parseSession, timeLeft, currentState, bannerFor, paywallNow, mapError } from "../../src/access/state.js";
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

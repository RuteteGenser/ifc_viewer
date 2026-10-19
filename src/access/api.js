// Same-origin client for the access API. Every write sends X-Argus-Client.
const BASE = "/api";

export class AccessError extends Error {
  constructor(status, code, message, body, retryAfter = 0) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

export async function call(method, path, body, { signal } = {}) {
  const headers = { Accept: "application/json" };
  if (method !== "GET") headers["X-Argus-Client"] = "1";
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, credentials: "same-origin", signal, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (err) {
    throw new AccessError(0, "network", String(err?.message || err), null);
  }
  const json = (res.headers.get("content-type") || "").includes("json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    throw new AccessError(res.status, json?.code || "", json?.error || "", json, Number(res.headers.get("retry-after")) || 0);
  }
  return json;
}

// Settles when the first session call has finished (or after 4 s, or at once when it never starts).
// The library waits for this so its first request carries the device cookie: no first-visit 401.
let settle;
const firstBootstrap = new Promise((resolve) => { settle = resolve; });
export const whenSessionSettled = () => Promise.race([firstBootstrap, new Promise((r) => setTimeout(r, 4000))]);

// Returns the raw JSON or null. Never throws, gives up after 3 s.
export async function bootstrapRaw() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  try {
    return await call("GET", "/session", undefined, { signal: ctl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    settle();
  }
}

export const getPlans = () => call("GET", "/plans");
export const redeemCode = (code) => call("POST", "/redeem-code", { code });
export const signup = (b) => call("POST", "/auth/signup", b);
export const login = (b) => call("POST", "/auth/login", b);
export const logout = () => call("POST", "/auth/logout", {});
export const requestReset = (email) => call("POST", "/auth/password/reset/request", { email });
export const confirmReset = (token, newPassword) => call("POST", "/auth/password/reset/confirm", { token, newPassword });
export const getAccount = () => call("GET", "/account");
export const exportAccount = () => call("GET", "/account/export");
export const deleteAccount = (password) => call("POST", "/account/delete", { confirm: "DELETE", password });
export const claimDeviceModels = () => call("POST", "/account/claim-device-models", {});
export const startCheckout = (priceLookupKey, termsVersion) =>
  call("POST", "/billing/checkout", { priceLookupKey, consent: { startNow: true, termsVersion } });
export const openPortal = (flow = "manage") => call("POST", "/billing/portal", { flow });
export const verifyEmail = (token) => call("POST", "/auth/verify-email", { token });
export const resendVerify = () => call("POST", "/auth/verify-email/resend", {});
export const requestMagic = (email) => call("POST", "/auth/magic-link/request", { email });
export const verifyMagic = (token) => call("POST", "/auth/magic-link/verify", { token });
// Demo mode only (the backend answers 404 otherwise).
export const demoOutbox = (to) => call("GET", `/demo/outbox${to ? `?to=${encodeURIComponent(to)}` : ""}`);
export const demoTravel = (hours) => call("POST", "/demo/time-travel", { hours });
export const demoReset = () => call("POST", "/demo/reset", {});

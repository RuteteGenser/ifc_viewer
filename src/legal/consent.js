// Request bodies that carry the user's legal consent. The new fields are additive:
// terms: { version } and withdrawalWaiver go next to the legacy acceptTerms/termsVersion
// and consent.termsVersion (older backends check those against their own terms_version
// setting and ignore unknown fields).
import { LEGAL_VERSION } from "./version";

export function signupBody({ email, password, legacyTermsVersion }) {
  return { email, password, displayName: "", acceptTerms: true, termsVersion: legacyTermsVersion, terms: { version: LEGAL_VERSION } };
}

export function checkoutBody({ priceLookupKey, legacyTermsVersion, withdrawalWaiver }) {
  const waiver = withdrawalWaiver === true;
  return {
    priceLookupKey,
    consent: { startNow: true, termsVersion: legacyTermsVersion, withdrawalWaiver: waiver },
    terms: { version: LEGAL_VERSION },
    withdrawalWaiver: waiver,
  };
}

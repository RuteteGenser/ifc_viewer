// Seller details and service facts used by every legal document (in the app and in the
// static copies under public/legal). This is the ONE place to fill them in.
// A value still in [SQUARE BRACKETS] is a placeholder: the documents show it as is,
// and scripts/build-legal.mjs lists every one that is left.
export const SELLER = {
  name: "[FIRMANAVN]",
  orgNr: "[ORG.NR]",
  address: "[ADRESSE]",
  email: "[E-POST]",
  vatRegistered: "[MVA-REGISTRERT: ja/nei]",
  // Where the servers are and who runs them (processors in the privacy notice).
  hostingProvider: "[HOSTINGLEVERANDØR]",
  hostingLocation: "[SERVERPLASSERING]",
  emailProvider: "[E-POSTLEVERANDØR]",
  // How long raw web server logs (with IP addresses) are kept.
  logDays: "[LOGGLAGRING ANTALL DAGER]",
  // Court for business customers (consumers can always sue where they live).
  venue: "[TINGRETT]",
  // Shown in the purchase information; the checkout always shows the live price.
  priceMonthly: "[PRIS PER MÅNED]",
  priceYearly: "[PRIS PER ÅR]",
};

// Service facts. Keep them equal to the backend settings of the same meaning.
export const FACTS = {
  product: "Argus",
  trialHours: 24, // anonymous_trial_hours
  graceDays: 7, // anonymous_grace_days / dunning_grace_days: read-only (open and download)
  retentionDays: 30, // expired_retention_days: download or delete only, then deleted
  purgeNoticeDays: 7, // purge_notice_days
  anonInactiveDays: 180, // anon_inactive_delete_days
  paymentPayloadDays: 90, // payment_event_payload_days
  refundDays: 14, // refund_window_days: voluntary full refund of the first payment
  priceNoticeDays: 30,
  renewalNoticeDays: 30, // reminder before a yearly plan renews
  deviceCookieDays: 400, // argus_dev Max-Age 34 560 000 s
  sessionCookieDays: 30, // argus_sid Max-Age 2 592 000 s
  breachNoticeHours: 48,
};

export const isPlaceholder = (value) => typeof value === "string" && /\[[^\]]+\]/.test(value);

// Names of the SELLER fields that are still placeholders.
export function unfilledPlaceholders(seller = SELLER) {
  return Object.entries(seller).filter(([, v]) => isPlaceholder(v)).map(([k]) => k);
}

// Fills {{seller.x}} and {{facts.x}} in a document. Unknown names stay visible as they are.
export function fillTemplate(text, seller = SELLER, facts = FACTS) {
  return String(text).replace(/\{\{\s*(seller|facts)\.(\w+)\s*\}\}/g, (all, group, key) => {
    const v = (group === "seller" ? seller : facts)[key];
    return v === undefined ? all : String(v);
  });
}

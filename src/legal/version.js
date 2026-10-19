// Version of the Terms and the Privacy notice. Sign-up and checkout send it as
// terms: { version: LEGAL_VERSION }. It must equal the backend's
// current_terms_version setting (argus-api migrations/005_terms_receipts.sql).
// Change it whenever a document changes in substance, together with the backend setting.
export const LEGAL_VERSION = "2026-10-19";

export const DOCS = ["terms", "privacy", "purchase-info", "withdrawal-form", "cookies", "dpa"];
export const LANGS = ["nb", "en"];

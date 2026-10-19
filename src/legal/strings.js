// Legal and consent strings, Norwegian (bokmål) and English. The legal documents
// themselves live in ./docs. lt(key, vars) fills {name}. No dashes as punctuation.

const nb = {
  "doc.terms": "Brukervilkår",
  "doc.privacy": "Personvern",
  "doc.purchase-info": "Informasjon før kjøp",
  "doc.withdrawal-form": "Angreskjema",
  "doc.cookies": "Informasjonskapsler",
  "doc.dpa": "Databehandleravtale",
  "page.title": "Vilkår og personvern",
  "page.close": "Lukk",
  "page.nav": "Juridiske dokumenter",
  "page.lang": "English",
  "page.langLabel": "Read in English",
  "page.loading": "Laster...",
  "page.missing": "Fant ikke dokumentet.",
  "page.static": "Utskriftsvennlig side",
  "page.back": "Til {product}",
  "consent.terms": "Jeg godtar Brukervilkårene og har lest Personvernerklæringen",
  "consent.waiver": "Jeg ber om at tjenesten leveres umiddelbart og forstår at angreretten bortfaller når tjenesten er levert fullt ut. Hvis jeg angrer før det, betaler jeg forholdsmessig for tiden jeg har brukt.",
  "consent.error.terms": "Kryss av for at du godtar Brukervilkårene og har lest Personvernerklæringen.",
  "price.month": "{amount} per måned inkl. {vat} % mva. Fornyes automatisk. Si opp når som helst under Konto.",
  "price.year": "{amount} per år inkl. {vat} % mva. Fornyes automatisk. Si opp når som helst under Konto.",
  "price.once": "{amount} inkl. {vat} % mva. for {days} dager. Fornyes ikke.",
  "links.legal": "Vilkår og personvern",
  "links.label": "Juridisk informasjon",
  "cancel.button": "Si opp abonnement",
  "cancel.hint": "Du beholder tilgangen ut perioden du har betalt for.",
};

const en = {
  "doc.terms": "Terms of Service",
  "doc.privacy": "Privacy",
  "doc.purchase-info": "Before you buy",
  "doc.withdrawal-form": "Withdrawal form",
  "doc.cookies": "Cookies",
  "doc.dpa": "Data processing agreement",
  "page.title": "Terms and privacy",
  "page.close": "Close",
  "page.nav": "Legal documents",
  "page.lang": "Norsk",
  "page.langLabel": "Les på norsk",
  "page.loading": "Loading...",
  "page.missing": "Document not found.",
  "page.static": "Printable page",
  "page.back": "To {product}",
  "consent.terms": "I accept the Terms of Service and have read the Privacy Policy",
  "consent.waiver": "I ask for the service to start right away. I understand that my right of withdrawal ends when the service has been fully delivered, and that if I withdraw before then, I pay for the part I have used.",
  "consent.error.terms": "Tick the box to accept the Terms of Service and confirm you have read the Privacy Policy.",
  "price.month": "{amount} per month incl. {vat}% VAT. Renews automatically. Cancel any time under Account.",
  "price.year": "{amount} per year incl. {vat}% VAT. Renews automatically. Cancel any time under Account.",
  "price.once": "{amount} incl. {vat}% VAT for {days} days. Does not renew.",
  "links.legal": "Terms and privacy",
  "links.label": "Legal information",
  "cancel.button": "Cancel subscription",
  "cancel.hint": "You keep access until the end of the period you have paid for.",
};

export const TABLES = { nb, en };

// The app speaks one language (English unless the account's language is complete, see
// access/copy.js), so legal strings follow the app, not the browser. The legal page itself has
// a Norsk / English switch (route lang, or setLegalLang) for reading the other version.
let current = null;
let appDefault = "en";
export function legalLang() {
  return current || appDefault;
}
export function setLegalDefault(lang) {
  appDefault = lang === "nb" ? "nb" : "en";
}
export function setLegalLang(lang) {
  current = lang === "en" || lang === "nb" ? lang : null;
}

export function lt(key, vars = {}, lang = legalLang()) {
  const s = TABLES[lang]?.[key] ?? en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

// "99 kr" / "NOK 99"; decimals only when there are øre.
export function formatNok(amountMinor, lang = legalLang()) {
  const n = amountMinor / 100;
  const text = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return lang === "nb" ? `${text.replace(".", ",")} kr` : `NOK ${text}`;
}

// The line shown right above the pay button.
export function priceSummary(price, lang = legalLang()) {
  if (!price) return "";
  const vat = Math.round((price.vatRate ?? 0.25) * 100);
  const amount = price.currency && price.currency !== "NOK"
    ? new Intl.NumberFormat(lang === "nb" ? "nb-NO" : "en-GB", { style: "currency", currency: price.currency }).format(price.amountMinor / 100)
    : formatNok(price.amountMinor, lang);
  if (price.kind !== "recurring") return lt("price.once", { amount, vat, days: price.accessDays }, lang);
  return lt(price.interval === "year" ? "price.year" : "price.month", { amount, vat }, lang);
}

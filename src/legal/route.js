// The legal page lives in the URL hash, next to the app's own "#view=" links:
//   #/legal                     the Terms, in the browser's language
//   #/legal/privacy/en          one document, in one language
//   #/legal/terms/nb@9-angrerett-for-forbrukere   ... scrolled to a section
import { DOCS } from "./version";

export function parseLegalHash(hash) {
  const m = /^#\/legal(?:\/([a-z-]+))?(?:\/(nb|en))?(?:@([a-z0-9-]+))?\/?$/.exec(hash || "");
  if (!m) return null;
  const doc = m[1] || "terms";
  if (!DOCS.includes(doc)) return { doc, lang: m[2] || null, section: null, missing: true };
  return { doc, lang: m[2] || null, section: m[3] || null, missing: false };
}

export function legalHash(doc, lang, section) {
  return `#/legal/${doc}${lang ? `/${lang}` : ""}${section ? `@${section}` : ""}`;
}

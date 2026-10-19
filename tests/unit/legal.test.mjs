import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderMarkdown, escapeHtml, slugify, docTitle } from "../../src/legal/markdown.js";
import { SELLER, FACTS, fillTemplate, unfilledPlaceholders, isPlaceholder } from "../../src/legal/seller.js";
import { LEGAL_VERSION, DOCS, LANGS } from "../../src/legal/version.js";
import { TABLES, pickLang, lt, priceSummary, formatNok } from "../../src/legal/strings.js";
import { signupBody, checkoutBody } from "../../src/legal/consent.js";
import { parseLegalHash, legalHash } from "../../src/legal/route.js";
import { renderAll, readDoc, OUT_DIR } from "../../scripts/build-legal.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const raw = (doc, lang) => readFileSync(join(ROOT, "src", "legal", "docs", `${doc}.${lang}.md`), "utf8");

// ------------------------------------------------------------ renderer safety

test("markdown: raw HTML in the source is escaped, never rendered", () => {
  const html = renderMarkdown('# Hi <script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n- <b>x</b>\n\n| <i>a</i> | b |\n| --- | --- |\n| <svg onload=alert(1)> | c |');
  assert.ok(!/<script|<img|<svg|<b>|<i>/i.test(html), html);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.ok(!/<[^>]+\son\w+=/i.test(html), "no event handler attribute on any tag");
});

test("markdown: unsafe link targets are dropped, safe ones kept", () => {
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "//evil.example/x", "\" onmouseover=\"alert(1)"]) {
    const html = renderMarkdown(`[click](${bad})`);
    assert.ok(!/href=/.test(html), `${bad} -> ${html}`);
    assert.match(html, /click/);
  }
  assert.match(renderMarkdown("[a](https://x.no/?a=1&b=2)"), /<a href="https:\/\/x\.no\/\?a=1&amp;b=2" rel="noopener noreferrer" target="_blank">a<\/a>/);
  assert.match(renderMarkdown("[m](mailto:a@b.no)"), /href="mailto:a@b\.no"/);
  // an attribute breakout through the URL stays inside the (escaped) attribute value
  const html = renderMarkdown('[x](https://a.no/"onclick=alert(1))');
  assert.ok(!/<a [^>]*\sonclick=/.test(html), html);
});

test("markdown: doc: links go through docHref, default is the in-app hash", () => {
  assert.match(renderMarkdown("[t](doc:terms)"), /href="#\/legal\/terms"/);
  assert.match(renderMarkdown("[t](doc:terms#9-x)", { docHref: (d, a) => `${d}.nb.html${a}` }), /href="terms\.nb\.html#9-x"/);
});

test("markdown: headings with ids, lists, bold, code, quotes, tables, placeholders", () => {
  const html = renderMarkdown("# Tittel\n\n## 9. Angrerett for forbrukere\n\n## 9. Angrerett for forbrukere\n\n- **a**\n- `b`\n\n1. one\n2. two\n\n> quote\n\n| h1 | h2 |\n| --- | --- |\n| c1 | c2 |\n\nFill [FIRMANAVN] here.\n\n---");
  assert.match(html, /<h1 id="tittel">Tittel<\/h1>/);
  assert.match(html, /<h2 id="9-angrerett-for-forbrukere">/);
  assert.match(html, /<h2 id="9-angrerett-for-forbrukere-2">/);
  assert.match(html, /<ul><li><strong>a<\/strong><\/li><li><code>b<\/code><\/li><\/ul>/);
  assert.match(html, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
  assert.match(html, /<blockquote><p>quote<\/p><\/blockquote>/);
  assert.match(html, /<th scope="col">h1<\/th>.*<td>c2<\/td>/s);
  assert.match(html, /<mark class="legal-ph">\[FIRMANAVN\]<\/mark>/);
  assert.match(html, /<hr>/);
  assert.equal(escapeHtml(`<&"'>`), "&lt;&amp;&quot;&#39;&gt;");
  assert.equal(slugify("Personvern og søknad på Ærø"), "personvern-og-soknad-pa-aero");
  assert.equal(docTitle("x\n# **Brukervilkår**\n"), "Brukervilkår");
});

// ------------------------------------------------------------ version and seller

test("LEGAL_VERSION is 2026-10-19 and matches the backend's current_terms_version when the backend is on this box", () => {
  assert.equal(LEGAL_VERSION, "2026-10-19");
  const candidates = ["/opt/repos/argus_wt_vipps/migrations/005_terms_receipts.sql", "/opt/repos/argus-api/migrations/005_terms_receipts.sql"];
  for (const file of candidates.filter(existsSync)) {
    const m = /'current_terms_version',\s*'"([^"]+)"'/.exec(readFileSync(file, "utf8"));
    if (m) assert.equal(m[1], LEGAL_VERSION, file);
  }
  for (const doc of ["terms", "privacy"]) for (const lang of LANGS) assert.match(raw(doc, lang), new RegExp(`(Versjon|Version) ${LEGAL_VERSION}`));
});

test("seller placeholders are flagged until filled in", () => {
  const left = unfilledPlaceholders();
  for (const key of ["name", "orgNr", "address", "email", "vatRegistered"]) assert.ok(left.includes(key), `${key} should still be a placeholder`);
  assert.equal(SELLER.name, "[FIRMANAVN]");
  assert.equal(SELLER.orgNr, "[ORG.NR]");
  assert.equal(SELLER.vatRegistered, "[MVA-REGISTRERT: ja/nei]");
  assert.deepEqual(unfilledPlaceholders({ ...SELLER, name: "Argus AS", email: "hei@argus.no" }).includes("name"), false);
  assert.ok(isPlaceholder("[ADRESSE]") && !isPlaceholder("Storgata 1"));
  assert.equal(fillTemplate("{{seller.name}} / {{facts.trialHours}} / {{seller.nope}}"), "[FIRMANAVN] / 24 / {{seller.nope}}");
  // the rendered documents show the placeholders visibly
  assert.match(renderMarkdown(readDoc("terms", "nb")), /<mark class="legal-ph">\[FIRMANAVN\]<\/mark>/);
});

// ------------------------------------------------------------ documents

test("every document exists in nb and en, is marked as an unreviewed draft, has no dashes and no unfilled template names", () => {
  for (const doc of DOCS) for (const lang of LANGS) {
    const text = raw(doc, lang);
    assert.ok(text.includes("UTKAST / DRAFT: ikke juridisk vurdert"), `${doc}.${lang} draft mark`);
    assert.ok(!/[–—]/.test(text), `${doc}.${lang} has an en or em dash`);
    assert.ok(!/\{\{/.test(readDoc(doc, lang)), `${doc}.${lang} has an unknown {{name}}`);
    assert.ok(docTitle(text), `${doc}.${lang} title`);
  }
});

test("every doc: link and anchor points at a real document and heading", () => {
  for (const doc of DOCS) for (const lang of LANGS) {
    for (const [, target, anchor] of readDoc(doc, lang).matchAll(/\]\(doc:([a-z-]+)(?:#([a-z0-9-]+))?\)/g)) {
      assert.ok(DOCS.includes(target), `${doc}.${lang} links unknown doc ${target}`);
      if (anchor) assert.ok(renderMarkdown(readDoc(target, lang)).includes(`id="${anchor}"`), `${doc}.${lang} -> ${target}#${anchor}`);
    }
  }
});

test("the terms quote the exact waiver text the checkout shows, and name the Account cancel button", () => {
  for (const lang of LANGS) {
    assert.ok(raw("terms", lang).includes(`> ${TABLES[lang]["consent.waiver"]}`), `terms.${lang} waiver quote`);
    assert.ok(raw("terms", lang).includes(`**${TABLES[lang]["cancel.button"]}**`), `terms.${lang} cancel button name`);
  }
});

test("the terms cover the required topics (nb)", () => {
  const t = raw("terms", "nb");
  for (const word of ["angrerettloven", "Forbrukerklageutvalget", "Forbrukertilsynet", "ec.europa.eu/consumers/odr", "norsk lov", "Force majeure", "forbrukerkjøpsloven", "Vipps MobilePay AS", "Stripe", "25 % merverdiavgift", "fornyes automatisk", "Si opp abonnement", "angreskjema", "forholdsmessig"])
    assert.ok(t.toLowerCase().includes(word.toLowerCase()), word);
  const p = raw("privacy", "nb");
  for (const word of ["Datatilsynet", "argus_dev", "argus_sid", "13 år", "18 år", "dataportabilitet", "EØS", "art. 6"]) assert.ok(p.includes(word), word);
  const f = raw("withdrawal-form", "nb");
  for (const line of ["Jeg/Vi (*) underretter herved om at jeg/vi (*) ønsker å gå fra min/vår (*) avtale", "Bestilt den (*) / mottatt den (*)", "(*) Stryk det som ikke passer."]) assert.ok(f.includes(line), line);
});

test("public/legal is up to date with the Markdown (run node scripts/build-legal.mjs)", () => {
  const files = renderAll();
  assert.equal(Object.keys(files).length, DOCS.length * LANGS.length + 1);
  for (const [name, html] of Object.entries(files)) {
    assert.equal(readFileSync(join(OUT_DIR, name), "utf8"), html, `${name} is stale`);
    assert.ok(!/<script/i.test(html), `${name} has no script`);
  }
  assert.match(files["terms.nb.html"], /<html lang="nb">/);
  assert.match(files["terms.nb.html"], /href="withdrawal-form\.nb\.html"/);
  assert.match(files["privacy.en.html"], /href="privacy\.nb\.html" hreflang="nb"/);
});

// ------------------------------------------------------------ strings, consent, route

test("language: Norwegian browsers and unknown get nb, everything else en", () => {
  assert.equal(pickLang(["nb-NO"]), "nb");
  assert.equal(pickLang(["nn"]), "nb");
  assert.equal(pickLang(["no", "en"]), "nb");
  assert.equal(pickLang([]), "nb");
  assert.equal(pickLang(["en-US", "nb"]), "en");
  assert.equal(pickLang("de-DE"), "en");
  assert.deepEqual(Object.keys(TABLES.nb).sort(), Object.keys(TABLES.en).sort(), "both tables have the same keys");
  for (const lang of LANGS) for (const v of Object.values(TABLES[lang])) assert.ok(!/[–—]/.test(v), v);
  assert.equal(lt("doc.terms", {}, "nb"), "Brukervilkår");
  assert.equal(lt("doc.terms", {}, "en"), "Terms of Service");
});

test("price summary line: amount incl. 25 % mva, renews, cancel under Account", () => {
  const month = { kind: "recurring", interval: "month", amountMinor: 9900, currency: "NOK" };
  assert.equal(priceSummary(month, "nb"), "99 kr per måned inkl. 25 % mva. Fornyes automatisk. Si opp når som helst under Konto.");
  assert.equal(priceSummary(month, "en"), "NOK 99 per month incl. 25% VAT. Renews automatically. Cancel any time under Account.");
  assert.equal(priceSummary({ ...month, interval: "year", amountMinor: 99000, vatRate: 0.25 }, "nb"), "990 kr per år inkl. 25 % mva. Fornyes automatisk. Si opp når som helst under Konto.");
  assert.equal(formatNok(12950, "nb"), "129,50 kr");
  assert.equal(priceSummary(null), "");
});

test("request bodies carry terms.version and the withdrawal waiver next to the legacy fields", () => {
  assert.deepEqual(signupBody({ email: "a@b.no", password: "pw", legacyTermsVersion: "2026-10-19-draft" }), {
    email: "a@b.no", password: "pw", displayName: "", acceptTerms: true, termsVersion: "2026-10-19-draft", terms: { version: LEGAL_VERSION },
  });
  assert.deepEqual(checkoutBody({ priceLookupKey: "standard_monthly_nok", legacyTermsVersion: "old", withdrawalWaiver: true }), {
    priceLookupKey: "standard_monthly_nok",
    consent: { startNow: true, termsVersion: "old", withdrawalWaiver: true },
    terms: { version: LEGAL_VERSION },
    withdrawalWaiver: true,
  });
  assert.equal(checkoutBody({ priceLookupKey: "x", withdrawalWaiver: "yes" }).withdrawalWaiver, false, "only a real true counts");
});

test("legal hash route", () => {
  assert.deepEqual(parseLegalHash("#/legal"), { doc: "terms", lang: null, section: null, missing: false });
  assert.deepEqual(parseLegalHash("#/legal/privacy/en"), { doc: "privacy", lang: "en", section: null, missing: false });
  assert.deepEqual(parseLegalHash("#/legal/terms/nb@9-angrerett"), { doc: "terms", lang: "nb", section: "9-angrerett", missing: false });
  assert.equal(parseLegalHash("#/legal/nope").missing, true);
  for (const h of ["", "#view=1,2", "#/legalx", "#legal/terms"]) assert.equal(parseLegalHash(h), null, h);
  assert.equal(legalHash("dpa", "en", "6-sub-processors"), "#/legal/dpa/en@6-sub-processors");
  assert.equal(FACTS.product, "Argus");
});

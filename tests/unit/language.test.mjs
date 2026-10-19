// One language on every screen. The UI is English; a translation is only used when it covers
// every key (a partial table would mix two languages on one screen). The legal page follows the
// app's language and offers its own Norsk / English switch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { en, t, setLocale, getLocale, isComplete } from "../../src/access/copy.js";
import nb from "../../src/access/copy.nb.js";
import { TABLES, legalLang, setLegalDefault, setLegalLang } from "../../src/legal/strings.js";
import { localeOf } from "../../src/cases/copy.js";

const SRC = new URL("../../src/", import.meta.url).pathname;
const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.(jsx?|mjs)$/.test(f) ? [p] : [];
});
const withNavigator = (language, fn) => {
  const prev = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { language, languages: [language] }, configurable: true });
  try { return fn(); } finally { if (prev) Object.defineProperty(globalThis, "navigator", prev); else delete globalThis.navigator; }
};

test("the partial Norwegian deck is never switched on: the UI stays English", () => {
  assert.equal(isComplete("nb"), false, "copy.nb.js is a partial draft");
  assert.equal(setLocale("nb"), "en");
  assert.equal(getLocale(), "en");
  for (const key of Object.keys(en)) assert.equal(t(key), en[key], key);
  setLocale("en");
});

test("no Norwegian string leaks into the English UI", () => {
  setLocale("en");
  const nbOnly = Object.entries(nb).filter(([k, v]) => v !== en[k]).map(([, v]) => v);
  for (const key of Object.keys(en)) assert.ok(!nbOnly.includes(t(key)), `${key} renders Norwegian`);
  for (const v of Object.values(en)) assert.ok(!/[æøåÆØÅ]/.test(v), `Norwegian letters in English copy: ${v}`);
});

test("every copy key a screen asks for exists in English (no raw keys on screen)", () => {
  const missing = [];
  let seen = 0;
  for (const f of files(SRC)) {
    const src = readFileSync(f, "utf8");
    if (!/access\/copy|from "\.\/copy"/.test(src) || /src\/cases\//.test(f)) continue;
    for (const [, key] of src.matchAll(/\bt\("([a-zA-Z0-9_.]+)"/g)) {
      seen++;
      if (!(key in en) && !(`${key}.1` in en)) missing.push(`${f.slice(SRC.length)}: ${key}`);
    }
  }
  assert.ok(seen > 50, `scanned ${seen} keys`);
  assert.deepEqual(missing, []);
});

test("every legal string key used by a screen exists in both languages", () => {
  const missing = [];
  for (const f of files(SRC)) {
    for (const [, key] of readFileSync(f, "utf8").matchAll(/\blt\("([a-zA-Z0-9_.]+)"/g)) {
      for (const lang of ["en", "nb"]) if (!(key in TABLES[lang])) missing.push(`${lang} ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("a Norwegian browser still gets English: access copy, legal strings, case exports", () => {
  withNavigator("nb-NO", () => {
    assert.equal(setLocale("en"), "en");
    assert.equal(legalLang(), "en");
    assert.equal(localeOf(), "en");
  });
  // The legal page's own switch, and an account whose language is complete, still work.
  setLegalLang("nb");
  assert.equal(legalLang(), "nb");
  setLegalLang(null);
  setLegalDefault("nb");
  assert.equal(legalLang(), "nb");
  setLegalDefault("en");
  assert.equal(legalLang(), "en");
});

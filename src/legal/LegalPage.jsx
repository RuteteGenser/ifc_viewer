import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { renderMarkdown, docTitle } from "./markdown";
import { loadDoc } from "./content";
import { legalHash, parseLegalHash } from "./route";
import { DOCS } from "./version";
import { legalLang, lt } from "./strings";
import "./legal.css";

// Shown over everything (also over an open paywall or sign-up dialog, which keep their
// state) while the hash is #/legal/... Closing goes back to where the user was.
export default function LegalRoute() {
  const [route, setRoute] = useState(() => parseLegalHash(typeof window === "undefined" ? "" : window.location.hash));
  const openedInApp = useRef(false);
  useEffect(() => {
    const onHash = () => {
      const next = parseLegalHash(window.location.hash);
      setRoute((prev) => {
        if (!prev && next) openedInApp.current = true;
        if (!next) openedInApp.current = false;
        return next;
      });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  if (!route) return null;
  const close = () => {
    if (openedInApp.current) {
      window.history.back();
      return;
    }
    // Opened straight from a link to #/legal: drop the hash, stay in the app.
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    setRoute(null);
  };
  return <LegalPage route={route} onClose={close} />;
}

// In-page moves (another document, the other language) replace the entry, so one Close
// (or one Back) always returns to the app.
const go = (hash) => window.location.replace(hash);

function LegalPage({ route, onClose }) {
  const lang = route.lang || legalLang();
  const [md, setMd] = useState(undefined); // undefined = loading, null = missing
  const ref = useRef(null);
  const headingRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    let live = true;
    setMd(undefined);
    if (route.missing) setMd(null);
    else loadDoc(route.doc, lang).then((text) => live && setMd(text), () => live && setMd(null));
    return () => { live = false; };
  }, [route.doc, route.missing, lang]);

  const html = useMemo(
    () => (md ? renderMarkdown(md, { docHref: (d, anchor) => legalHash(d, lang, anchor.slice(1)) }) : ""),
    [md, lang],
  );

  // Focus: into the page on open, back to the opener on close. Tab stays inside, Escape closes.
  useEffect(() => {
    const previous = document.activeElement;
    const box = ref.current;
    box.focus();
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === "Tab") {
        const els = [...box.querySelectorAll("a[href], button:not(:disabled)")];
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      e.stopPropagation(); // the viewer's own shortcuts must not fire under the page
    };
    box.addEventListener("keydown", onKey);
    return () => {
      box.removeEventListener("keydown", onKey);
      if (previous && previous.isConnected) previous.focus?.({ preventScroll: true });
    };
  }, []);

  // A new document starts at its top (or at the asked section), with focus on its heading.
  useEffect(() => {
    if (!md) return;
    const target = route.section && ref.current.querySelector(`[id="${route.section}"]`);
    if (target) target.scrollIntoView();
    else ref.current.scrollTop = 0;
    if (document.activeElement === ref.current || !ref.current.contains(document.activeElement)) headingRef.current?.focus({ preventScroll: !!target });
  }, [md, route.section]);

  const onClick = (e) => {
    const a = e.target.closest?.("a[href^='#/legal']");
    if (!a) return;
    e.preventDefault();
    go(a.getAttribute("href"));
  };
  const other = lang === "nb" ? "en" : "nb";
  const title = md ? docTitle(md) : lt("page.title", {}, lang);
  const staticHref = `${import.meta.env.BASE_URL}legal/${route.doc}.${lang}.html`;

  return createPortal(
    <div className="legal-page" role="dialog" aria-modal="true" aria-label={title} lang={lang} ref={ref} tabIndex={-1} onClick={onClick} data-testid="legal-page" data-doc={route.doc}>
      <div className="legal-page__bar">
        <span className="legal-page__brand">{lt("page.title", {}, lang)}</span>
        <a className="legal-page__lang" href={legalHash(route.doc, other)} hrefLang={other} lang={other}>{lt("page.langLabel", {}, lang)}</a>
        <button type="button" className="legal-page__close" onClick={onClose}>{lt("page.close", {}, lang)}</button>
      </div>
      <nav className="legal-page__nav" aria-label={lt("page.nav", {}, lang)}>
        <ul>
          {DOCS.map((d) => (
            <li key={d}><a href={legalHash(d, lang)} aria-current={d === route.doc ? "page" : undefined}>{lt(`doc.${d}`, {}, lang)}</a></li>
          ))}
        </ul>
      </nav>
      <article className="legal-doc">
        {md === undefined && <p role="status">{lt("page.loading", {}, lang)}</p>}
        {md === null && <h1 ref={headingRef} tabIndex={-1}>{lt("page.missing", {}, lang)}</h1>}
        {md && (
          <>
            <h1 ref={headingRef} tabIndex={-1} className="legal-doc__title">{title}</h1>
            {/* renderMarkdown escapes all HTML in the source first (see markdown.js). */}
            <div dangerouslySetInnerHTML={{ __html: html.replace(/^<h1[^>]*>.*?<\/h1>\n?/, "") }} />
            <p className="legal-doc__static"><a href={staticHref} target="_blank" rel="noopener">{lt("page.static", {}, lang)}</a></p>
          </>
        )}
      </article>
    </div>,
    document.body,
  );
}

// Small row of links to the legal pages (paywall, account, library). `docs` picks which.
export function LegalLinks({ docs = ["terms", "privacy"], className = "", lang }) {
  const l = lang || legalLang();
  return (
    <nav className={`legal-links ${className}`.trim()} aria-label={lt("links.label", {}, l)}>
      {docs.map((d) => <a key={d} href={legalHash(d)} className="legal-links__a">{lt(`doc.${d}`, {}, l)}</a>)}
    </nav>
  );
}

// "I accept the Terms of Service and have read the Privacy Policy", with both links.
export function TermsConsentLabel() {
  return (
    <span>
      {lt("consent.terms.before")}
      <a href={legalHash("terms")}>{lt("consent.terms.link1")}</a>
      {lt("consent.terms.middle")}
      <a href={legalHash("privacy")}>{lt("consent.terms.link2")}</a>
      {lt("consent.terms.after")}
    </span>
  );
}

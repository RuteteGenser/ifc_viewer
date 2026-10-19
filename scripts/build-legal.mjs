// Builds the static copies of the legal documents: public/legal/<doc>.<lang>.html
// (served as /app/legal/terms.nb.html, so the landing page can link them without JS)
// and public/legal/index.html. Same Markdown, same renderer as the app.
//
//   node scripts/build-legal.mjs          write the files, list unfilled placeholders
//   node scripts/build-legal.mjs --check  exit 1 if the files are out of date
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderMarkdown, docTitle, escapeHtml } from "../src/legal/markdown.js";
import { fillTemplate, unfilledPlaceholders, FACTS } from "../src/legal/seller.js";
import { DOCS, LANGS, LEGAL_VERSION } from "../src/legal/version.js";
import { lt } from "../src/legal/strings.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = join(ROOT, "src", "legal", "docs");
export const OUT_DIR = join(ROOT, "public", "legal");

const CSS = `:root{--paper:#fbfaf6;--ink:#2a2622;--faint:#72685a;--line:#ddd6c7;--accent:#7d5326;--mark:#fff1a8;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--paper:#1d1b18;--ink:#eee8dc;--faint:#b5aa98;--line:#4a4339;--accent:#e2b77e;--mark:#5a4a10}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:46rem;margin:0 auto;padding:16px 16px 48px;overflow-wrap:anywhere}
header{display:flex;flex-wrap:wrap;gap:4px 16px;align-items:center;justify-content:space-between;max-width:46rem;margin:0 auto;padding:8px 16px;border-bottom:1px solid var(--line)}
nav ul{display:flex;flex-wrap:wrap;gap:0 12px;list-style:none;margin:0;padding:0}
a{color:var(--accent)}header a,nav a{display:inline-flex;align-items:center;min-height:44px}
nav a[aria-current=page]{font-weight:600;color:var(--ink)}
h1{font-family:Georgia,serif;font-size:1.7rem;line-height:1.25;margin:16px 0 8px}h2{font-size:1.2rem;margin:28px 0 8px}h3{font-size:1.05rem}
blockquote{margin:12px 0;padding:8px 12px;border-left:4px solid var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent)}
blockquote p{margin:0}.legal-table{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.95rem}
th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}mark.legal-ph{background:var(--mark);color:inherit}
code{font-size:.92em}footer{max-width:46rem;margin:0 auto;padding:16px;color:var(--faint);font-size:.9rem;border-top:1px solid var(--line)}
@media print{header nav,footer{display:none}}`;

const fileName = (doc, lang) => `${doc}.${lang}.html`;

export function staticPage(doc, lang, md) {
  const other = lang === "nb" ? "en" : "nb";
  const body = renderMarkdown(md, { docHref: (d, anchor) => fileName(d, lang) + anchor });
  const title = docTitle(md);
  const nav = DOCS.map((d) => `<li><a href="${fileName(d, lang)}"${d === doc ? ' aria-current="page"' : ""}>${escapeHtml(lt(`doc.${d}`, {}, lang))}</a></li>`).join("");
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="legal-version" content="${LEGAL_VERSION}">
<title>${escapeHtml(title)} | ${FACTS.product}</title>
<link rel="alternate" hreflang="${other}" href="${fileName(doc, other)}">
<style>${CSS}</style>
</head>
<body>
<header>
<a href="../">${escapeHtml(lt("page.back", { product: FACTS.product }, lang))}</a>
<a href="${fileName(doc, other)}" hreflang="${other}" lang="${other}">${escapeHtml(lt("page.langLabel", {}, lang))}</a>
<nav aria-label="${escapeHtml(lt("page.nav", {}, lang))}"><ul>${nav}</ul></nav>
</header>
<main>
${body}
</main>
<footer>${FACTS.product} · ${escapeHtml(lt("page.title", {}, lang))} · ${LEGAL_VERSION}</footer>
</body>
</html>
`;
}

function indexPage() {
  const list = (lang) => DOCS.map((d) => `<li><a href="${fileName(d, lang)}">${escapeHtml(lt(`doc.${d}`, {}, lang))}</a></li>`).join("");
  return `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(lt("page.title", {}, "nb"))} | ${FACTS.product}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>${escapeHtml(lt("page.title", {}, "nb"))}</h1>
<ul>${list("nb")}</ul>
<h2 lang="en">${escapeHtml(lt("page.title", {}, "en"))}</h2>
<ul lang="en">${list("en")}</ul>
<p><a href="../">${escapeHtml(lt("page.back", { product: FACTS.product }, "nb"))}</a></p>
</main>
</body>
</html>
`;
}

export const readDoc = (doc, lang) => fillTemplate(readFileSync(join(DOCS_DIR, `${doc}.${lang}.md`), "utf8"));

// { "terms.nb.html": "<!doctype html>...", ... }
export function renderAll() {
  const files = { "index.html": indexPage() };
  for (const doc of DOCS) for (const lang of LANGS) files[fileName(doc, lang)] = staticPage(doc, lang, readDoc(doc, lang));
  return files;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const files = renderAll();
  if (process.argv.includes("--check")) {
    const stale = Object.entries(files).filter(([name, html]) => !existsSync(join(OUT_DIR, name)) || readFileSync(join(OUT_DIR, name), "utf8") !== html);
    if (stale.length) {
      console.error(`public/legal is out of date: ${stale.map(([n]) => n).join(", ")}. Run node scripts/build-legal.mjs`);
      process.exit(1);
    }
    console.log("public/legal is up to date");
  } else {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const [name, html] of Object.entries(files)) writeFileSync(join(OUT_DIR, name), html);
    console.log(`wrote ${Object.keys(files).length} files to public/legal`);
  }
  const left = unfilledPlaceholders();
  if (left.length) console.warn(`placeholders still to fill in src/legal/seller.js: ${left.join(", ")}`);
}

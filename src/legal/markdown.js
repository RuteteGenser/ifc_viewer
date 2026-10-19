// A tiny Markdown renderer for the legal documents (no dependencies, used by the app
// and by scripts/build-legal.mjs). Safe by construction: the whole input is HTML-escaped
// FIRST, then only the markup below is turned into tags, and links keep only safe targets.
//
// Supported: # to #### headings (with ids), paragraphs, "- " and "1. " lists (one level),
// "> " quotes, "---" rules, | tables |, **bold**, `code`, [text](url) links and
// [PLACEHOLDER] marks. Links to "doc:<name>" or "doc:<name>#anchor" go through
// options.docHref so the app and the static pages can point at their own copies.

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const SAFE_URL = /^(https?:\/\/|mailto:|#|\/(?!\/))/i;

export function slugify(text) {
  return String(text)
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z0-9#]+;/gi, "")
    .toLowerCase()
    .replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";
}

// `escaped` is already HTML-escaped text of one line or paragraph.
function inline(escaped, options) {
  const codes = [];
  let s = escaped.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    let href = url;
    const doc = /^doc:([a-z-]+)(#[a-z0-9-]+)?$/i.exec(url);
    if (doc) href = options.docHref ? options.docHref(doc[1], doc[2] || "") : `#/legal/${doc[1]}`;
    else if (!SAFE_URL.test(url)) return label; // javascript:, data:, protocol-relative ... are dropped
    const external = /^https?:/i.test(href);
    return `<a href="${href}"${external ? ' rel="noopener noreferrer" target="_blank"' : ""}>${label}</a>`;
  });
  // What is left in square brackets is a placeholder to fill in before launch.
  s = s.replace(/\[([A-ZÆØÅ][^\]<>]*)\]/g, '<mark class="legal-ph">[$1]</mark>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function renderMarkdown(md, options = {}) {
  const lines = escapeHtml(String(md).replace(/\r\n?/g, "\n")).split("\n");
  const out = [];
  const ids = new Set();
  let para = [];
  let list = null; // { tag, items }
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "), options)}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i, options)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  const flush = () => { flushPara(); flushList(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(trimmed))) {
      flush();
      const level = m[1].length;
      const html = inline(m[2], options);
      let id = slugify(html);
      for (let n = 2; ids.has(id); n++) id = `${slugify(html)}-${n}`;
      ids.add(id);
      out.push(`<h${level} id="${id}">${html}</h${level}>`);
      continue;
    }
    if (/^-{3,}$/.test(trimmed)) { flush(); out.push("<hr>"); continue; }
    if (trimmed.startsWith("&gt;")) {
      flush();
      const quote = [];
      while (i < lines.length && lines[i].trim().startsWith("&gt;")) {
        quote.push(lines[i].trim().replace(/^&gt;\s?/, ""));
        i++;
      }
      i--;
      out.push(`<blockquote><p>${inline(quote.join(" "), options)}</p></blockquote>`);
      continue;
    }
    if (trimmed.startsWith("|") && i + 1 < lines.length && /^\|?\s*:?-{3,}/.test(lines[i + 1].trim())) {
      flush();
      const head = cells(trimmed);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      i--;
      out.push(
        `<div class="legal-table"><table><thead><tr>${head.map((c) => `<th scope="col">${inline(c, options)}</th>`).join("")}</tr></thead>` +
          `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, options)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
      );
      continue;
    }
    if ((m = /^([-*]|\d+\.)\s+(.*)$/.exec(trimmed))) {
      flushPara();
      const tag = /\d/.test(m[1]) ? "ol" : "ul";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push(m[2]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ` ${trimmed}`; continue; }
    flushList();
    para.push(trimmed);
  }
  flush();
  return out.join("\n");
}

// The first "# " heading, as plain text (page titles).
export function docTitle(md) {
  const m = /^#\s+(.+)$/m.exec(String(md));
  return m ? m[1].replace(/\*\*/g, "").trim() : "";
}

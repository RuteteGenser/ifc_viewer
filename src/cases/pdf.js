// Case report PDF: pure function buildCasePdf(caseObj, opts) -> Uint8Array. Callers rehydrate snapshot.image / snapshot.thumb first.
import { PdfDocument, dataUrlToBytes, textWidth, wrapText } from "./pdfwriter.js";

export { downloadPdf } from "./pdfwriter.js";

const COPY = {
  en: { comment: "Comment", pin: "Pin", arrow: "Arrow", text: "Text", freehand: "Freehand", page: (x, y) => `Page ${x} of ${y}`,
    model: "Model", storey: "Storey", note: "Note", annotations: "Annotations", contents: "Contents", snapshots: "Snapshots",
    date: "Date", report: "Argus case report", continued: "continued", noImage: "Image not available", untitled: "Snapshot", by: "by" },
  nb: { comment: "Kommentar", pin: "Merke", arrow: "Pil", text: "Tekst", freehand: "Frihånd", page: (x, y) => `Side ${x} av ${y}`,
    model: "Modell", storey: "Etasje", note: "Notat", annotations: "Merknader", contents: "Innhold", snapshots: "Bilder",
    date: "Dato", report: "Argus saksrapport", continued: "forts.", noImage: "Bilde mangler", untitled: "Bilde", by: "av" },
};
const GRAY = "#6b6b6b", RULE = "#b8b8b8", INK = "#1a1a1a";
const M = 40, ROW = 18, COVER_TOC_TOP = 290;

const day = (s) => (s ? String(s).slice(0, 10) : "");
const stamp = (s) => (s ? String(s).slice(0, 16).replace("T", " ") : "");
const clamp = (lines, n) => (lines.length <= n ? lines : [...lines.slice(0, n - 1), lines[n - 1].replace(/.{0,3}$/, "") + "..."]);
function fit(str, width, size, bold) { // single line, truncated with "..."
  let s = String(str ?? "").replace(/\s+/g, " ");
  if (textWidth(s, size, bold) <= width) return s;
  while (s.length > 1 && textWidth(s + "...", size, bold) > width) s = s.slice(0, -1);
  return s + "...";
}

export function buildCasePdf(caseObj, opts = {}) {
  const c = caseObj || {};
  const t = COPY[opts.locale] || COPY.en;
  const snaps = Array.isArray(c.snapshots) ? c.snapshots : [];
  const name = c.name || "Case";
  const model = c.model || {};
  const modelLine = [model.name, model.ifcSchema].filter(Boolean).join(" ");
  const date = day(opts.date || c.updatedAt || c.createdAt);
  const doc = new PdfDocument({ size: opts.pageSize, title: opts.title || name, author: opts.author ?? c.meta?.author ?? "", now: opts.now });
  const W = doc.pageWidth, H = doc.pageHeight, CW = W - 2 * M, BOTTOM = H - 50;
  const wantCover = opts.includeCover ?? snaps.length >= 2;

  const header = (p) => {
    const right = [modelLine, date].filter(Boolean).join("   ");
    const rw = Math.min(textWidth(right, 8.5), CW * 0.55);
    p.text(W - M, 32, fit(right, rw, 8.5), { size: 8.5, color: GRAY, align: "right" });
    p.text(M, 32, fit(name, CW - rw - 12, 9.5, true), { size: 9.5, bold: true });
    p.line(M, 40, W - M, 40, { stroke: RULE });
  };

  // cover page count is needed up front so snapshot page numbers can be listed in the contents
  const cap1 = Math.floor((BOTTOM - COVER_TOC_TOP) / ROW), capN = Math.floor((BOTTOM - 62) / ROW);
  const coverPages = wantCover ? 1 + Math.max(0, Math.ceil((snaps.length - cap1) / capN)) : 0;

  const covers = [];
  for (let k = 0; k < coverPages; k++) { const p = doc.addPage(); header(p); covers.push(p); }

  const startPage = [];
  snaps.forEach((s, idx) => {
    startPage.push(doc.pages.length + 1);
    let p = doc.addPage(); header(p);
    const title = s.title || `${t.untitled} ${idx + 1}`;
    let y = 66;
    const titleLines = clamp(wrapText(title, CW, 15, true), 3);
    titleLines.forEach((l, k) => p.text(M, y + k * 19, l, { size: 15, bold: true }));
    y += titleLines.length * 19 + 2;
    p.text(M, y + 8, [`${idx + 1}/${snaps.length}`, stamp(s.createdAt)].filter(Boolean).join("   "), { size: 8, color: GRAY });
    y += 18;

    let bytes = null, img = null;
    for (const src of [s.image, s.thumb]) {
      if (!src) continue;
      try { bytes = dataUrlToBytes(src); img = doc.addJpeg(bytes); break; } catch { img = null; }
    }
    if (img) {
      let w = CW, h = (CW * img.height) / img.width;
      const maxH = H * 0.55;
      if (h > maxH) { h = maxH; w = (h * img.width) / img.height; }
      p.image(img, M + (CW - w) / 2, y, w, h);
      p.rect(M + (CW - w) / 2, y, w, h, { stroke: RULE });
      y += h + 16;
    } else {
      p.rect(M, y, CW, 60, { stroke: RULE });
      p.text(M + CW / 2, y + 34, t.noImage, { size: 10, color: GRAY, align: "center" });
      y += 76;
    }

    const room = (need) => {
      if (y + need <= BOTTOM) return;
      p = doc.addPage(); header(p);
      p.text(M, 66, fit(`${title} (${t.continued})`, CW, 10, true), { size: 10, bold: true, color: GRAY });
      y = 90;
    };

    const anns = Array.isArray(s.annotations) ? s.annotations : [];
    if (anns.length) {
      room(60);
      p.text(M, y + 9, `${t.annotations} (${anns.length})`, { size: 11, bold: true });
      y += 22;
    }
    anns.forEach((a, k) => {
      const tx = M + 26, tw = CW - 26;
      const label = t[a.type] || a.type || t.comment;
      const bodyLines = a.text ? wrapText(a.text, tw, 10) : [];
      const meta = [a.author ? `${t.by} ${a.author}` : "", stamp(a.createdAt)].filter(Boolean).join(", ");
      const storey = a.anchor?.storey;
      const h = 13 + bodyLines.length * 13 + (meta ? 11 : 0) + 8;
      room(Math.min(h, 120));
      p.circle(M + 9, y + 6, 8.5, { fill: a.color || INK });
      p.text(M + 9, y + 9.2, String(k + 1), { size: 8.5, bold: true, color: "#ffffff", align: "center" });
      p.text(tx, y + 9, label, { size: 9.5, bold: true });
      if (storey) p.text(tx + textWidth(label, 9.5, true) + 10, y + 9, `${t.storey}: ${fit(storey, tw - 90, 9)}`, { size: 9, color: GRAY });
      let ly = y + 22;
      for (const l of bodyLines) {
        if (ly + 3 > BOTTOM) { y = ly - 13; room(30); ly = y + 22; } // very long text: continue on a new page
        if (l) p.text(tx, ly, l, { size: 10 });
        ly += 13;
      }
      if (meta) { p.text(tx, ly - 1, fit(meta, tw, 8), { size: 8, color: GRAY }); ly += 11; }
      y = ly + 2;
    });

    if (s.note && String(s.note).trim()) {
      const lines = wrapText(String(s.note).trim(), CW, 10);
      room(50);
      y += 4;
      p.text(M, y + 9, t.note, { size: 11, bold: true });
      y += 24;
      for (const l of lines) {
        room(16);
        if (l) p.text(M, y, l, { size: 10 });
        y += 13;
      }
    }
  });

  if (wantCover || doc.pages.length === 0) {
    if (!covers.length) { const p = doc.addPage(); header(p); covers.push(p); }
    const p0 = covers[0];
    p0.text(M, 80, t.report, { size: 9, bold: true, color: GRAY });
    const nl = clamp(wrapText(name, CW, 26, true), 3);
    nl.forEach((l, k) => p0.text(M, 116 + k * 32, l, { size: 26, bold: true }));
    let y = 116 + nl.length * 32 + 10;
    for (const [k, v] of [[t.model, modelLine], [t.date, date], [t.snapshots, String(snaps.length)]]) {
      if (!v) continue;
      p0.text(M, y, k, { size: 10, color: GRAY });
      p0.text(M + 80, y, fit(v, CW - 80, 10, true), { size: 10, bold: true });
      y += 16;
    }
    if (snaps.length) p0.text(M, COVER_TOC_TOP - 14, t.contents, { size: 12, bold: true });
    snaps.forEach((s, i) => {
      const onFirst = i < cap1, ci = onFirst ? 0 : 1 + Math.floor((i - cap1) / capN);
      const row = onFirst ? i : (i - cap1) % capN;
      const p = covers[ci], ry = (onFirst ? COVER_TOC_TOP : 62) + row * ROW + 12;
      const label = `${i + 1}.  ${s.title || `${t.untitled} ${i + 1}`}`;
      p.text(M, ry, fit(label, CW - 40, 10), { size: 10 });
      p.text(W - M, ry, String(startPage[i]), { size: 10, align: "right" });
      p.line(M, ry + 5, W - M, ry + 5, { stroke: "#e3e3e3", lineWidth: 0.4 });
    });
  }

  const total = doc.pages.length;
  doc.pages.forEach((p, k) => {
    p.line(M, H - 38, W - M, H - 38, { stroke: RULE });
    p.text(M, H - 24, "Argus", { size: 8.5, color: GRAY });
    p.text(W - M, H - 24, t.page(k + 1, total), { size: 8.5, color: GRAY, align: "right" });
  });
  return doc.build();
}

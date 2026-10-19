// Minimal dependency-free PDF 1.4 writer: Helvetica / Helvetica-Bold (WinAnsi), JPEG (DCT) images.
// Page coordinates are TOP-DOWN in points (y = 0 is the top edge); the writer flips them.

export const PAGE_SIZES = { A4: [595, 842], Letter: [612, 792] };

// ---- WinAnsi (cp1252) ----
const CP1252_HIGH = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
  0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};
const UNICODE_TO_WIN = new Map(Object.entries(CP1252_HIGH).map(([b, u]) => [u, Number(b)]));

/** JS string -> WinAnsi bytes. Unmappable characters become '?'; whitespace controls become a space. */
export function encodeWinAnsi(str) {
  const out = [];
  for (const ch of String(str ?? "")) {
    const c = ch.codePointAt(0);
    if (c === 0x09 || c === 0x0a || c === 0x0d || c === 0xa0) out.push(c === 0xa0 ? 0xa0 : 0x20);
    else if (c >= 0x20 && c < 0x7f) out.push(c);
    else if (c >= 0xa0 && c <= 0xff) out.push(c);
    else if (UNICODE_TO_WIN.has(c)) out.push(UNICODE_TO_WIN.get(c));
    else if (c === 0x2212) out.push(0x2d); // minus sign
    else if (c === 0x200b || c === 0xfe0f || c === 0x200d) continue; // zero-width, variation selector
    else out.push(0x3f);
  }
  return Uint8Array.from(out);
}

// ---- Helvetica AFM widths (1/1000 em), index = WinAnsi code 32..255 ----
function buildWidths(ascii, high, groups) {
  const w = new Array(256).fill(0);
  for (let i = 0; i < ascii.length; i++) w[32 + i] = ascii[i];
  for (const [code, v] of Object.entries(high)) w[code] = v;
  for (const [from, to, v] of groups) for (let c = from; c <= to; c++) w[c] = v;
  return w;
}
// ASCII 32..126
const REG_ASCII = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,
  667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,
  556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const BOLD_ASCII = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,
  722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,
  556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const REG_HIGH = { 128:556,130:222,131:556,132:333,133:1000,134:556,135:556,136:333,137:1000,138:667,139:333,140:1000,142:611,145:222,146:222,147:333,148:333,149:350,150:556,151:1000,152:333,153:1000,154:500,155:333,156:944,158:500,159:667,
  160:278,161:333,162:556,163:556,164:556,165:556,166:260,167:556,168:333,169:737,170:370,171:556,172:584,173:333,174:737,175:333,176:400,177:584,178:333,179:333,180:333,181:556,182:537,183:278,184:333,185:333,186:365,187:556,188:834,189:834,190:834,191:611,
  198:1000,199:722,208:722,209:722,215:584,216:778,221:667,222:667,223:611,230:889,231:500,240:556,241:556,247:584,248:611,253:500,254:556,255:500 };
const BOLD_HIGH = { 128:556,130:278,131:556,132:500,133:1000,134:556,135:556,136:333,137:1000,138:667,139:333,140:1000,142:611,145:278,146:278,147:500,148:500,149:350,150:556,151:1000,152:333,153:1000,154:556,155:333,156:944,158:500,159:667,
  160:278,161:333,162:556,163:556,164:556,165:556,166:280,167:556,168:333,169:737,170:370,171:556,172:584,173:333,174:737,175:333,176:400,177:584,178:333,179:333,180:333,181:611,182:556,183:278,184:333,185:333,186:365,187:556,188:834,189:834,190:834,191:611,
  198:1000,199:722,208:722,209:722,215:584,216:778,221:667,222:667,223:611,230:889,231:556,240:611,241:611,247:584,248:611,253:556,254:611,255:556 };
// accented letter groups share the base letter's width
const REG_GROUPS = [[192,197,667],[200,203,667],[204,207,278],[210,214,778],[217,220,722],[224,229,556],[232,235,556],[236,239,278],[242,246,556],[249,252,556]];
const BOLD_GROUPS = [[192,197,722],[200,203,667],[204,207,278],[210,214,778],[217,220,722],[224,229,556],[232,235,556],[236,239,278],[242,246,611],[249,252,611]];
export const WIDTHS = { regular: buildWidths(REG_ASCII, REG_HIGH, REG_GROUPS), bold: buildWidths(BOLD_ASCII, BOLD_HIGH, BOLD_GROUPS) };

/** Width in points of a string at a font size. */
export function textWidth(str, size, bold = false) {
  const w = bold ? WIDTHS.bold : WIDTHS.regular;
  let sum = 0;
  for (const b of encodeWinAnsi(str)) sum += w[b] || 556;
  return (sum * size) / 1000;
}

/** Word-wrap to maxWidth points. Honors \n, breaks over-long words by character. Always returns >= 1 line. */
export function wrapText(str, maxWidth, size, bold = false) {
  const lines = [];
  for (const para of String(str ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const word of para.split(/ +/)) {
      if (!word) continue;
      const trial = line ? line + " " + word : word;
      if (textWidth(trial, size, bold) <= maxWidth) { line = trial; continue; }
      if (line) { lines.push(line); line = ""; }
      let rest = word;
      while (textWidth(rest, size, bold) > maxWidth && rest.length > 1) {
        let n = 1;
        while (n < rest.length && textWidth(rest.slice(0, n + 1), size, bold) <= maxWidth) n++;
        lines.push(rest.slice(0, n)); rest = rest.slice(n);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

// ---- data URL / JPEG ----
export function dataUrlToBytes(url) {
  const m = /^data:([^,;]*)((?:;[^,;]*)*),(.*)$/s.exec(String(url ?? ""));
  if (!m) throw new Error("Not a data URL");
  if (/;base64/i.test(m[2])) {
    const bin = atob(m[3].replace(/\s/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(decodeURIComponent(m[3]), (c) => c.charCodeAt(0) & 255);
}

/** Read size and color model from a JPEG (baseline, extended or progressive; 8-bit gray or 3-component). */
export function parseJpeg(b) {
  if (!(b instanceof Uint8Array) || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw new Error("Not a JPEG image");
  let i = 2, adobe = null;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m === 0xd9 || m === 0xda) break;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (m === 0xee && len >= 14 && String.fromCharCode(...b.subarray(i + 4, i + 9)) === "Adobe") adobe = b[i + 15];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (m !== 0xc0 && m !== 0xc1 && m !== 0xc2) throw new Error("Unsupported JPEG type (only baseline, extended sequential and progressive Huffman)");
      const precision = b[i + 4], height = (b[i + 5] << 8) | b[i + 6], width = (b[i + 7] << 8) | b[i + 8], comps = b[i + 9];
      if (precision !== 8) throw new Error("Unsupported JPEG precision " + precision);
      if (!width || !height) throw new Error("JPEG has no size");
      if (comps !== 1 && comps !== 3) throw new Error("Unsupported JPEG color model (" + comps + " components); need grayscale or RGB/YCbCr");
      return { width, height, components: comps, colorSpace: comps === 1 ? "DeviceGray" : "DeviceRGB", progressive: m === 0xc2, adobeTransform: adobe };
    }
    i += 2 + len;
  }
  throw new Error("JPEG size marker not found");
}

// ---- output helpers ----
const fmt = (n) => String(Math.round(n * 100) / 100);
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);
/** WinAnsi bytes -> PDF literal string (pure ASCII; high/control bytes octal-escaped). */
function pdfString(bytes) {
  let s = "(";
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += "\\" + String.fromCharCode(b);
    else if (b < 0x20 || b > 0x7e) s += "\\" + b.toString(8).padStart(3, "0");
    else s += String.fromCharCode(b);
  }
  return s + ")";
}
/** PDF text string for the info dictionary: ASCII literal, else UTF-16BE hex. */
function infoString(v) {
  const s = String(v ?? "");
  if (/^[\x20-\x7e]*$/.test(s)) return pdfString(ascii(s));
  let hex = "FEFF";
  for (let k = 0; k < s.length; k++) hex += s.charCodeAt(k).toString(16).padStart(4, "0");
  return "<" + hex.toUpperCase() + ">";
}
function color(c) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c ?? ""));
  const v = m ? m[1] : "000000";
  return [0, 2, 4].map((k) => fmt(parseInt(v.slice(k, k + 2), 16) / 255)).join(" ");
}

export class PdfPage {
  constructor(width, height) { this.width = width; this.height = height; this.ops = []; this.images = new Set(); }
  /** Single line of text at baseline y. opts: size, bold, color, align 'left'|'right'|'center' (x is then the anchor). */
  text(x, y, str, { size = 10, bold = false, color: c = "#000000", align = "left" } = {}) {
    const w = textWidth(str, size, bold);
    const px = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${fmt(size)} Tf ${color(c)} rg ${fmt(px)} ${fmt(this.height - y)} Td ${pdfString(encodeWinAnsi(str))} Tj ET`);
  }
  /** Wrapped paragraph starting with its first baseline at y. Returns {lines, bottom} (bottom = y after the last line). */
  paragraph(x, y, width, str, { size = 10, bold = false, color: c, leading = size * 1.3 } = {}) {
    const lines = wrapText(str, width, size, bold);
    lines.forEach((l, k) => { if (l) this.text(x, y + k * leading, l, { size, bold, color: c }); });
    return { lines, bottom: y + lines.length * leading };
  }
  rect(x, y, w, h, { fill, stroke, lineWidth = 0.5 } = {}) {
    const ops = [`${fmt(x)} ${fmt(this.height - y - h)} ${fmt(w)} ${fmt(h)} re`];
    this.ops.push(this._paint(ops, fill, stroke, lineWidth));
  }
  line(x1, y1, x2, y2, { stroke = "#000000", lineWidth = 0.5 } = {}) {
    this.ops.push(`${color(stroke)} RG ${fmt(lineWidth)} w ${fmt(x1)} ${fmt(this.height - y1)} m ${fmt(x2)} ${fmt(this.height - y2)} l S`);
  }
  circle(cx, cy, r, { fill, stroke, lineWidth = 0.5 } = {}) {
    const k = 0.5523 * r, X = cx, Y = this.height - cy;
    const ops = [`${fmt(X + r)} ${fmt(Y)} m`,
      `${fmt(X + r)} ${fmt(Y + k)} ${fmt(X + k)} ${fmt(Y + r)} ${fmt(X)} ${fmt(Y + r)} c`,
      `${fmt(X - k)} ${fmt(Y + r)} ${fmt(X - r)} ${fmt(Y + k)} ${fmt(X - r)} ${fmt(Y)} c`,
      `${fmt(X - r)} ${fmt(Y - k)} ${fmt(X - k)} ${fmt(Y - r)} ${fmt(X)} ${fmt(Y - r)} c`,
      `${fmt(X + k)} ${fmt(Y - r)} ${fmt(X + r)} ${fmt(Y - k)} ${fmt(X + r)} ${fmt(Y)} c h`];
    this.ops.push(this._paint(ops, fill, stroke, lineWidth));
  }
  _paint(ops, fill, stroke, lineWidth) {
    const pre = (fill ? `${color(fill)} rg ` : "") + (stroke ? `${color(stroke)} RG ${fmt(lineWidth)} w ` : "");
    return pre + ops.join(" ") + (fill && stroke ? " B" : fill ? " f" : " S");
  }
  /** Place a registered image (from PdfDocument.addJpeg) with its top-left corner at x,y. */
  image(img, x, y, w, h) {
    this.images.add(img.name);
    this.ops.push(`q ${fmt(w)} 0 0 ${fmt(h)} ${fmt(x)} ${fmt(this.height - y - h)} cm /${img.name} Do Q`);
  }
}

export class PdfDocument {
  constructor({ size = "A4", title = "", author = "", creator = "Argus", now = new Date() } = {}) {
    [this.pageWidth, this.pageHeight] = PAGE_SIZES[size] || PAGE_SIZES.A4;
    this.info = { title, author, creator, now };
    this.pages = []; this.imgs = [];
  }
  addPage() { const p = new PdfPage(this.pageWidth, this.pageHeight); this.pages.push(p); return p; }
  /** Register JPEG bytes; returns {name, width, height, ...}. Throws a clear Error for unsupported files. */
  addJpeg(bytes) {
    const info = parseJpeg(bytes);
    const img = { ...info, name: "Im" + (this.imgs.length + 1), bytes };
    this.imgs.push(img);
    return img;
  }
  build() {
    const chunks = [], offsets = [];
    let pos = 0;
    const push = (u8) => { chunks.push(u8); pos += u8.length; };
    const obj = (n, head, stream) => {
      offsets[n] = pos;
      push(ascii(`${n} 0 obj\n${head}`));
      if (stream) { push(ascii("\nstream\n")); push(stream); push(ascii("\nendstream")); }
      push(ascii("\nendobj\n"));
    };
    const imgBase = 6, pageBase = imgBase + this.imgs.length, total = pageBase + this.pages.length * 2;
    push(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, `<< /Type /Pages /Count ${this.pages.length} /Kids [${this.pages.map((_, k) => `${pageBase + 2 * k} 0 R`).join(" ")}] >>`);
    obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const d = this.info.now, p2 = (v) => String(v).padStart(2, "0");
    const date = `D:${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
    obj(5, `<< /Title ${infoString(this.info.title)} /Author ${infoString(this.info.author)} /Creator ${infoString(this.info.creator)} /Producer ${infoString("Argus")} /CreationDate (${date}) >>`);
    this.imgs.forEach((im, k) => {
      const parms = im.components === 3 && im.adobeTransform === 0 ? " /DecodeParms << /ColorTransform 0 >>" : "";
      obj(imgBase + k, `<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /${im.colorSpace} /BitsPerComponent 8 /Filter /DCTDecode${parms} /Length ${im.bytes.length} >>`, im.bytes);
    });
    this.pages.forEach((pg, k) => {
      const xo = this.imgs.map((im, j) => [im, j]).filter(([im]) => pg.images.has(im.name)).map(([im, j]) => `/${im.name} ${imgBase + j} 0 R`).join(" ");
      obj(pageBase + 2 * k, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pg.width} ${pg.height}] /Contents ${pageBase + 2 * k + 1} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xo ? ` /XObject << ${xo} >>` : ""} >> >>`);
      const content = ascii(pg.ops.join("\n"));
      obj(pageBase + 2 * k + 1, `<< /Length ${content.length} >>`, content);
    });
    const xref = pos;
    let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let n = 1; n < total; n++) x += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
    push(ascii(x + `trailer\n<< /Size ${total} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
    const out = new Uint8Array(pos);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }
}

/** Save bytes as a file; on iOS-like browsers offer the share sheet first. Browser-only, not unit tested. */
export async function downloadPdf(bytes, filename = "case.pdf") {
  const blob = new Blob([bytes], { type: "application/pdf" });
  try {
    const file = new File([blob], filename, { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPad|iPhone|iPod/.test(navigator.userAgent + (navigator.platform || ""))) {
      await navigator.share({ files: [file], title: filename });
      return "shared";
    }
  } catch (e) {
    if (e && e.name === "AbortError") return "cancelled";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return "downloaded";
}

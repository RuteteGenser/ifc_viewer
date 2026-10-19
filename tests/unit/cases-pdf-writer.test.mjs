import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkStructure } from "./helpers/pdfcheck.mjs";
import { encodeWinAnsi, textWidth, wrapText, parseJpeg, dataUrlToBytes, PdfDocument } from "../../src/cases/pdfwriter.js";

const fx = JSON.parse(readFileSync(new URL("../fixtures/jpegs.json", import.meta.url), "utf8"));
const jpg = (k) => Uint8Array.from(Buffer.from(fx[k], "base64"));
const latin = (u8) => Buffer.from(u8).toString("latin1");

test("WinAnsi: Norwegian letters, accents and punctuation map to cp1252 bytes", () => {
  assert.deepEqual([...encodeWinAnsi("æøåÆØÅ")], [0xe6, 0xf8, 0xe5, 0xc6, 0xd8, 0xc5]);
  assert.deepEqual([...encodeWinAnsi("éèüöäß")], [0xe9, 0xe8, 0xfc, 0xf6, 0xe4, 0xdf]);
  assert.deepEqual([...encodeWinAnsi("€–—‘’“”•…")], [0x80, 0x96, 0x97, 0x91, 0x92, 0x93, 0x94, 0x95, 0x85]);
});
test("WinAnsi: unmappable characters become ?, one per code point; controls become spaces", () => {
  assert.equal(latin(encodeWinAnsi("a☃b")), "a?b");
  assert.equal(latin(encodeWinAnsi("😀")), "?");
  assert.equal(latin(encodeWinAnsi("a\tb\nc")), "a b c");
  assert.equal(latin(encodeWinAnsi(null)), "");
});
test("Helvetica widths match the AFM (regular and bold)", () => {
  assert.equal(textWidth("Hello", 1000), 2278);
  assert.equal(textWidth("Hello", 10), 22.78);
  assert.equal(textWidth(" ", 1000), 278);
  assert.equal(textWidth("æøå", 1000), 889 + 611 + 556);
  assert.equal(textWidth("Hello", 1000, true), 722 + 556 + 278 + 278 + 611);
  assert.equal(textWidth("W", 1000, true), 944);
});
test("wrapText: wraps at word boundaries within the width and keeps explicit newlines", () => {
  const lines = wrapText("one two three four five six seven", textWidth("one two three", 10) + 0.1, 10);
  assert.deepEqual(lines, ["one two three", "four five six", "seven"]);
  assert.deepEqual(wrapText("a\n\nb", 100, 10), ["a", "", "b"]);
  assert.deepEqual(wrapText("", 100, 10), [""]);
});
test("wrapText: over-long words are broken and every line fits", () => {
  const w = 60, lines = wrapText("x".repeat(80) + " end", w, 10);
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(textWidth(l, 10) <= w + 1e-9, l);
  assert.equal(lines.join("").replace(/ /g, ""), "x".repeat(80) + "end");
});
test("JPEG parser: baseline and progressive, grayscale and YCbCr", () => {
  assert.deepEqual(pick(parseJpeg(jpg("gray8"))), { width: 8, height: 8, components: 1, colorSpace: "DeviceGray", progressive: false });
  assert.deepEqual(pick(parseJpeg(jpg("rgb16"))), { width: 16, height: 16, components: 3, colorSpace: "DeviceRGB", progressive: false });
  assert.equal(parseJpeg(jpg("gray8prog")).progressive, true);
  assert.deepEqual(pick(parseJpeg(jpg("rgb16prog"))), { width: 16, height: 16, components: 3, colorSpace: "DeviceRGB", progressive: true });
  assert.equal(parseJpeg(jpg("scene")).width, 800);
});
function pick(i) { const { width, height, components, colorSpace, progressive } = i; return { width, height, components, colorSpace, progressive }; }
test("JPEG parser: rejects non-JPEG, CMYK, lossless and truncated input with clear errors", () => {
  assert.throws(() => parseJpeg(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])), /Not a JPEG/);
  const cmyk = jpg("rgb16").slice(); const i = cmyk.findIndex((b, k) => b === 0xff && cmyk[k + 1] === 0xc0); cmyk[i + 9] = 4;
  assert.throws(() => parseJpeg(cmyk), /color model/);
  const lossless = jpg("rgb16").slice(); lossless[i + 1] = 0xc3;
  assert.throws(() => parseJpeg(lossless), /Unsupported JPEG type/);
  assert.throws(() => parseJpeg(jpg("gray8").slice(0, 6)), /size marker/);
});
test("dataUrlToBytes: base64 and percent-encoded; rejects garbage", () => {
  assert.deepEqual([...dataUrlToBytes("data:application/octet-stream;base64,AQID")], [1, 2, 3]);
  assert.deepEqual([...dataUrlToBytes("data:,%01%02")], [1, 2]);
  assert.throws(() => dataUrlToBytes("http://x/y.jpg"), /data URL/);
  assert.deepEqual(dataUrlToBytes("data:image/jpeg;base64," + fx.gray8), jpg("gray8"));
});

test("PdfDocument: exact xref offsets, Size, Count, info dictionary, JPEG XObject", () => {
  const d = new PdfDocument({ title: "Brannkonsept æøå", author: "Ola (Nordmann)", now: new Date(Date.UTC(2026, 9, 19, 12, 0, 0)) });
  const img = d.addJpeg(jpg("rgb16"));
  const p = d.addPage(); p.text(40, 60, "Hei (verden) \\ æøå", { bold: true }); p.image(img, 40, 100, 100, 100); p.rect(10, 10, 5, 5, { fill: "#ff0000" }); p.line(0, 0, 10, 10); p.circle(50, 50, 5, { fill: "#00ff00", stroke: "#000000" });
  d.addPage();
  const { pages, text } = checkStructure(d.build());
  assert.equal(pages, 2);
  assert.match(text, /\/Creator \(Argus\)/);
  assert.match(text, /\/CreationDate \(D:20261019120000Z\)/);
  assert.match(text, /\/Title <FEFF/);
  assert.match(text, /\/Author \(Ola \\\(Nordmann\\\)\)/);
  assert.match(text, /\/Filter \/DCTDecode/);
  assert.match(text, /\(Hei \\\(verden\\\) \\\\ \\346\\370\\345\) Tj/);
  assert.match(text, /\/MediaBox \[0 0 595 842\]/);
});
test("PdfDocument: Letter size, zero pages still valid", () => {
  const d = new PdfDocument({ size: "Letter" }); d.addPage();
  assert.match(checkStructure(d.build()).text, /\[0 0 612 792\]/);
  checkStructure(new PdfDocument().build());
});

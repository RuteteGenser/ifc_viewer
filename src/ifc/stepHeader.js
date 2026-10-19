// Reads the start of an IFC (STEP, ISO 10303-21) file without parsing it:
// is it STEP at all, and which schema does its header name. Pure functions on
// bytes, used by the page (before an import), the import worker and the
// library download check.
//
// A STEP file may carry comments (/* ... */) anywhere whitespace is allowed,
// including before "ISO-10303-21;" and inside the header, and exporters put
// text such as "converted from FILE_SCHEMA(('IFC2X3'))" in them. Comments are
// therefore blanked out (same length, so offsets still point into the bytes)
// before anything is looked for.

export const HEAD_BYTES = 65536;

const latin1 = new TextDecoder("latin1");

/** The first HEAD_BYTES of `bytes` as text, one character per byte. */
export const headText = (bytes) => latin1.decode(bytes.subarray(0, HEAD_BYTES));

/** `text` with every STEP comment replaced by spaces. Quotes ('...', '' inside) are respected. */
export function blankComments(text) {
  const parts = [];
  let last = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 39) inString = false; // a doubled '' closes and reopens at once
      continue;
    }
    if (c === 39) {
      inString = true;
    } else if (c === 47 && text.charCodeAt(i + 1) === 42) {
      const close = text.indexOf("*/", i + 2);
      const stop = close < 0 ? text.length : close + 2; // an unclosed comment runs to the end of what was read
      parts.push(text.slice(last, i), " ".repeat(stop - i));
      last = stop;
      i = stop - 1;
    }
  }
  parts.push(text.slice(last));
  return parts.join("");
}

// A UTF-8 byte order mark read as latin1, or as a decoded character.
const BOM = /^(?:\xEF\xBB\xBF|﻿)/;

/** Text (already comment-free) starts with the STEP magic, after a BOM and whitespace. */
export const startsAsStep = (clean) => /^\s*ISO-10303-21(?![\w-])/i.test(clean.replace(BOM, ""));

/** The first bytes (up to 64 KB) are a STEP file's start. */
export function hasStepHeader(bytes) {
  return startsAsStep(blankComments(headText(bytes)));
}

/** The first bytes are a ZIP archive's ("PK\3\4", or an empty archive's "PK\5\6"). */
export const isZip = (bytes) => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5) && (bytes[3] === 4 || bytes[3] === 6);

/**
 * Where the header names its schema: the first name inside FILE_SCHEMA((...)),
 * looked for only between HEADER; and ENDSEC; with comments blanked out.
 * @returns {{ name: string, start: number, end: number } | null}  start/end are byte offsets of the name
 */
export function fileSchemaOf(bytes) {
  const clean = blankComments(headText(bytes));
  const header = /\bHEADER\s*;/i.exec(clean);
  if (!header) return null;
  const from = header.index + header[0].length;
  const endsec = /\bENDSEC\s*;/i.exec(clean.slice(from));
  const section = clean.slice(from, endsec ? from + endsec.index : clean.length);
  const m = /\bFILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/i.exec(section);
  if (!m) return null;
  const start = from + m.index + m[0].length - 1 - m[1].length;
  return { name: m[1], start, end: start + m[1].length };
}

/**
 * The schema name is a known one written in lower or mixed case (web-ifc
 * reads it, but @thatopen/fragments compares it case-sensitively and rejects
 * it). Returns what to write over the name, or null when nothing needs doing.
 * @param {Uint8Array} bytes
 * @param {string[]} known  upper-case schema names (web-ifc's SchemaNames, flattened)
 */
export function schemaCaseFix(bytes, known) {
  const found = fileSchemaOf(bytes);
  if (!found) return null;
  const upper = found.name.trim().toUpperCase();
  if (found.name === upper || found.name.trim() !== found.name || !known.includes(upper)) return null;
  return { start: found.start, end: found.end, upper };
}

/** Writes `text` (ASCII) over bytes[start..]; returns what was there, to restore it later. */
export function overwriteAscii(bytes, start, text) {
  const before = latin1.decode(bytes.subarray(start, start + text.length));
  for (let i = 0; i < text.length; i++) bytes[start + i] = text.charCodeAt(i);
  return before;
}

/**
 * Does the DATA section (as far as the first 64 KB show it) hold IFC entities?
 * true: an "#n=IFC...(" line was found; false: the section is there but holds
 * none (only non-IFC entities, or nothing before ENDSEC;); null: cannot tell
 * (no DATA; within the first 64 KB). Used only after the importer failed, to
 * tell a file that is not IFC data from an error of Argus's own.
 */
export function hasIfcEntities(bytes) {
  const clean = blankComments(headText(bytes));
  const data = /\bDATA\s*;/i.exec(clean);
  if (!data) return null;
  const rest = clean.slice(data.index + data[0].length);
  if (/#\d+\s*=\s*IFC[A-Z0-9_]*\s*\(/i.test(rest)) return true;
  if (/#\d+\s*=/.test(rest) || /^\s*ENDSEC\s*;/i.test(rest)) return false;
  return null;
}

// Checks the bytes of a library download before they reach the importer.

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const SHA_LIMIT = 100 * 1048576;

/** First bytes look like an IFC (STEP) file or a ZIP. */
export function hasIfcOrZipMagic(head) {
  const text = new TextDecoder("latin1").decode(head.subarray(0, 64)).replace(/^﻿|^\xEF\xBB\xBF/, "");
  return /^\s*ISO-10303-21/.test(text) || (head[0] === 0x50 && head[1] === 0x4b);
}

/** The sha256 the server states, from its record or the ETag. */
export function expectedSha(record, etag) {
  const fromTag = /^"?([0-9a-f]{64})"?$/i.exec((etag || "").replace(/^W\//, ""))?.[1];
  const s = record?.sha256 || fromTag;
  return s && /^[0-9a-f]{64}$/i.test(s) ? s.toLowerCase() : null;
}

/**
 * @param {{ chunks: Uint8Array[], contentLength: number|null, recordSize: number|null, sha: string|null }} d
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function checkDownload({ chunks, contentLength, recordSize, sha }) {
  const received = chunks.reduce((n, c) => n + c.byteLength, 0);
  if (contentLength && received !== contentLength) return { ok: false, reason: `got ${received} of ${contentLength} bytes` };
  if (recordSize && received !== recordSize) return { ok: false, reason: `got ${received} bytes, expected ${recordSize}` };
  const first = chunks.find((c) => c.byteLength > 0);
  if (!first || !hasIfcOrZipMagic(first)) return { ok: false, reason: "not an IFC or ZIP file" };
  if (sha && received <= SHA_LIMIT && globalThis.crypto?.subtle) {
    const digest = hex(await crypto.subtle.digest("SHA-256", await new Blob(chunks).arrayBuffer()));
    if (digest !== sha) return { ok: false, reason: "checksum mismatch" };
  }
  return { ok: true };
}

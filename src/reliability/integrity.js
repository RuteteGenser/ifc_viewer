// Checks the bytes of a library download before they reach the importer.
import { HEAD_BYTES, hasStepHeader, isZip } from "../ifc/stepHeader.js";

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const SHA_LIMIT = 100 * 1048576;

/** First bytes (up to 64 KB: a long leading comment is allowed) look like an IFC (STEP) file or a ZIP. */
export function hasIfcOrZipMagic(head) {
  return isZip(head) || hasStepHeader(head);
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
  // The first 64 KB may span several small chunks.
  const head = new Uint8Array(Math.min(HEAD_BYTES, received));
  let filled = 0;
  for (const c of chunks) {
    if (filled >= head.length) break;
    const part = c.subarray(0, head.length - filled);
    head.set(part, filled);
    filled += part.length;
  }
  if (filled === 0 || !hasIfcOrZipMagic(head.subarray(0, filled))) return { ok: false, reason: "not an IFC or ZIP file" };
  if (sha && received <= SHA_LIMIT && globalThis.crypto?.subtle) {
    const digest = hex(await crypto.subtle.digest("SHA-256", await new Blob(chunks).arrayBuffer()));
    if (digest !== sha) return { ok: false, reason: "checksum mismatch" };
  }
  return { ok: true };
}

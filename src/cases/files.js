// Case files: `<slug>.argus-case.json`. Pure apart from Blob/File reading.
import { validateCase } from "./schema";
import { newId } from "./ids";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const IMAGE_DROP_BYTES = 15 * 1024 * 1024;
export const FILE_SUFFIX = ".argus-case.json";

const DE = { "æ": "ae", "ø": "o", "å": "a", "ä": "a", "ö": "o", "ü": "u", "ß": "ss", "đ": "d", "ð": "d", "þ": "th" };

// Lowercase ASCII slug: æ->ae, ø->o, å->a (also ä ö ü ß), other accents stripped, any run of
// non letters/digits becomes one "-", trimmed, max 60 chars, "case" when nothing is left.
// "Brannkonsept 2. etasje æøå" -> "brannkonsept-2-etasje-aeoa"
export function slugify(name) {
  const s = String(name ?? "").toLowerCase().replace(/[æøåäöüßđðþ]/g, (c) => DE[c])
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return s || "case";
}

const byteLength = (s) => new TextEncoder().encode(s).length;

// images (optional): { [snapshotId]: { thumb, image } } merged over the case's own fields.
// Returns { blob, filename, warnings }. Over IMAGE_DROP_BYTES the full-size images are dropped (thumbs stay).
export function buildCaseExport(c, images = {}) {
  const warnings = [];
  const merged = { ...c, snapshots: (c.snapshots || []).map((s) => ({ ...s, ...(images[s.id] || {}) })) };
  let text = JSON.stringify(merged);
  if (byteLength(text) > IMAGE_DROP_BYTES) {
    merged.snapshots = merged.snapshots.map((s) => ({ ...s, image: null }));
    text = JSON.stringify(merged);
    warnings.push("The case was over 15 MB, so full-size images were left out. Thumbnails and annotations are kept.");
  }
  const blob = new Blob([text], { type: "application/json" });
  if (blob.size > MAX_FILE_BYTES) warnings.push("The file is still over 25 MB and may not import.");
  return { blob, filename: slugify(c.name) + FILE_SUFFIX, warnings };
}
export const exportCaseFile = (c, images) => buildCaseExport(c, images).blob;

export class CaseFileError extends Error {
  constructor(message, errors = []) { super(message); this.name = "CaseFileError"; this.errors = errors; }
}

// fileOrText: File | Blob | string. opts.existingIds: iterable of case ids already on the device.
export async function importCaseFile(fileOrText, { existingIds = [] } = {}) {
  let text;
  if (typeof fileOrText === "string") {
    if (byteLength(fileOrText) > MAX_FILE_BYTES) throw new CaseFileError("That file is larger than 25 MB.");
    text = fileOrText;
  } else if (fileOrText && typeof fileOrText.text === "function") {
    if (fileOrText.size > MAX_FILE_BYTES) throw new CaseFileError("That file is larger than 25 MB.");
    text = await fileOrText.text();
  } else throw new CaseFileError("No file to import.");

  let raw;
  try { raw = JSON.parse(text); } catch { throw new CaseFileError("That file is not valid JSON."); }
  const v = validateCase(raw);
  if (!v.ok) throw new CaseFileError(v.errors[0], v.errors);
  const warnings = [...v.warnings];
  const c = v.case;

  if (byteLength(text) > IMAGE_DROP_BYTES) {
    c.snapshots.forEach((s) => { s.image = null; });
    warnings.push("The case was over 15 MB, so full-size images were left out.");
  }
  const taken = existingIds instanceof Set ? existingIds : new Set(existingIds);
  if (taken.has(c.id)) {
    let id = newId();
    while (taken.has(id)) id = newId();
    c.id = id;
    warnings.push("A case with this id already exists on this device, so it was imported as a new copy.");
  }
  return { case: c, warnings };
}

// Why an import failed, and what to tell the user. Plain functions, no DOM:
// the import worker, the page and the tests all use them.
//
// The one rule: only INVALID_FILE may say the file is not valid IFC. Every
// other failure is Argus's own, the device's or the network's problem.

export const KIND = Object.freeze({
  INVALID_FILE: "INVALID_FILE", // the importer read the content and rejected it
  APP_ASSET_FAILED: "APP_ASSET_FAILED", // a chunk, worker script, schema table or wasm did not load
  WORKER_CRASHED: "WORKER_CRASHED", // the import worker died after it had started
  OUT_OF_MEMORY: "OUT_OF_MEMORY",
  TIMEOUT: "TIMEOUT",
  CANCELLED: "CANCELLED",
  DOWNLOAD_INCOMPLETE: "DOWNLOAD_INCOMPLETE", // library bytes did not match size, header or checksum
  FILE_UNREADABLE: "FILE_UNREADABLE", // the browser could not read the picked file from disk
  UNKNOWN: "UNKNOWN",
});

export class ImportError extends Error {
  constructor(kind, message, { stage, cause } = {}) {
    super(message);
    this.name = "ImportError";
    this.kind = kind;
    this.stage = stage;
    if (cause) this.cause = cause;
  }
}

// Texts the browser and emscripten produce when a file Argus ships did not arrive.
const ASSET_FAILURE =
  /dynamically imported module|Failed to fetch|importScripts|NetworkError|Load failed|error loading dynamically|MIME type|expected magic word|WebAssembly\.(instantiate|compile|instantiateStreaming)|CompileError|LinkError|wasm streaming|fetching of the wasm failed|prepare wasm|Unexpected token '<'|Unexpected end of (input|JSON)/i;
const MEMORY_FAILURE = /out of memory|allocation failed|Array buffer allocation|Invalid array length|Cannot enlarge memory|WebAssembly\.Memory|\bOOM\b/i;

/**
 * @param {unknown} err
 * @param {"read"|"schema"|"parse"|"build"} stage  where in the import it was thrown
 * @returns {string} a KIND
 */
export function classifyFailure(err, stage) {
  const text = `${err?.name ?? ""} ${err?.message ?? err ?? ""}`;
  if (MEMORY_FAILURE.test(text)) return KIND.OUT_OF_MEMORY;
  if (ASSET_FAILURE.test(text)) return KIND.APP_ASSET_FAILED;
  if (stage === "read") return KIND.FILE_UNREADABLE;
  if (stage === "schema") return KIND.APP_ASSET_FAILED; // nothing about the file is involved yet
  if (stage === "parse") return KIND.INVALID_FILE;
  return KIND.UNKNOWN;
}

// Page side: turn whatever the import promise rejected with into an ImportError.
export function toImportError(err) {
  if (err instanceof ImportError) return err;
  const message = String(err?.message ?? err);
  if (message === "cancelled") return new ImportError(KIND.CANCELLED, message);
  if (message === "timeout") return new ImportError(KIND.TIMEOUT, message);
  return new ImportError(classifyFailure(err, "build"), message, { stage: "build", cause: err });
}

// Worth one automatic retry with a fresh worker.
export const isRetryable = (kind) => kind === KIND.APP_ASSET_FAILED || kind === KIND.WORKER_CRASHED;

const oneLine = (text, max = 140) => {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * The sentence the user reads.
 * @param {{kind:string,message?:string}} error
 * @param {{name:string, reloading?:boolean, retried?:boolean, staleBuild?:boolean}} ctx
 */
export function describeFailure(error, { name, reloading = false, retried = false, staleBuild = false } = {}) {
  switch (error.kind) {
    case KIND.INVALID_FILE:
      return `"${name}" is not a valid IFC file: ${oneLine(error.message) || "the importer rejected it"}.`.replace(/\.\.$/, ".");
    case KIND.APP_ASSET_FAILED:
      if (reloading) return "Argus could not load part of itself (probably a new version was released). Reloading…";
      return staleBuild
        ? "A new version of Argus was released and this page is out of date. Reload to continue."
        : "Argus could not load part of itself. Check your connection, then retry or reload the page.";
    case KIND.WORKER_CRASHED:
      return retried
        ? "The importer stopped unexpectedly again. Retry, or reload the page."
        : "The importer stopped unexpectedly. Trying again…";
    case KIND.OUT_OF_MEMORY:
      return `Not enough memory to open "${name}" on this device. Close other tabs or try a smaller model.`;
    case KIND.TIMEOUT:
      return `"${name}" is taking too long to open. It may be too large for this device. You can retry or pick a smaller file.`;
    case KIND.DOWNLOAD_INCOMPLETE:
      return "The download was incomplete. Try again.";
    case KIND.FILE_UNREADABLE:
      return `Could not read "${name}" from this device. Is the file still there?`;
    default:
      return `Something went wrong opening "${name}". Retry, or open Details for the technical message.`;
  }
}

// Short text for a bug report, shown under "Details" and copyable.
export function failureDetails(error, { name, buildId, userAgent } = {}) {
  return [
    `kind: ${error.kind}`,
    error.stage ? `stage: ${error.stage}` : null,
    `file: ${name ?? "?"}`,
    `message: ${oneLine(error.message, 400)}`,
    `build: ${buildId ?? "unknown"}`,
    `agent: ${userAgent ?? "unknown"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

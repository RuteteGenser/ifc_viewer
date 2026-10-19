// Main-thread side of ifcImportWorker.js: converts IFC bytes (or a File) into
// fragments data in a dedicated worker. Each import gets its own worker, which
// is terminated when it finishes, fails or is cancelled.

import { ImportError, KIND } from "../reliability/importErrors";

let spare = null;
let releaseWarm = null; // resolves the pending prewarm promise

function createWorker() {
  const worker = new Worker(new URL("./ifcImportWorker.js", import.meta.url), { type: "module" });
  // The worker's first message says its own code started (see ifcImportWorker.js).
  // Kept on the object because a prewarmed worker says it before an import exists.
  worker.addEventListener("message", (event) => {
    if (event.data?.type !== "alive") return;
    worker.alive = true;
    worker.lock = event.data.lock;
    worker.onAlive?.();
  });
  return worker;
}

// Starts one idle worker ahead of time, so its code is already downloaded and
// parsed when the first file is opened. Does nothing if one is waiting.
// `schema` (a web-ifc schema id) also fetches that schema's tables inside the
// worker. Returns a promise that resolves once the worker has booted (and
// fetched them), or at once if there was nothing to do or it failed.
// Memory is tight: stop the idle worker (its wasm heap goes with it).
export function releaseImporterMemory() {
  spare?.terminate();
  spare = null;
}

export function prewarmIfcImporter(schema) {
  if (spare) return Promise.resolve();
  try {
    const worker = createWorker();
    spare = worker;
    return new Promise((resolve) => {
      releaseWarm = resolve;
      worker.addEventListener("message", (event) => event.data?.type === "warmed" && resolve());
      worker.addEventListener("error", () => {
        // A worker that failed to start must not be handed to the next import.
        if (spare === worker) spare = null;
        worker.terminate();
        resolve();
      });
      worker.postMessage({ type: "warm", schema });
    });
  } catch {
    spare = null;
    return Promise.resolve();
  }
}

/**
 * @param {object} input    { file } or { bytes } (bytes are transferred to the worker)
 * @param {object} options  { wasm, webIfcSettings, doubleSidedMaterials, onProgress(fraction, stage), fresh, stallMs, allSchemas }
 *                          fresh: never reuse the prewarmed worker (a retry after a failure)
 *                          stallMs: no sign of life from the worker for this long means it is stuck;
 *                          the import then fails with TIMEOUT so the caller can restart it
 *                          allSchemas: load every schema's tables, not only the one the header names
 * @returns {{ promise: Promise<{ fragments: Uint8Array, source: Uint8Array }>, cancel: () => void }}
 */
export function importIfcInWorker(input, options) {
  if (options.fresh && spare) spare.terminate();
  const worker = (!options.fresh && spare) || createWorker();
  spare = null;
  releaseWarm?.(); // a file arrived first: nothing left to wait for
  releaseWarm = null;
  let settled = false;
  let rejectPromise;
  let stallTimer = 0;
  // Ends the import with `error` and gets rid of the worker.
  const fail = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(stallTimer);
    worker.terminate();
    prewarmIfcImporter();
    rejectPromise(error);
  };
  // Any sign of life (a message from the worker) pushes the stall deadline back.
  const touch = () => {
    if (!options.stallMs || settled) return;
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => fail(new ImportError(KIND.TIMEOUT, `No sign of life for ${Math.round(options.stallMs / 1000)} s`)), options.stallMs);
  };
  // The worker holds a Web Lock while it lives (see ifcImportWorker.js); asking
  // for the same lock is only granted once the worker is gone, however it died.
  const watchLock = () => {
    if (!worker.lock || !navigator.locks) return;
    navigator.locks.request(worker.lock, () => {
      fail(new ImportError(KIND.WORKER_CRASHED, "The import worker was stopped unexpectedly."));
    });
  };
  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject;
    worker.onmessage = (event) => {
      const msg = event.data;
      touch();
      if (msg.type === "alive" || msg.type === "warmed") return;
      if (msg.type === "progress") {
        options.onProgress?.(msg.progress, msg.process);
        return;
      }
      if (settled) return;
      settled = true;
      clearTimeout(stallTimer);
      worker.terminate();
      prewarmIfcImporter();
      if (msg.type === "done") resolve({ fragments: msg.fragments, source: msg.source });
      else reject(new ImportError(msg.kind ?? KIND.UNKNOWN, msg.message, { stage: msg.stage, diag: msg.diag }));
    };
    worker.onerror = (event) => {
      const message = event.message || (worker.alive ? "The import worker crashed." : "The import worker could not start.");
      fail(new ImportError(worker.alive ? KIND.WORKER_CRASHED : KIND.APP_ASSET_FAILED, message));
    };
    worker.onAlive = () => {
      touch();
      watchLock();
    };
    if (worker.alive) watchLock();
    touch();
    const { wasm, webIfcSettings, doubleSidedMaterials, allSchemas } = options;
    worker.postMessage(
      { ...input, wasm, webIfcSettings, doubleSidedMaterials, allSchemas: !!allSchemas },
      input.bytes ? [input.bytes.buffer] : [],
    );
  });
  const cancel = () => fail(new Error("cancelled"));
  return { promise, cancel };
}

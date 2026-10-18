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
  worker.addEventListener("message", (event) => event.data?.type === "alive" && (worker.alive = true));
  return worker;
}

// Starts one idle worker ahead of time, so its code is already downloaded and
// parsed when the first file is opened. Does nothing if one is waiting.
// `schema` (a web-ifc schema id) also fetches that schema's tables inside the
// worker. Returns a promise that resolves once the worker has booted (and
// fetched them), or at once if there was nothing to do or it failed.
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
 * @param {object} options  { wasm, webIfcSettings, doubleSidedMaterials, onProgress(fraction, stage), fresh }
 *                          fresh: never reuse the prewarmed worker (a retry after a failure)
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
  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject;
    worker.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === "alive" || msg.type === "warmed") return;
      if (msg.type === "progress") {
        options.onProgress?.(msg.progress, msg.process);
        return;
      }
      settled = true;
      worker.terminate();
      prewarmIfcImporter();
      if (msg.type === "done") resolve({ fragments: msg.fragments, source: msg.source });
      else reject(new ImportError(msg.kind ?? KIND.UNKNOWN, msg.message, { stage: msg.stage }));
    };
    worker.onerror = (event) => {
      settled = true;
      worker.terminate();
      prewarmIfcImporter();
      const message = event.message || (worker.alive ? "The import worker crashed." : "The import worker could not start.");
      reject(new ImportError(worker.alive ? KIND.WORKER_CRASHED : KIND.APP_ASSET_FAILED, message));
    };
    const { wasm, webIfcSettings, doubleSidedMaterials } = options;
    worker.postMessage(
      { ...input, wasm, webIfcSettings, doubleSidedMaterials },
      input.bytes ? [input.bytes.buffer] : [],
    );
  });
  const cancel = () => {
    if (settled) return;
    settled = true;
    worker.terminate();
    prewarmIfcImporter();
    rejectPromise(new Error("cancelled"));
  };
  return { promise, cancel };
}

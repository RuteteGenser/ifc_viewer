// Main-thread side of ifcImportWorker.js: converts IFC bytes (or a File) into
// fragments data in a dedicated worker. Each import gets its own worker, which
// is terminated when it finishes, fails or is cancelled.

let spare = null;

function createWorker() {
  return new Worker(new URL("./ifcImportWorker.js", import.meta.url), { type: "module" });
}

// Starts one idle worker ahead of time, so its code is already downloaded and
// parsed when the first file is opened. Does nothing if one is waiting.
export function prewarmIfcImporter() {
  if (spare) return;
  try {
    spare = createWorker();
  } catch {
    spare = null;
  }
}

/**
 * @param {object} input    { file } or { bytes } (bytes are transferred to the worker)
 * @param {object} options  { wasm, webIfcSettings, doubleSidedMaterials, onProgress(fraction, stage) }
 * @returns {{ promise: Promise<{ fragments: Uint8Array, source: Uint8Array }>, cancel: () => void }}
 */
export function importIfcInWorker(input, options) {
  const worker = spare ?? createWorker();
  spare = null;
  let settled = false;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject;
    worker.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === "progress") {
        options.onProgress?.(msg.progress, msg.process);
        return;
      }
      settled = true;
      worker.terminate();
      prewarmIfcImporter();
      if (msg.type === "done") resolve({ fragments: msg.fragments, source: msg.source });
      else reject(new Error(msg.message));
    };
    worker.onerror = (event) => {
      settled = true;
      worker.terminate();
      prewarmIfcImporter();
      reject(new Error(event.message || "The import worker crashed."));
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

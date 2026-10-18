// Runs the IFC -> fragments conversion (web-ifc wasm, the slow part of
// opening a model) off the main thread, so the UI keeps responding while a
// big file loads. One import per worker; the client terminates it afterwards
// so the wasm heap is released and Cancel can simply kill it.
import { IfcImporter } from "@thatopen/fragments";
import { loadSchema, loadSchemaFor } from "./ifcSchemas";
import { classifyFailure } from "../reliability/importErrors";

// Static imports above have loaded: the page tells a worker that never got
// here (a file of Argus's own failed to load) from one that died later.
// The worker also holds a Web Lock for as long as it lives. A killed worker
// (terminate, the OS reclaiming memory) sends nothing, but its lock is
// released at once, which is how the page notices (see ifcImportClient.js).
// A busy worker cannot run timers, so a heartbeat would not work; a lock does.
const lockName = `argus-import-${Math.random().toString(36).slice(2)}`;
if (self.navigator?.locks) {
  self.navigator.locks.request(lockName, () => {
    self.postMessage({ type: "alive", lock: lockName });
    return new Promise(() => {}); // held until the worker is gone
  });
} else {
  self.postMessage({ type: "alive" });
}

self.onmessage = async (event) => {
  // Prewarm: the page has started this worker ahead of the first file; fetch
  // the schema tables that file will most likely need, then say so.
  if (event.data.type === "warm") {
    if (event.data.schema) await loadSchema(event.data.schema).catch(() => {});
    self.postMessage({ type: "warmed" });
    return;
  }
  const { file, bytes, wasm, webIfcSettings, doubleSidedMaterials } = event.data;
  // Where a failure happened decides what it means (see classifyFailure).
  let stage = "read";
  try {
    // A File is read here, in the worker, so the main thread never has to
    // allocate or copy the whole file. The bytes go back to the page at the
    // end (transferred, not copied): "Save as .ifcZIP" and the raw property
    // lookups need the original file.
    const source = bytes ?? new Uint8Array(await file.arrayBuffer());
    // web-ifc's per-schema class tables are separate chunks (see ifcSchemas.js);
    // the one this file uses must be in before it is opened.
    stage = "schema";
    await loadSchemaFor(source);
    stage = "parse";
    const importer = new IfcImporter();
    importer.wasm = wasm;
    if (webIfcSettings) importer.webIfcSettings = webIfcSettings;
    importer.doubleSidedMaterials = !!doubleSidedMaterials;
    // Keep IfcBuildingStorey.Elevation as the file states it (project-relative,
    // in the file's unit). The default replaces it with a world-space value in
    // metres that includes the site placement (131 m on skolebygg).
    importer.replaceStoreyElevation = false;
    const fragments = await importer.process({
      bytes: source,
      progressCallback: (progress, info) => self.postMessage({ type: "progress", progress, process: info?.process }),
    });
    self.postMessage({ type: "done", fragments, source }, [fragments.buffer, source.buffer]);
  } catch (err) {
    self.postMessage({ type: "error", kind: classifyFailure(err, stage), stage, message: String(err?.message ?? err) });
  }
};

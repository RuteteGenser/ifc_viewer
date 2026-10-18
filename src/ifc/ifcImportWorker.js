// Runs the IFC -> fragments conversion (web-ifc wasm, the slow part of
// opening a model) off the main thread, so the UI keeps responding while a
// big file loads. One import per worker; the client terminates it afterwards
// so the wasm heap is released and Cancel can simply kill it.
import { IfcImporter } from "@thatopen/fragments";
import { loadSchema, loadSchemaFor } from "./ifcSchemas";

self.onmessage = async (event) => {
  // Prewarm: the page has started this worker ahead of the first file; fetch
  // the schema tables that file will most likely need, then say so.
  if (event.data.type === "warm") {
    if (event.data.schema) await loadSchema(event.data.schema).catch(() => {});
    self.postMessage({ type: "warmed" });
    return;
  }
  const { file, bytes, wasm, webIfcSettings, doubleSidedMaterials } = event.data;
  try {
    // A File is read here, in the worker, so the main thread never has to
    // allocate or copy the whole file. The bytes go back to the page at the
    // end (transferred, not copied): "Save as .ifcZIP" and the raw property
    // lookups need the original file.
    const source = bytes ?? new Uint8Array(await file.arrayBuffer());
    // web-ifc's per-schema class tables are separate chunks (see ifcSchemas.js);
    // the one this file uses must be in before it is opened.
    await loadSchemaFor(source);
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
    self.postMessage({ type: "error", message: String(err?.message ?? err) });
  }
};

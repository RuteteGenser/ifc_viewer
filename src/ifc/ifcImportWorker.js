// Runs the IFC -> fragments conversion (web-ifc wasm, the slow part of
// opening a model) off the main thread, so the UI keeps responding while a
// big file loads. One import per worker; the client terminates it afterwards
// so the wasm heap is released and Cancel can simply kill it.
import { IfcImporter } from "@thatopen/fragments";

self.onmessage = async (event) => {
  const { file, bytes, wasm, webIfcSettings, doubleSidedMaterials } = event.data;
  try {
    // A File is read here, in the worker, so the main thread never has to
    // allocate or copy the whole file. The bytes go back to the page at the
    // end (transferred, not copied): "Save as .ifcZIP" and the raw property
    // lookups need the original file.
    const source = bytes ?? new Uint8Array(await file.arrayBuffer());
    const importer = new IfcImporter();
    importer.wasm = wasm;
    if (webIfcSettings) importer.webIfcSettings = webIfcSettings;
    importer.doubleSidedMaterials = !!doubleSidedMaterials;
    const fragments = await importer.process({
      bytes: source,
      progressCallback: (progress, info) => self.postMessage({ type: "progress", progress, process: info?.process }),
    });
    self.postMessage({ type: "done", fragments, source }, [fragments.buffer, source.buffer]);
  } catch (err) {
    self.postMessage({ type: "error", message: String(err?.message ?? err) });
  }
};

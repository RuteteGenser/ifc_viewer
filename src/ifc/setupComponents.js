import { FragmentsModels, IfcImporter } from "@thatopen/fragments";
// Local worker asset so the app never depends on a CDN at runtime.
import { prewarmIfcImporter } from "./ifcImportClient";
import fragmentsWorkerUrl from "@thatopen/fragments/worker?url";
import { loadSchema, loadSchemaFor } from "./ifcSchemas";

/**
 * Creates the (non-visual) IFC parsing pipeline, returned in the shape the
 * viewer hook uses: `fragments.core` is the fragments engine (its models
 * stream to a local worker), `ifcLoader.load` converts IFC bytes with the
 * local web-ifc wasm copied into /public/wasm and hands the result to that
 * engine, and `components.dispose` tears the engine down.
 *
 * This talks to @thatopen/fragments directly instead of going through
 * @thatopen/components. That package is a 420 kB toolkit (cameras, raycasters,
 * clipper, ...) of which the viewer used only three thin wrappers, which are
 * re-created below; leaving it out saves about 120 kB of gzip on every first
 * visit.
 */
export async function createIfcPipeline() {
  const core = new FragmentsModels(fragmentsWorkerUrl);
  const wasm = { path: `${import.meta.env.BASE_URL}wasm/`, absolute: true };

  const fragments = { core, get list() { return core.models.list; } };

  const ifcLoader = {
    // Same steps as OBC.IfcLoader.load: convert in the importer, then load
    // the converted bytes into the fragments engine under `name`.
    async load(data, coordinate, name, config) {
      await loadSchemaFor(data);
      core.settings.autoCoordinate = coordinate;
      const importer = new IfcImporter();
      importer.wasm.path = wasm.path;
      importer.wasm.absolute = wasm.absolute;
      importer.webIfcSettings = { COORDINATE_TO_ORIGIN: true };
      config?.instanceCallback?.(importer);
      const bytes = await importer.process({ ...config?.processData, bytes: data });
      return core.load(bytes, { modelId: name, userData: config?.userData });
    },
  };

  const components = {
    dispose() {
      core.dispose();
    },
  };

  return { components, fragments, ifcLoader };
}

// Starts downloading the schema code for IFC4 (the sample's schema) ahead of
// the first file, so opening it does not wait for that chunk.
export function warmIfc4Schema() {
  return loadSchema(2).catch(() => {});
}

// main.jsx calls startIfcPipeline() before React renders so the heavy
// @thatopen / web-ifc chunk downloads and boots in parallel with the UI;
// the viewer hook then claims that pipeline (or builds one if none was
// started). A claimed pipeline is never shared, so the hook can dispose it.
let early = null;

export function startIfcPipeline() {
  early = createIfcPipeline();
  // Once the engine is up, not before, so the importer's own download does
  // not compete with it on a slow link.
  early.then(prewarmIfcImporter, () => {});
}

export function takeIfcPipeline() {
  const pipeline = early ?? createIfcPipeline();
  early = null;
  return pipeline;
}

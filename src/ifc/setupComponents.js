import { FragmentsModels } from "@thatopen/fragments";
// Local worker asset so the app never depends on a CDN at runtime.
import fragmentsWorkerUrl from "@thatopen/fragments/worker?url";

/**
 * Creates the (non-visual) viewer pipeline, returned in the shape the viewer
 * hook uses: `fragments.core` is the fragments engine (its models stream to a
 * local worker), `ifcLoader.settings` says how to run the web-ifc wasm copied
 * into /public/wasm, and `components.dispose` tears the engine down.
 *
 * The IFC -> fragments conversion itself does not run here: it runs in the
 * import worker (ifcImportClient.js / ifcImportWorker.js), which is why the
 * web-ifc parser and its per-schema tables are not needed on this thread.
 *
 * This talks to @thatopen/fragments directly instead of going through
 * @thatopen/components. That package is a 420 kB toolkit (cameras, raycasters,
 * clipper, ...) of which the viewer used only three thin wrappers, which are
 * re-created below; leaving it out saves about 120 kB of gzip on every first
 * visit.
 */
export async function createIfcPipeline() {
  const core = new FragmentsModels(fragmentsWorkerUrl);

  const fragments = { core, get list() { return core.models.list; } };

  const ifcLoader = { settings: ifcImportSettings() };

  const components = {
    dispose() {
      core.dispose();
    },
  };

  return { components, fragments, ifcLoader };
}

// How the import worker runs web-ifc: the local wasm copy (never a CDN), and
// the model re-centred on its own origin.
export function ifcImportSettings() {
  return {
    wasm: { path: `${import.meta.env.BASE_URL}wasm/`, absolute: true },
    webIfc: { COORDINATE_TO_ORIGIN: true },
  };
}

// main.jsx calls startIfcPipeline() before React renders so the heavy
// @thatopen / web-ifc chunk downloads and boots in parallel with the UI;
// the viewer hook then claims that pipeline (or builds one if none was
// started). A claimed pipeline is never shared, so the hook can dispose it.
let early = null;

export function startIfcPipeline() {
  early = createIfcPipeline();
}

export function takeIfcPipeline() {
  const pipeline = early ?? createIfcPipeline();
  early = null;
  return pipeline;
}

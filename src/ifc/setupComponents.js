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
  const fragments = {
    core: new FragmentsModels(fragmentsWorkerUrl),
    get list() {
      return this.core.models.list;
    },
    // The fragments worker stopped answering (a model build that never
    // finishes): replace the engine with a fresh one and stop the old one's
    // workers. Only called while no model is loaded, since the old engine's
    // models go with it. Everything reads `fragments.core` at the time of use.
    restart() {
      const old = this.core;
      this.core = new FragmentsModels(fragmentsWorkerUrl);
      terminateWorkers(old);
      old.dispose().catch(() => {});
    },
  };

  const ifcLoader = { settings: ifcImportSettings() };

  const components = {
    dispose() {
      fragments.core.dispose();
    },
  };

  return { components, fragments, ifcLoader };
}

// Best effort: the worker pool is internal to @thatopen/fragments (3.4), so a
// version without these fields just leaves the old workers to the garbage collector.
function terminateWorkers(core) {
  try {
    for (const worker of core._connection?._data?._threadsModelAmount?.keys?.() ?? []) worker.terminate?.();
  } catch {
    // nothing to stop
  }
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

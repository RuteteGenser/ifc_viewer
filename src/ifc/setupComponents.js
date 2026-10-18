import * as OBC from "@thatopen/components";
// Local worker asset so the app never depends on a CDN at runtime.
import fragmentsWorkerUrl from "@thatopen/fragments/worker?url";

/**
 * Creates the (non-visual) IFC parsing pipeline: a Components container,
 * a FragmentsManager (loads the local worker) and an IfcLoader (loads the
 * local web-ifc wasm binaries copied into /public/wasm).
 */
export async function createIfcPipeline() {
  const components = new OBC.Components();

  const fragments = components.get(OBC.FragmentsManager);
  fragments.init(fragmentsWorkerUrl);

  const ifcLoader = components.get(OBC.IfcLoader);
  await ifcLoader.setup({
    autoSetWasm: false,
    wasm: {
      path: `${import.meta.env.BASE_URL}wasm/`,
      absolute: true,
    },
  });

  components.init();

  return { components, fragments, ifcLoader };
}

// main.jsx calls startIfcPipeline() before React renders so the heavy
// @thatopen / web-ifc chunk downloads and boots in parallel with the UI;
// the viewer hook then claims that pipeline (or builds one if none was
// started). A claimed pipeline is never shared, so the hook can dispose it.
let early = null;

export function startIfcPipeline() {
  early = createIfcPipeline();
  early.catch(() => {});
}

export function takeIfcPipeline() {
  const pipeline = early ?? createIfcPipeline();
  early = null;
  return pipeline;
}

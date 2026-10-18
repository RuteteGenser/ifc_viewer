import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(here, "..", "..", "fixtures");
export const fixtureBytes = (name) => new Uint8Array(readFileSync(join(FIXTURE_DIR, name)));
export const fixtureText = (name) => readFileSync(join(FIXTURE_DIR, name), "latin1");

// A stand-in for the viewer's fragments model, built from a real IFC file with
// web-ifc (node build), so storeys.js sees the same shape of data it gets in the
// browser: a category/instance spatial tree and getItemsData rows.
let apiPromise;
async function webifc() {
  if (!apiPromise) {
    apiPromise = (async () => {
      const W = createRequire(join(here, "..", "..", "..", "/"))("web-ifc");
      const api = new W.IfcAPI();
      await api.Init();
      return { W, api };
    })();
  }
  return apiPromise;
}

export async function fakeModelFromIfc(bytes) {
  const { W, api } = await webifc();
  const id = api.OpenModel(bytes);
  const ids = (type) => {
    const v = api.GetLineIDsWithType(id, type);
    return Array.from({ length: v.size() }, (_, i) => v.get(i));
  };
  const storeyIds = ids(W.IFCBUILDINGSTOREY);
  const wallIds = [...ids(W.IFCWALL), ...ids(W.IFCWALLSTANDARDCASE)];
  const lines = new Map(storeyIds.map((s) => [s, api.GetLine(id, s)]));
  // Each storey's walls come from IfcRelContainedInSpatialStructure.
  const contained = new Map();
  for (const rel of ids(W.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
    const line = api.GetLine(id, rel);
    contained.set(line.RelatingStructure.value, line.RelatedElements.map((e) => e.value));
  }
  const tree = {
    category: "IFCPROJECT",
    localId: null,
    children: [{
      localId: 1, category: null, children: [{
        category: "IFCBUILDINGSTOREY", localId: null,
        children: storeyIds.map((s) => ({
          localId: s, category: null,
          children: (contained.get(s) ?? []).length
            ? [{ category: "IFCWALL", localId: null, children: contained.get(s).map((w) => ({ localId: w, category: null, children: [] })) }]
            : [],
        })),
      }],
    }],
  };
  void wallIds;
  const model = {
    async getSpatialStructure() { return tree; },
    async getItemsData(localIds) {
      return localIds.map((l) => {
        const line = lines.get(l);
        return { Name: { value: line.Name.value }, Elevation: { value: line.Elevation.value } };
      });
    },
  };
  return { model, close: () => api.CloseModel(id) };
}

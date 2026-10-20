// The measure tools, as a list: the Measure menu draws whatever is here, so a new tool is one more entry (and its
// handler in the viewer). `id` is what the viewer arms; `hint` is the one line under the name in the menu.
export const MEASURE_TOOLS = [
  { id: "distance", name: "Distance", hint: "Two points on the model" },
  { id: "clearance", name: "Clearance", hint: "Space around an element, four directions" },
];
export const DEFAULT_MEASURE_TOOL = "distance";
const KEY = "argus.measureTool";

export function toolById(id) {
  return MEASURE_TOOLS.find((t) => t.id === id) ?? MEASURE_TOOLS[0];
}

// The tool used last, so the Measure button arms it next time. Storage may be blocked: always fall back.
export function loadLastMeasureTool() {
  try {
    const id = localStorage.getItem(KEY);
    if (MEASURE_TOOLS.some((t) => t.id === id)) return id;
  } catch {
    // private window or blocked storage: the default is fine
  }
  return DEFAULT_MEASURE_TOOL;
}

export function saveLastMeasureTool(id) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // not remembered; the tool still works
  }
}

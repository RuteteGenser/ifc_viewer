const COARSE = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

const HINTS = {
  measure: {
    touch: "Tap two points to measure.",
    mouse: "Click two points on the model to measure between them.",
  },
  tag: {
    touch: "Tap an element to pin its tag.",
    mouse: "Hover an element, then click to pin its dimension tag.",
  },
  category: {
    touch: "Tap an element to hide its category.",
    mouse: "Click an element to hide its whole category.",
  },
  sectionIdle: {
    touch: "Section cut. Dragging turns the model.",
    mouse: "",
  },
  sectionMove: {
    touch: "Drag to slide the section.",
    mouse: "",
  },
};
const LABELS = { sectionIdle: "Move section" };

// One line saying what the armed tool does, with an obvious way out.
export default function ToolHint({ tool, onDone }) {
  if (!tool) return null;
  const text = HINTS[tool][COARSE ? "touch" : "mouse"];
  return (
    <div className="tool-hint" role="status">
      <span className="tool-hint__text">{text}</span>
      <button type="button" className="tool-hint__done" onClick={onDone}>
        {LABELS[tool] ?? "Done"}
      </button>
    </div>
  );
}

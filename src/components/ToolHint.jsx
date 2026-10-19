const COARSE = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

const HINTS = {
  measure: {
    touch: "Tap two points to measure.",
    mouse: "Click two points on the model to measure between them.",
  },
  tag: {
    touch: "Tap an element to pin its tag.",
    mouse: "Hover an element, then click to pin its tag.",
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
export default function ToolHint({ tool, onDone, plane = 0 }) {
  if (!tool) return null;
  let text = HINTS[tool][COARSE ? "touch" : "mouse"];
  // With two planes, say which one the drag moves.
  if (plane && tool === "sectionMove") text = `Moving Plane ${plane}. Drag to slide it.`;
  else if (plane && tool === "sectionIdle") text = `Section cut. Plane ${plane} is active.`;
  return (
    <div className="tool-hint" role="status">
      <span className="tool-hint__text">{text}</span>
      <button type="button" className="tool-hint__done" onClick={onDone}>
        {LABELS[tool] ?? "Done"}
      </button>
    </div>
  );
}

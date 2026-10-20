// English copy for the Measure menu and the Clearance tool. One place, so the words are easy to find and review.
export const MEASURE_COPY = {
  menuLabel: "Measure tools",
  caretLabel: "Choose a measure tool",
  armLabel: (name) => `Measure: ${name}`,
  tooltip: (name) => `Measure: ${name}`,
  tooltipHint: "Use the arrow for more measure tools",
  hudDistance: { touch: "Tap two points to measure.", mouse: "Click two points on the model to measure between them." },
  hudClearance: { touch: "Tap an element to measure clearance.", mouse: "Click an element to measure its clearance in four directions." },
  emptyHint: { touch: "Tap", mouse: "Click" },
  emptyDistance: "two points on the model to measure.",
  emptyClearance: "an element to measure the space around it.",
  clearanceTitle: (name) => `Clearance: ${name}`,
  directions: { up: "Up", down: "Down", left: "Left", right: "Right" },
  open: "Open",
  remove: "Remove measurement",
  noShape: "This element has no shape to measure from",
  failed: "The clearance could not be measured",
};

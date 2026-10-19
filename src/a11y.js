// Small accessibility helpers shared by the tab bar and the menus.

// Roving focus for tabs, menus and listboxes: the index a navigation key moves to, or -1 for any other key.
// Wraps at the ends, like the WAI-ARIA authoring practices.
export function nextIndex(key, current, count, horizontal = true) {
  if (count <= 0) return -1;
  const fwd = horizontal ? "ArrowRight" : "ArrowDown";
  const back = horizontal ? "ArrowLeft" : "ArrowUp";
  if (key === fwd) return (current + 1) % count;
  if (key === back) return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return -1;
}

// The page title: the model being viewed first, so a tab or history entry says what is open.
export function pageTitle(names, base = "Argus, IFC viewer") {
  const list = names.filter(Boolean);
  if (list.length === 0) return base;
  const first = list[0].replace(/\.(ifczip|ifc|zip)$/i, "");
  return `${list.length > 1 ? `${first} and ${list.length - 1} more` : first} - ${base}`;
}

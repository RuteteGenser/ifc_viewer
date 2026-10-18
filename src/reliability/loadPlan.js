// Pure rules for opening files: which files Argus accepts, how long the
// automatic attempts may take in all, and the queue of files waiting to be
// opened. No DOM, so the tests drive them directly.

/** "ifc" for .ifc, "zip" for .ifcZIP and .zip (opened when it holds an .ifc), null otherwise. */
export function fileKind(name) {
  const n = String(name ?? "").toLowerCase();
  if (n.endsWith(".ifc")) return "ifc";
  if (n.endsWith(".ifczip") || n.endsWith(".zip")) return "zip";
  return null;
}

/** The .ifc entries of an unpacked archive (folders and macOS metadata left out). */
export const ifcEntries = (names) => names.filter((n) => /\.ifc$/i.test(n) && !/(^|\/)__MACOSX\//.test(n) && !/(^|\/)\._/.test(n));

// A stalled import (no sign of life) is restarted, but the time lost to stalls
// is capped: a file truly too big for the device must not keep the user
// waiting through three full stall limits (up to 15 minutes).
export const STALL_BUDGET_MS = 240_000;

/** May an import that has already lost `stalledMs` to stalls be restarted, if the next stall could last `nextStallMs`? */
export const mayRetryStall = (stalledMs, nextStallMs, budgetMs = STALL_BUDGET_MS) => stalledMs + nextStallMs <= budgetMs;

/** How long the fragments worker may take to build a converted model before it counts as hung. */
export const buildLimitMs = (fragmentBytes) => Math.min(30_000 + (fragmentBytes / 1048576) * 4000, 180_000);

/**
 * Files waiting to be opened, in order. A file picked while another is opening
 * joins the end instead of replacing what is running.
 */
export class LoadQueue {
  constructor() {
    this.items = [];
  }
  /** Adds files; returns how many were added. */
  add(files) {
    const list = Array.from(files ?? []);
    this.items.push(...list);
    return list.length;
  }
  next() {
    return this.items.shift() ?? null;
  }
  clear() {
    const dropped = this.items.length;
    this.items = [];
    return dropped;
  }
  get size() {
    return this.items.length;
  }
}

/** Text for the toast shown when files join the queue. */
export function queuedText(files) {
  const list = Array.from(files ?? []);
  if (list.length === 1) return `Added to the queue: ${list[0].displayName ?? list[0].name}`;
  return `${list.length} files added to the queue`;
}

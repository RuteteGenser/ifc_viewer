// Pure edits of a case's snapshot list. Each returns a new case object; nothing here touches storage.
import { LIMITS, newSnapshot } from "./schema";

export class CaseLimitError extends Error { name = "CaseLimitError"; }

export function addSnapshot(c, fields) {
  if (c.snapshots.length >= LIMITS.snapshotsPerCase) throw new CaseLimitError(`A case holds at most ${LIMITS.snapshotsPerCase} snapshots.`);
  const snap = newSnapshot(fields);
  return { case: { ...c, snapshots: [...c.snapshots, snap] }, snapshot: snap };
}

export const updateSnapshot = (c, id, patch) => ({ ...c, snapshots: c.snapshots.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

export const removeSnapshot = (c, id) => ({ ...c, snapshots: c.snapshots.filter((s) => s.id !== id) });

// dir -1 moves a snapshot one place earlier, +1 one place later. Out of range returns the case unchanged.
export function moveSnapshot(c, id, dir) {
  const from = c.snapshots.findIndex((s) => s.id === id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= c.snapshots.length) return c;
  const list = [...c.snapshots];
  [list[from], list[to]] = [list[to], list[from]];
  return { ...c, snapshots: list };
}

// Index to select after the list changed: keep the same snapshot, else the nearest one.
export const indexAfter = (c, id, fallback = 0) => {
  const i = c.snapshots.findIndex((s) => s.id === id);
  return i >= 0 ? i : Math.min(Math.max(fallback, 0), Math.max(c.snapshots.length - 1, 0));
};

// Rough bytes the images of a case take (data URL length), for the "large case" hint.
export const caseBytes = (c) => c.snapshots.reduce((n, s) => n + (s.thumb?.length || 0) + (s.image?.length || 0), 0);

export const importKind = (name) => (/\.(bcf|bcfzip)$/i.test(name) ? "bcf" : "json");

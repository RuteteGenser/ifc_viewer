import test from "node:test";
import assert from "node:assert/strict";
import { childrenOf, pathOf, pathLabel, depthOf, heightOf, canMoveFolder, canCreateIn, pickerRows, folderMessage, validName, limitHint, atLimit, scopeModels, countText } from "../../src/library/folders.js";

const F = (id, parentId = null, o = {}) => ({ id, name: id, parentId, sortOrder: 0, modelCount: 0, ...o });
// A > B > C (3 levels), D top level, E top level
const fs = [F("A"), F("B", "A"), F("C", "B"), F("D"), F("E", null, { sortOrder: -1 })];

test("children are ordered by sortOrder, then name", () => {
  assert.deepEqual(childrenOf(fs, null).map((f) => f.id), ["E", "A", "D"]);
  assert.deepEqual(childrenOf(fs, "A").map((f) => f.id), ["B"]);
});
test("path, label and depth", () => {
  assert.deepEqual(pathOf(fs, "C").map((f) => f.id), ["A", "B", "C"]);
  assert.equal(pathLabel(fs, "C"), "A / B / C");
  assert.equal(pathLabel(fs, "nope"), "");
  assert.equal(depthOf(fs, "C"), 3);
  assert.equal(depthOf(fs, null), 0);
  assert.equal(heightOf(fs, "A"), 3);
  assert.equal(heightOf(fs, "D"), 1);
});
test("a broken cycle in the data does not hang", () => {
  const loop = [F("x", "y"), F("y", "x")];
  assert.equal(pathOf(loop, "x").length, 2);
});
test("cannot move a folder into itself or its descendants", () => {
  assert.equal(canMoveFolder(fs, "A", "A").reason, "self");
  assert.equal(canMoveFolder(fs, "A", "C").reason, "cycle");
  assert.equal(canMoveFolder(fs, "A", "B").reason, "cycle");
});
test("depth limit counts the moved subtree", () => {
  assert.equal(canMoveFolder(fs, "D", "B").ok, true); // D under B = level 3
  assert.equal(canMoveFolder(fs, "D", "C").reason, "too_deep");
  assert.equal(canMoveFolder(fs, "A", "D").reason, "too_deep"); // A has height 3, D is level 1
  assert.equal(canMoveFolder(fs, "B", "D").ok, true); // B has height 2 under D = 3
  assert.equal(canMoveFolder(fs, "C", null).ok, true);
  assert.equal(canMoveFolder(fs, "A", null).reason, "same");
  assert.equal(canCreateIn(fs, "B"), true);
  assert.equal(canCreateIn(fs, "C"), false);
  assert.equal(canCreateIn(fs, null), true);
});
test("picker rows: top level first, current marked, illegal targets disabled", () => {
  const rows = pickerRows(fs, { current: "D" });
  assert.equal(rows[0].folder, null);
  assert.deepEqual(rows.map((r) => r.folder?.id ?? "top"), ["top", "E", "A", "B", "C", "D"]);
  assert.deepEqual(rows.filter((r) => r.current).map((r) => r.folder?.id), ["D"]);
  assert.equal(rows.find((r) => r.folder?.id === "C").depth, 3);
  const mv = pickerRows(fs, { moving: "A", current: null });
  assert.deepEqual(mv.filter((r) => r.disabled).map((r) => r.folder.id).sort(), ["A", "B", "C", "D", "E"]);
  assert.equal(mv[0].disabled, false); // top level is "same", marked current rather than disabled
});
test("messages are plain words", () => {
  assert.match(folderMessage({ status: 409, body: { code: "name_taken" } }), /already exists/);
  assert.match(folderMessage({ status: 400, body: { code: "folder_too_deep" } }), /3 levels/);
  assert.match(folderMessage({ status: 402, body: { code: "quota_folders" } }, 20), /limit \(20\)/);
  assert.match(folderMessage({ status: 402, body: { code: "upgrade_required" } }), /read-only/);
  assert.match(folderMessage({ status: 404 }), /no longer/);
  assert.ok(!/—/.test(folderMessage({})));
});
test("name validation", () => {
  assert.equal(validName("Drawings"), "");
  assert.ok(validName("  "));
  assert.ok(validName("a/b"));
  assert.ok(validName("x".repeat(81)));
});
test("limit hint and scope", () => {
  assert.equal(limitHint(5, 20), "");
  assert.equal(limitHint(17, 20), "17 of 20 folders");
  assert.equal(limitHint(3, 0), "");
  assert.equal(atLimit(20, 20), true);
  assert.equal(atLimit(19, 20), false);
  const own = [{ id: 1, folderId: null }, { id: 2, folderId: "A" }, { id: 3 }];
  assert.deepEqual(scopeModels(own, { folderId: null }).map((m) => m.id), [1, 3]);
  assert.deepEqual(scopeModels(own, { folderId: "A" }).map((m) => m.id), [2]);
  assert.equal(scopeModels(own, { folderId: "A", searching: true }).length, 3);
  assert.equal(scopeModels(own, { folderId: "A", enabled: false }).length, 3);
  assert.equal(countText(1), "1 model");
});

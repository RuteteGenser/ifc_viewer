import test from "node:test";
import assert from "node:assert/strict";
import { listProjects, projectModels, projectNameError, rootOf, isRealProject, UNSORTED_ID, DUMMY_ID } from "../../src/library/projects.js";

const F = (id, parentId = null, updatedAt = "2026-01-01T00:00:00Z") => ({ id, name: id, parentId, updatedAt });
const M = (id, folderId = null, uploadedAt = "2026-01-01T00:00:00Z", extra = {}) => ({ id, name: `${id}.ifc`, folderId, uploadedAt, owner: "me", ...extra });
const folders = [F("A"), F("B", null, "2026-03-01T00:00:00Z"), F("A1", "A"), F("A2", "A1")];

test("rootOf climbs to the top level folder", () => {
  assert.equal(rootOf(folders, "A2"), "A");
  assert.equal(rootOf(folders, "B"), "B");
  assert.equal(rootOf(folders, "nope"), null);
});
test("only top level folders are projects, counted including sub folders", () => {
  const list = listProjects(folders, [M("1", "A"), M("2", "A2"), M("3", "B")]);
  assert.deepEqual(list.map((p) => [p.id, p.count]), [["B", 1], ["A", 2]]);
});
test("sorted by last updated, a newer model lifts its project; ties by name", () => {
  const list = listProjects([F("x"), F("y"), F("z", null, "2026-02-01T00:00:00Z")], [M("1", "x", "2026-05-01T00:00:00Z")]);
  assert.deepEqual(list.map((p) => p.id), ["x", "z", "y"]);
});
test("loose models make one virtual Unsorted project, last, only when there are some", () => {
  assert.equal(listProjects(folders, [M("1", "A")]).some((p) => p.id === UNSORTED_ID), false);
  const list = listProjects(folders, [M("1", "A"), M("2"), M("3", "gone")]);
  assert.equal(list.at(-1).id, UNSORTED_ID);
  assert.equal(list.at(-1).count, 2, "a model in a folder that no longer exists counts as loose");
  assert.equal(list.at(-1).virtual, true);
});
test("no folders and no models: no projects", () => assert.deepEqual(listProjects([], []), []));
test("projectModels: a project's models or the loose ones; samples never", () => {
  const items = [M("1", "A"), M("2", "A2"), M("3"), M("s", null, undefined, { owner: "samples" })];
  assert.deepEqual(projectModels(folders, items, "A").map((m) => m.id), ["1", "2"]);
  assert.deepEqual(projectModels(folders, items, UNSORTED_ID).map((m) => m.id), ["3"]);
});
test("project names: required, short, no slashes, unique ignoring case, not reserved", () => {
  const ps = listProjects(folders, []);
  assert.match(projectNameError("  ", ps), /Enter a name/);
  assert.match(projectNameError("a/b", ps), /slashes/);
  assert.match(projectNameError("x".repeat(81), ps), /80/);
  assert.match(projectNameError("a", ps), /already exists/);
  assert.match(projectNameError("unsorted", ps), /already exists/);
  assert.match(projectNameError("Dummy Project", ps), /already exists/);
  assert.equal(projectNameError("a", ps, "A"), "", "renaming a project to its own name in other case is fine");
  assert.equal(projectNameError("Villa", ps), "");
});
test("real project ids", () => {
  assert.equal(isRealProject("abc"), true);
  for (const id of [null, "", UNSORTED_ID, DUMMY_ID]) assert.equal(isRealProject(id), false);
});

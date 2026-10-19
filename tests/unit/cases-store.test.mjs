import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../../src/cases/store.js";
import { newCase, newSnapshot, newAnnotation } from "../../src/cases/schema.js";
import { fakeIndexedDB } from "./helpers/fakeIdb.mjs";

const T = "data:image/jpeg;base64,THUMB", I = "data:image/jpeg;base64,IMAGE";
function mk(name = "Case", snaps = 2) {
  const c = newCase({ name, model: { name: "m.ifc" } });
  for (let i = 0; i < snaps; i++) {
    const s = newSnapshot({ title: "S" + i, thumb: T + i, image: I + i });
    s.annotations.push(newAnnotation("pin", { anchor: { point: [i, 0, 0] } }));
    c.snapshots.push(s);
  }
  return c;
}
let clock = 0;
const tick = () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString();
const variants = [
  ["indexedDB fake", () => { const idb = fakeIndexedDB(); return { s: createStore({ indexedDB: idb, now: tick }), idb }; }],
  ["memory fallback", () => ({ s: createStore({ indexedDB: null, now: tick }) })],
];

for (const [label, make] of variants) {
  test(`${label}: save then get rehydrates images and annotations`, async () => {
    const { s } = make(); const c = mk();
    await s.saveCase(c);
    const back = await s.getCase(c.id);
    assert.deepEqual(back.snapshots.map((x) => [x.thumb, x.image]), [[T + 0, I + 0], [T + 1, I + 1]]);
    assert.equal(back.snapshots[1].annotations[0].anchor.point[0], 1);
    assert.equal(back.name, c.name);
  });
  test(`${label}: getCase of an unknown id is null`, async () => {
    const { s } = make(); assert.equal(await s.getCase("nope"), null);
  });
  test(`${label}: listCases summaries, newest first, with first thumb and no big images`, async () => {
    const { s } = make(); const a = mk("A"), b = mk("B", 0);
    await s.saveCase(a); await s.saveCase(b);
    const list = await s.listCases();
    assert.deepEqual(list.map((x) => x.name), ["B", "A"]);
    assert.deepEqual(list[1], { id: a.id, name: "A", updatedAt: list[1].updatedAt, snapshotCount: 2, model: { name: "m.ifc" }, thumb: T + 0 });
    assert.equal(list[0].thumb, null); assert.equal(list[0].snapshotCount, 0);
  });
  test(`${label}: saveCase touches updatedAt, unless touch:false`, async () => {
    const { s } = make(); const c = mk(); const orig = c.updatedAt;
    const saved = await s.saveCase(c);
    assert.notEqual(saved.updatedAt, orig);
    const kept = await s.saveCase({ ...c, updatedAt: "2020-01-01T00:00:00.000Z" }, { touch: false });
    assert.equal(kept.updatedAt, "2020-01-01T00:00:00.000Z");
  });
  test(`${label}: re-saving without a snapshot removes its stale images`, async () => {
    const { s } = make(); const c = mk(); await s.saveCase(c);
    c.snapshots.pop(); await s.saveCase(c);
    const back = await s.getCase(c.id);
    assert.equal(back.snapshots.length, 1);
    c.snapshots[0].image = null; await s.saveCase(c);
    assert.equal((await s.getCase(c.id)).snapshots[0].image, null);
    assert.equal((await s.getCase(c.id)).snapshots[0].thumb, T + 0);
  });
  test(`${label}: deleteCase removes the case and its images, leaves other cases alone`, async () => {
    const { s } = make(); const a = mk("A"), b = mk("B"); await s.saveCase(a); await s.saveCase(b);
    await s.deleteCase(a.id);
    assert.equal(await s.getCase(a.id), null);
    assert.deepEqual((await s.listCases()).map((x) => x.id), [b.id]);
    assert.equal((await s.getCase(b.id)).snapshots[0].image, I + 0);
  });
  test(`${label}: saveSnapshotImages updates one snapshot`, async () => {
    const { s } = make(); const c = mk(); await s.saveCase(c);
    await s.saveSnapshotImages(c.id, c.snapshots[0].id, { image: "data:image/jpeg;base64,NEW" });
    const back = await s.getCase(c.id);
    assert.equal(back.snapshots[0].image, "data:image/jpeg;base64,NEW"); assert.equal(back.snapshots[0].thumb, T + 0); assert.equal(back.snapshots[1].image, I + 1);
    await assert.rejects(s.saveSnapshotImages(c.id, "missing", { image: null }), /not found/);
  });
  test(`${label}: events fire for save and delete, unsubscribe works, bad listener is isolated`, async () => {
    const { s } = make(); const got = [];
    s.subscribe(() => { throw new Error("boom"); });
    const off = s.subscribe((e) => got.push(e));
    const c = mk(); await s.saveCase(c); await s.deleteCase(c.id);
    assert.deepEqual(got, [{ type: "save", id: c.id }, { type: "delete", id: c.id }]);
    off(); await s.saveCase(c); assert.equal(got.length, 2);
  });
  test(`${label}: saveCase rejects a case without id; stored data is a copy`, async () => {
    const { s } = make(); await assert.rejects(s.saveCase({}), /id/);
    const c = mk(); await s.saveCase(c); c.name = "changed"; c.snapshots[0].annotations.length = 0;
    const back = await s.getCase(c.id); assert.notEqual(back.name, "changed"); assert.equal(back.snapshots[0].annotations.length, 1);
  });
}

test("fake IDB: case record holds no image data, images live in the images store keyed caseId:snapId:kind", async () => {
  const idb = fakeIndexedDB(); const s = createStore({ indexedDB: idb }); const c = mk();
  await s.saveCase(c);
  const db = idb.dbs.get("argus-cases");
  assert.deepEqual([...db.stores.keys()].sort(), ["cases", "images"]);
  assert.equal(db.version, 1);
  const rec = db.stores.get("cases").data.get(c.id);
  assert.ok(rec.snapshots.every((x) => x.thumb === null && x.image === null));
  assert.deepEqual([...db.stores.get("images").data.keys()].sort(), c.snapshots.flatMap((x) => [`${c.id}:${x.id}:image`, `${c.id}:${x.id}:thumb`]).sort());
  assert.equal(db.stores.get("images").data.get(`${c.id}:${c.snapshots[0].id}:thumb`), T + 0);
  await s.deleteCase(c.id);
  assert.equal(db.stores.get("images").data.size, 0); assert.equal(db.stores.get("cases").data.size, 0);
});
test("persistent flag and onStatus: real (fake) idb -> true", async () => {
  const seen = []; const s = createStore({ indexedDB: fakeIndexedDB(), onStatus: (x) => seen.push(x) });
  assert.equal(s.persistent, false); // unknown until opened
  await s.listCases();
  assert.equal(s.persistent, true); assert.deepEqual(seen, [{ persistent: true, reason: null }]);
});
test("persistent flag: no indexedDB -> false + status with reason, still works", async () => {
  const seen = []; const s = createStore({ indexedDB: undefined, onStatus: (x) => seen.push(x) });
  const c = mk(); await s.saveCase(c);
  assert.equal(s.persistent, false); assert.equal(seen.length, 1); assert.equal(seen[0].persistent, false); assert.match(seen[0].reason, /not available/);
  assert.equal((await s.getCase(c.id)).name, c.name);
});
test("persistent flag: open() fails -> memory fallback", async () => {
  const seen = []; const s = createStore({ indexedDB: fakeIndexedDB({ failOpen: true }), onStatus: (x) => seen.push(x) });
  await s.saveCase(mk()); assert.equal(s.persistent, false); assert.match(seen[0].reason, /SecurityError/);
  assert.equal((await s.listCases()).length, 1);
});
test("persistent flag: open() throws synchronously -> memory fallback", async () => {
  const s = createStore({ indexedDB: { open() { throw new Error("denied"); } } });
  await s.saveCase(mk()); assert.equal(s.persistent, false); assert.equal((await s.listCases()).length, 1);
});
test("a failing write after open is thrown (never silently pretended saved) and leaves data intact", async () => {
  const s = createStore({ indexedDB: fakeIndexedDB({ failPut: true }) });
  await assert.rejects(s.saveCase(mk()), /Quota|transaction|request/i);
  assert.deepEqual(await s.listCases(), []);
});
test("onStatus listener that throws does not break the store", async () => {
  const s = createStore({ indexedDB: null, onStatus: () => { throw new Error("x"); } });
  await s.saveCase(mk()); assert.equal((await s.listCases()).length, 1);
});
test("two stores on one fake database share data (persistence across instances)", async () => {
  const idb = fakeIndexedDB(); const c = mk();
  await createStore({ indexedDB: idb }).saveCase(c);
  assert.equal((await createStore({ indexedDB: idb }).getCase(c.id)).snapshots[0].image, I + 0);
});
test("estimateQuota: reads navigator.storage.estimate, null when missing or throwing", async () => {
  assert.deepEqual(await createStore({ indexedDB: null, storage: { estimate: async () => ({ usage: 50, quota: 200 }) } }).estimateQuota(), { usage: 50, quota: 200, ratio: 0.25 });
  assert.equal(await createStore({ indexedDB: null, storage: {} }).estimateQuota(), null);
  assert.equal(await createStore({ indexedDB: null, storage: { estimate: async () => { throw new Error("x"); } } }).estimateQuota(), null);
});

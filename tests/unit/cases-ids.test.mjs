import test from "node:test";
import assert from "node:assert/strict";
import { createIdGenerator, newId, isId, idTime, ALPHABET } from "../../src/cases/ids.js";

test("format: 26 chars Crockford base32 (no I L O U)", () => {
  const id = newId();
  assert.equal(id.length, 26);
  assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(isId(id));
  assert.ok(!/[ILOU]/.test(ALPHABET));
});
test("isId rejects wrong length, lowercase, bad chars, non strings, overflowing time char", () => {
  for (const bad of ["", "abc", "01J".repeat(9), newId().toLowerCase(), newId().slice(1) + "U", null, 5, undefined, "8" + "0".repeat(25)]) assert.equal(isId(bad), false, String(bad));
});
test("time sortable: later clock gives larger string", () => {
  let t = 1_700_000_000_000;
  const gen = createIdGenerator({ now: () => t, random: () => 0.5 });
  const a = gen(); t += 1; const b = gen(); t += 100000; const c = gen();
  assert.ok(a < b && b < c);
  assert.deepEqual([c, a, b].sort(), [a, b, c]);
});
test("same millisecond: monotonic and unique even with a constant random source", () => {
  const gen = createIdGenerator({ now: () => 5000, random: () => 0 });
  const ids = Array.from({ length: 200 }, gen);
  assert.equal(new Set(ids).size, 200);
  assert.deepEqual([...ids].sort(), ids);
});
test("monotonic carry across the base32 boundary", () => {
  const gen = createIdGenerator({ now: () => 1, random: () => 31.99 / 32 }); // all 'Z'
  const a = gen(), b = gen();
  assert.equal(a.slice(10), "Z".repeat(16));
  assert.ok(isId(b));
});
test("time part decodes back to the injected clock", () => {
  const gen = createIdGenerator({ now: () => 1_760_000_000_123, random: () => 0.1 });
  assert.equal(idTime(gen()), 1_760_000_000_123);
  assert.equal(idTime("nope"), null);
});
test("injected random drives the random part deterministically", () => {
  const mk = () => createIdGenerator({ now: () => 42, random: () => 0.25 });
  assert.equal(mk()(), mk()());
  assert.equal(mk()().slice(10), "8".repeat(16));
});
test("default generator makes 1000 unique ids", () => {
  assert.equal(new Set(Array.from({ length: 1000 }, newId)).size, 1000);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { FIXTURES } from "../fixtures/generate.mjs";
import { FIXTURE_DIR } from "./helpers/fixtures.mjs";

test("committed fixtures are exactly what the generator produces, and small", () => {
  for (const [file, text] of Object.entries(FIXTURES)) {
    assert.equal(readFileSync(`${FIXTURE_DIR}/${file}`, "utf8"), text, `${file} is stale: run node tests/fixtures/generate.mjs`);
    assert.ok(statSync(`${FIXTURE_DIR}/${file}`).size < 100 * 1024, `${file} is over 100 KB`);
  }
});

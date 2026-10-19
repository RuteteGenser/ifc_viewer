// The import worker must not load web-ifc's schema tables lazily: WebKit
// (Safari, every iOS browser) evaluates a module worker's entry file a second
// time when one of its chunks imports it, so a lazy schema chunk filled the
// tables of a second copy of web-ifc and every model failed on an iPhone with
// "undefined is not an object (evaluating 'Object.keys(LD[this.modelSchemaList[e]])')".
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { entryImportsIn, slimWebIfc } from "../../scripts/vite-trim-plugins.mjs";
import viteConfig from "../../vite.config.js";

const require = createRequire(import.meta.url);
const WEB_IFC = require.resolve("web-ifc").replace(/web-ifc-api-node\.js$/, "web-ifc-api.js");

const chunk = (fileName, { isEntry = false, imports = [], dynamicImports = [], code = "" } = {}) => ({ type: "chunk", fileName, isEntry, imports, dynamicImports, code });

test("the bundle shape that broke every model on iOS is caught: a schema chunk importing the worker entry", () => {
  const bundle = {
    w: chunk("assets/ifcImportWorker-B9PdDqgh.js", { isEntry: true, dynamicImports: ["assets/iw-schema-2.js"] }),
    s: chunk("assets/iw-schema-2.js", { imports: ["assets/ifcImportWorker-B9PdDqgh.js"] }),
  };
  assert.deepEqual(entryImportsIn(bundle), ["assets/iw-schema-2.js -> assets/ifcImportWorker-B9PdDqgh.js"]);
});

test("a one-file worker that lists itself (inlined imports) passes; one that really imports itself does not", () => {
  const self = "assets/ifcImportWorker-C2LSyRws.js";
  assert.deepEqual(entryImportsIn({ w: chunk(self, { isEntry: true, dynamicImports: [self], code: "Promise.resolve().then(()=>x)" }) }), []);
  assert.equal(entryImportsIn({ w: chunk(self, { isEntry: true, dynamicImports: [self], code: 'import("./ifcImportWorker-C2LSyRws.js")' }) }).length, 1);
  // Chunks importing a shared non-entry chunk (the page's layout) are fine.
  assert.deepEqual(
    entryImportsIn({ e: chunk("assets/index.js", { isEntry: true, dynamicImports: ["assets/s.js"] }), s: chunk("assets/s.js", { imports: ["assets/web-ifc.js"] }), w: chunk("assets/web-ifc.js") }),
    [],
  );
});

test("the import worker is built as one file with every schema inside and the guard on", () => {
  const config = viteConfig({ command: "build", mode: "production" });
  const names = config.worker.plugins().map((p) => p.name);
  assert.ok(names.includes("slim-web-ifc"));
  assert.ok(names.includes("no-worker-entry-imports"));
  assert.equal(config.worker.rollupOptions.output.codeSplitting, false);
});

test("slimWebIfc({ split: false }) keeps all three schemas' tables but still trims the write tables and threads", async () => {
  const plugin = slimWebIfc({ split: false });
  plugin.configResolved({ command: "build", root: process.cwd() });
  const source = readFileSync(WEB_IFC, "utf8");
  const { code } = plugin.transform(source, WEB_IFC);
  for (const id of [1, 2, 3]) {
    assert.ok(code.includes(`\nFromRawLineData[${id}] = {\n`), `FromRawLineData[${id}] kept`);
    assert.ok(code.includes(`\nInheritanceDef[${id}] = {\n`), `InheritanceDef[${id}] kept`);
    assert.ok(!code.includes(`\nConstructors[${id}] = {\n`), `Constructors[${id}] trimmed`);
  }
  assert.ok(code.includes('throw new Error("multithreaded web-ifc is not bundled")'));
  assert.equal(await plugin.load("\0virtual:web-ifc-schema-2"), "export {}\n");
  // The split build (the page's) still moves the tables out.
  const split = slimWebIfc();
  split.configResolved({ command: "build", root: process.cwd() });
  assert.ok(!split.transform(source, WEB_IFC).code.includes("\nFromRawLineData[2] = {\n"));
});

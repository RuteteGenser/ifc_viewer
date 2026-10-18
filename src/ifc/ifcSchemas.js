import { SchemaNames } from "web-ifc";

// web-ifc keeps a class and lookup tables for each IFC schema; production
// builds split them into one chunk per schema (see slimWebIfc in
// scripts/vite-trim-plugins.mjs) and a file's schema must be loaded before the
// file is opened. In the dev server nothing is split and these imports are empty.
const chunks = {
  1: () => import("virtual:web-ifc-schema-1"), // IFC2X3
  2: () => import("virtual:web-ifc-schema-2"), // IFC4
  3: () => import("virtual:web-ifc-schema-3"), // IFC4X3 and its drafts
};

const requested = new Map();

export function loadSchema(id) {
  if (!requested.has(id)) {
    // One more try after a short pause: a dropped connection often recovers at once.
    const promise = chunks[id]().catch(() => new Promise((resolve) => setTimeout(resolve, 400)).then(() => chunks[id]()));
    // A failed download must not be remembered, so the next file retries.
    promise.catch(() => requested.delete(id));
    requested.set(id, promise);
  }
  return requested.get(id);
}

// The schema id web-ifc will pick for these IFC bytes (it reads the first name
// of FILE_SCHEMA, upper-cased, against SchemaNames), or null if there is none.
export function schemaIdOf(bytes) {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 65536));
  const name = /FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/i.exec(head)?.[1]?.toUpperCase();
  if (!name) return null;
  for (let id = 0; id < SchemaNames.length; id++) {
    if (SchemaNames[id]?.includes(name)) return id;
  }
  return null;
}

// Loads whatever schema code opening `bytes` needs. A header this can't read
// loads every schema, so web-ifc decides (and reports) as it always did.
export async function loadSchemaFor(bytes) {
  const id = schemaIdOf(bytes);
  await Promise.all((id && chunks[id] ? [id] : Object.keys(chunks).map(Number)).map(loadSchema));
}

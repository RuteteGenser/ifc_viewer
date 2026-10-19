import { FromRawLineData, SchemaNames } from "web-ifc";
import { fileSchemaOf } from "./stepHeader";
import { importRetrying } from "../reliability/retry";

// web-ifc keeps a class and lookup tables for each IFC schema; the page's
// production build splits them into one chunk per schema (see slimWebIfc in
// scripts/vite-trim-plugins.mjs) and a file's schema must be loaded before the
// file is opened. The import worker's build and the dev server split nothing,
// and there these imports are empty.
const chunks = {
  1: () => import("virtual:web-ifc-schema-1"), // IFC2X3
  2: () => import("virtual:web-ifc-schema-2"), // IFC4
  3: () => import("virtual:web-ifc-schema-3"), // IFC4X3 and its drafts
};

const requested = new Map();

export function loadSchema(id) {
  if (!requested.has(id)) {
    // One more try after a short pause: a dropped connection often recovers at
    // once. The repeat asks by a cache-busting address, because a browser
    // remembers a failed import() of the same address (see importRetrying).
    const promise = importRetrying(chunks[id], { delay: 400 });
    // A failed download must not be remembered, so the next file retries.
    promise.catch(() => requested.delete(id));
    requested.set(id, promise);
  }
  return requested.get(id);
}

// The schema id web-ifc will pick for these IFC bytes (it reads the first name
// of FILE_SCHEMA, upper-cased, against SchemaNames), or null if there is none.
// Only the real header counts: comments are ignored (an exporter's
// "/* converted from FILE_SCHEMA(('IFC2X3')) */" once made a valid IFC4 file
// load the wrong tables and fail), see stepHeader.js.
export function schemaIdOf(bytes) {
  const name = fileSchemaOf(bytes)?.name?.trim().toUpperCase();
  if (!name) return null;
  for (let id = 0; id < SchemaNames.length; id++) {
    if (SchemaNames[id]?.includes(name)) return id;
  }
  return null;
}

// Every schema name web-ifc knows, upper case.
export const KNOWN_SCHEMAS = SchemaNames.flatMap((names) => names ?? []);

export const loadAllSchemas = () => Promise.all(Object.keys(chunks).map(Number).map(loadSchema));

// Loads whatever schema code opening `bytes` needs. A header this can't read
// loads every schema, so web-ifc decides (and reports) as it always did.
export async function loadSchemaFor(bytes) {
  const id = schemaIdOf(bytes);
  if (id && chunks[id]) await loadSchema(id);
  else await loadAllSchemas();
}

const ALL_IDS = Object.keys(chunks).map(Number);

// True when web-ifc's own lookup table for schema `id` is filled in: this
// reads the very binding web-ifc's IfcAPI reads (`Object.keys(LD[schema])`),
// so it is true exactly when opening a file of that schema can work.
export const schemaTablesReady = (id) => FromRawLineData[id] != null && typeof FromRawLineData[id] === "object";

// The schema ids whose tables are in, e.g. [2].
export const registeredSchemas = () => ALL_IDS.filter(schemaTablesReady);

// Loads the tables opening `bytes` needs (all of them with `all`, or when the
// header names no known schema) and checks they really arrived where web-ifc
// reads them. If not, loads every schema again from scratch and checks once
// more; still missing throws, with what was and was not registered, instead
// of letting web-ifc fail later with "undefined is not an object".
// Returns { schema, registered } for error reports.
export async function ensureSchemaFor(bytes, { all = false } = {}) {
  const schema = schemaIdOf(bytes);
  const known = !!(schema && chunks[schema]);
  await (all || !known ? loadAllSchemas() : loadSchema(schema));
  const needed = known ? [schema] : ALL_IDS;
  if (!needed.every(schemaTablesReady)) {
    requested.clear();
    await loadAllSchemas();
    if (!needed.every(schemaTablesReady)) {
      throw new Error(`web-ifc schema tables missing after loading: needed [${needed}], registered [${registeredSchemas()}]`);
    }
  }
  return { schema, registered: registeredSchemas() };
}

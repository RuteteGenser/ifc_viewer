// Lets node:test import the app's own source files unchanged: Vite resolves
// extensionless relative imports and import.meta.env, plain node does not.
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);

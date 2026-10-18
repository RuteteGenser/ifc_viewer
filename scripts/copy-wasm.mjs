// Copies the web-ifc WASM binary into public/wasm so the IFC parser can
// be loaded from the same origin, with no CDN dependency at runtime.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(rootDir, "node_modules", "web-ifc");
const destDir = join(rootDir, "public", "wasm");

mkdirSync(destDir, { recursive: true });

// Only the single-thread build: the multithreaded glue is not bundled (see
// slimWebIfc in scripts/vite-trim-plugins.mjs), so its wasm would never load.
for (const file of ["web-ifc.wasm"]) {
  copyFileSync(join(srcDir, file), join(destDir, file));
}

console.log("Copied web-ifc WASM binary to public/wasm");

// Copies the web-ifc WASM binaries into public/wasm so the IFC parser can
// be loaded from the same origin, with no CDN dependency at runtime.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(rootDir, "node_modules", "web-ifc");
const destDir = join(rootDir, "public", "wasm");

mkdirSync(destDir, { recursive: true });

for (const file of ["web-ifc.wasm", "web-ifc-mt.wasm"]) {
  copyFileSync(join(srcDir, file), join(destDir, file));
}

console.log("Copied web-ifc WASM binaries to public/wasm");

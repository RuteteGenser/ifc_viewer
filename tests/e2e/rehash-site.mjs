// Turns a built site into "the next deploy": every content-hashed file under
// assets/ gets a new name (and every reference to it is rewritten), the
// service worker's VERSION and the page's argus-build id change too. Nothing
// of the old names exists afterwards, which is what the first version of
// redeploy.sh did to the old build. Usage: node rehash-site.mjs <siteDir> <outDir>
import { cpSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function rehashSite(src, dst) {
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
  const app = join(dst, "app");
  const assets = join(app, "assets");
  for (const f of readdirSync(assets)) if (/\.(gz|br)$/.test(f)) rmSync(join(assets, f));
  const rev = (text) => [...text].reverse().join("");
  const renames = {};
  for (const f of readdirSync(assets)) {
    const m = /^(.*)-([A-Za-z0-9_-]{8})(\.[a-z]+)$/.exec(f);
    if (m) renames[f] = `${m[1]}-${rev(m[2])}${m[3]}`;
  }
  for (const [a, b] of Object.entries(renames)) renameSync(join(assets, a), join(assets, b));
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  for (const f of walk(app)) {
    if (!/\.(js|css|html)$/.test(f)) continue;
    const before = readFileSync(f, "utf8");
    let text = before;
    for (const [a, b] of Object.entries(renames)) text = text.split(a).join(b);
    if (f.endsWith("/sw.js")) text = text.replace(/const VERSION = "([0-9a-f]{12})"/, (_, v) => `const VERSION = "${rev(v)}"`);
    if (f.endsWith("/index.html")) text = text.replace(/(name="argus-build" content=")([^"]+)"/, (_, p, id) => `${p}${rev(id)}"`);
    if (text !== before) writeFileSync(f, text);
  }
  return Object.keys(renames).length;
}

if (process.argv[1].endsWith("rehash-site.mjs") && process.argv[2]) console.log("renamed", rehashSite(process.argv[2], process.argv[3]));

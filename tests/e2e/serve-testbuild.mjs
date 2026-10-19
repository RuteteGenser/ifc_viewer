// Serves a scratch build (made with VITE_TEST_HOOK=1) at /app/ and forwards /api/ to the real
// service, so state-assertion tests can run against `window.__ifcDebug` without touching the
// deployed site. usage: node serve-testbuild.mjs <dist-dir> <port> [upstream=http://127.0.0.1:3700]
// The dist dir must hold app/ (vite build --base=/app/ --outDir <dir>/app).
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const [, , dir, port = "4390", upstream = "http://127.0.0.1:3700"] = process.argv;
if (!dir) throw new Error("usage: serve-testbuild.mjs <dist-dir> <port> [upstream]");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".json": "application/json", ".ifc": "application/octet-stream" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) {
    const up = await fetch(upstream + req.url, {
      method: req.method,
      headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => !["host", "connection"].includes(k))),
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req,
      duplex: "half",
    }).catch(() => null);
    if (!up) { res.writeHead(502); return res.end(); }
    const headers = Object.fromEntries([...up.headers].filter(([k]) => !["content-encoding", "transfer-encoding", "connection"].includes(k)));
    res.writeHead(up.status, headers);
    return res.end(Buffer.from(await up.arrayBuffer()));
  }
  if (url.pathname === "/app") { res.writeHead(301, { Location: "/app/" }); return res.end(); }
  if (!url.pathname.startsWith("/app/")) { res.writeHead(404); return res.end("not found"); }
  let rel = decodeURIComponent(url.pathname.slice(5)) || "index.html";
  if (rel.endsWith("/")) rel += "index.html";
  const file = normalize(join(dir, "app", rel));
  if (!file.startsWith(normalize(join(dir, "app"))) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  res.end(readFileSync(file));
}).listen(Number(port), "127.0.0.1", () => console.log(`serving ${dir} on http://127.0.0.1:${port}/app/`));

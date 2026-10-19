// Static server for a scratch build at /app/ (vite build --base=/app/ --outDir <dir>/app).
// usage: node serve-access.mjs <dist-dir> <port> [upstream-port]
// With an upstream port, /api/ is piped to it (cookies pass through both ways).
// Without one, /api/ answers 404, like a deployment that predates the access system.
// env HIDE_SESSION=1: /api/session answers 404 and everything else goes upstream (the old live API).
// env SPREAD_IP=1: every request gets its own X-Real-IP so a long test run never hits the per-IP caps.
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const [, , dir, port, upPort] = process.argv;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".json": "application/json", ".ifc": "application/octet-stream" };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) {
    if (!upPort) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("not found"); }
    if (process.env.HIDE_SESSION && url.pathname === "/api/session") { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("not found"); }
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    delete headers["x-forwarded-proto"];
    if (process.env.SPREAD_IP) headers["x-real-ip"] = `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
    // The backend's fake checkout pages send Referrer-Policy: no-referrer, so Chrome posts their
    // forms with "Origin: null" and the backend answers 403 csrf. This stands in for the fix there
    // (Referrer-Policy: same-origin on those two pages) so the frontend flow can be tested.
    if (headers.origin === "null" && url.pathname.startsWith("/api/billing/fake/")) headers.origin = `http://127.0.0.1:${port}`;
    const up = http.request({ host: "127.0.0.1", port: Number(upPort), method: req.method, path: req.url, headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on("error", () => { res.writeHead(502); res.end(); });
    return req.pipe(up);
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

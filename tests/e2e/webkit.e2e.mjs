// Opens models in WebKit, the engine of Safari and of every iOS browser.
// Chromium never showed the bug this guards: WebKit evaluates a module
// worker's entry file a second time when one of its chunks imports it, so the
// import worker's lazily loaded schema tables went into a second copy of
// web-ifc and every model failed on an iPhone with "undefined is not an object
// (evaluating 'Object.keys(LD[this.modelSchemaList[e]])')" (see vite.config.js).
//
//   ARGUS_URL=http://localhost:3700 node tests/e2e/webkit.e2e.mjs
//
// Needs Playwright's WebKit: `PLAYWRIGHT_BROWSERS_PATH=<dir> node
// /opt/repos/web/node_modules/playwright/cli.js install webkit`, run with the
// same PLAYWRIGHT_BROWSERS_PATH. On a host without WebKit's system libraries
// (no apt), `apt-get download` the packages ldd reports missing for
// <dir>/webkit-*/minibrowser-wpe/bin/*, `dpkg -x` them and copy the .so files
// into <dir>/webkit-*/minibrowser-wpe/sys/lib (the launcher adds it to the
// library path), and set PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1.
// Prints SKIP and exits 0 when WebKit cannot start.
import { createRequire } from "node:module";
import { join } from "node:path";
import { APP, AUTH_HEADER, DEMO_FILE, FIXTURES } from "./lib.mjs";

const require = createRequire("/opt/repos/web/");
const { webkit, devices } = require("playwright");

let browser;
try {
  browser = await webkit.launch();
} catch (err) {
  console.log(`SKIP webkit: WebKit did not start (${String(err.message).split("\n")[0]})`);
  process.exit(0);
}

const cases = [
  { name: "sample building (IFC4) via ?demo=1", query: "?demo=1" },
  { name: "local IFC4 file", file: DEMO_FILE },
  { name: "local IFC2X3 file", file: join(FIXTURES, "mm-ifc2x3.ifc") },
];
let failed = 0;
for (const project of ["desktop", "iphone"]) {
  for (const c of cases) {
    const ctx = await browser.newContext({
      ...(project === "iphone" ? devices["iPhone 13"] : { viewport: { width: 1440, height: 900 } }),
      extraHTTPHeaders: { Authorization: AUTH_HEADER },
    });
    const page = await ctx.newPage();
    const errors = [];
    // ARGUS_IGNORE_SESSION_404=1: a deployment without the access API answers /api/session with 404; the
    // browser logs that one line itself. Everything else still counts.
    const session404 = (url) => process.env.ARGUS_IGNORE_SESSION_404 && /\/api\/session$/.test(url || "");
    page.on("console", (m) => m.type() === "error" && !session404(m.location()?.url) && errors.push(m.text()));
    // WebKit reports a ResizeObserver loop as a page error; it is harmless.
    page.on("pageerror", (e) => !/ResizeObserver loop/.test(e.message) && errors.push(e.message));
    let result;
    try {
      await page.goto(`${APP}${c.query ?? ""}`, { waitUntil: "domcontentloaded" });
      if (c.file) {
        await page.waitForFunction(() => performance.getEntriesByName("viewer-ready").length > 0, null, { timeout: 60000 });
        await page.setInputFiles("input[type=file]", c.file);
      }
      await page.waitForFunction(
        () => performance.getEntriesByName("model-shown").length > 0 || !!document.querySelector(".error-banner, [role=alert]"),
        null,
        { timeout: 90000 },
      );
      const shown = await page.evaluate(() => performance.getEntriesByName("model-shown").length > 0);
      if (!shown) result = `error shown: ${await page.evaluate(() => document.querySelector("[role=alert]")?.innerText.replace(/\s+/g, " "))}`;
      else if (errors.length) result = `console errors: ${errors.join(" | ").slice(0, 300)}`;
    } catch (err) {
      result = String(err.message).split("\n")[0];
    }
    console.log(`${result ? "FAIL" : "PASS"} webkit: ${c.name} [${project}]${result ? `\n    ${result}` : ""}`);
    if (result) failed++;
    await ctx.close();
  }
}
await browser.close();
process.exit(failed ? 1 : 0);

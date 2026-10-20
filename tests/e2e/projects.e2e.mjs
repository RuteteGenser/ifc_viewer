// Projects: the first screen of the viewer (src/library/ProjectBrowser.jsx) against the REAL new backend.
// env: ARGUS_URL=<static server piped to a scratch backend started with ARGUS_REQUIRE_SESSION=1, see serve-access.mjs>,
//      ARGUS_SHOTS (screenshot dir). Every case is a fresh anonymous visitor with its own account; the live service is never touched.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { suite, openApp, waitForModelAfter, OUT, fx } from "./lib.mjs";
import { buildIfc } from "../fixtures/generate.mjs";

const SHOTS = process.env.ARGUS_SHOTS || `${OUT}/projects`;
mkdirSync(SHOTS, { recursive: true });
const PROJECTS = ["desktop", "iphone13", "small320", "ipad-mini"];
// A first visit asks for folders before its session cookie exists (401 once); the rest are the same noise the folders suite allows.
const NOISE = [/api\/(folders|session)/, /Failed to load resource/];
let n = 0;
const ifc = () => buildIfc({ schema: "IFC4", unit: "m", name: randomBytes(3).toString("hex"), storeys: [{ name: "L0", elevation: 0 }], wall: [4, 0.2, 2.8] });
const call = (page, method, path, body) =>
  page.evaluate(async ([m, p, b]) => {
    const r = await fetch(`/api${p}`, { method: m, headers: { "X-Argus-Client": "1", "Content-Type": typeof b === "string" ? "text/plain" : "application/json" }, body: b === undefined ? undefined : typeof b === "string" ? b : JSON.stringify(b), credentials: "same-origin" });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [method, path, body]);
const models = async (page) => (await call(page, "GET", "/models")).body.filter((m) => m.owner !== "samples");
const folders = async (page) => (await call(page, "GET", "/folders")).body;
async function visitor(page) {
  n += 1;
  await page.context().setExtraHTTPHeaders({ "x-real-ip": `10.${Math.floor(Math.random() * 250)}.${Math.floor(n / 250)}.${n % 250}` });
  await openApp(page);
  // the session cookie may still be on its way for a moment
  let redeemed = 0;
  for (let i = 0; i < 8 && redeemed !== 200; i++) {
    redeemed = (await call(page, "POST", "/redeem-code", { code: "123" })).status;
    if (redeemed !== 200) await page.waitForTimeout(500);
  }
  assert.equal(redeemed, 200, "redeem 123");
  await openApp(page);
}
const shot = (page, project, name) => page.screenshot({ path: `${SHOTS}/${name}-${project}.png` });
const noOverflow = async (page) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "horizontal overflow");
const smallTargets = (page, scope) =>
  page.evaluate((sel) => [...document.querySelectorAll(`${sel} button, ${sel} a[href], ${sel} input`)].filter((e) => e.offsetParent && !e.hidden).map((e) => [e.textContent.trim().slice(0, 30) || e.getAttribute("aria-label"), Math.round(e.getBoundingClientRect().height)]).filter(([, h]) => h < 44), scope);
const browser = (page) => page.locator(".proj");
const newProject = async (page, name) => {
  await page.getByRole("button", { name: "New project", exact: true }).first().click();
  const dlg = page.getByRole("dialog", { name: "New project" });
  await dlg.getByLabel("Project name").fill(name);
  await dlg.getByRole("button", { name: "Create" }).click();
  await page.getByRole("heading", { level: 1, name }).waitFor();
};
// The loaded-models column is always there on a desktop; on a phone or tablet it opens from a button.
async function openSidebar(page) {
  if (await page.locator(".sidebar").isVisible()) return;
  const btn = page.getByRole("button", { name: /^(Open menu|Show model list)$/ }).first();
  await btn.click();
  await page.locator(".sidebar").waitFor({ state: "visible" });
}
const pollFor = async (what, fn, ms = 15000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
};

await suite("projects", [
  {
    name: "no projects: New project and Try a dummy project, nothing else competes; keyboard; no overflow; 44 px",
    projects: PROJECTS,
    allowErrors: NOISE,
    fn: async ({ page, project }) => {
      await visitor(page);
      const b = browser(page);
      await b.getByRole("button", { name: "New project", exact: true }).waitFor();
      await b.getByRole("button", { name: "Try a dummy project" }).waitFor();
      assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1, "one h1");
      assert.match(await b.innerText(), /A project keeps the models of one building together/);
      assert.equal(await page.getByRole("checkbox", { name: /Also save/ }).count(), 0, "no loose-save checkbox");
      assert.equal(await page.locator(".models-chip").count(), 0, "no Models chip in the header");
      assert.equal(await page.locator(".header").getByText("Projects").count(), 1, "the header says where you are");
      await noOverflow(page);
      assert.deepEqual(await smallTargets(page, ".proj"), [], "targets under 44 px");
      await shot(page, project, "empty");
      // keyboard: New project is the first control in the page body, Enter opens the dialog, Escape closes it and returns focus
      const first = b.getByRole("button", { name: "New project", exact: true });
      await first.focus();
      await page.keyboard.press("Enter");
      const dlg = page.getByRole("dialog", { name: "New project" });
      await dlg.waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.id), "proj-name", "the name field has focus");
      await shot(page, project, "new-dialog");
      await page.keyboard.press("Escape");
      await dlg.waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => document.activeElement?.textContent.trim()), "New project", "focus returns");
    },
  },
  {
    name: "create a project: its page opens; a local file added there opens and is saved into it; reload lists it with 1 model",
    projects: ["desktop", "iphone13"],
    timeout: 120000,
    allowErrors: NOISE,
    fn: async ({ page, project }) => {
      await visitor(page);
      await newProject(page, "Harbour Street");
      assert.equal((await folders(page)).length, 1);
      assert.equal(await page.getByTestId("proj-count").innerText(), "0 models");
      assert.deepEqual(await smallTargets(page, ".proj"), []);
      await shot(page, project, "project-empty");
      await page.getByRole("button", { name: "Add model" }).waitFor();
      await waitForModelAfter(page, () => page.locator('input[type="file"]').first().setInputFiles(fx("m-ifc4.ifc")));
      const f = (await folders(page))[0];
      const saved = await pollFor("the file in the project", async () => (await models(page)).find((m) => m.folderId === f.id));
      assert.equal(saved.name, "m-ifc4.ifc");
      assert.equal((await models(page)).length, 1);
      await page.locator(".header").getByText("Harbour Street").waitFor();
      await page.locator(".header").getByText("m-ifc4.ifc").waitFor();
      await shot(page, project, "model-open");
      await openApp(page);
      await page.getByRole("button", { name: "Open project Harbour Street, 1 model" }).waitFor();
      await shot(page, project, "browser");
      await page.getByRole("button", { name: "Open project Harbour Street, 1 model" }).click();
      await page.getByRole("button", { name: "Open m-ifc4.ifc" }).waitFor();
      await shot(page, project, "project-page");
    },
  },
  {
    name: "outside a project a file is only viewed (nothing saved); Save to a project creates the project and saves it",
    projects: ["desktop", "iphone13"],
    timeout: 120000,
    allowErrors: NOISE,
    fn: async ({ page, project }) => {
      await visitor(page);
      await waitForModelAfter(page, () => page.locator('input[type="file"]').first().setInputFiles(fx("m-ifc4.ifc")));
      await page.waitForTimeout(1500);
      assert.equal((await models(page)).length, 0, "viewing saves nothing");
      await openSidebar(page);
      assert.equal(await page.getByText("Also save to my models").count(), 0);
      assert.equal(await page.getByText(/Save to my models/).count(), 0);
      await shot(page, project, "view-only");
      await page.getByRole("button", { name: "Save to a project" }).click();
      const dlg = page.getByRole("dialog", { name: "Save to a project" });
      await dlg.getByLabel("Project name").fill("Villa");
      await dlg.getByRole("button", { name: "Create and save" }).click();
      const f = await pollFor("the folder", async () => (await folders(page))[0]);
      const saved = await pollFor("the saved model", async () => (await models(page)).find((m) => m.folderId === f.id));
      assert.equal(saved.name, "m-ifc4.ifc");
      assert.equal(f.name, "Villa");
    },
  },
  {
    name: "the dummy project is a read-only demo that creates nothing on the server; Make my own project leads to New project",
    projects: ["desktop", "iphone13"],
    timeout: 120000,
    allowErrors: NOISE,
    fn: async ({ page, project }) => {
      await visitor(page);
      await page.getByRole("button", { name: "Try a dummy project" }).click();
      await page.getByRole("heading", { level: 1, name: "Dummy project" }).waitFor();
      await page.getByText("Demo", { exact: true }).waitFor();
      await page.getByText(/Nothing here is saved to your account/).waitFor();
      assert.equal(await page.getByRole("button", { name: "Add model" }).count(), 0, "read-only");
      await shot(page, project, "dummy");
      await waitForModelAfter(page, () => page.getByRole("button", { name: "Open Sample building" }).click());
      await page.waitForTimeout(1000);
      assert.equal((await folders(page)).length, 0, "no folder created");
      assert.equal((await models(page)).length, 0, "no model created");
      await page.reload();
      await page.getByRole("button", { name: "Try a dummy project" }).waitFor();
    },
  },
  {
    name: "the dummy project: Make my own project asks for a name and opens the new project",
    projects: ["iphone13"],
    allowErrors: NOISE,
    fn: async ({ page }) => {
      await visitor(page);
      await page.getByRole("button", { name: "Try a dummy project" }).click();
      await page.getByRole("button", { name: "Make my own project" }).click();
      const dlg = page.getByRole("dialog", { name: "New project" });
      await dlg.getByLabel("Project name").fill("Mine");
      await dlg.getByRole("button", { name: "Create" }).click();
      await page.getByRole("heading", { level: 1, name: "Mine" }).waitFor();
      await page.getByRole("button", { name: /^Projects$/ }).first().click();
      await page.getByRole("button", { name: "Open project Mine, 0 models" }).waitFor();
    },
  },
  {
    name: "name rules: empty, duplicate (any case) and reserved names are refused",
    projects: ["iphone13"],
    allowErrors: [...NOISE],
    fn: async ({ page }) => {
      await visitor(page);
      await newProject(page, "Alpha");
      await page.getByRole("button", { name: /^Projects$/ }).first().click();
      await page.getByRole("button", { name: "New project", exact: true }).click();
      const dlg = page.getByRole("dialog", { name: "New project" });
      await dlg.getByRole("button", { name: "Create" }).click();
      await dlg.getByRole("alert").filter({ hasText: "Enter a name" }).waitFor();
      await dlg.getByLabel("Project name").fill("alpha");
      await dlg.getByRole("button", { name: "Create" }).click();
      await dlg.getByRole("alert").filter({ hasText: "already exists" }).waitFor();
      await dlg.getByLabel("Project name").fill("Unsorted");
      await dlg.getByRole("button", { name: "Create" }).click();
      await dlg.getByRole("alert").filter({ hasText: "already exists" }).waitFor();
      assert.equal((await folders(page)).length, 1);
    },
  },
  {
    name: "rename and delete a project from its page; deleting keeps the models (they move to Unsorted)",
    projects: ["desktop", "iphone13"],
    timeout: 120000,
    allowErrors: NOISE,
    fn: async ({ page }) => {
      await visitor(page);
      await newProject(page, "Old name");
      const f = (await folders(page))[0];
      await call(page, "POST", `/models?name=in-proj.ifc`, ifc());
      const rec = (await models(page))[0];
      assert.equal((await call(page, "PATCH", `/models/${rec.id}`, { folderId: f.id })).status, 200);
      await openApp(page);
      await page.getByRole("button", { name: "Open project Old name, 1 model" }).click();
      await page.getByRole("button", { name: "More actions for project Old name" }).click();
      await page.getByRole("button", { name: "Rename", exact: true }).click();
      await page.getByLabel("New name for Old name").fill("New name");
      await page.getByLabel("New name for Old name").press("Enter");
      await page.getByRole("heading", { level: 1, name: "New name" }).waitFor();
      assert.equal((await folders(page))[0].name, "New name");
      await page.getByRole("button", { name: "More actions for project New name" }).click();
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete project" }).click();
      await page.getByRole("button", { name: "Open project Unsorted, 1 model" }).waitFor();
      assert.equal((await folders(page)).length, 0);
      assert.equal((await models(page)).length, 1, "the model is still saved");
    },
  },
  {
    name: "Unsorted shows loose models last; Move to... puts one in a project",
    projects: ["desktop", "iphone13"],
    timeout: 120000,
    allowErrors: NOISE,
    fn: async ({ page, project }) => {
      await visitor(page);
      await call(page, "POST", "/folders", { name: "Target", parentId: null });
      assert.equal((await call(page, "POST", "/models?name=loose.ifc", ifc())).status, 201);
      await openApp(page);
      await page.locator(".proj-card").first().waitFor();
      const cards = await page.locator(".proj-card").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      assert.deepEqual(cards, ["Open project Target, 0 models", "Open project Unsorted, 1 model"], "Unsorted is last");
      await shot(page, project, "unsorted-browser");
      await page.getByRole("button", { name: "Open project Unsorted, 1 model" }).click();
      await page.getByRole("button", { name: "Open loose.ifc" }).waitFor();
      await page.getByRole("button", { name: "More actions for loose.ifc" }).click();
      await page.getByRole("button", { name: "Move to..." }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Target" }).click();
      await page.getByRole("button", { name: "Open project Target, 1 model" }).waitFor();
      assert.equal((await models(page))[0].folderId, (await folders(page))[0].id);
    },
  },
  {
    name: "a backend without folders keeps the plain start card",
    projects: ["desktop", "iphone13"],
    allowErrors: [...NOISE, /http 404/],
    fn: async ({ page }) => {
      await page.route("**/api/folders", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "not found" }));
      await visitor(page);
      await page.getByRole("button", { name: "Open IFC file" }).first().waitFor();
      assert.equal(await page.getByRole("button", { name: "New project", exact: true }).count(), 0);
      assert.equal(await page.locator(".proj").count(), 0);
    },
  },
  {
    name: "the library list failing shows the calm retry, not a broken browser",
    projects: ["iphone13"],
    allowErrors: [...NOISE, /http 5\d\d/, /requestfailed/],
    fn: async ({ page }) => {
      await visitor(page);
      await page.route("**/api/models", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Retry" }).waitFor({ timeout: 20000 });
      assert.equal(await page.locator(".proj").count(), 0);
    },
  },
]);

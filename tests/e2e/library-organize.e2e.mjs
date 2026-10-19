// Library sort / filter / search. Read-only against the real models; it uploads up to 6 throwaway
// __org_<random> files and deletes exactly those (by their own ids) in a finally block.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { suite, openApp, api, sleep } from "./lib.mjs";
import { buildIfc } from "../fixtures/generate.mjs";

const storeys = (n) => Array.from({ length: n }, (_, i) => ({ name: `L${i}`, elevation: i * 3 }));
const make = (tag, schema, n) => buildIfc({ schema, unit: "m", name: tag, storeys: storeys(n), wall: [4, 0.2, 2.8] });

async function upload(name, text) {
  let res;
  for (let i = 0; i < 3; i++) {
    res = await api.get(`/models?name=${encodeURIComponent(name)}`, { method: "POST", body: text });
    if (res.status !== 429) break;
    await sleep((Number(res.headers.get("retry-after")) || 30) * 1000 + 500); // the 10 a minute upload limit
  }
  if (res.status !== 201) throw new Error(`upload expected 201, got ${res.status}`);
  const rec = await res.json();
  if (!rec.name.startsWith("__org_")) throw new Error(`refusing: ${rec.name}`);
  return rec;
}
async function removeOwn(recs) {
  for (const r of recs) {
    const cur = await api.get(`/models/${encodeURIComponent(r.id)}`);
    if (cur.status !== 200) continue;
    if (!(await cur.json()).name.startsWith("__org_")) throw new Error(`refusing to delete ${r.id}`);
    await api.get(`/models/${encodeURIComponent(r.id)}`, { method: "DELETE" });
  }
}

async function withSet(fn) {
  const tag = randomBytes(4).toString("hex");
  const spec = [
    [`__org_${tag}_mid.ifc`, "IFC4", 3],
    [`__org_${tag}_alpha MEP.ifc`, "IFC2X3", 1],
    [`__org_${tag}_Zulu.ifc`, "IFC2X3", 6],
    [`__org_${tag}_Blåbær STR.ifc`, "IFC4", 2],
    [`__org_${tag}_beta ARC.ifc`, "IFC4", 5],
    [`__org_${tag}_gamma.ifc`, "IFC4", 4],
  ];
  const recs = [];
  try {
    for (const [name, schema, n] of spec) {
      recs.push(await upload(name, make(`${tag}${recs.length}`, schema, n)));
      await sleep(30);
    }
    return await fn({ tag, recs });
  } finally {
    await removeOwn(recs);
  }
}

const ours = (page, tag) => page.locator(".lib--empty .lib-list .lib-row__main").evaluateAll((els, t) => els.map((e) => e.getAttribute("aria-label").replace(/^Open /, "")).filter((n) => n.startsWith(`__org_${t}_`)).map((n) => n.slice(`__org_${t}_`.length).replace(/\.ifc$/, "")), tag);
const sortBy = (page, label) => page.locator(".lib--empty").getByLabel("Sort by").selectOption({ label });
const dirBtn = (page) => page.locator(".lib--empty").getByRole("button", { name: /^Order:/ });

await suite("library-organize", [
  {
    name: "sort, filter and search the library; real models untouched",
    projects: ["desktop", "iphone13"],
    timeout: 240000,
    fn: async ({ page }) => {
      const realBefore = (await (await api.get("/models")).json()).map((m) => m.id).sort();
      await withSet(async ({ tag, recs }) => {
        await openApp(page);
        await page.evaluate(() => localStorage.removeItem("argus.library.organize"));
        await page.reload();
        await page.locator(".lib--empty").getByLabel("Sort by").waitFor();

        // default: date added, newest first
        assert.deepEqual(await ours(page, tag), ["gamma", "beta ARC", "Blåbær STR", "Zulu", "alpha MEP", "mid"], "default order");
        await dirBtn(page).click();
        assert.deepEqual(await ours(page, tag), ["mid", "alpha MEP", "Zulu", "Blåbær STR", "beta ARC", "gamma"], "oldest first");
        // name: A to Z (case-insensitive, å after z)
        await sortBy(page, "Name");
        // the browser's own Norwegian collation decides where "Blåbær" goes, so ask it
        const az = await page.evaluate((n) => [...n].sort(new Intl.Collator("nb", { numeric: true, sensitivity: "base" }).compare), ["alpha MEP", "beta ARC", "gamma", "mid", "Zulu", "Blåbær STR"]);
        assert.deepEqual(await ours(page, tag), az, "name A to Z");
        await dirBtn(page).click();
        assert.deepEqual(await ours(page, tag), [...az].reverse(), "name Z to A");
        // size: largest first by default, then smallest
        await sortBy(page, "Size");
        assert.deepEqual(await ours(page, tag), ["Zulu", "beta ARC", "gamma", "mid", "Blåbær STR", "alpha MEP"], "largest first");
        await dirBtn(page).click();
        assert.deepEqual((await ours(page, tag)).reverse(), ["Zulu", "beta ARC", "gamma", "mid", "Blåbær STR", "alpha MEP"], "smallest first");

        // format chip
        const chips = page.locator(".lib--empty").getByRole("group", { name: "Filters" });
        const f2 = chips.getByRole("button", { name: "IFC2X3", exact: true });
        await f2.click();
        assert.equal(await f2.getAttribute("aria-pressed"), "true");
        assert.deepEqual((await ours(page, tag)).sort(), ["Zulu", "alpha MEP"]);
        // discipline chip combines with the format chip (AND)
        await chips.getByRole("button", { name: "MEP", exact: true }).click();
        assert.deepEqual(await ours(page, tag), ["alpha MEP"]);
        await chips.getByRole("button", { name: "ARC", exact: true }).click(); // MEP or ARC, but only IFC2X3
        assert.deepEqual(await ours(page, tag), ["alpha MEP"]);
        await f2.click();
        assert.deepEqual((await ours(page, tag)).sort(), ["alpha MEP", "beta ARC"]);
        await chips.getByRole("button", { name: "MEP", exact: true }).click();
        await chips.getByRole("button", { name: "ARC", exact: true }).click();
        assert.equal((await ours(page, tag)).length, 6, "chips off shows all");
        // samples stay while chips are on
        await f2.click();
        await page.getByRole("button", { name: "Open Sample building" }).waitFor();
        await f2.click();

        // search: diacritics and case; Esc clears; count
        const q = page.locator(".lib--empty").getByLabel("Search my models");
        await q.fill(`${tag} BLABAER`);
        assert.deepEqual(await ours(page, tag), ["Blåbær STR"]);
        await page.locator(".lib--empty").getByTestId("lib-count").filter({ hasText: /^1 of \d+$/ }).waitFor();
        await q.press("Escape");
        assert.equal(await q.inputValue(), "");
        assert.equal((await ours(page, tag)).length, 6);
        // empty result and Clear filters
        await q.fill("zzzqqq-none");
        await page.getByText("No models match.").waitFor();
        assert.equal(await page.getByRole("button", { name: "Open Sample building" }).count(), 0, "a search that matches nothing hides the sample too");
        await page.getByRole("button", { name: "Clear filters" }).click();
        assert.equal(await q.inputValue(), "");
        assert.equal((await ours(page, tag)).length, 6);

        // remembered: sort choice survives a reload
        await sortBy(page, "Name");
        await page.reload();
        await page.locator(".lib--empty").getByLabel("Sort by").waitFor();
        assert.equal(await page.locator(".lib--empty").getByLabel("Sort by").inputValue(), "name");

        // no sideways overflow at 320 px
        await page.setViewportSize({ width: 320, height: 700 });
        await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(over <= 0, `horizontal overflow ${over}px at 320`);
        for (const el of await page.locator(".lib--empty .lib-org button, .lib--empty .lib-org select, .lib--empty .lib-org input").all()) {
          const b = await el.boundingBox();
          if (b) assert.ok(b.height >= 43.5 && b.width >= 43.5, `target ${Math.round(b.width)}x${Math.round(b.height)} too small`);
        }
      });
      assert.deepEqual((await (await api.get("/models")).json()).map((m) => m.id).sort(), realBefore, "the real models are unchanged");
    },
  },
]);

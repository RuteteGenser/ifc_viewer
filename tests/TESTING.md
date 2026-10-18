# Testing Argus

No new dependencies: `node:test`, `node:assert` and playwright (resolved from `/opt/repos/web/node_modules` by `tests/e2e/lib.mjs`).

```
tests/run-all.sh                  everything (unit + api + e2e against the live site)
tests/run-all.sh --unit           ~5 s, no browser
tests/run-all.sh --api            backend suites on scratch ports (~35 s) + read-only live smoke
tests/run-all.sh --e2e            browser tests against ARGUS_URL (default http://localhost:3700)
tests/run-all.sh --e2e --hook     plus the state-hook cases against a scratch build
tests/run-all.sh --e2e-only library     one e2e file
ARGUS_REAL=1 tests/run-all.sh --e2e-only real-files     real downloaded models (not in git)
```
Exit code is non-zero on any failure; the last lines are a summary. Logs are kept in a temp dir that is printed at the end. The machine has 2 cores: do not run suites in parallel with each other or with a deploy, the software-GL browser gets slow and timing-based cases suffer.

## Layers

### Unit (`tests/unit/*.test.mjs`)
Pure modules, imported unchanged. `tests/unit/helpers/register.mjs` is a tiny node loader that resolves Vite-style extensionless imports and `import.meta.env`; nothing in `src/` was modified.
Covered: `projectUnits` (m/mm/cm/km, area/volume prefix rule, gram/kg, feet/inch conversion units, missing units, CRLF, units at the END of a 7 MB file, full-scan fallback), `elementDetails` (units, booleans, empty sets hidden, filter, storey elevation in metres, materials), `storeys` (mm/m/feet fixtures read through real web-ifc, merge across models), `spatialTree`, `modelBounds` (outliers, <30 elements untouched, section sheet), `ifcSchemas.schemaIdOf`, `viewHelpers` (view link round trip, bad links), `formatLength`, `dimensionTagFormat`, `library/api.js` and `format.js` (mock fetch: no-library cases, error sentences, streaming download, rename/delete).
Not unit tested: `useLeaveGuard` (needs React + `window.history`; covered by `back-guard.e2e.mjs`), `zoomMetrics`/`zoomAlongRay` (live inside the 5 700-line `useIfcViewer` effect and need three.js + a DOM; covered through the test hook in `navigation.e2e.mjs`), `useLibrary`, `rawIfcQuery`, `ifcImportClient/Worker` (browser workers; covered by e2e).
Mutation check done once by hand: flipping a unit factor, the 30-element rule, the schema case, the Yes/No mapping, the library "no library" statuses, the tree sort and the view-link length each made a test fail.

### API (`tests/api/`)
`run.sh` runs `/opt/ifc-viewer-host/api/test.mjs` (63 checks) and `contract-test.mjs` (12) exactly as the api README documents: scratch ports 4180-4195, temp data dirs, never the live service or `data/`. It refuses to start if a scratch port is busy. `smoke.mjs` is read-only against the live service: health, auth required, listing fields, stats, 404, sha256 + size of the smallest model, Range request. It never uploads, renames or deletes (a download bumps that model's `downloads` counter).

### E2E (`tests/e2e/*.e2e.mjs`)
One file per flow. Each case runs on three profiles: `desktop` (1440x900), `iphone13`, `ipad-mini` (portrait), each in a fresh context, no retries, 60-170 s timeout. Output: one `PASS|FAIL|SKIP|KNOWN-FAIL` line per case and profile with timing, then a per-file summary line. Failures save a screenshot to `tests/e2e/out/` (git-ignored) and print the first browser errors.

| file | flow |
|---|---|
| first-open | empty state, file chooser, sample, ?demo=1 |
| local-file | open .ifc via the file input; select a wall; storey elevation in metres (mm/m/feet/end-of-file units, FZK from the library) |
| invalid-inputs | empty file, text file, .txt, truncated, no geometry: accurate message, no stuck spinner, app usable after |
| library | list (read-only), ?model=, open via UI, rename, delete, missing id deep link, dropped download. Writes only to a throwaway `__test_<random>.ifc`, deleted by its own id in `finally`; the 4 real models are never touched |
| tools | measure (+Done, Esc), section preset + Undo, hide + Undo/Redo, isolate via search + Show all, level "Only" |
| navigation | wheel zoom limits and toasts once, Home, zoom buttons, touch pinch, orbit pivot (state hook) |
| back-guard | Back asks, Stay, second Back, Leave, #hash change |
| offline | reload offline opens the sample (?demo=1 and by hand) |
| pwa | manifest, icons, service worker active |
| landing | header + 2 sections, links, no horizontal overflow at 375/768/1440 |
| bigfile | 17 MB file: longest main-thread gap < 1.5 s |
| real-files | (ARGUS_REAL=1) duplex, clinic, fzk, school_str levels in metres |

`lib.mjs` has the helpers: `suite`, `openApp`, `loadSample`, `loadFile`, `setFile`, `waitForModelAfter` (waits for the app's own `model-shown` performance mark and the overlay to disappear: works on phones where the sidebar is a closed drawer), `canvasStats`, `tapModel`, `readLevels`, `viewShot`/`pngDiff`, `watchToasts`, `touchSession` (CDP touch/pinch), `createThrowaway`/`removeThrowaway`. Any console error, page error, failed request or HTTP >= 400 fails a case unless the case lists it in `allowErrors`.

#### Test hook build (state assertions)
The deployed build has no `window.__ifcDebug`. Cases that need it call `requireHook` and SKIP with a message otherwise. Build and serve a scratch copy (proxies `/api` to the real service):
```
tests/e2e/hook-build.sh start        # builds with VITE_TEST_HOOK=1 into /tmp/argus-hook-build, serves http://127.0.0.1:4390
ARGUS_URL=http://127.0.0.1:4390 node tests/e2e/navigation.e2e.mjs
tests/e2e/hook-build.sh stop         # REBUILD=1 to rebuild after source changes
```
`run-all.sh --hook` does this for you and runs `navigation`. Landing/PWA cases skip on that URL where there is no landing page.

## Environment variables
`ARGUS_URL` base URL (default http://localhost:3700) - `ARGUS_AUTH` user:pass (default ifc:123) - `ARGUS_PROJECTS` comma list to narrow profiles - `ARGUS_ONLY` substring of a case name - `ARGUS_REAL=1` real-file smoke - `ARGUS_MODELS_DIR`, `ARGUS_BIG_FILE` input locations (cases skip when missing) - `ARGUS_STRICT=1` count known-failing cases as failures - `ARGUS_HOOK_DIR`, `ARGUS_HOOK_PORT`, `REBUILD`.

## Adding a test
Unit: new `tests/unit/x.test.mjs`, import from `../../src/...js`; fixtures from `tests/unit/helpers/fixtures.mjs`. E2E: new `tests/e2e/x.e2e.mjs` calling `suite("x", [{ name, projects?, allowErrors?, knownFailing?, timeout?, fn: async ({ page, ctx, project, touch, phone, skip }) => {...} }])`. Wait on app state (marks, roles, text), never on fixed sleeps for outcomes; a flaky test is a bug in the test. `knownFailing: "why"` keeps the assertion intact but reports KNOWN-FAIL (exit 0, unless ARGUS_STRICT=1) until the bug is fixed; it prints a note when the case starts passing.
Fixtures: `node tests/fixtures/generate.mjs` regenerates `tests/fixtures/*` (deterministic; mm, m and feet; IFC2X3 and IFC4; units at the end; no units; no geometry; empty; truncated; text). Do not commit real or licensed models.

## Known failing tests
See the "Known failing" section of the final report in the lane hand-off; currently none are marked `knownFailing` in the code. (Update this paragraph when a bug is accepted for v1.)

## Other lanes
`lane-reliability` adds `tests/reliability/` and `tests/e2e/stale-build.e2e.mjs`. They are not edited here. `run-all.sh --e2e` runs every `tests/e2e/*.e2e.mjs`, so `stale-build` is picked up automatically after merge if it uses the same `suite` runner or prints a final `PASS|FAIL <name>:` line; reliability scripts under `tests/reliability/` are run by their own runner. Both branches add only new files plus this file name differs (`TESTING.md` vs their README), so the merge is conflict free.

# Reliability tests

Everything here is plain Node (no new dependencies, no package.json scripts).

## Unit tests (node:test, no browser)

    node --test tests/reliability/*.test.mjs

Node 22 wants the glob (a bare directory argument is treated as a file).

- `importErrors.test.mjs`: the failure taxonomy (INVALID_FILE, APP_ASSET_FAILED,
  WORKER_CRASHED, OUT_OF_MEMORY, TIMEOUT, CANCELLED, ...), which kinds are retried,
  and that "valid IFC" is only ever said for INVALID_FILE.
- `recovery.test.mjs`: the one-reload-per-minute loop guard, the resume-after-reload
  intent (once, expires), build id parsing.
- `integrity.test.mjs`: library download checks (length, size, header, sha256).

## End-to-end: stale tab after a deploy

    node tests/e2e/stale-build.e2e.mjs

Builds this checkout with vite (about 30 s; set `ARGUS_E2E_SITE=<dir containing app/>`
to reuse a build), derives "the next deploy" with `tests/e2e/rehash-site.mjs` (every hashed
asset renamed, old names no longer served), serves both from a small nginx-like server with
a mock library, and drives chromium. Scenarios: a tab opened before the deploy opens a
library model (must reload once and open it by itself), picks a local file (must say the
page was updated and ask to pick it again), idles while a new version appears (banner, no
reload), meets a deploy that never works (exactly one automatic reload, then a Reload
button), keeps working on the service worker's previous cache, and gets a really invalid
file (still says so, with Details).

Playwright is not a dependency of this repo: it is resolved from `/opt/repos/web/node_modules`
(`createRequire`). Set `ARGUS_E2E_WEB` to another directory that has it, and
`ARGUS_E2E_PORT` (default 4791) if the port is taken.

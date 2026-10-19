#!/usr/bin/env bash
# API layer: the backend's own suites on scratch ports and temp data dirs, plus a
# read-only smoke of the live service. Never writes to /opt/ifc-viewer-host/data.
#   tests/api/run.sh            both
#   tests/api/run.sh --suites   only the backend suites (test.mjs, contract-test.mjs)
#   tests/api/run.sh --smoke    only the live read-only smoke
# env: API_DIR (default /opt/ifc-viewer-host/api), ARGUS_URL, ARGUS_AUTH, BIG, LIVE_COPY
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
API_DIR="${API_DIR:-/opt/ifc-viewer-host/api}"
mode="${1:-all}"
rc=0
SCRATCH_PORTS="4180 4182 4183 4184 4185 4186 4187 4188 4189 4191 4195"

run_suites() {
  for p in $SCRATCH_PORTS; do
    if (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null; then
      echo "FAIL api suites: scratch port $p is busy (another test run?). Wait and retry."; return 1
    fi
  done
  local t0=$SECONDS out
  out="$(mktemp)"
  # test.mjs picks its own temp data dirs and ports 4180-4191; it must never get BASE (that would aim it at a real stack).
  ( cd "$API_DIR" && env -u BASE node test.mjs ) >"$out" 2>&1; local a=$?
  local pass; pass=$(grep -c '^PASS' "$out")
  grep -E '^FAIL|^SKIP' "$out" | head -20
  if [ $a -eq 0 ] && [ "$pass" -ge 60 ]; then echo "PASS api test.mjs: $pass checks ($((SECONDS - t0)) s)"; else echo "FAIL api test.mjs: exit $a, $pass PASS lines (log: $out)"; rc=1; fi
  t0=$SECONDS
  ( cd "$API_DIR" && node contract-test.mjs ) >"$out" 2>&1; local c=$?
  pass=$(grep -c '^PASS' "$out")
  if [ $c -eq 0 ] && [ "$pass" -ge 10 ]; then echo "PASS api contract-test.mjs: $pass checks ($((SECONDS - t0)) s)"; else echo "FAIL api contract-test.mjs: exit $c, $pass PASS lines"; tail -5 "$out"; rc=1; fi
}

run_smoke() {
  node "$HERE/smoke.mjs" || rc=1
}

case "$mode" in
  --suites) run_suites ;;
  --smoke) run_smoke ;;
  *) run_suites; run_smoke ;;
esac
exit $rc

#!/usr/bin/env bash
# Runs every test layer and prints a summary. Exit code is non-zero if anything failed.
#   tests/run-all.sh                 unit + api + e2e (against ARGUS_URL, default http://localhost:3700)
#   tests/run-all.sh --unit          only unit tests (node:test, no browser, ~5 s)
#   tests/run-all.sh --api           only the API layer (backend suites on scratch ports + read-only live smoke)
#   tests/run-all.sh --e2e           only browser tests
#   tests/run-all.sh --hook          with --e2e (or alone): also run the state-hook cases against a scratch test-hook build
#   tests/run-all.sh --e2e-only NAME run just tests/e2e/NAME.e2e.mjs (e.g. library)
# env: ARGUS_URL ARGUS_AUTH ARGUS_PROJECTS=desktop,iphone13,ipad-mini ARGUS_REAL=1 ARGUS_STRICT=1 (see tests/TESTING.md)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"
want_unit=0; want_api=0; want_e2e=0; want_hook=0; only=""
if [ $# -eq 0 ]; then want_unit=1; want_api=1; want_e2e=1; fi
while [ $# -gt 0 ]; do
  case "$1" in
    --unit) want_unit=1 ;; --api) want_api=1 ;; --e2e) want_e2e=1 ;; --hook) want_hook=1 ;;
    --e2e-only) want_e2e=1; shift; only="$1" ;;
    *) echo "unknown flag $1"; exit 2 ;;
  esac; shift
done
rc=0; SUMMARY=(); LOG="$(mktemp -d)"
note() { SUMMARY+=("$1"); }

if [ $want_unit -eq 1 ]; then
  echo "== unit"; t0=$SECONDS
  node --import ./tests/unit/helpers/register.mjs --test --test-reporter=spec "tests/unit/*.test.mjs" >"$LOG/unit.log" 2>&1; u=$?
  grep -E "^ℹ (tests|pass|fail|skipped)" "$LOG/unit.log"; grep -E "^✖" "$LOG/unit.log" | head -20
  if [ $u -eq 0 ]; then note "PASS unit ($((SECONDS - t0)) s)"; else note "FAIL unit (log $LOG/unit.log)"; rc=1; fi
fi

if [ $want_api -eq 1 ]; then
  echo "== api"; out="$("$HERE/api/run.sh" 2>&1)"; a=$?; echo "$out" | grep -E "^(PASS|FAIL|SKIP) (api|GET|the|a |unauth)" | head -30
  if [ $a -eq 0 ]; then note "PASS api"; else note "FAIL api"; echo "$out" | tail -15; rc=1; fi
fi

run_e2e_file() { # file url label
  local f="$1" url="$2" label="$3" name; name="$(basename "$f" .e2e.mjs)"
  echo "== e2e $name $label"
  ARGUS_URL="$url" node "$f" >"$LOG/e2e-$name$label.log" 2>&1; local e=$?
  grep -E "^(PASS|FAIL|KNOWN-FAIL|SKIP)" "$LOG/e2e-$name$label.log" | cut -c1-200
  grep -E "^    " "$LOG/e2e-$name$label.log" | grep -B0 -A0 "known bug" | head -5
  local last; last="$(grep -E "^(PASS|FAIL) $name:" "$LOG/e2e-$name$label.log" | tail -1)"
  # Scripts with their own runner (stale-build, auto-recovery, load-queue,
  # sw-navigation) end with exit code 0 and no summary line: that is a pass.
  if [ -z "$last" ]; then
    if [ $e -eq 0 ]; then last="PASS $name: exit 0 (own runner, see $LOG/e2e-$name$label.log)"
    else last="FAIL $name: crashed (see $LOG/e2e-$name$label.log)"; fi
  fi
  note "$last $label"; [ $e -ne 0 ] && rc=1
}

if [ $want_e2e -eq 1 ] || [ $want_hook -eq 1 ]; then
  URL="${ARGUS_URL:-http://localhost:3700}"
  if [ $want_e2e -eq 1 ]; then
    for f in tests/e2e/${only:-*}.e2e.mjs; do [ -f "$f" ] && run_e2e_file "$f" "$URL" ""; done
  fi
  if [ $want_hook -eq 1 ]; then
    HURL="$("$ROOT/tests/e2e/hook-build.sh" start)" || { note "FAIL hook build"; rc=1; HURL=""; }
    if [ -n "$HURL" ]; then
      for n in navigation; do run_e2e_file "tests/e2e/$n.e2e.mjs" "$HURL" "[hook build]"; done
      "$ROOT/tests/e2e/hook-build.sh" stop
    fi
  fi
fi

echo; echo "================ SUMMARY ================"
printf '%s\n' "${SUMMARY[@]}"
echo "logs: $LOG"
[ $rc -eq 0 ] && echo "ALL GREEN" || echo "FAILURES"
exit $rc

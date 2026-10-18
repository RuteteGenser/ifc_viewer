#!/usr/bin/env bash
# Builds a scratch copy of the viewer with the test hook compiled in (window.__ifcDebug) and
# serves it on a scratch port. The deployed site never contains the hook.
#   tests/e2e/hook-build.sh start   build (if needed) + serve, prints the URL
#   tests/e2e/hook-build.sh stop    stop the server
# env: ARGUS_HOOK_DIR (default /tmp/argus-hook-build), ARGUS_HOOK_PORT (default 4390), REBUILD=1
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
DIR="${ARGUS_HOOK_DIR:-/tmp/argus-hook-build}"; PORT="${ARGUS_HOOK_PORT:-4390}"; PIDF="$DIR/server.pid"
case "${1:-start}" in
  start)
    if [ ! -f "$DIR/app/index.html" ] || [ -n "${REBUILD:-}" ]; then
      ( cd "$ROOT" && node scripts/copy-wasm.mjs >/dev/null && VITE_TEST_HOOK=1 npx vite build --base=/app/ --outDir "$DIR/app" --emptyOutDir >"$DIR.build.log" 2>&1 ) || { echo "build failed, see $DIR.build.log"; exit 1; }
    fi
    if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then :; else
      node "$HERE/serve-testbuild.mjs" "$DIR" "$PORT" >"$DIR/server.log" 2>&1 &
      echo $! >"$PIDF"; sleep 1
    fi
    echo "http://127.0.0.1:$PORT" ;;
  stop) [ -f "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null && rm -f "$PIDF" || true ;;
esac

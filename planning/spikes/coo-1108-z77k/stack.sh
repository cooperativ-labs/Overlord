#!/bin/sh
# Scratch acceptance stack control (coo:1108.z77k). Not production code.
# Requires: W (scratch directory holding cloud.env, state.json, ovld-src.mts, logs/) and
# ROOT (this repository). cloud.env is the backend environment, one NAME=value per line.
# usage: stack.sh backend-start|backend-stop|backend-kill9|runner-start <n>|runner-stop <n>|status
: "${W:?set W to the scratch directory}" "${ROOT:?set ROOT to the repository}"
TSX="$ROOT/node_modules/tsx/dist/loader.mjs"
case "$1" in
  backend-start)
    cd "$ROOT/backend" && nohup env -i $(grep -v '^#' "$W/cloud.env" | xargs) $EXTRA_ENV \
      node --import tsx --import ../planning/spikes/coo-1108-z77k/kb-preload.ts index.ts >> "$W/logs/backend-cloud.log" 2>&1 &
    until curl -s -o /dev/null --max-time 2 http://127.0.0.1:4411/api/health; do sleep 0.5; done
    echo "backend up" ;;
  backend-stop) pkill -TERM -f "kb-preload.ts index.ts"; sleep 1; echo stopped ;;
  backend-kill9) pkill -KILL -f "kb-preload.ts index.ts"; echo killed ;;
  runner-start)
    TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$W/state.json','utf8')).runnerTokens['t$2'])")
    LABEL="Jake Mac"; [ "$2" = 2 ] && LABEL="Build Box"
    # ovld-src.mts: import { runCli } from '<ROOT>/cli/src/index.ts'; runCli({ primaryCommand: 'ovld' })
    cd "$W" && nohup env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp OVLD_HOME="$W/home-t$2" \
      OVERLORD_BACKEND_URL=http://127.0.0.1:4411 OVERLORD_USER_TOKEN="$TOKEN" \
      OVERLORD_DEVICE_FINGERPRINT="acceptance-target-$2" OVERLORD_DEVICE_LABEL="$LABEL" \
      node --import "$TSX" "$W/ovld-src.mts" runner start --poll-interval-ms 500 >> "$W/logs/runner-t$2.log" 2>&1 &
    echo "runner $2 started" ;;
  runner-stop)
    for p in $(pgrep -f "ovld-src.mts runner"); do
      if ps eww -p "$p" | grep -q "acceptance-target-$2"; then kill "$p"; fi
    done
    echo "runner $2 stopped" ;;
  status)
    pgrep -fl "kb-preload.ts index.ts" | cut -c1-60
    for p in $(pgrep -f "ovld-src.mts runner"); do ps eww -p "$p" | grep -o "acceptance-target-[0-9]" | head -1; done ;;
esac

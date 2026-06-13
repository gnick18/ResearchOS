#!/usr/bin/env bash
#
# One-command local test for the phone-push relay (P2 / phase 2.5 / P3).
#
# Boots a local `wrangler dev` relay with stdin DETACHED (so wrangler never reads
# interactive hotkeys -- that is what accidentally opens the public cloudflared
# tunnel when you paste into its terminal), relaxes the cooldown / dead-man's-switch
# timers so the harness does not wait, waits for the server, runs smoke-notify.mjs
# against it, then tears the relay down. Exits with the harness's status.
#
# Usage: from relay/ run `npm run test:notify` (or `bash scripts/smoke-notify-local.sh`).
# Override the port with PORT=9999 npm run test:notify.
set -uo pipefail

cd "$(dirname "$0")/.."
PORT="${PORT:-8787}"
LOG="$(mktemp -t ros-smoke-relay.XXXXXX)"

echo "Starting local relay on :$PORT (wrangler dev, no tunnel; log: $LOG)..."
# </dev/null detaches stdin so wrangler runs non-interactively (no hotkeys, no
# tunnel). Output goes to the log so a boot error is still inspectable.
npx wrangler dev --port "$PORT" \
  --var NOTIFY_COOLDOWN_MS:4000 --var REMINDER_STALE_MS:0 \
  </dev/null >"$LOG" 2>&1 &
WPID=$!

cleanup() {
  kill "$WPID" 2>/dev/null || true
  # wrangler spawns a workerd child; make sure it goes too.
  pkill -P "$WPID" 2>/dev/null || true
  pkill -f "workerd" 2>/dev/null || true
}
trap cleanup EXIT

echo "Waiting for the relay to boot..."
UP=""
for _ in $(seq 1 60); do
  # Any HTTP response (even a 404) means the server is up. curl -s exits 0 on 404.
  if curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/nope" 2>/dev/null; then
    UP="yes"
    break
  fi
  sleep 1
done

if [ -z "$UP" ]; then
  echo "FAIL: relay did not come up on :$PORT within 60s. wrangler log:"
  tail -30 "$LOG"
  exit 1
fi

echo "Relay up. Running smoke-notify..."
echo ""
BASE_URL="http://127.0.0.1:$PORT" node scripts/smoke-notify.mjs
STATUS=$?
exit "$STATUS"

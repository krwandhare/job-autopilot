#!/bin/bash
# Background scheduler: calls POST /api/jobs/sync-gmail on an interval so
# LinkedIn alert leads land in the Action Center without a manual button
# click or an agent session. Requires GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/
# GMAIL_REFRESH_TOKEN to already be set in the running dev server's
# environment (see scripts/gmail-oauth-setup.mjs) -- this script only
# triggers the sync, it does not hold credentials itself.
#
# Usage: ./scripts/gmail-sync-runner.sh [interval_seconds] [base_url]
#   Defaults: interval_seconds=1800 (30 min), base_url=http://localhost:3000
# Stop:  kill the PID printed at start (or see data/gmail-sync-runner.pid)
# Logs:  data/gmail-sync-runner.log

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTERVAL_SECONDS="${1:-1800}"
BASE_URL="${2:-http://localhost:3000}"
LOG_FILE="$DIR/data/gmail-sync-runner.log"
PID_FILE="$DIR/data/gmail-sync-runner.pid"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

cleanup() {
  log "stopping (signal received)"
  rm -f "$PID_FILE"
  exit 0
}
trap cleanup TERM INT

echo $$ > "$PID_FILE"
log "started, interval=${INTERVAL_SECONDS}s, base=${BASE_URL}, pid=$$"

while true; do
  response="$(curl -s -X POST "$BASE_URL/api/jobs/sync-gmail" -H "Content-Type: application/json" -d '{}')"
  summary="$(python3 -c "
import json, sys
try:
    d = json.loads(sys.argv[1])
    if 'error' in d:
        print('error:', d['error'])
    else:
        print(f\"imported={d.get('imported')} threadsProcessed={d.get('threadsProcessed')} rateLimited={d.get('rateLimited')} skipped={d.get('skipped')}\")
        for e in d.get('errors', []):
            print(' -', e)
except Exception as exc:
    print('unparseable response:', exc)
" "$response" 2>&1)"
  log "$summary"
  sleep "$INTERVAL_SECONDS"
done

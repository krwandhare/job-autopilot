#!/bin/bash
# Background queue runner: works through every "new" job with Auto-fill &
# submit, unattended. Never guesses at anything it can't resolve on its own
# -- any job with genuinely new questions, a manual-only field, or a
# non-code submit failure gets parked in "needs_review" instead of being
# skipped silently or answered with a guess. A verification-code blocker is
# already auto-parked to "needs_code" server-side (lib/autofill/filler.ts's
# submitApplication()); this script just closes that session and moves on.
#
# Usage: ./scripts/queue-runner.sh
# Stop:  kill the PID printed at start (or see data/queue-runner.pid)
# Logs:  data/queue-runner.log

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="http://localhost:3000"
LOG_FILE="$DIR/data/queue-runner.log"
POLL_EMPTY_SECONDS=300
BETWEEN_JOBS_SECONDS=8

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

json_get() {
  # json_get <json-on-stdin> <python-expr-on-`d`>
  python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print($1)
except Exception:
    print(\"\")
"
}

mark_status() {
  curl -sS -m 15 -X PATCH "$BASE_URL/api/jobs/$1" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"$2\"}" > /dev/null
}

finish_session() {
  curl -sS -m 15 -X POST "$BASE_URL/api/autofill/finish" \
    -H "Content-Type: application/json" \
    -d "{\"jobId\":$1}" > /dev/null
}

park_and_finish() {
  local job_id="$1" status="$2" why="$3"
  log "job $job_id: $why -- parking as $status"
  mark_status "$job_id" "$status"
  finish_session "$job_id"
}

trap 'log "=== queue runner stopped (pid $$) ==="; exit 0' TERM INT

log "=== queue runner started (pid $$) ==="

while true; do
  next_json=$(curl -sS -m 30 "$BASE_URL/api/autofill/next" 2>/dev/null)
  job_id=$(echo "$next_json" | json_get "(d.get('job') or {}).get('id','')")

  if [ -z "$job_id" ]; then
    log "queue empty, sleeping ${POLL_EMPTY_SECONDS}s"
    sleep "$POLL_EMPTY_SECONDS"
    continue
  fi

  job_title=$(echo "$next_json" | json_get "d['job'].get('title','')")
  job_company=$(echo "$next_json" | json_get "d['job'].get('company','')")
  log "picked job $job_id: $job_title @ $job_company"

  start_json=$(curl -sS -m 200 -X POST "$BASE_URL/api/autofill/start" \
    -H "Content-Type: application/json" \
    -d "{\"jobId\":$job_id,\"mode\":\"submit\"}" 2>/dev/null)
  status=$(echo "$start_json" | json_get "d.get('status','')")
  log "job $job_id start status: $status"

  if [ "$status" = "needs_input" ]; then
    park_and_finish "$job_id" "needs_review" "unanswered new questions"
    sleep "$BETWEEN_JOBS_SECONDS"
    continue
  fi

  if [ "$status" != "ready_for_review" ]; then
    park_and_finish "$job_id" "needs_review" "fill did not reach ready_for_review (status=$status)"
    sleep "$BETWEEN_JOBS_SECONDS"
    continue
  fi

  manual_count=$(echo "$start_json" | json_get "len(d.get('manualFields') or [])")
  if [ "$manual_count" != "0" ]; then
    park_and_finish "$job_id" "needs_review" "has manual-only field(s)"
    sleep "$BETWEEN_JOBS_SECONDS"
    continue
  fi

  submit_json=$(curl -sS -m 90 -X POST "$BASE_URL/api/autofill/submit" \
    -H "Content-Type: application/json" \
    -d "{\"jobId\":$job_id}" 2>/dev/null)
  submit_status=$(echo "$submit_json" | json_get "d.get('status','')")
  log "job $job_id submit status: $submit_status"

  if [ "$submit_status" = "submitted" ]; then
    mark_status "$job_id" "applied"
    finish_session "$job_id"
    log "job $job_id: APPLIED"
  elif [ "$submit_status" = "unconfirmed" ]; then
    needs_code=$(echo "$submit_json" | json_get "d.get('needsVerificationCode', False)")
    if [ "$needs_code" = "True" ]; then
      log "job $job_id: needs verification code (auto-parked server-side)"
      finish_session "$job_id"
    else
      park_and_finish "$job_id" "needs_review" "submit unconfirmed, non-code reason"
    fi
  else
    park_and_finish "$job_id" "needs_review" "submit returned unexpected status ($submit_status)"
  fi

  sleep "$BETWEEN_JOBS_SECONDS"
done

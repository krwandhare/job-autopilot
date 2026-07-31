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

status_payload() {
  local status="$1" action_type="${2:-}" reason_code="${3:-}"
  local reason_text="${4:-}" details_json="${5:-[]}"
  if [ -n "$action_type" ]; then
    python3 -c '
import json, sys
try:
    details = json.loads(sys.argv[5])
except Exception:
    details = []
print(json.dumps({
    "status": sys.argv[1],
    "action": {
        "actionType": sys.argv[2],
        "reasonCode": sys.argv[3],
        "reasonText": sys.argv[4],
        "details": details[:10],
        "source": "queue_runner",
    },
}))
' "$status" "$action_type" "$reason_code" "$reason_text" "$details_json"
  else
    python3 -c 'import json, sys; print(json.dumps({"status": sys.argv[1]}))' "$status"
  fi
}

mark_status() {
  local job_id="$1" status="$2" action_type="${3:-}" reason_code="${4:-}"
  local reason_text="${5:-}" details_json="${6:-[]}" payload
  payload=$(status_payload "$status" "$action_type" "$reason_code" "$reason_text" "$details_json")
  curl -sS -m 15 -X PATCH "$BASE_URL/api/jobs/$1" \
    -H "Content-Type: application/json" \
    -d "$payload" > /dev/null
}

finish_session() {
  curl -sS -m 15 -X POST "$BASE_URL/api/autofill/finish" \
    -H "Content-Type: application/json" \
    -d "{\"jobId\":$1}" > /dev/null
}

park_and_finish() {
  local job_id="$1" status="$2" why="$3" action_type="$4" reason_code="$5"
  local reason_text="$6" details_json="${7:-[]}"
  log "job $job_id: $why -- parking as $status"
  mark_status "$job_id" "$status" "$action_type" "$reason_code" "$reason_text" "$details_json"
  finish_session "$job_id"
}

if [ "${QUEUE_RUNNER_FUNCTIONS_ONLY:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

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
    missing_details=$(echo "$start_json" | json_get \
      "json.dumps([str(f.get('label') or f.get('key') or 'Unlabeled question') for f in (d.get('missingFields') or [])][:10])")
    park_and_finish "$job_id" "needs_review" "unanswered new questions" \
      "application_review" "unanswered_questions" \
      "The application has questions that need your answer." "$missing_details"
    sleep "$BETWEEN_JOBS_SECONDS"
    continue
  fi

  if [ "$status" != "ready_for_review" ]; then
    failure_details=$(echo "$start_json" | json_get \
      "json.dumps([str(d.get('reason'))] if d.get('reason') else [])")
    if [ "$status" = "blocked" ]; then
      failure_code="browser_challenge_detected"
      failure_text="The employer page requires manual intervention before autofill can continue."
    else
      failure_code="autofill_error"
      failure_text="Autofill could not continue because the employer form or browser session failed."
    fi
    park_and_finish "$job_id" "needs_review" \
      "fill did not reach ready_for_review (status=$status)" \
      "application_review" "$failure_code" "$failure_text" "$failure_details"
    sleep "$BETWEEN_JOBS_SECONDS"
    continue
  fi

  manual_count=$(echo "$start_json" | json_get "len(d.get('manualFields') or [])")
  if [ "$manual_count" != "0" ]; then
    manual_details=$(echo "$start_json" | json_get \
      "json.dumps([str(f.get('label') or f.get('key') or 'Unlabeled manual field') for f in (d.get('manualFields') or [])][:10])")
    park_and_finish "$job_id" "needs_review" "has manual-only field(s)" \
      "application_review" "manual_fields_required" \
      "The employer form contains fields or agreements that require your judgment." \
      "$manual_details"
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
      submit_details=$(echo "$submit_json" | json_get \
        "json.dumps([str(d.get('reason'))] if d.get('reason') else [])")
      park_and_finish "$job_id" "needs_review" "submit unconfirmed, non-code reason" \
        "application_review" "submission_unconfirmed" \
        "The submit attempt could not be confirmed and requires your review." \
        "$submit_details"
    fi
  else
    submit_details=$(echo "$submit_json" | json_get \
      "json.dumps([str(d.get('reason'))] if d.get('reason') else [])")
    park_and_finish "$job_id" "needs_review" \
      "submit returned unexpected status ($submit_status)" \
      "application_review" "submission_error" \
      "The application could not be submitted automatically and requires your review." \
      "$submit_details"
  fi

  sleep "$BETWEEN_JOBS_SECONDS"
done

#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DATA="$(mktemp -d "${TMPDIR:-/tmp}/job-autopilot-route-e2e.XXXXXX")"
PORT_A="${JOB_AUTOPILOT_E2E_PORT_A:-43102}"
PORT_B="${JOB_AUTOPILOT_E2E_PORT_B:-43103}"
PID_A=""
PID_B=""

cleanup() {
  if [ -n "$PID_A" ]; then kill "$PID_A" >/dev/null 2>&1 || true; fi
  if [ -n "$PID_B" ]; then kill "$PID_B" >/dev/null 2>&1 || true; fi
  if [ -n "$PID_A" ]; then wait "$PID_A" >/dev/null 2>&1 || true; fi
  if [ -n "$PID_B" ]; then wait "$PID_B" >/dev/null 2>&1 || true; fi
  rm -rf "$TEST_DATA"
}
trap cleanup EXIT

wait_for_server() {
  local port="$1" log_file="$2"
  for _ in $(seq 1 50); do
    if curl -fsS "http://127.0.0.1:$port/api/actions" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  printf 'server on port %s did not become ready\n' "$port" >&2
  tail -40 "$log_file" >&2 || true
  return 1
}

json_job_id() {
  python3 -c '
import json, sys
payload = json.load(sys.stdin)
print((payload.get("job") or {}).get("id", ""))
'
}

cd "$ROOT"
JOB_AUTOPILOT_DATA_DIR="$TEST_DATA" JOB_AUTOPILOT_INSTANCE_ID=codex-route-e2e \
  npm run start -- --hostname 127.0.0.1 --port "$PORT_A" >"$TEST_DATA/codex.log" 2>&1 &
PID_A=$!
JOB_AUTOPILOT_DATA_DIR="$TEST_DATA" JOB_AUTOPILOT_INSTANCE_ID=claude-route-e2e \
  npm run start -- --hostname 127.0.0.1 --port "$PORT_B" >"$TEST_DATA/claude.log" 2>&1 &
PID_B=$!

wait_for_server "$PORT_A" "$TEST_DATA/codex.log"
wait_for_server "$PORT_B" "$TEST_DATA/claude.log"

for endpoint in start answer submit finish; do
  malformed_code="$(
    curl -sS -o "$TEST_DATA/malformed-$endpoint.json" -w '%{http_code}' \
      -X POST "http://127.0.0.1:$PORT_A/api/autofill/$endpoint" \
      -H 'Content-Type: application/json' -d '{'
  )"
  [ "$malformed_code" = "400" ]
  python3 -c '
import json, sys
payload = json.load(open(sys.argv[1]))
assert isinstance(payload.get("error"), str)
assert payload["error"]
' "$TEST_DATA/malformed-$endpoint.json"
done

sqlite3 "$TEST_DATA/app.db" "
  INSERT INTO jobs
    (source, source_job_id, title, company, location, remote, url, fetched_at, match_score, status)
  VALUES
    ('test', 'route-1', 'Synthetic Backend Engineer', 'Synthetic One', 'Remote', 1,
     'https://example.invalid/1', '2026-07-30 12:00:00', 95, 'new'),
    ('test', 'route-2', 'Synthetic Frontend Engineer', 'Synthetic Two', 'Remote', 1,
     'https://example.invalid/2', '2026-07-30 11:00:00', 85, 'new');
"

next_a="$(curl -fsS "http://127.0.0.1:$PORT_A/api/autofill/next")"
next_b="$(curl -fsS "http://127.0.0.1:$PORT_B/api/autofill/next")"
job_a="$(printf '%s' "$next_a" | json_job_id)"
job_b="$(printf '%s' "$next_b" | json_job_id)"

[ "$job_a" = "1" ]
[ "$job_b" = "2" ]

conflict_code="$(
  curl -sS -o "$TEST_DATA/conflict.json" -w '%{http_code}' \
    "http://127.0.0.1:$PORT_B/api/autofill/next?jobId=1"
)"
[ "$conflict_code" = "409" ]

curl -fsS -X POST "http://127.0.0.1:$PORT_A/api/autofill/finish" \
  -H "Content-Type: application/json" -d '{"jobId":1}' >/dev/null
curl -fsS -X POST "http://127.0.0.1:$PORT_B/api/autofill/finish" \
  -H "Content-Type: application/json" -d '{"jobId":2}' >/dev/null

resume_code="$(
  curl -sS -o "$TEST_DATA/resume.json" -w '%{http_code}' \
    "http://127.0.0.1:$PORT_B/api/autofill/next?jobId=1"
)"
[ "$resume_code" = "200" ]

curl -fsS -X PATCH "http://127.0.0.1:$PORT_B/api/jobs/1" \
  -H "Content-Type: application/json" \
  -d '{
    "status":"needs_review",
    "action":{
      "actionType":"application_review",
      "reasonCode":"unanswered_questions",
      "reasonText":"The application has questions that need your answer.",
      "details":["Synthetic screening question"],
      "source":"route_e2e"
    }
  }' >/dev/null

actions="$(curl -fsS "http://127.0.0.1:$PORT_A/api/actions")"
printf '%s' "$actions" | python3 -c '
import json, sys
payload = json.load(sys.stdin)
items = payload.get("actions") or []
assert len(items) == 1
assert items[0]["jobId"] == 1
assert items[0]["reasonCode"] == "unanswered_questions"
assert items[0]["details"] == ["Synthetic screening question"]
'

curl -fsS -X POST "http://127.0.0.1:$PORT_B/api/autofill/finish" \
  -H "Content-Type: application/json" -d '{"jobId":1}' >/dev/null

claim_count="$(sqlite3 -readonly "$TEST_DATA/app.db" "SELECT COUNT(*) FROM job_claims;")"
[ "$claim_count" = "0" ]

printf 'Two-instance shared-runtime route E2E passed.\n'

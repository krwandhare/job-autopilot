#!/usr/bin/env bash
#
# Route/database integration regression for GET/PATCH /api/jobs/[id]
# against a disposable database (same pattern as the other
# scripts/test-*-route*.sh scripts) -- never reads or mutates the real
# data/app.db. Covers the status-transition side effects that live inside
# the route handler itself (application creation on -> "applied",
# job_actions recording/resolution), not just plain field persistence.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DATA="$(mktemp -d "${TMPDIR:-/tmp}/job-autopilot-job-detail-route-e2e.XXXXXX")"
PORT="${JOB_AUTOPILOT_E2E_PORT:-43124}"
PID=""

cleanup() {
  fuser -k "$PORT/tcp" >/dev/null 2>&1 || true
  if [ -n "$PID" ]; then kill "$PID" >/dev/null 2>&1 || true; fi
  if [ -n "$PID" ]; then wait "$PID" >/dev/null 2>&1 || true; fi
  rm -rf "$TEST_DATA"
}
trap cleanup EXIT

wait_for_server() {
  for _ in $(seq 1 50); do
    if curl -fsS "http://127.0.0.1:$PORT/api/actions" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  printf 'server on port %s did not become ready\n' "$PORT" >&2
  tail -40 "$TEST_DATA/server.log" >&2 || true
  return 1
}

field() {
  python3 -c "
import json, sys
payload = json.load(sys.stdin)
value = payload
for key in sys.argv[1:]:
    value = value[key]
print(json.dumps(value))
" "$@"
}

cd "$ROOT"
JOB_AUTOPILOT_DATA_DIR="$TEST_DATA" JOB_AUTOPILOT_INSTANCE_ID=job-detail-route-e2e \
  npm run start -- --hostname 127.0.0.1 --port "$PORT" >"$TEST_DATA/server.log" 2>&1 &
PID=$!

wait_for_server

TEST_DB_PATH="$TEST_DATA/app.db" \
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types -e '
  const Database = require("better-sqlite3");
  const db = new Database(process.env.TEST_DB_PATH);
  db.prepare(
    `INSERT INTO jobs
       (source, source_job_id, title, company, location, remote, url, fetched_at, match_score, status)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    "test", "job-detail-1", "Senior Backend Engineer", "Synthetic Job Detail Co", "Remote", 1,
    "https://example.invalid/job-detail-1", "2026-08-03 12:00:00", 90, "new"
  );
  db.prepare(
    `INSERT INTO jobs
       (source, source_job_id, title, company, location, remote, url, fetched_at, match_score, status)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    "test", "job-detail-2", "External Lead Role", "Synthetic Lead Co", "Remote", 1,
    "https://example.invalid/job-detail-2", "2026-08-03 12:00:00", 0, "external_lead"
  );
  db.close();
'

# GET for a nonexistent job returns a clean 404.
missing_status="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/jobs/999")"
[ "$missing_status" = "404" ] || {
  printf 'expected 404 for nonexistent job, got %s\n' "$missing_status" >&2
  exit 1
}

# GET returns the full expected shape for a real job, including a null
# draft (none generated yet).
get_response="$(curl -fsS "http://127.0.0.1:$PORT/api/jobs/1")"
job_title="$(printf '%s' "$get_response" | field job title)"
job_status="$(printf '%s' "$get_response" | field job status)"
draft_value="$(printf '%s' "$get_response" | field draft)"
[ "$job_title" = '"Senior Backend Engineer"' ] || {
  printf 'expected job title to round-trip, got %s\n' "$job_title" >&2
  exit 1
}
[ "$job_status" = '"new"' ] || {
  printf 'expected status "new", got %s\n' "$job_status" >&2
  exit 1
}
[ "$draft_value" = "null" ] || {
  printf 'expected no draft yet, got %s\n' "$draft_value" >&2
  exit 1
}

# PATCH rejects an invalid status without touching the row.
invalid_status_code="$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "http://127.0.0.1:$PORT/api/jobs/1" \
  -H "Content-Type: application/json" -d '{"status":"not-a-real-status"}')"
[ "$invalid_status_code" = "400" ] || {
  printf 'expected 400 for an invalid status, got %s\n' "$invalid_status_code" >&2
  exit 1
}
unchanged_status="$(sqlite3 "$TEST_DATA/app.db" "SELECT status FROM jobs WHERE id = 1;")"
[ "$unchanged_status" = "new" ] || {
  printf 'expected job 1 status to remain unchanged after a rejected PATCH, got %s\n' "$unchanged_status" >&2
  exit 1
}

# PATCH with a malformed body returns a clean 400, not a crash.
malformed_status="$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "http://127.0.0.1:$PORT/api/jobs/1" \
  -H "Content-Type: application/json" -d 'not valid json')"
[ "$malformed_status" = "400" ] || {
  printf 'expected 400 for malformed JSON, got %s\n' "$malformed_status" >&2
  exit 1
}

# PATCH to "applied" both updates status and creates a real applications
# row (the exact route-layer side effect a prior real bug in this repo was
# about -- see SESSION.md) -- confirmed directly against the database.
apply_status="$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "http://127.0.0.1:$PORT/api/jobs/1" \
  -H "Content-Type: application/json" -d '{"status":"applied"}')"
[ "$apply_status" = "200" ] || {
  printf 'expected 200 for a valid status PATCH, got %s\n' "$apply_status" >&2
  exit 1
}
new_status="$(sqlite3 "$TEST_DATA/app.db" "SELECT status FROM jobs WHERE id = 1;")"
[ "$new_status" = "applied" ] || {
  printf 'expected job 1 status to become "applied", got %s\n' "$new_status" >&2
  exit 1
}
application_row="$(sqlite3 "$TEST_DATA/app.db" "SELECT source FROM applications WHERE job_id = 1;")"
[ "$application_row" = "manual" ] || {
  printf 'expected an applications row with source=manual for a plain manual PATCH, got %s\n' "$application_row" >&2
  exit 1
}

# A job whose prior status was "external_lead" defaults the application's
# source to "external_lead" instead of "manual" when no applicationSource
# is explicitly given -- the route's own documented fallback rule.
curl -fsS -X PATCH "http://127.0.0.1:$PORT/api/jobs/2" \
  -H "Content-Type: application/json" -d '{"status":"applied"}' >/dev/null
lead_application_source="$(sqlite3 "$TEST_DATA/app.db" "SELECT source FROM applications WHERE job_id = 2;")"
[ "$lead_application_source" = "external_lead" ] || {
  printf 'expected source=external_lead for a job that was external_lead, got %s\n' "$lead_application_source" >&2
  exit 1
}

# Re-PATCHing to "applied" again (already applied) must not create a
# second applications row.
curl -fsS -X PATCH "http://127.0.0.1:$PORT/api/jobs/1" \
  -H "Content-Type: application/json" -d '{"status":"applied"}' >/dev/null
application_count="$(sqlite3 "$TEST_DATA/app.db" "SELECT COUNT(*) FROM applications WHERE job_id = 1;")"
[ "$application_count" = "1" ] || {
  printf 'expected exactly 1 applications row for job 1 after re-applying, got %s\n' "$application_count" >&2
  exit 1
}

# PATCH with an actionable status and an explicit action context persists
# a job_actions row with the given reason.
curl -fsS -X PATCH "http://127.0.0.1:$PORT/api/jobs/1" \
  -H "Content-Type: application/json" \
  -d '{"status":"needs_review","action":{"actionType":"review","reasonCode":"manual_check","reasonText":"Needs a manual look."}}' >/dev/null
action_row="$(sqlite3 "$TEST_DATA/app.db" "SELECT reason_code, reason_text FROM job_actions WHERE job_id = 1 ORDER BY id DESC LIMIT 1;")"
[ "$action_row" = "manual_check|Needs a manual look." ] || {
  printf 'expected a job_actions row recording the given reason, got %s\n' "$action_row" >&2
  exit 1
}

# An invalid action context (missing required fields) is rejected with a
# clean 400, leaving the job's status unchanged.
invalid_action_status="$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "http://127.0.0.1:$PORT/api/jobs/1" \
  -H "Content-Type: application/json" -d '{"status":"needs_review","action":{"actionType":""}}')"
[ "$invalid_action_status" = "400" ] || {
  printf 'expected 400 for an invalid action context, got %s\n' "$invalid_action_status" >&2
  exit 1
}

# An invalid applicationSource is rejected with a clean 400.
invalid_source_status="$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "http://127.0.0.1:$PORT/api/jobs/1" \
  -H "Content-Type: application/json" -d '{"status":"applied","applicationSource":"not-a-real-source"}')"
[ "$invalid_source_status" = "400" ] || {
  printf 'expected 400 for an invalid applicationSource, got %s\n' "$invalid_source_status" >&2
  exit 1
}

printf 'Job-detail route/DB integration E2E passed.\n'

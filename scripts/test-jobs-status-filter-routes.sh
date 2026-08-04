#!/usr/bin/env bash
#
# Route E2E regression for the dashboard's Action Center tabs (Verification,
# Needs Review, External, Drafts, Decisions). GET /api/jobs must not hide a
# job behind the default match_score > 0 filter when the caller explicitly
# asks for one of the actionable statuses those tabs link to -- the Action
# Center already lists such jobs regardless of score, so the pipeline list
# must agree once you click through, instead of showing an empty list for a
# job the dashboard itself just said needs attention.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DATA="$(mktemp -d "${TMPDIR:-/tmp}/job-autopilot-status-filter-e2e.XXXXXX")"
PORT="${JOB_AUTOPILOT_E2E_PORT:-43110}"
PID=""

cleanup() {
  # "npm run start"'s $! is only the npm wrapper -- it does not forward
  # signals to the actual next-server grandchild, which would otherwise
  # leak as an orphan still bound to $PORT and serving out of this
  # about-to-be-deleted TEST_DATA directory. Kill by port, not just by PID.
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

job_ids() {
  python3 -c '
import json, sys
payload = json.load(sys.stdin)
print(",".join(str(job["id"]) for job in payload.get("jobs") or []))
'
}

cd "$ROOT"
JOB_AUTOPILOT_DATA_DIR="$TEST_DATA" JOB_AUTOPILOT_INSTANCE_ID=status-filter-e2e \
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
    "test", "needs-code-zero-score", "Blocked On Code", "Zero Score Co", "Remote", 1,
    "https://example.invalid/needs-code", "2026-07-31 12:00:00", 0, "needs_code"
  );
  db.prepare(
    `INSERT INTO jobs
       (source, source_job_id, title, company, location, remote, url, fetched_at, match_score, status)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    "test", "new-scored", "Scored New Job", "Scored Co", "Remote", 1,
    "https://example.invalid/new-scored", "2026-07-31 11:00:00", 42, "new"
  );
  db.close();
'

# A score-0 job in an Action Center status must still appear once the
# dashboard's Verification/Needs Review/External/Drafts/Decisions tabs filter
# the pipeline list to that status.
needs_code_ids="$(curl -fsS "http://127.0.0.1:$PORT/api/jobs?status=needs_code" | job_ids)"
[ "$needs_code_ids" = "1" ] || {
  printf 'expected needs_code job (score 0) to be included, got jobs: %s\n' "$needs_code_ids" >&2
  exit 1
}

# A score-0 job must still be hidden from ordinary "new" browsing by default
# -- this fix must not resurrect the general noise-reduction behavior.
new_ids="$(curl -fsS "http://127.0.0.1:$PORT/api/jobs?status=new" | job_ids)"
[ "$new_ids" = "2" ] || {
  printf 'expected only the scored new job, got jobs: %s\n' "$new_ids" >&2
  exit 1
}

# showAll=1 must still surface every status regardless of score, unaffected
# by this fix.
all_ids="$(curl -fsS "http://127.0.0.1:$PORT/api/jobs?showAll=1" | job_ids)"
[ "$all_ids" = "2,1" ] || {
  printf 'expected both jobs with showAll=1, got jobs: %s\n' "$all_ids" >&2
  exit 1
}

printf 'Action Center status-filter route E2E passed.\n'

#!/usr/bin/env bash
#
# Route E2E regression for POST /api/draft/[id] ("Generate draft"). This
# control was flagged by explorer-agent's manual-review classifier as a
# state-mutating button, but unlike Fill/Auto-submit/Sync/Import it never
# leaves this app -- lib/draft.ts is pure, deterministic, local template
# generation with no external network call and no real submission, so it is
# safe to cover with real, repeatable automated E2E coverage against a
# disposable database (same isolation pattern as test-jobs-status-filter-
# routes.sh).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DATA="$(mktemp -d "${TMPDIR:-/tmp}/job-autopilot-draft-e2e.XXXXXX")"
PORT="${JOB_AUTOPILOT_E2E_PORT:-43120}"
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
    value = value[key] if not isinstance(value, list) else value[int(key)]
print(value)
" "$@"
}

cd "$ROOT"
JOB_AUTOPILOT_DATA_DIR="$TEST_DATA" JOB_AUTOPILOT_INSTANCE_ID=draft-generation-e2e \
  npm run start -- --hostname 127.0.0.1 --port "$PORT" >"$TEST_DATA/server.log" 2>&1 &
PID=$!

wait_for_server

TEST_DB_PATH="$TEST_DATA/app.db" \
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types -e '
  const Database = require("better-sqlite3");
  const db = new Database(process.env.TEST_DB_PATH);
  db.prepare(
    `INSERT INTO resumes (filename, text, skills_json) VALUES (?, ?, ?)`
  ).run(
    "synthetic-resume.txt",
    "Built and shipped backend services using TypeScript and PostgreSQL for five years. Led a team through a major infrastructure migration.",
    JSON.stringify(["typescript", "postgresql"])
  );
  db.prepare(
    `INSERT INTO jobs
       (source, source_job_id, title, company, location, remote, url, fetched_at,
        match_score, match_reasons_json, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    "test", "draft-gen-1", "Senior Backend Engineer", "Synthetic Drafts Co", "Remote", 1,
    "https://example.invalid/draft-gen-1", "2026-08-02 12:00:00", 90,
    JSON.stringify({
      score: 90,
      matchedSkills: ["typescript", "postgresql"],
      missingSkills: [],
      skillsInPostingNotInResume: [],
      reasons: ["Matches required skills"],
    }),
    "new"
  );
  db.close();
'

# 404 for a job that does not exist -- must not silently generate a draft
# with no job context.
missing_status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/draft/999")"
[ "$missing_status" = "404" ] || {
  printf 'expected 404 for nonexistent job, got %s\n' "$missing_status" >&2
  exit 1
}

response="$(curl -fsS -X POST "http://127.0.0.1:$PORT/api/draft/1")"

cover_letter="$(printf '%s' "$response" | field draft coverLetter)"
case "$cover_letter" in
  *"Synthetic Drafts Co"*) ;;
  *)
    printf 'cover letter missing expected company: %s\n' "$cover_letter" >&2
    exit 1
    ;;
esac
case "$cover_letter" in
  *"Senior Backend Engineer"*) ;;
  *)
    printf 'cover letter missing expected job title: %s\n' "$cover_letter" >&2
    exit 1
    ;;
esac

case "$cover_letter" in
  *"typescript, postgresql"*) ;;
  *)
    printf 'cover letter missing expected matched skills: %s\n' "$cover_letter" >&2
    exit 1
    ;;
esac

answers_len="$(printf '%s' "$response" | python3 -c '
import json, sys
payload = json.load(sys.stdin)
print(len(payload["draft"]["answers"]))
')"
[ "$answers_len" = "2" ] || {
  printf 'expected 2 draft answers, got %s\n' "$answers_len" >&2
  exit 1
}

# The route must persist the draft, not just return it -- confirm a real row
# landed in the drafts table tied to the correct job.
drafts_count="$(sqlite3 "$TEST_DATA/app.db" "SELECT COUNT(*) FROM drafts WHERE job_id = 1;")"
[ "$drafts_count" = "1" ] || {
  printf 'expected exactly 1 persisted draft row for job 1, got %s\n' "$drafts_count" >&2
  exit 1
}

# Regenerating for the same job must not require a resume upload dance again
# and should append a second row rather than erroring -- matches the UI's
# "Generate draft" being safely clickable more than once.
second_status="$(curl -fsS -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/draft/1")"
[ "$second_status" = "200" ] || {
  printf 'expected 200 on a repeat draft generation, got %s\n' "$second_status" >&2
  exit 1
}

printf 'Generate-draft route E2E passed.\n'

#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DATA="$(mktemp -d "${TMPDIR:-/tmp}/job-autopilot-resume-analysis.XXXXXX")"
PORT="${JOB_AUTOPILOT_RESUME_ANALYSIS_PORT:-43104}"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" >/dev/null 2>&1 || true; fi
  if [ -n "$SERVER_PID" ]; then wait "$SERVER_PID" >/dev/null 2>&1 || true; fi
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
  printf 'resume-analysis test server did not become ready\n' >&2
  tail -40 "$TEST_DATA/server.log" >&2 || true
  return 1
}

cd "$ROOT"
JOB_AUTOPILOT_DATA_DIR="$TEST_DATA" JOB_AUTOPILOT_INSTANCE_ID=resume-analysis-e2e \
  npm run start -- --hostname 127.0.0.1 --port "$PORT" >"$TEST_DATA/server.log" 2>&1 &
SERVER_PID=$!
wait_for_server

resume_json="$(
  curl -fsS -X POST "http://127.0.0.1:$PORT/api/resume" \
    -F "file=@$ROOT/fixtures/resume-tailoring/sample-resume.txt;type=text/plain"
)"
resume_id="$(
  printf '%s' "$resume_json" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])'
)"
curl -fsS -X POST "http://127.0.0.1:$PORT/api/resume/evidence" \
  -H "Content-Type: application/json" \
  -d "{\"resumeId\":$resume_id}" >/dev/null

sqlite3 "$TEST_DATA/app.db" "
  UPDATE resume_evidence
  SET verification_status = 'verified'
  WHERE resume_id = $resume_id
    AND normalized_text IN (
      'Platform engineer focused on reliable distributed systems.',
      'Reduced deployment time by 40% using GitHub Actions and Terraform.',
      'Led migration of services to Kubernetes.',
      'TypeScript',
      'Kubernetes',
      'Terraform',
      'PostgreSQL'
    );

  INSERT INTO jobs
    (source, source_job_id, title, company, location, remote, description, url,
     fetched_at, match_score, status)
  VALUES
    ('test', 'resume-analysis-1', 'Synthetic Platform Engineer', 'Synthetic Company',
     'Remote', 1,
     'RESPONSIBILITIES
Build reliable platform services using TypeScript and PostgreSQL.
MINIMUM QUALIFICATIONS
Kubernetes experience is required.
At least 5 years of software engineering experience.
PREFERRED QUALIFICATIONS
Terraform experience is preferred.',
     'https://example.invalid/resume-analysis', '2026-07-30 12:00:00', 90, 'new');
"

analysis="$(
  curl -fsS -X POST "http://127.0.0.1:$PORT/api/jobs/1/resume-analysis"
)"
printf '%s' "$analysis" | python3 -c '
import json, sys
payload = json.load(sys.stdin)["analysis"]
assert payload["counts"]["required"] == 2
assert payload["counts"]["preferred"] == 1
items = {item["requirement"]["text"]: item for item in payload["coverage"]}
assert items["Build reliable platform services using TypeScript and PostgreSQL"]["status"] == "supported"
assert items["Kubernetes experience is required"]["status"] == "supported"
assert items["At least 5 years of software engineering experience"]["status"] == "not_evidenced"
assert items["Terraform experience is preferred"]["status"] == "supported"
'

stored="$(curl -fsS "http://127.0.0.1:$PORT/api/jobs/1/resume-analysis")"
printf '%s' "$stored" | python3 -c '
import json, sys
payload = json.load(sys.stdin)["analysis"]
assert payload is not None
assert len(payload["coverage"]) == 4
'

sqlite3 "$TEST_DATA/app.db" "
  UPDATE jobs
  SET description = description || '
Python experience is required.'
  WHERE id = 1;
"
refreshed="$(
  curl -fsS -X POST "http://127.0.0.1:$PORT/api/jobs/1/resume-analysis"
)"
printf '%s' "$refreshed" | python3 -c '
import json, sys
items = json.load(sys.stdin)["analysis"]["coverage"]
python = next(item for item in items if "Python" in item["requirement"]["text"])
assert python["requirement"]["priority"] == "required"
assert python["status"] == "not_evidenced"
'

printf 'Disposable resume-analysis route E2E passed.\n'

#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DATA="$(mktemp -d "${TMPDIR:-/tmp}/job-autopilot-core-routes.XXXXXX")"
PORT="${JOB_AUTOPILOT_CORE_ROUTES_PORT:-43106}"
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
  printf 'core route integration server did not become ready\n' >&2
  tail -40 "$TEST_DATA/server.log" >&2 || true
  return 1
}

request_status() {
  local method="$1" endpoint="$2" body="$3" output="$4"
  curl -sS -o "$output" -w '%{http_code}' \
    -X "$method" "http://127.0.0.1:$PORT$endpoint" \
    -H 'Content-Type: application/json' -d "$body"
}

cd "$ROOT"
JOB_AUTOPILOT_DATA_DIR="$TEST_DATA" JOB_AUTOPILOT_INSTANCE_ID=core-routes-e2e \
  npm run start -- --hostname 127.0.0.1 --port "$PORT" >"$TEST_DATA/server.log" 2>&1 &
SERVER_PID=$!
wait_for_server

curl -fsS -X PUT "http://127.0.0.1:$PORT/api/filters" \
  -H 'Content-Type: application/json' \
  -d '{
    "titleInclude":"platform engineer",
    "titleExclude":"intern",
    "locations":["United States"],
    "remoteOnly":true,
    "minSalary":140000,
    "requiredSkills":["TypeScript","Kubernetes"],
    "excludedCompanies":["Blocked Company"]
  }' >/dev/null

filters="$(curl -fsS "http://127.0.0.1:$PORT/api/filters")"
printf '%s' "$filters" | python3 -c '
import json, sys
value = json.load(sys.stdin)["filter"]
assert value["titleInclude"] == "platform engineer"
assert value["locations"] == ["United States"]
assert value["remoteOnly"] is True
assert value["minSalary"] == 140000
assert value["requiredSkills"] == ["TypeScript", "Kubernetes"]
'

filter_before="$(sqlite3 "$TEST_DATA/app.db" 'SELECT title_include || char(31) || locations_json || char(31) || required_skills_json FROM filters ORDER BY id DESC LIMIT 1;')"
invalid_filter_status="$(request_status PUT /api/filters '{"remoteOnly":"yes"}' "$TEST_DATA/invalid-filter.json")"
[ "$invalid_filter_status" = "400" ]
filter_after="$(sqlite3 "$TEST_DATA/app.db" 'SELECT title_include || char(31) || locations_json || char(31) || required_skills_json FROM filters ORDER BY id DESC LIMIT 1;')"
[ "$filter_before" = "$filter_after" ]

source_created="$(curl -fsS -X POST "http://127.0.0.1:$PORT/api/sources" \
  -H 'Content-Type: application/json' \
  -d '{"type":"greenhouse","config":{"companySlug":"fixture-company"}}')"
source_id="$(printf '%s' "$source_created" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
sources="$(curl -fsS "http://127.0.0.1:$PORT/api/sources")"
printf '%s' "$sources" | python3 -c '
import json, sys
sources = json.load(sys.stdin)["sources"]
assert len(sources) == 1
assert sources[0]["type"] == "greenhouse"
assert sources[0]["config"] == {"companySlug": "fixture-company"}
'
invalid_source_status="$(request_status POST /api/sources '{"type":"greenhouse","config":{"companySlug":"fixture-company","token":"secret"}}' "$TEST_DATA/invalid-source.json")"
[ "$invalid_source_status" = "400" ]
[ "$(sqlite3 "$TEST_DATA/app.db" 'SELECT COUNT(*) FROM source_configs;')" = "1" ]
curl -fsS -X DELETE "http://127.0.0.1:$PORT/api/sources" \
  -H 'Content-Type: application/json' -d "{\"id\":$source_id}" >/dev/null
[ "$(sqlite3 "$TEST_DATA/app.db" 'SELECT COUNT(*) FROM source_configs;')" = "0" ]

sqlite3 "$TEST_DATA/app.db" "
  INSERT INTO resumes (filename, text, skills_json)
  VALUES (
    'synthetic-resume.txt',
    'First verified sentence. Second verified sentence! TypeScript and Kubernetes.',
    '[\"TypeScript\",\"Kubernetes\"]'
  );

  WITH RECURSIVE sequence(value) AS (
    SELECT 1
    UNION ALL
    SELECT value + 1 FROM sequence WHERE value < 55
  )
  INSERT INTO jobs
    (source, source_job_id, title, company, location, remote, salary_text,
     description, url, posted_at, fetched_at, match_score, match_reasons_json, status)
  SELECT
    'fixture',
    'job-' || value,
    CASE WHEN value = 1 THEN 'Platform Engineer' ELSE 'Synthetic Engineer ' || value END,
    CASE WHEN value = 1 THEN 'Fixture Systems' ELSE 'Fixture Company ' || value END,
    'Remote - United States',
    1,
    '\$150,000-\$180,000',
    'Build reliable systems with TypeScript and Kubernetes.',
    'https://example.invalid/jobs/' || value,
    '2026-08-01',
    datetime('2026-08-01 12:00:00', '+' || value || ' minutes'),
    CASE WHEN value = 3 THEN 0 ELSE 100 - value END,
    CASE WHEN value = 1 THEN
      '{\"score\":99,\"matchedSkills\":[\"TypeScript\",\"Kubernetes\"],\"missingSkills\":[],\"skillsInPostingNotInResume\":[],\"reasons\":[\"fixture\"]}'
    ELSE NULL END,
    CASE WHEN value = 2 THEN 'rejected' ELSE 'new' END
  FROM sequence;
"

page_one="$(curl -fsS "http://127.0.0.1:$PORT/api/jobs?page=1")"
printf '%s' "$page_one" | python3 -c '
import json, sys
payload = json.load(sys.stdin)
assert payload["total"] == 54
assert payload["page"] == 1
assert payload["pageSize"] == 50
assert len(payload["jobs"]) == 50
assert payload["jobs"][0]["id"] == 1
assert all(job["matchScore"] > 0 for job in payload["jobs"])
'
page_two="$(curl -fsS "http://127.0.0.1:$PORT/api/jobs?page=2")"
printf '%s' "$page_two" | python3 -c '
import json, sys
payload = json.load(sys.stdin)
assert payload["total"] == 54
assert len(payload["jobs"]) == 4
'
all_jobs="$(curl -fsS "http://127.0.0.1:$PORT/api/jobs?showAll=1&page=2")"
printf '%s' "$all_jobs" | python3 -c '
import json, sys
payload = json.load(sys.stdin)
assert payload["total"] == 55
assert len(payload["jobs"]) == 5
assert any(job["id"] == 3 and job["matchScore"] == 0 for job in payload["jobs"])
'
rejected="$(curl -fsS "http://127.0.0.1:$PORT/api/jobs?status=rejected")"
printf '%s' "$rejected" | python3 -c '
import json, sys
payload = json.load(sys.stdin)
assert payload["total"] == 1
assert payload["jobs"][0]["id"] == 2
'
invalid_page_status="$(curl -sS -o "$TEST_DATA/invalid-page.json" -w '%{http_code}' "http://127.0.0.1:$PORT/api/jobs?page=0")"
[ "$invalid_page_status" = "400" ]

draft="$(curl -fsS -X POST "http://127.0.0.1:$PORT/api/draft/1")"
printf '%s' "$draft" | python3 -c '
import json, sys
draft = json.load(sys.stdin)["draft"]
assert "Fixture Systems" in draft["coverLetter"]
assert "including TypeScript, Kubernetes" in draft["coverLetter"]
assert len(draft["answers"]) == 2
'
[ "$(sqlite3 "$TEST_DATA/app.db" 'SELECT COUNT(*) FROM drafts WHERE job_id = 1;')" = "1" ]

curl -fsS -X PATCH "http://127.0.0.1:$PORT/api/jobs/1" \
  -H 'Content-Type: application/json' -d '{"status":"drafted"}' >/dev/null
[ "$(sqlite3 "$TEST_DATA/app.db" 'SELECT status FROM jobs WHERE id = 1;')" = "drafted" ]
invalid_status_code="$(request_status PATCH /api/jobs/1 '{"status":"submitted","unexpected":true}' "$TEST_DATA/invalid-job.json")"
[ "$invalid_status_code" = "400" ]
[ "$(sqlite3 "$TEST_DATA/app.db" 'SELECT status FROM jobs WHERE id = 1;')" = "drafted" ]

curl -fsS -X PATCH "http://127.0.0.1:$PORT/api/jobs/1" \
  -H 'Content-Type: application/json' \
  -d '{"status":"applied","applicationSource":"autofill_review"}' >/dev/null
[ "$(sqlite3 "$TEST_DATA/app.db" 'SELECT status FROM jobs WHERE id = 1;')" = "applied" ]
[ "$(sqlite3 "$TEST_DATA/app.db" 'SELECT COUNT(*) FROM applications WHERE job_id = 1;')" = "1" ]
[ "$(sqlite3 "$TEST_DATA/app.db" 'SELECT source FROM applications WHERE job_id = 1;')" = "autofill_review" ]
[ "$(sqlite3 "$TEST_DATA/app.db" 'SELECT resume_version FROM applications WHERE job_id = 1;')" = "synthetic-resume.txt" ]
curl -fsS -X PATCH "http://127.0.0.1:$PORT/api/jobs/1" \
  -H 'Content-Type: application/json' \
  -d '{"status":"applied","applicationSource":"manual"}' >/dev/null
[ "$(sqlite3 "$TEST_DATA/app.db" 'SELECT COUNT(*) FROM applications WHERE job_id = 1;')" = "1" ]
[ "$(sqlite3 "$TEST_DATA/app.db" 'SELECT source FROM applications WHERE job_id = 1;')" = "autofill_review" ]

application="$(curl -fsS -X PATCH "http://127.0.0.1:$PORT/api/applications/1" \
  -H 'Content-Type: application/json' \
  -d '{"notes":"Synthetic follow-up","followUpAt":"2026-08-10","responseReceivedAt":"2026-08-05","responseType":"interview"}')"
printf '%s' "$application" | python3 -c '
import json, sys
application = json.load(sys.stdin)["application"]
assert application["notes"] == "Synthetic follow-up"
assert application["follow_up_at"] == "2026-08-10"
assert application["response_type"] == "interview"
'
notes_before="$(sqlite3 "$TEST_DATA/app.db" 'SELECT notes FROM applications WHERE job_id = 1;')"
invalid_application_status="$(request_status PATCH /api/applications/1 '{"notes":"changed","responseType":"pending"}' "$TEST_DATA/invalid-application.json")"
[ "$invalid_application_status" = "400" ]
[ "$(sqlite3 "$TEST_DATA/app.db" 'SELECT notes FROM applications WHERE job_id = 1;')" = "$notes_before" ]

stats="$(curl -fsS "http://127.0.0.1:$PORT/api/applications?stats=1")"
printf '%s' "$stats" | python3 -c '
import json, sys
stats = json.load(sys.stdin)["stats"]
assert stats["total"] == 1
assert stats["withResponse"] == 1
assert stats["responseRate"] == 1
'
top_fit="$(curl -fsS "http://127.0.0.1:$PORT/api/applications?topFit=5")"
printf '%s' "$top_fit" | python3 -c '
import json, sys
jobs = json.load(sys.stdin)["jobs"]
assert len(jobs) == 5
assert all(job["matchScore"] > 0 for job in jobs)
assert all(job["id"] not in (1, 2, 3) for job in jobs)
'

printf 'Disposable core route/database integration passed.\n'

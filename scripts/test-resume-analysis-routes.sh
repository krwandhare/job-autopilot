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

printf 'this is not a PDF' >"$TEST_DATA/disguised.pdf"
invalid_status="$(
  curl -sS -o "$TEST_DATA/invalid-upload.json" -w '%{http_code}' \
    -X POST "http://127.0.0.1:$PORT/api/resume" \
    -F "file=@$TEST_DATA/disguised.pdf;type=application/pdf"
)"
test "$invalid_status" = "400"
python3 -c '
import json, sys
payload = json.load(open(sys.argv[1]))
assert payload["error"] == "The selected file is not a valid PDF document."
' "$TEST_DATA/invalid-upload.json"
test "$(sqlite3 "$TEST_DATA/app.db" 'SELECT COUNT(*) FROM resumes;')" = "0"
test ! -d "$TEST_DATA/resumes"

invalid_autofill_status="$(
  curl -sS -o "$TEST_DATA/invalid-autofill-upload.json" -w '%{http_code}' \
    -X POST "http://127.0.0.1:$PORT/api/autofill/upload-file" \
    -F "file=@$TEST_DATA/disguised.pdf;type=application/pdf" \
    -F 'jobId=1' -F 'autofillId=synthetic-file' -F 'key=resume' \
    -F 'label=Resume' -F 'kind=file'
)"
test "$invalid_autofill_status" = "400"
python3 -c '
import json, sys
payload = json.load(open(sys.argv[1]))
assert payload["error"] == "The selected file is not a valid PDF document."
' "$TEST_DATA/invalid-autofill-upload.json"
test ! -d "$TEST_DATA/resumes"

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
  SET verification_status = 'rejected'
  WHERE resume_id = $resume_id
    AND evidence_kind = 'skill'
    AND normalized_text = 'PostgreSQL';
"
bulk_skills="$(
  curl -fsS -X PATCH "http://127.0.0.1:$PORT/api/resume/evidence" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"verify_all_skills\",\"resumeId\":$resume_id}"
)"
printf '%s' "$bulk_skills" | python3 -c '
import json, sys
payload = json.load(sys.stdin)
skills = {
    item["normalizedText"]: item["verificationStatus"]
    for item in payload["evidence"]
    if item["kind"] == "skill"
}
assert {"TypeScript", "Kubernetes", "Terraform", "PostgreSQL"} <= skills.keys()
assert skills["PostgreSQL"] == "rejected"
assert all(
    status == "verified"
    for skill, status in skills.items()
    if skill != "PostgreSQL"
)
assert payload["updatedCount"] == len(skills) - 1
'

bulk_evidence="$(
  curl -fsS -X PATCH "http://127.0.0.1:$PORT/api/resume/evidence" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"verify_all_evidence\",\"resumeId\":$resume_id}"
)"
printf '%s' "$bulk_evidence" | python3 -c '
import json, sys
payload = json.load(sys.stdin)
statuses = [item["verificationStatus"] for item in payload["evidence"]]
assert payload["updatedCount"] > 0
assert "extracted" not in statuses
assert statuses.count("rejected") == 1
assert all(
    item["verificationStatus"] == "verified"
    for item in payload["evidence"]
    if item["normalizedText"] != "PostgreSQL"
)
'

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

  INSERT INTO jobs
    (source, source_job_id, title, company, location, remote, description, url,
     fetched_at, match_score, status)
  VALUES
    ('test', 'resume-analysis-2', 'Synthetic Backend Engineer', 'Second Company',
     'Remote', 1, 'TypeScript experience is required.',
     'https://example.invalid/resume-analysis-2', '2026-07-30 11:00:00', 80, 'new');
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

variant="$(
  curl -fsS -X POST "http://127.0.0.1:$PORT/api/jobs/1/resume-variant"
)"
printf '%s' "$variant" | python3 -c '
import json, sys
variant = json.load(sys.stdin)["variant"]
assert variant["status"] == "draft"
assert len(variant["items"]) >= 7
assert all(item["included"] for item in variant["items"])
assert not any("Python" in item["tailoredText"] for item in variant["items"])
assert any(
  "required" in item["rationale"] and "Kubernetes" in item["matchedTerms"]
  for item in variant["items"]
)
'
variant_id="$(
  printf '%s' "$variant" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["variant"]["id"])'
)"
first_item_id="$(
  printf '%s' "$variant" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["variant"]["items"][0]["id"])'
)"

updated_variant="$(
  curl -fsS -X PATCH "http://127.0.0.1:$PORT/api/resume-variants/$variant_id" \
    -H "Content-Type: application/json" \
    -d "{\"itemId\":$first_item_id,\"included\":false}"
)"
printf '%s' "$updated_variant" | python3 -c '
import json, sys
variant = json.load(sys.stdin)["variant"]
assert variant["status"] == "draft"
assert sum(1 for item in variant["items"] if not item["included"]) == 1
'

approved="$(
  curl -fsS -X POST \
    "http://127.0.0.1:$PORT/api/resume-variants/$variant_id/approve"
)"
printf '%s' "$approved" | python3 -c '
import json, sys
variant = json.load(sys.stdin)["variant"]
assert variant["status"] == "approved"
assert variant["approvedAt"] is not None
'

artifacts="$(
  curl -fsS -X POST \
    "http://127.0.0.1:$PORT/api/resume-variants/$variant_id/artifacts"
)"
printf '%s' "$artifacts" | python3 -c '
import json, sys
artifacts = json.load(sys.stdin)["artifacts"]
assert [(item["format"], item["validationStatus"]) for item in artifacts] == [
    ("docx", "passed"),
    ("pdf", "passed"),
]
assert all(item["validation"]["missingItemCount"] == 0 for item in artifacts)
'

default_attachment="$(
  curl -fsS "http://127.0.0.1:$PORT/api/autofill/next?jobId=1"
)"
printf '%s' "$default_attachment" | python3 -c '
import json, sys
attachment = json.load(sys.stdin)["job"]["resumeAttachment"]
assert attachment["source"] == "tailored"
assert attachment["format"] == "docx"
assert attachment["variantId"] is not None
'
curl -fsS -X POST "http://127.0.0.1:$PORT/api/autofill/finish" \
  -H "Content-Type: application/json" -d '{"jobId":1}' >/dev/null

curl -fsS -X PATCH "http://127.0.0.1:$PORT/api/resume-variants/$variant_id" \
  -H "Content-Type: application/json" \
  -d '{"preferredFormat":"pdf"}' >/dev/null
pdf_attachment="$(
  curl -fsS "http://127.0.0.1:$PORT/api/autofill/next?jobId=1"
)"
printf '%s' "$pdf_attachment" | python3 -c '
import json, sys
attachment = json.load(sys.stdin)["job"]["resumeAttachment"]
assert attachment["source"] == "tailored"
assert attachment["format"] == "pdf"
'
curl -fsS -X POST "http://127.0.0.1:$PORT/api/autofill/finish" \
  -H "Content-Type: application/json" -d '{"jobId":1}' >/dev/null

other_job_attachment="$(
  curl -fsS "http://127.0.0.1:$PORT/api/autofill/next?jobId=2"
)"
printf '%s' "$other_job_attachment" | python3 -c '
import json, sys
attachment = json.load(sys.stdin)["job"]["resumeAttachment"]
assert attachment["source"] == "master"
assert attachment["variantId"] is None
'
curl -fsS -X POST "http://127.0.0.1:$PORT/api/autofill/finish" \
  -H "Content-Type: application/json" -d '{"jobId":2}' >/dev/null

curl -fsS -D "$TEST_DATA/docx.headers" \
  -o "$TEST_DATA/tailored.docx" \
  "http://127.0.0.1:$PORT/api/resume-variants/$variant_id/download/docx"
curl -fsS -D "$TEST_DATA/pdf.headers" \
  -o "$TEST_DATA/tailored.pdf" \
  "http://127.0.0.1:$PORT/api/resume-variants/$variant_id/download/pdf"
python3 - "$TEST_DATA" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])
assert (root / "tailored.docx").read_bytes().startswith(b"PK")
assert (root / "tailored.pdf").read_bytes().startswith(b"%PDF")
assert "application/vnd.openxmlformats-officedocument.wordprocessingml.document" in (
    root / "docx.headers"
).read_text().lower()
assert "application/pdf" in (root / "pdf.headers").read_text().lower()
PY

immutable_code="$(
  curl -sS -o "$TEST_DATA/immutable.json" -w '%{http_code}' \
    -X PATCH "http://127.0.0.1:$PORT/api/resume-variants/$variant_id" \
    -H "Content-Type: application/json" \
    -d "{\"itemId\":$first_item_id,\"included\":true}"
)"
[ "$immutable_code" = "409" ]

printf 'Disposable resume-analysis, variant, and artifact route E2E passed.\n'

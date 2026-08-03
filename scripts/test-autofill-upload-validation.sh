#!/usr/bin/env bash
#
# Route E2E regression for POST /api/autofill/upload-file's new size/
# extension guards. Unlike the resume-upload route this one can't use an
# extension allowlist -- it attaches whatever file an employer's ATS field
# asks for (resume, cover letter, portfolio, transcript, ...) -- so it only
# blocks executable/script extensions and caps size. This script only
# exercises the validation step itself (which runs, and rejects, before the
# route ever calls fillFileField()/looks at an active Playwright session),
# not a full live autofill attach -- that needs a real browser session and
# is covered by this repo's existing live/manual autofill verification
# instead.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DATA="$(mktemp -d "${TMPDIR:-/tmp}/job-autopilot-autofill-upload-e2e.XXXXXX")"
TEST_DATA="$(cd "$TEST_DATA" && pwd)"
PORT="${JOB_AUTOPILOT_E2E_PORT:-43122}"
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

cd "$ROOT"
JOB_AUTOPILOT_DATA_DIR="$TEST_DATA" JOB_AUTOPILOT_INSTANCE_ID=autofill-upload-e2e \
  npm run start -- --hostname 127.0.0.1 --port "$PORT" >"$TEST_DATA/server.log" 2>&1 &
PID=$!

wait_for_server

assert_upload_rejected() {
  local upload_file="$1" filename="$2" expected_message="$3" description="$4"
  local status body
  body="$(mktemp "${TMPDIR:-/tmp}/job-autopilot-autofill-upload-resp.XXXXXX")"
  status="$(curl -sS -o "$body" -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/autofill/upload-file" \
    -F "file=@${upload_file};filename=${filename}" \
    -F "jobId=999999" -F "autofillId=field-1" -F "key=cover_letter" -F "label=Cover letter" -F "kind=file")"
  [ "$status" = "400" ] || {
    printf '%s: expected 400, got %s (body: %s)\n' "$description" "$status" "$(cat "$body")" >&2
    rm -f "$body"
    exit 1
  }
  local message
  message="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["error"])' < "$body")"
  [ "$message" = "$expected_message" ] || {
    printf '%s: expected error %q, got %q\n' "$description" "$expected_message" "$message" >&2
    rm -f "$body"
    exit 1
  }
  rm -f "$body"
}

SMALL_FIXTURE="$TEST_DATA/portfolio.pdf"
printf 'not a real PDF, just a small fixture' > "$SMALL_FIXTURE"

EMPTY_FIXTURE="$TEST_DATA/empty.pdf"
: > "$EMPTY_FIXTURE"
assert_upload_rejected "$EMPTY_FIXTURE" "empty.pdf" \
  "The uploaded file is empty." "empty file"

OVERSIZED_FIXTURE="$TEST_DATA/oversized.pdf"
truncate -s 26M "$OVERSIZED_FIXTURE"
assert_upload_rejected "$OVERSIZED_FIXTURE" "oversized.pdf" \
  "Files must be 25MB or smaller." "oversized file"

assert_upload_rejected "$SMALL_FIXTURE" "resume.exe" \
  "This file type isn't allowed for upload." "dangerous extension (.exe)"

assert_upload_rejected "$SMALL_FIXTURE" "setup.sh" \
  "This file type isn't allowed for upload." "dangerous extension (.sh)"

# A plausible non-resume, non-dangerous attachment (portfolio PDF) must not
# be rejected by validation -- confirms the guard isn't an accidental
# resume-only allowlist. It will fail past validation (no active Playwright
# session for job 999999), which is expected and out of scope here; only
# the validation step itself is under test.
status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/autofill/upload-file" \
  -F "file=@${SMALL_FIXTURE};filename=portfolio.pdf" \
  -F "jobId=999999" -F "autofillId=field-1" -F "key=cover_letter" -F "label=Cover letter" -F "kind=file")"
[ "$status" != "400" ] || {
  printf 'expected a plausible non-dangerous file to pass validation (non-400), got 400\n' >&2
  exit 1
}

printf 'Autofill upload-file validation route E2E passed.\n'

#!/usr/bin/env bash
#
# Route E2E regression for POST /api/resume (upload). explorer-agent flags
# the Profile page's file input as sensitive/manual-review because it
# handles real personal data -- but the route itself is safe to cover with
# real automated E2E coverage as long as the file it uploads is a synthetic
# fixture, never a real resume. TODO.md documents a real prior incident
# where automated test work overwrote the live resume's file_path, so this
# script only ever runs against a disposable JOB_AUTOPILOT_DATA_DIR (its own
# temp data/resumes/ directory) and never touches the real data/ directory.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DATA="$(mktemp -d "${TMPDIR:-/tmp}/job-autopilot-resume-upload-e2e.XXXXXX")"
# Canonicalize away any double slash from a trailing-slash $TMPDIR (common on
# macOS) -- path.join() on the Node side normalizes it, so a literal-slash
# comparison against the raw mktemp output would otherwise never match.
TEST_DATA="$(cd "$TEST_DATA" && pwd)"
PORT="${JOB_AUTOPILOT_E2E_PORT:-43121}"
PID=""
FIXTURE="$ROOT/fixtures/resume-tailoring/sample-resume.txt"

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

[ -f "$FIXTURE" ] || {
  printf 'synthetic fixture resume not found at %s\n' "$FIXTURE" >&2
  exit 1
}

cd "$ROOT"
JOB_AUTOPILOT_DATA_DIR="$TEST_DATA" JOB_AUTOPILOT_INSTANCE_ID=resume-upload-e2e \
  npm run start -- --hostname 127.0.0.1 --port "$PORT" >"$TEST_DATA/server.log" 2>&1 &
PID=$!

wait_for_server

response="$(curl -fsS -X POST "http://127.0.0.1:$PORT/api/resume" \
  -F "file=@${FIXTURE};filename=synthetic-fixture-resume.txt;type=text/plain")"

filename="$(printf '%s' "$response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["filename"])')"
[ "$filename" = "synthetic-fixture-resume.txt" ] || {
  printf 'expected uploaded filename to round-trip, got %s\n' "$filename" >&2
  exit 1
}

skills_len="$(printf '%s' "$response" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["skills"]))')"
[ "$skills_len" -gt 0 ] || {
  printf 'expected skills to be detected from the fixture resume, got 0\n' >&2
  exit 1
}

# The route must persist both the DB row and the file on disk, and it must
# write the clean original filename as the on-disk basename (autofill later
# attaches this exact file and the ATS sees its basename) -- never inside
# the real, non-disposable data/resumes/ directory.
db_row="$(sqlite3 "$TEST_DATA/app.db" "SELECT filename, file_path FROM resumes ORDER BY id DESC LIMIT 1;")"
db_filename="${db_row%%|*}"
db_file_path="${db_row#*|}"
[ "$db_filename" = "synthetic-fixture-resume.txt" ] || {
  printf 'expected resumes.filename to match upload, got %s\n' "$db_row" >&2
  exit 1
}

case "$db_file_path" in
  "$TEST_DATA"/resumes/*/synthetic-fixture-resume.txt) ;;
  *)
    printf 'expected file_path under disposable resumes dir, got %s\n' "$db_file_path" >&2
    exit 1
    ;;
esac

[ -f "$db_file_path" ] || {
  printf 'expected uploaded file to exist on disk at %s\n' "$db_file_path" >&2
  exit 1
}
printf 'Resume-upload route E2E passed.\n'

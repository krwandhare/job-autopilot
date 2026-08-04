#!/usr/bin/env bash
#
# Route/database integration regression for GET/PUT /api/filters against a
# disposable database (npm run start + a temp JOB_AUTOPILOT_DATA_DIR, same
# pattern as the other scripts/test-*-route*.sh scripts) -- never reads or
# mutates the real data/app.db.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DATA="$(mktemp -d "${TMPDIR:-/tmp}/job-autopilot-filters-route-e2e.XXXXXX")"
PORT="${JOB_AUTOPILOT_E2E_PORT:-43123}"
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
JOB_AUTOPILOT_DATA_DIR="$TEST_DATA" JOB_AUTOPILOT_INSTANCE_ID=filters-route-e2e \
  npm run start -- --hostname 127.0.0.1 --port "$PORT" >"$TEST_DATA/server.log" 2>&1 &
PID=$!

wait_for_server

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

# A fresh database has no filters row yet -- the schema init inserts one
# default row, so this must NOT be null.
initial="$(curl -fsS "http://127.0.0.1:$PORT/api/filters")"
initial_id="$(printf '%s' "$initial" | field filter id)"
[ "$initial_id" != "null" ] || {
  printf 'expected a default filters row to already exist, got null\n' >&2
  exit 1
}

# PUT creates/updates the single filters row (upsert onto the latest row,
# not a new row per call).
put_response="$(curl -fsS -X PUT "http://127.0.0.1:$PORT/api/filters" \
  -H "Content-Type: application/json" \
  -d '{"titleInclude":"backend","titleExclude":"intern","locations":["Remote","NYC"],"remoteOnly":true,"minSalary":120000,"requiredSkills":["TypeScript"],"excludedCompanies":["Acme"]}')"
put_ok="$(printf '%s' "$put_response" | field ok)"
[ "$put_ok" = "true" ] || {
  printf 'expected {"ok":true} from PUT, got %s\n' "$put_response" >&2
  exit 1
}

after_put="$(curl -fsS "http://127.0.0.1:$PORT/api/filters")"
title_include="$(printf '%s' "$after_put" | field filter titleInclude)"
remote_only="$(printf '%s' "$after_put" | field filter remoteOnly)"
min_salary="$(printf '%s' "$after_put" | field filter minSalary)"
locations_len="$(printf '%s' "$after_put" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["filter"]["locations"]))')"
[ "$title_include" = '"backend"' ] || {
  printf 'expected titleInclude "backend", got %s\n' "$title_include" >&2
  exit 1
}
[ "$remote_only" = "true" ] || {
  printf 'expected remoteOnly true, got %s\n' "$remote_only" >&2
  exit 1
}
[ "$min_salary" = "120000" ] || {
  printf 'expected minSalary 120000, got %s\n' "$min_salary" >&2
  exit 1
}
[ "$locations_len" = "2" ] || {
  printf 'expected 2 locations, got %s\n' "$locations_len" >&2
  exit 1
}

# A second PUT must update the same row (upsert), not insert a new one --
# confirmed directly against the database, not just the API response.
curl -fsS -X PUT "http://127.0.0.1:$PORT/api/filters" \
  -H "Content-Type: application/json" \
  -d '{"titleInclude":"frontend"}' >/dev/null

filters_row_count="$(sqlite3 "$TEST_DATA/app.db" "SELECT COUNT(*) FROM filters;")"
[ "$filters_row_count" = "1" ] || {
  printf 'expected exactly 1 filters row after two PUTs, got %s\n' "$filters_row_count" >&2
  exit 1
}

second_put_title="$(curl -fsS "http://127.0.0.1:$PORT/api/filters" | field filter titleInclude)"
[ "$second_put_title" = '"frontend"' ] || {
  printf 'expected the second PUT to overwrite titleInclude, got %s\n' "$second_put_title" >&2
  exit 1
}

# A PUT with omitted fields falls back to defaults (empty string/array/false/
# null), not the previous row's values -- confirms PUT replaces, not merges.
curl -fsS -X PUT "http://127.0.0.1:$PORT/api/filters" -H "Content-Type: application/json" -d '{}' >/dev/null
after_empty_put="$(curl -fsS "http://127.0.0.1:$PORT/api/filters")"
empty_title="$(printf '%s' "$after_empty_put" | field filter titleInclude)"
[ "$empty_title" = '""' ] || {
  printf 'expected an empty-body PUT to reset titleInclude to "", got %s\n' "$empty_title" >&2
  exit 1
}

# Malformed JSON must return a clean 400, not crash the route.
malformed_status="$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "http://127.0.0.1:$PORT/api/filters" \
  -H "Content-Type: application/json" -d 'not valid json')"
[ "$malformed_status" = "400" ] || {
  printf 'expected 400 for malformed JSON, got %s\n' "$malformed_status" >&2
  exit 1
}

printf 'Filters route/DB integration E2E passed.\n'

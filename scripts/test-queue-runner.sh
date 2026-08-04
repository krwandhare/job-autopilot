#!/usr/bin/env bash

set -euo pipefail

QUEUE_RUNNER_FUNCTIONS_ONLY=1
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/queue-runner.sh"

payload="$(
  status_payload \
    "needs_review" \
    "application_review" \
    "unanswered_questions" \
    "The application has questions that need your answer." \
    '["Expected salary","Why this company?"]'
)"

python3 -c '
import json, sys
payload = json.loads(sys.stdin.read())
assert payload["status"] == "needs_review"
assert payload["action"]["reasonCode"] == "unanswered_questions"
assert payload["action"]["details"] == ["Expected salary", "Why this company?"]
assert payload["action"]["source"] == "queue_runner"
' <<<"$payload"

basic_payload="$(status_payload "applied")"
python3 -c '
import json, sys
assert json.loads(sys.stdin.read()) == {"status": "applied"}
' <<<"$basic_payload"

printf 'Queue-runner structured action payload checks passed.\n'

#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_RUNTIME="$(mktemp -d "${TMPDIR:-/tmp}/job-autopilot-test-all.XXXXXX")"

cleanup() {
  rm -rf "$TEST_RUNTIME"
}
trap cleanup EXIT

export JOB_AUTOPILOT_DATA_DIR="$TEST_RUNTIME/runtime"
export PLAYWRIGHT_OUTPUT_DIR="$TEST_RUNTIME/playwright"
mkdir -p "$JOB_AUTOPILOT_DATA_DIR" "$PLAYWRIGHT_OUTPUT_DIR"

cd "$PROJECT_ROOT"

test_commands=(
  test:integration-automation
  test:action-center
  test:resume-evidence
  test:resume-layout
  test:resume-requirements
  test:resume-variants
  test:resume-artifacts
  test:resume-analysis-routes
  test:tailored-resume-generator
  test:gmail-leads
  test:applications
  test:queue-runner
  test:shared-runtime
  test:shared-runtime-routes
)

for test_command in "${test_commands[@]}"; do
  printf '\n==> npm run %s\n' "$test_command"
  npm run "$test_command"
done

printf '\nAll deterministic tests passed using disposable data.\n'

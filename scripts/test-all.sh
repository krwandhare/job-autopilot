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

# Several isolated route and browser suites exercise `next start`; create the
# production output before those suites instead of relying on a stale local
# `.next` directory from an earlier developer build.
npm run build

test_commands=(
  test:unit
  test:integration-automation
  test:action-center
  test:resume-evidence
  test:resume-layout
  test:resume-requirements
  test:resume-variants
  test:resume-artifacts
  test:resume-server-config
  test:resume-upload-validation
  test:resume-analysis-routes
  test:llm-tailoring
  test:jobs-status-filter-routes
  test:draft-generation
  test:resume-upload
  test:autofill-upload-validation
  test:filters-route
  test:job-detail-route
  test:explorer-classify
  test:tailored-resume-generator
  test:submission-guard
  test:gmail-leads
  test:applications
  test:cv-archive
  test:autofill-upload
  test:autofill-errors
  test:api-validation
  test:queue-runner
  test:shared-runtime
  test:shared-runtime-routes
)

for test_command in "${test_commands[@]}"; do
  printf '\n==> npm run %s\n' "$test_command"
  npm run "$test_command"
done

printf '\nAll deterministic tests passed using disposable data.\n'

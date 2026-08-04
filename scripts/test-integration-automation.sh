#!/usr/bin/env bash
#
# End-to-end tests for integrate-branch.sh. Each scenario uses a disposable
# Git repository and real branches, commits, worktrees, merges, and ref checks.

set -euo pipefail

SOURCE_REPO="$(git rev-parse --show-toplevel)"
INTEGRATOR="$SOURCE_REPO/scripts/integrate-branch.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/job-autopilot-integration-e2e.XXXXXX")"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

new_repo() {
  local repo="$1"
  mkdir -p "$repo/scripts" "$repo/config/agent-tasks" "$repo/app"
  cp "$INTEGRATOR" "$repo/scripts/integrate-branch.sh"
  chmod +x "$repo/scripts/integrate-branch.sh"
  printf 'app/**\n' > "$repo/config/agent-tasks/codex.allow"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    '[[ -d node_modules/example-package ]]' \
    '[[ ! -L node_modules ]]' \
    '[[ "$(cat node_modules/example-package/index.js)" == "installed" ]]' \
    > "$repo/scripts/validate.sh"
  chmod +x "$repo/scripts/validate.sh"
  mkdir -p "$repo/node_modules/example-package"
  printf 'installed\n' > "$repo/node_modules/example-package/index.js"
  printf 'node_modules/\n' > "$repo/.gitignore"
  printf 'base\n' > "$repo/app/shared.txt"
  git -C "$repo" init -q -b main
  git -C "$repo" config user.name "Integration Test"
  git -C "$repo" config user.email "integration@example.invalid"
  git -C "$repo" add .
  git -C "$repo" commit -q -m "base"
  git -C "$repo" branch integration/concurrent-work
}

assert_ref_unchanged() {
  local repo="$1" branch="$2" expected="$3"
  local actual
  actual="$(git -C "$repo" rev-parse "$branch")"
  [[ "$actual" == "$expected" ]] ||
    { printf 'expected %s to remain at %s, got %s\n' "$branch" "$expected" "$actual" >&2; exit 1; }
}

printf '1/5 clean merge updates the integration branch...\n'
CLEAN_REPO="$TEST_ROOT/clean"
new_repo "$CLEAN_REPO"
git -C "$CLEAN_REPO" switch -q -c feature/codex-tests main
printf 'covered\n' > "$CLEAN_REPO/app/test.txt"
git -C "$CLEAN_REPO" add app/test.txt
git -C "$CLEAN_REPO" commit -q -m "add covered file"
(
  cd "$CLEAN_REPO"
  INTEGRATION_VALIDATE_CMD=./scripts/validate.sh \
    ./scripts/integrate-branch.sh \
      --source feature/codex-tests \
      --target integration/concurrent-work \
      --task codex \
      --apply
)
git -C "$CLEAN_REPO" merge-base --is-ancestor feature/codex-tests integration/concurrent-work

printf '2/5 dirty source worktrees are rejected without moving the target...\n'
DIRTY_REPO="$TEST_ROOT/dirty"
new_repo "$DIRTY_REPO"
git -C "$DIRTY_REPO" switch -q -c feature/codex-tests main
printf 'covered\n' > "$DIRTY_REPO/app/test.txt"
git -C "$DIRTY_REPO" add app/test.txt
git -C "$DIRTY_REPO" commit -q -m "add covered file"
printf 'unfinished\n' > "$DIRTY_REPO/app/unfinished.txt"
DIRTY_BEFORE="$(git -C "$DIRTY_REPO" rev-parse integration/concurrent-work)"
if (
  cd "$DIRTY_REPO"
  INTEGRATION_VALIDATE_CMD=./scripts/validate.sh \
    ./scripts/integrate-branch.sh \
      --source feature/codex-tests \
      --target integration/concurrent-work \
      --task codex \
      --apply
); then
  printf 'dirty-worktree scenario unexpectedly succeeded\n' >&2
  exit 1
fi
assert_ref_unchanged "$DIRTY_REPO" integration/concurrent-work "$DIRTY_BEFORE"

printf '3/5 ownership violations are rejected without moving the target...\n'
OWNER_REPO="$TEST_ROOT/ownership"
new_repo "$OWNER_REPO"
git -C "$OWNER_REPO" switch -q -c feature/codex-tests main
printf 'not allowed\n' > "$OWNER_REPO/README.md"
git -C "$OWNER_REPO" add README.md
git -C "$OWNER_REPO" commit -q -m "touch disallowed file"
OWNER_BEFORE="$(git -C "$OWNER_REPO" rev-parse integration/concurrent-work)"
if (
  cd "$OWNER_REPO"
  INTEGRATION_VALIDATE_CMD=./scripts/validate.sh \
    ./scripts/integrate-branch.sh \
      --source feature/codex-tests \
      --target integration/concurrent-work \
      --task codex \
      --apply
); then
  printf 'ownership scenario unexpectedly succeeded\n' >&2
  exit 1
fi
assert_ref_unchanged "$OWNER_REPO" integration/concurrent-work "$OWNER_BEFORE"

printf '4/5 textual conflicts are rejected without moving the target...\n'
CONFLICT_REPO="$TEST_ROOT/conflict"
new_repo "$CONFLICT_REPO"
git -C "$CONFLICT_REPO" switch -q -c feature/codex-tests main
printf 'feature\n' > "$CONFLICT_REPO/app/shared.txt"
git -C "$CONFLICT_REPO" commit -qam "feature edit"
git -C "$CONFLICT_REPO" switch -q integration/concurrent-work
printf 'integration\n' > "$CONFLICT_REPO/app/shared.txt"
git -C "$CONFLICT_REPO" commit -qam "integration edit"
CONFLICT_BEFORE="$(git -C "$CONFLICT_REPO" rev-parse integration/concurrent-work)"
if (
  cd "$CONFLICT_REPO"
  INTEGRATION_VALIDATE_CMD=./scripts/validate.sh \
    ./scripts/integrate-branch.sh \
      --source feature/codex-tests \
      --target integration/concurrent-work \
      --task codex \
      --apply
); then
  printf 'conflict scenario unexpectedly succeeded\n' >&2
  exit 1
fi
assert_ref_unchanged "$CONFLICT_REPO" integration/concurrent-work "$CONFLICT_BEFORE"

printf '5/5 validation failures are rejected without moving the target...\n'
VALIDATION_REPO="$TEST_ROOT/validation"
new_repo "$VALIDATION_REPO"
git -C "$VALIDATION_REPO" switch -q -c feature/codex-tests main
printf 'covered\n' > "$VALIDATION_REPO/app/test.txt"
git -C "$VALIDATION_REPO" add app/test.txt
git -C "$VALIDATION_REPO" commit -q -m "add covered file"
VALIDATION_BEFORE="$(git -C "$VALIDATION_REPO" rev-parse integration/concurrent-work)"
if (
  cd "$VALIDATION_REPO"
  INTEGRATION_VALIDATE_CMD=false \
    ./scripts/integrate-branch.sh \
      --source feature/codex-tests \
      --target integration/concurrent-work \
      --task codex \
      --apply
); then
  printf 'validation-failure scenario unexpectedly succeeded\n' >&2
  exit 1
fi
assert_ref_unchanged "$VALIDATION_REPO" integration/concurrent-work "$VALIDATION_BEFORE"

printf 'All integration automation end-to-end scenarios passed.\n'

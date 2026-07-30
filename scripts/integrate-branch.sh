#!/usr/bin/env bash
#
# Guarded feature-branch integration.
#
# The source branch is checked against a task-specific allowlist, merged in a
# temporary worktree, and validated there. The target branch is updated only
# after every gate passes. A conflict, ownership violation, or failed command
# removes the temporary worktree and leaves both branch refs unchanged.
#
# Usage:
#   scripts/integrate-branch.sh \
#     --source feature/codex-tests \
#     --target integration/concurrent-work \
#     --task codex \
#     --apply
#
# Without --apply this performs the complete trial merge and validation but
# does not create a merge commit or update the target branch.

set -euo pipefail

SOURCE_BRANCH=""
TARGET_BRANCH=""
TASK_NAME=""
APPLY=false

usage() {
  sed -n '4,21p' "$0"
}

fail() {
  printf 'integration failed: %s\n' "$*" >&2
  exit 1
}

while (($#)); do
  case "$1" in
    --source)
      SOURCE_BRANCH="${2:-}"
      shift 2
      ;;
    --target)
      TARGET_BRANCH="${2:-}"
      shift 2
      ;;
    --task)
      TASK_NAME="${2:-}"
      shift 2
      ;;
    --apply)
      APPLY=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[[ -n "$SOURCE_BRANCH" ]] || fail "--source is required"
[[ -n "$TARGET_BRANCH" ]] || fail "--target is required"
[[ -n "$TASK_NAME" ]] || fail "--task is required"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

git show-ref --verify --quiet "refs/heads/$SOURCE_BRANCH" ||
  fail "local source branch does not exist: $SOURCE_BRANCH"
git show-ref --verify --quiet "refs/heads/$TARGET_BRANCH" ||
  fail "local target branch does not exist: $TARGET_BRANCH"

[[ "$SOURCE_BRANCH" != "$TARGET_BRANCH" ]] || fail "source and target must differ"

ALLOW_FILE="$REPO_ROOT/config/agent-tasks/$TASK_NAME.allow"
[[ -f "$ALLOW_FILE" ]] || fail "missing ownership allowlist: $ALLOW_FILE"

ALLOWED_PATTERNS=()
while IFS= read -r pattern; do
  ALLOWED_PATTERNS+=("$pattern")
done < <(sed -e 's/[[:space:]]*#.*$//' -e '/^[[:space:]]*$/d' "$ALLOW_FILE")
((${#ALLOWED_PATTERNS[@]} > 0)) || fail "ownership allowlist is empty: $ALLOW_FILE"

CHANGED_FILES=()
while IFS= read -r file; do
  CHANGED_FILES+=("$file")
done < <(git diff --name-only "$TARGET_BRANCH...$SOURCE_BRANCH")

if ((${#CHANGED_FILES[@]} == 0)); then
  fail "source has no changes relative to target"
fi

is_allowed() {
  local file="$1"
  local pattern
  for pattern in "${ALLOWED_PATTERNS[@]}"; do
    # Intentional shell glob matching: allowlists use patterns such as
    # "tests/**"; values come from repository-controlled files, not eval.
    if [[ "$file" == $pattern ]]; then
      return 0
    fi
  done
  return 1
}

OWNERSHIP_FAILURES=()
for file in "${CHANGED_FILES[@]}"; do
  if ! is_allowed "$file"; then
    OWNERSHIP_FAILURES+=("$file")
  fi
done

if ((${#OWNERSHIP_FAILURES[@]} > 0)); then
  printf 'integration failed: task "%s" changed files outside its allowlist:\n' "$TASK_NAME" >&2
  printf '  %s\n' "${OWNERSHIP_FAILURES[@]}" >&2
  exit 2
fi

TEMP_WORKTREE="$(mktemp -d "${TMPDIR:-/tmp}/job-autopilot-integration.XXXXXX")"
TARGET_BEFORE="$(git rev-parse "$TARGET_BRANCH")"

cleanup() {
  git worktree remove --force "$TEMP_WORKTREE" >/dev/null 2>&1 || true
  rmdir "$TEMP_WORKTREE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Detach at the target so this works even when another worktree has the target
# branch checked out. The branch ref is updated atomically only after success.
git worktree add --detach "$TEMP_WORKTREE" "$TARGET_BRANCH" >/dev/null

# Dependencies are intentionally ignored by Git. Reuse the already installed
# locked dependencies from the primary worktree so validation is fast and does
# not perform a network install inside every disposable worktree.
if [[ -d "$REPO_ROOT/node_modules" && ! -e "$TEMP_WORKTREE/node_modules" ]]; then
  ln -s "$REPO_ROOT/node_modules" "$TEMP_WORKTREE/node_modules"
fi

if ! git -C "$TEMP_WORKTREE" merge --no-commit --no-ff "$SOURCE_BRANCH" >/dev/null 2>&1; then
  git -C "$TEMP_WORKTREE" merge --abort >/dev/null 2>&1 || true
  fail "merge conflict between $SOURCE_BRANCH and $TARGET_BRANCH"
fi

VALIDATION_COMMAND="${INTEGRATION_VALIDATE_CMD:-npm run validate}"
printf 'Validating trial merge: %s\n' "$VALIDATION_COMMAND"
if ! (cd "$TEMP_WORKTREE" && bash -o pipefail -c "$VALIDATION_COMMAND"); then
  git -C "$TEMP_WORKTREE" merge --abort >/dev/null 2>&1 || true
  fail "validation failed; target branch was not updated"
fi

if [[ "$APPLY" == false ]]; then
  git -C "$TEMP_WORKTREE" merge --abort >/dev/null 2>&1 || true
  printf 'Trial integration passed; target unchanged (use --apply to merge).\n'
  exit 0
fi

git -C "$TEMP_WORKTREE" commit \
  -m "merge: integrate $SOURCE_BRANCH into $TARGET_BRANCH" >/dev/null
MERGE_COMMIT="$(git -C "$TEMP_WORKTREE" rev-parse HEAD)"

# update-ref is compare-and-swap: if another process advanced the target while
# validation ran, this refuses rather than overwriting concurrent work.
if ! git update-ref "refs/heads/$TARGET_BRANCH" "$MERGE_COMMIT" "$TARGET_BEFORE"; then
  fail "target advanced during validation; rerun against its latest state"
fi

printf 'Integrated %s into %s at %s\n' \
  "$SOURCE_BRANCH" "$TARGET_BRANCH" "$MERGE_COMMIT"

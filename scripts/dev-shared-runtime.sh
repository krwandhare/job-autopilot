#!/usr/bin/env bash

set -euo pipefail

INSTANCE_ID="${1:-}"
PORT="${2:-}"

if [[ ! "$INSTANCE_ID" =~ ^[a-zA-Z0-9._:-]{1,128}$ ]]; then
  printf 'usage: %s <instance-id> <port>\n' "$0" >&2
  exit 2
fi
if [[ ! "$PORT" =~ ^[0-9]+$ ]] || ((PORT < 1024 || PORT > 65535)); then
  printf 'port must be an integer between 1024 and 65535\n' >&2
  exit 2
fi

COMMON_GIT_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
PRIMARY_WORKTREE="$(dirname "$COMMON_GIT_DIR")"
SHARED_DATA_DIR="${JOB_AUTOPILOT_DATA_DIR:-$PRIMARY_WORKTREE/data}"

mkdir -p "$SHARED_DATA_DIR"

printf 'Starting %s on http://localhost:%s with the shared runtime directory\n' \
  "$INSTANCE_ID" "$PORT"

export JOB_AUTOPILOT_DATA_DIR="$SHARED_DATA_DIR"
export JOB_AUTOPILOT_INSTANCE_ID="$INSTANCE_ID"
exec npm run dev -- --port "$PORT"

#!/bin/bash
# Spin up an isolated worktree for a parallel top-level session, so a
# `git checkout` in one session never drags the others (see AGENTS.md sec. 6,
# the 2026-06-08 p1a-invite incident).
#
# Usage:
#   scripts/new-session-worktree.sh <name> [base-branch]
#
# Creates /Users/gnickles/Desktop/ros-<name> on a new branch session/<name>
# off <base-branch> (default: main), and APFS-clones node_modules so a dev
# server / Preview boots (a symlink breaks Turbopack; an install can revoke
# macOS TCC perms and kill every running agent). Point the new session's cwd at
# the printed path.

set -euo pipefail

NAME="${1:-}"
BASE="${2:-main}"
if [ -z "$NAME" ]; then
  echo "usage: $0 <name> [base-branch]" >&2
  exit 2
fi

MAIN=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)
DEST="/Users/gnickles/Desktop/ros-${NAME}"
BRANCH="session/${NAME}"

if [ -e "$DEST" ]; then
  echo "destination already exists: $DEST" >&2
  exit 1
fi

git -C "$MAIN" worktree add -b "$BRANCH" "$DEST" "$BASE"

# APFS copy-on-write clone of node_modules (instant, near-zero disk until a
# file diverges). Falls back to a plain copy on non-APFS volumes.
for d in node_modules frontend/node_modules; do
  if [ -d "$MAIN/$d" ]; then
    echo "cloning $d ..."
    cp -c -R "$MAIN/$d" "$DEST/$d" 2>/dev/null || cp -R "$MAIN/$d" "$DEST/$d"
  fi
done

echo
echo "worktree ready: $DEST  (branch $BRANCH off $BASE)"
echo "start your session with this as its working directory."

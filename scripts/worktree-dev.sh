#!/usr/bin/env bash
# worktree-dev.sh
#
# Start a Next dev server for a git worktree, reliably.
#
# Why this exists. This repo is a pnpm workspace. A worktree starts with no
# node_modules, and the two shortcuts both fail for a dev server:
#   - Symlinking node_modules to the main checkout: Turbopack rejects symlinks
#     that escape the worktree root ("points out of the filesystem root").
#   - COW-copying (cp -c -R) the main node_modules: pnpm's symlink farm does not
#     survive the copy, leaving a broken node_modules/node_modules link that
#     Turbopack also rejects, so /<route> 500s on first compile.
# The only thing that works is a real `pnpm install` in the worktree. It is fast
# because pnpm hardlinks from the global store, and it produces a correct,
# self-contained module tree with its own .next, so it never touches the main
# checkout or anyone's :3000.
#
# Usage:
#   scripts/worktree-dev.sh <worktree-frontend-dir> <port> [ENV=VALUE ...]
# Example (Data Hub walkthrough with the flag on):
#   scripts/worktree-dev.sh .claude/worktrees/my-wt/frontend 3211 NEXT_PUBLIC_DATAHUB_ENABLED=1
#
# It installs deps if they are missing or broken, then execs `next dev` on the
# given port with any KEY=VALUE pairs exported into the server's environment.
#
# No em-dashes, no emojis, no mid-sentence colons.

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: scripts/worktree-dev.sh <worktree-frontend-dir> <port> [ENV=VALUE ...]" >&2
  exit 2
fi

FRONTEND_DIR="$1"
PORT="$2"
shift 2

if [ ! -f "$FRONTEND_DIR/package.json" ]; then
  echo "error: $FRONTEND_DIR does not look like a frontend dir (no package.json)" >&2
  exit 1
fi

cd "$FRONTEND_DIR"

# A node_modules is "broken" when next/turbopack cannot resolve, which the COW
# copy leaves as a self-referential node_modules/node_modules symlink. Detect a
# missing tree OR that stale self-link and reinstall in either case.
needs_install=0
if [ ! -d node_modules ]; then
  needs_install=1
elif [ -L node_modules/node_modules ]; then
  echo "detected a broken node_modules/node_modules symlink (stale COW copy); reinstalling" >&2
  rm -rf node_modules
  needs_install=1
elif [ ! -d node_modules/next ]; then
  needs_install=1
fi

if [ "$needs_install" -eq 1 ]; then
  echo "installing dependencies in $FRONTEND_DIR (pnpm hardlinks from the global store, fast)..." >&2
  pnpm install --prefer-offline
fi

# Export any KEY=VALUE pairs (e.g. a feature flag) into the dev server env.
for kv in "$@"; do
  export "$kv"
done

echo "starting next dev on port $PORT in $FRONTEND_DIR" >&2
exec npm run dev -- -p "$PORT"

#!/usr/bin/env bash
#
# Install the repo's git hooks into .git/hooks (which is NOT version controlled,
# so each clone/worktree must run this once). Idempotent: safe to re-run.
#
#   bash scripts/install-git-hooks.sh
#
# Currently installs a combined pre-commit hook:
#   1. Icon ratchet guard  - blocks a NEW inline <svg> under frontend/src.
#   1b. Dead-route guard    - blocks a static internal link (href / router.push)
#                             that points at a route which does not exist and would
#                             404 at runtime (masked by the top-level [labSlug]).
#   2. Credits self-heal    - when package.json changes, regenerate + stage the
#                             open-source credits so committed NOTICES never drift.
#   3. Privacy guard        - blocks staging business/financial/personal info into
#                             this PUBLIC repo (EIN/SSN patterns + a local denylist).
#
# All checks live in TRACKED scripts; this hook is just the trigger. They fail
# OPEN on a tooling hiccup so it never wedges a commit (privacy guard exit 2).

set -euo pipefail

root=$(git rev-parse --show-toplevel)
hook="$root/.git/hooks/pre-commit"

mkdir -p "$root/.git/hooks"

cat > "$hook" <<'HOOK'
#!/usr/bin/env bash
#
# Repo pre-commit hook. Managed by scripts/install-git-hooks.sh — re-run that to
# reinstall if .git/hooks is ever wiped. Do not hand-edit; edit the installer.

set -uo pipefail
root=$(git rev-parse --show-toplevel)
staged=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null)

# --- 1. Icon ratchet guard (only on staged TS/TSX under frontend/src) ---------
if printf '%s\n' "$staged" | grep -qE '^frontend/src/.*\.(ts|tsx)$'; then
  check="$root/frontend/scripts/icon-guard-precommit.mjs"
  if [ -f "$check" ]; then
    node "$check"
    # 1 = a real offender; block. Anything else (0 clean, 2 tooling error) = allow.
    [ "$?" -eq 1 ] && exit 1
  fi
  # Dead-route guard. Scans the whole tree (a staged link can break against any
  # route), so it rides the same staged-frontend-src trigger as the icon guard.
  deadroutes="$root/frontend/scripts/check-dead-routes.mjs"
  if [ -f "$deadroutes" ]; then
    node "$deadroutes"
    # 1 = a real dead link; block. 0 clean / 2 tooling error = allow.
    [ "$?" -eq 1 ] && exit 1
  fi
fi

# --- 2. Credits self-heal (only when a package.json is staged) ----------------
if printf '%s\n' "$staged" | grep -qE '(^|/)package\.json$'; then
  selfheal="$root/scripts/credits-precommit.mjs"
  if [ -f "$selfheal" ]; then
    node "$selfheal" || true   # fails open by design
  fi
fi

# --- 3. Privacy guard (the repo is PUBLIC; runs on every staged file) ----------
if [ -n "$staged" ]; then
  privacy="$root/scripts/privacy-guard-precommit.mjs"
  if [ -f "$privacy" ]; then
    node "$privacy"
    # 1 = sensitive content staged; block. 0 clean / 2 tooling error = allow.
    [ "$?" -eq 1 ] && exit 1
  fi
fi

exit 0
HOOK

chmod +x "$hook"
echo "Installed pre-commit hook -> $hook"

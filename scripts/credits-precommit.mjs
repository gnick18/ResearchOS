#!/usr/bin/env node
//
// Pre-commit self-heal for the open-source credits artifacts.
//
// The open-source credits (credits.json served at /open-source, plus the
// THIRD_PARTY_NOTICES and ACKNOWLEDGEMENTS.md compliance files) are generated
// from the dependency set. When a commit changes package.json without
// regenerating them they go stale, which used to break the Vercel prebuild and
// block every deploy (the qrcode dep, 2026-06-08).
//
// The build is now resilient (prebuild regenerates rather than gating), so a
// drift can no longer break deploys. This hook keeps the COMMITTED artifacts
// honest the easy way: when a commit touches a package.json, regenerate the
// credits and stage the result so the dependency change and its credits land in
// the same commit. No human step, nothing to remember.
//
// Like the icon guard, the real logic lives in this TRACKED script (every
// worktree/clone has it) and it FAILS OPEN: any error here exits 0 so a tooling
// hiccup never wedges a commit. Worst case is the old behavior (drift), which
// the build now absorbs anyway.
//
// Trigger lives in .git/hooks/pre-commit (installed by scripts/install-git-hooks.sh).

import { execFileSync } from "node:child_process";

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", ...opts });
}

try {
  const root = sh("git", ["rev-parse", "--show-toplevel"]).trim();
  const run = (cmd, args) => sh(cmd, args, { cwd: root, stdio: "ignore" });

  // Regenerate from the (staged) dependency set.
  run("node", ["scripts/build-open-source-credits.mjs"]);

  // Stage the artifacts so they ride along with the package.json change. If they
  // did not change, git add is a no-op.
  run("git", [
    "add",
    "ACKNOWLEDGEMENTS.md",
    "THIRD_PARTY_NOTICES",
    "frontend/public/open-source/credits.json",
  ]);
} catch {
  // Fail open: never block a commit on a credits hiccup.
}
process.exit(0);

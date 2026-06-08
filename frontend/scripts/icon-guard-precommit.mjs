// Pre-commit icon ratchet check (fast path of the icon-guard test).
//
// Mirrors frontend/src/components/icons/__tests__/icon-guard.test.ts, but runs
// buildBaseline() directly (no vitest boot) so it stays sub-second and is cheap
// enough to gate every component commit. The full vitest guard remains the
// source of truth in the suite; this is the early-warning copy.
//
// Why this exists: on 2026-06-08 a rebuilt Settings "Companion" section landed
// 10 raw inline <svg>s on main without anyone running the guard, then two
// sessions independently fixed it. A commit-time check stops that class of
// regression at the source, including sub-bot commits in worktrees (git
// worktrees share the main repo's hooks dir).
//
// Exit codes (read by .git/hooks/pre-commit):
//   0  clean (no new inline <svg> over the committed baseline)
//   1  real offender -> BLOCK the commit
//   2  tooling error -> hook fails OPEN (never blocks a commit on a node/script
//      problem; the suite-level guard still backstops)
//
// House style note: this is dev tooling, not product UI, but it still follows
// the no-emoji / no-em-dash rules for output text.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

try {
  const root = execSync("git rev-parse --show-toplevel", {
    encoding: "utf8",
  }).trim();
  const scriptUrl = pathToFileURL(
    join(root, "frontend/scripts/update-icon-baseline.mjs"),
  ).href;
  const { buildBaseline } = await import(scriptUrl);
  const baseline = JSON.parse(
    readFileSync(join(root, "frontend/icon-svg-baseline.json"), "utf8"),
  );
  const current = buildBaseline();

  const offenders = [];
  for (const [file, count] of Object.entries(current)) {
    const allowed = baseline[file] ?? 0;
    if (count > allowed) {
      offenders.push(`  ${file} (${count} inline <svg>, baseline allows ${allowed})`);
    }
  }

  if (offenders.length > 0) {
    process.stderr.write(
      "\nicon-guard pre-commit check FAILED. New inline <svg> detected.\n\n" +
        offenders.join("\n") +
        "\n\nUse <Icon name=...> from @/components/icons instead. If this is a\n" +
        "genuinely new VERIFIED icon, add it to the registry (needs Grant sign-off)\n" +
        "and run frontend/scripts/update-icon-baseline.mjs to refresh the baseline.\n" +
        "To bypass in a true emergency, commit with --no-verify.\n\n",
    );
    process.exit(1);
  }
  process.exit(0);
} catch (err) {
  // Fail OPEN. A tooling problem must never wedge a commit; the vitest guard
  // still catches the regression in the suite.
  process.stderr.write(
    "icon-guard pre-commit check skipped (tooling error, failing open): " +
      (err && err.message ? err.message : String(err)) +
      "\n",
  );
  process.exit(2);
}

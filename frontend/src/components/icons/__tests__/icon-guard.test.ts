// sequence editor master. The ratchet guard for the verified icon library.
//
// It re-scans frontend/src for inline "<svg" (with the same exclusions as the
// baseline generator) and compares to the committed icon-svg-baseline.json. It
// FAILS when:
//   (a) a file NOT in the baseline contains an inline <svg> (a new offender,
//       which must use <Icon> from @/components/icons), or
//   (b) a baseline file's <svg> count INCREASED.
// It PASSES when counts are equal or DECREASED (migrating an existing file off
// inline SVG is always allowed; the guard only ratchets one direction).
//
// The escape hatch (adding a genuinely new VERIFIED icon to the registry and
// regenerating the baseline) requires Grant's sign-off. See
// scripts/update-icon-baseline.mjs and AGENTS.md.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBaseline } from "../../../../scripts/update-icon-baseline.mjs";

const BASELINE_PATH = join(__dirname, "../../../../icon-svg-baseline.json");

function loadBaseline(): Record<string, number> {
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

describe("icon ratchet guard", () => {
  it("blocks new inline <svg> and any increase over the baseline", () => {
    const baseline = loadBaseline();
    const current = buildBaseline() as Record<string, number>;

    const offenders: string[] = [];

    for (const [file, count] of Object.entries(current)) {
      const allowed = baseline[file] ?? 0;
      if (count > allowed) {
        offenders.push(
          `New inline <svg> found in ${file}. Use <Icon name=...> from ` +
            `@/components/icons. If this is a genuinely new VERIFIED icon, add it ` +
            `to the registry (requires Grant's sign-off) and run ` +
            `scripts/update-icon-baseline.mjs. ` +
            `(baseline allows ${allowed}, found ${count})`,
        );
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("baseline only contains files that still have inline <svg> (stays honest)", () => {
    // Not a hard failure path for migration, but flags a stale baseline entry so
    // we keep the file diff-clean over time. Decreases are fine; a baseline key
    // that no longer matches any file means the file was renamed or fully
    // migrated and should be dropped on the next sign-off regeneration.
    const baseline = loadBaseline();
    const current = buildBaseline() as Record<string, number>;
    const stale = Object.keys(baseline).filter((f) => !(f in current));
    // Informational only: do not fail the build for staleness.
    if (stale.length > 0) {
      console.warn(
        `icon-svg-baseline.json has ${stale.length} stale entr${
          stale.length === 1 ? "y" : "ies"
        } (migrated/renamed): ${stale.join(", ")}`,
      );
    }
    expect(true).toBe(true);
  });
});

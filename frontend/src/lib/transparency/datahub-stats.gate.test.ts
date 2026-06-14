import { describe, expect, it } from "vitest";

import { buildTransparencyReport } from "./run";
import { STAT_PINS } from "./datasets/datahub-stats";

/**
 * THE DATA HUB STATISTICS GATE.
 *
 * The Data Hub analysis engine is a free, open, local-first alternative to
 * GraphPad Prism. This gate runs the same `buildTransparencyReport()` the page
 * renders and asserts that every statistic our engine computes on the single
 * fixed dataset agrees with its scipy / statsmodels / lifelines reference. A
 * change to the engine that drifts any statistic away from the pinned reference
 * fails the build before it can reach the page or a user.
 *
 * This is the enforcement half of the standing rule in
 * docs/datahub/STATS_VALIDATION.md: every new Data Hub statistical test must add a
 * scipy/statsmodels/R reference (via gen-datahub-stats-golden.py) and a pin here.
 * Because the domain is wired into the same report, the generic report.test.ts
 * gate already enforces each comparison; this sibling makes the requirement
 * explicit and guards the domain's structure so a future edit cannot quietly
 * delete the validation.
 */
describe("Data Hub statistics validated against scipy / statsmodels / lifelines", () => {
  const report = buildTransparencyReport();
  const domain = report.domains.find((d) => d.id === "datahub-stats");

  it("the datahub-stats domain exists and is wired into the report", () => {
    expect(domain, "datahub-stats domain is missing from the transparency report").toBeDefined();
  });

  it("pins every StatPin as a comparison (one per pinned reference)", () => {
    expect(domain).toBeDefined();
    if (!domain) return;
    const comparisons = domain.cases.flatMap((c) => c.comparisons);
    expect(comparisons.length).toBe(STAT_PINS.length);
    // Every pin id is represented exactly once.
    const caseIds = new Set(domain.cases.map((c) => c.id));
    for (const pin of STAT_PINS) {
      expect(caseIds.has(pin.id), `missing pinned comparison for ${pin.id}`).toBe(true);
    }
  });

  it("only checks against scipy, statsmodels, pingouin, lifelines, or sklearn", () => {
    expect(domain).toBeDefined();
    if (!domain) return;
    const allowed = new Set([
      "scipy",
      "statsmodels",
      "pingouin",
      "lifelines",
      "sklearn",
      "firthlogist",
    ]);
    for (const c of domain.cases) {
      for (const cmp of c.comparisons) {
        expect(allowed.has(cmp.oracleId), `unexpected oracle ${cmp.oracleId}`).toBe(true);
      }
    }
  });

  it("has zero failing comparisons (no engine has drifted from its reference)", () => {
    expect(domain).toBeDefined();
    if (!domain) return;
    expect(domain.totals.fail, "a Data Hub statistic drifted from its reference").toBe(0);
    expect(domain.status).not.toBe("fail");
  });

  // Per-statistic assertion so a failure names the exact statistic + oracle.
  for (const pin of STAT_PINS) {
    it(`${pin.id} (${pin.metric}) agrees with ${pin.oracleId}`, () => {
      expect(domain).toBeDefined();
      if (!domain) return;
      const c = domain.cases.find((x) => x.id === pin.id);
      expect(c, `no case for ${pin.id}`).toBeDefined();
      if (!c) return;
      const cmp = c.comparisons[0];
      expect(cmp.oracleId).toBe(pin.oracleId);
      expect(
        cmp.delta,
        `${pin.id}: ours=${cmp.ours} reference=${cmp.theirs} delta=${cmp.delta} `
          + `${cmp.tolerance.unit} (warn tolerance ${cmp.tolerance.warn})`,
      ).toBeLessThanOrEqual(cmp.tolerance.warn);
      expect(cmp.status).not.toBe("fail");
    });
  }
});

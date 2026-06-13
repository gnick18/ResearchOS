import { describe, expect, it } from "vitest";

import { buildTransparencyReport } from "./run";

/**
 * THE GATE.
 *
 * This is the "true test" behind the /transparency page. It runs the exact same
 * `buildTransparencyReport()` the page renders and asserts every comparison is
 * within its tolerance band. If a change to a ResearchOS bioinformatic
 * implementation makes its output drift away from the pinned third-party oracle
 * (Biopython, primer3), this test fails on push and the regression is caught
 * before it can reach the page or a user.
 *
 * It does NOT re-derive the oracle values (that is the Python generators' job).
 * It only enforces that what the page claims ("we match the reference") is true.
 */
describe("transparency report — every advertised comparison must hold", () => {
  const report = buildTransparencyReport();

  it("has at least one domain with cases", () => {
    expect(report.domains.length).toBeGreaterThan(0);
    for (const d of report.domains) {
      expect(d.cases.length, `${d.id} has no cases`).toBeGreaterThan(0);
    }
  });

  it("reports zero failing comparisons overall", () => {
    expect(
      report.totals.fail,
      `transparency report has ${report.totals.fail} failing comparison(s); `
        + "a ResearchOS tool has drifted from its third-party oracle",
    ).toBe(0);
    expect(report.status).not.toBe("fail");
  });

  // One assertion per individual comparison so a failure points at the exact
  // case + oracle, not just "something is off".
  for (const domain of report.domains) {
    // A domain may be all-informational at a given moment (e.g. the phylo domain
    // before its offline ggtree golden is committed, when every comparison is
    // context, not a gated validation). That would leave an empty describe, which
    // vitest rejects, so skip the per-domain block until it has a gated comparison.
    const hasGated = domain.cases.some((c) =>
      c.comparisons.some((cmp) => !cmp.informational),
    );
    if (!hasGated) continue;
    describe(domain.title, () => {
      for (const c of domain.cases) {
        // Informational cross-method comparisons (Wallace / GC rules) are context,
        // not validations; they are not gated.
        for (const cmp of c.comparisons.filter((x) => !x.informational)) {
          it(`${c.id} vs ${cmp.oracleId}: |${cmp.ours} - ${cmp.theirs}| = ${cmp.delta} ${cmp.tolerance.unit} <= ${cmp.tolerance.warn}`, () => {
            // A documented difference (delta within the warn band) is allowed and
            // surfaced on the page; only a true drift beyond the warn band, which
            // would indicate a bug, fails the build.
            expect(
              cmp.delta,
              `${domain.id}/${c.id} drifted from ${cmp.oracleId}: ours=${cmp.ours} `
                + `oracle=${cmp.theirs} delta=${cmp.delta} ${cmp.tolerance.unit} `
                + `(warn tolerance ${cmp.tolerance.warn})`,
            ).toBeLessThanOrEqual(cmp.tolerance.warn);
            expect(cmp.status).not.toBe("fail");
          });
        }
      }
    });
  }

  it("rolls totals up consistently from the gated per-case comparisons", () => {
    let pass = 0;
    let warn = 0;
    let fail = 0;
    for (const d of report.domains) {
      for (const c of d.cases) {
        for (const cmp of c.comparisons.filter((x) => !x.informational)) {
          if (cmp.status === "pass") pass += 1;
          else if (cmp.status === "warn") warn += 1;
          else fail += 1;
        }
      }
    }
    expect(report.totals).toEqual({ pass, warn, fail });
  });
});

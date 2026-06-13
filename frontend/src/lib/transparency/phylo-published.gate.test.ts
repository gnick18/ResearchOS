import { describe, expect, it } from "vitest";

import { buildTransparencyReport } from "./run";
import {
  PHYLO_PUBLISHED_CASES,
  anyCaseReady,
  caseIsReady,
  readyCases,
  reproductionVerdict,
} from "./datasets/phylo-published";

/**
 * THE PUBLISHED-TREE REPRODUCTION GATE.
 *
 * The /phylo Tree Builder GENERATES a tree-building recipe. This gate proves the
 * other half of the transparency story: that recipe, run on a real paper's input,
 * recovers that paper's published tree. It runs the same buildTransparencyReport()
 * the page renders and asserts that, for every case whose offline run has landed,
 * the Robinson-Foulds reproduction is within the case's committed tolerance.
 *
 * THE OFFLINE-RESULT CONTRACT. ML tree search is stochastic and we never run it on
 * a server, so the result tree is produced ONCE offline by a human running
 * scripts/run-phylo-published-case.sh <case>, which rewrites that case's
 * result.json with the resulting Newick and pending = false (exactly like the
 * ggtree golden activation). Until at least one case's result lands, the repo
 * ships only pending placeholders and THIS GATE SKIPS so CI never goes red on a
 * tree no one has computed. Once a result is committed, anyCaseReady() flips to
 * true and the assertions below activate with no further code change.
 */
const ready = anyCaseReady();

const describePublished = ready ? describe : describe.skip;

if (!ready) {
  // Make the skip visible and self-documenting rather than silent.
  describe("Published-tree reproduction validated by Robinson-Foulds", () => {
    it.skip(
      "activates once an offline run is committed "
        + "(run scripts/run-phylo-published-case.sh <case>, commit the rewritten "
        + "result.json so the case has pending = false and a published tree in "
        + "datasets/phylo-published.ts)",
      () => {
        // Intentionally empty: this is the pending marker.
      },
    );
  });
}

describePublished("Published-tree reproduction validated by Robinson-Foulds", () => {
  const report = buildTransparencyReport();
  const domain = report.domains.find((d) => d.id === "phylo-published");

  it("the phylo-published domain exists and is wired into the report", () => {
    expect(
      domain,
      "phylo-published domain is missing from the transparency report",
    ).toBeDefined();
  });

  it("has one comparison per ready case", () => {
    expect(domain).toBeDefined();
    if (!domain) return;
    const comparisons = domain.cases.flatMap((c) => c.comparisons);
    expect(comparisons.length).toBe(readyCases().length);
  });

  it("only scores against the published tree (the RF oracle)", () => {
    expect(domain).toBeDefined();
    if (!domain) return;
    for (const c of domain.cases) {
      for (const cmp of c.comparisons) {
        expect(cmp.oracleId, `unexpected oracle ${cmp.oracleId}`).toBe("published-tree");
      }
    }
  });

  it("has zero failing comparisons (every ready case reproduces its published tree)", () => {
    expect(domain).toBeDefined();
    if (!domain) return;
    expect(domain.totals.fail, "a reproduction drifted past its tolerance").toBe(0);
    expect(domain.status).not.toBe("fail");
  });

  // Per-case assertion so a failure names the exact case and its RF.
  for (const pc of PHYLO_PUBLISHED_CASES) {
    if (!caseIsReady(pc)) continue;
    it(`${pc.id} reproduces its published tree (${pc.recoveryFloor !== undefined ? "recovery" : "support"} criterion)`, () => {
      const v = reproductionVerdict(pc);
      expect(v, `no verdict for ready case ${pc.id}`).not.toBeNull();
      if (!v) return;
      // A ready case must actually share taxa with its published tree, otherwise
      // the labels did not line up and the score is meaningless.
      expect(v.rf.sharedTaxa, `${pc.id}: no shared taxa with the published tree`)
        .toBeGreaterThanOrEqual(4);
      // The pass criterion (support mode: no well-supported clade missed; RF mode:
      // normalized RF at or below the committed tolerance).
      expect(
        v.pass,
        v.mode === "support"
          ? `${pc.id}: missed ${v.wellSupportedMissed} clades at or above support ${v.cutoff} `
            + `(max missing support ${v.maxMissingSupport})`
          : `${pc.id}: recovered ${v.rf.cladesRecovered}/${v.rf.cladesTotal} published clades, `
            + `below floor ${v.recoveryFloor}`,
      ).toBe(true);

      expect(domain).toBeDefined();
      if (!domain) return;
      const c = domain.cases.find((x) => x.id === pc.id);
      expect(c, `no case for ${pc.id}`).toBeDefined();
      if (!c) return;
      const cmp = c.comparisons[0];
      expect(cmp.oracleId).toBe("published-tree");
      expect(
        cmp.delta,
        `${pc.id}: ${cmp.metric} = ${cmp.ours}, tolerance ${cmp.tolerance.warn}`,
      ).toBeLessThanOrEqual(cmp.tolerance.warn);
      expect(cmp.status).not.toBe("fail");
    });
  }
});

import { describe, expect, it } from "vitest";

import { buildTransparencyReport } from "./run";
import { PHYLO_CASES, allGoldensReady } from "./datasets/phylo-ggtree";

/**
 * THE PHYLOGENETICS LAYOUT GATE.
 *
 * The /phylo Tree Studio lays trees out with our own native-SVG layout math
 * (frontend/src/lib/phylo/layout.ts), no plotting library. This gate runs the
 * same buildTransparencyReport() the page renders and asserts that, on every
 * seeded real tree, our layout reproduces ggtree's tip ordering and node depth.
 * A layout change that reorders tips or breaks depth would drop the correlation
 * below tolerance and fail the build before it can reach a user.
 *
 * THE OFFLINE-REFERENCE CONTRACT. ggtree is R and cannot run in CI, so its
 * coordinate table is produced ONCE offline by scripts/gen-phylo-ggtree-golden.R
 * and committed as JSON under datasets/phylo-ggtree-golden/<tree>.json, exactly
 * like the scipy goldens. Until that human run lands, the repo ships a PLACEHOLDER
 * golden (pending = true) and THIS GATE SKIPS so CI never goes red on a reference
 * that does not exist yet. Running gen-phylo-ggtree-golden.R writes goldens with
 * pending = false; once every seeded tree is non-pending, allGoldensReady() flips
 * to true and the real assertions below activate with no further code change.
 */
const ready = allGoldensReady();

const describePhylo = ready ? describe : describe.skip;

if (!ready) {
  // Make the skip visible and self-documenting rather than silent.
  describe("Phylogenetic tree layout validated against ggtree", () => {
    it.skip(
      "activates once the real ggtree golden is committed "
        + "(run scripts/gen-phylo-ggtree-golden.R, commit the JSON under "
        + "datasets/phylo-ggtree-golden/ and the PNGs under public/transparency/phylo/, "
        + "so every seeded tree golden has pending = false)",
      () => {
        // Intentionally empty: this is the pending marker.
      },
    );
  });
}

describePhylo("Phylogenetic tree layout validated against ggtree", () => {
  const report = buildTransparencyReport();
  const domain = report.domains.find((d) => d.id === "phylo");

  it("the phylo domain exists and is wired into the report", () => {
    expect(domain, "phylo domain is missing from the transparency report").toBeDefined();
  });

  it("has one comparison per seeded tree (one ggtree check each)", () => {
    expect(domain).toBeDefined();
    if (!domain) return;
    const comparisons = domain.cases.flatMap((c) => c.comparisons);
    expect(comparisons.length).toBe(PHYLO_CASES.length);
    const caseIds = new Set(domain.cases.map((c) => c.id));
    for (const pc of PHYLO_CASES) {
      expect(caseIds.has(pc.id), `missing comparison for ${pc.id}`).toBe(true);
    }
  });

  it("only checks against ggtree", () => {
    expect(domain).toBeDefined();
    if (!domain) return;
    for (const c of domain.cases) {
      for (const cmp of c.comparisons) {
        expect(cmp.oracleId, `unexpected oracle ${cmp.oracleId}`).toBe("ggtree");
      }
    }
  });

  it("has zero failing comparisons (our layout matches ggtree on every tree)", () => {
    expect(domain).toBeDefined();
    if (!domain) return;
    expect(domain.totals.fail, "a tree layout drifted from ggtree").toBe(0);
    expect(domain.status).not.toBe("fail");
  });

  // Per-tree assertion so a failure names the exact tree + agreement.
  for (const pc of PHYLO_CASES) {
    it(`${pc.id} reproduces ggtree's tip order and depth`, () => {
      expect(domain).toBeDefined();
      if (!domain) return;
      const c = domain.cases.find((x) => x.id === pc.id);
      expect(c, `no case for ${pc.id}`).toBeDefined();
      if (!c) return;
      const cmp = c.comparisons[0];
      expect(cmp.oracleId).toBe("ggtree");
      expect(
        cmp.delta,
        `${pc.id}: tip-order agreement ${cmp.ours} (1 - corr = ${cmp.delta}), `
          + `warn tolerance ${cmp.tolerance.warn}`,
      ).toBeLessThanOrEqual(cmp.tolerance.warn);
      expect(cmp.status).not.toBe("fail");
    });
  }
});

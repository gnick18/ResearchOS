import { describe, expect, it } from "vitest";

import {
  PUBLISHED_DIGEST_CASES,
  PUBLISHED_QPCR_CASES,
  PUBLISHED_TRANSLATE_CASES,
  qpcrEfficiencyPercent,
} from "./datasets/published";
import { LAMBDA_J02459 } from "./datasets/lambda-genome";
import { buildTransparencyReport } from "./run";
import { translate } from "@/vendor/seqviz/sequence";
import { digestEnzymes, fragmentSizes } from "@/lib/sequences/enzyme-filters";

/**
 * Gate for the "Validated against published results" section.
 *
 * Each pinned value was transcribed verbatim from a GenBank record or a
 * peer-reviewed paper. These assertions enforce that our engines reproduce those
 * published numbers exactly. They run with no network and no filesystem: the
 * reference sequences are embedded constants.
 */
describe("published validation — our engines reproduce published values", () => {
  it("embeds the lambda genome at its deposited length (J02459, 48,502 bp)", () => {
    expect(LAMBDA_J02459.length).toBe(48502);
    expect(/^[ACGT]+$/.test(LAMBDA_J02459)).toBe(true);
  });

  describe("translation matches each GenBank record's annotated protein", () => {
    for (const c of PUBLISHED_TRANSLATE_CASES) {
      it(`${c.accession} translates to its /translation protein (${c.protein.length} aa)`, () => {
        const ours = translate(c.seq, "dna");
        expect(ours).toBe(c.protein);
        // The coding region is exactly the protein length in codons (stop dropped).
        expect(c.seq.length).toBe(c.protein.length * 3);
      });
    }
  });

  describe("restriction digest matches the published reference fragment pattern", () => {
    for (const c of PUBLISHED_DIGEST_CASES) {
      it(`${c.accession} + ${c.enzymeName} yields ${c.fragments.length} fragment(s)`, () => {
        const [d] = digestEnzymes(c.seq, "dna", [c.enzymeKey]);
        const cuts = d
          ? Array.from(new Set(d.cuts.map((cut) => cut.position))).sort((a, b) => a - b)
          : [];
        const ours = fragmentSizes(cuts, c.seq.length, c.circular);
        expect([...ours].sort((a, b) => b - a)).toEqual(
          [...c.fragments].sort((a, b) => b - a),
        );
        // Fragments must sum to the full sequence length.
        expect(ours.reduce((s, x) => s + x, 0)).toBe(c.seq.length);
      });
    }
  });

  describe("RT-qPCR efficiency recomputed from the published slope", () => {
    for (const c of PUBLISHED_QPCR_CASES) {
      it(`slope ${c.slope} gives ${c.reportedPercent}% (paper rounding)`, () => {
        const ours = qpcrEfficiencyPercent(c.slope);
        expect(Math.round(ours)).toBe(c.reportedPercent);
        expect(Math.abs(ours - c.reportedPercent)).toBeLessThan(0.5);
      });
    }
  });

  it("the published domain reports zero failing comparisons", () => {
    const report = buildTransparencyReport();
    const published = report.domains.find((d) => d.id === "published");
    expect(published, "published domain is missing from the report").toBeDefined();
    expect(published!.cases.length).toBe(
      PUBLISHED_TRANSLATE_CASES.length
        + PUBLISHED_DIGEST_CASES.length
        + PUBLISHED_QPCR_CASES.length,
    );
    expect(published!.totals.fail).toBe(0);
    expect(published!.status).not.toBe("fail");
  });
});

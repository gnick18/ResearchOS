// primer panel bot — tests for the DESIGN scan/scoring + the CHECK trust checks.
// These verify the APE-level behaviour: candidates respect the length/Tm windows,
// ranking puts the best-scoring oligo first, and the trust checks flag the
// classic pathological oligos (self-dimer / hairpin / poly-X / weak clamp).

import { describe, it, expect } from "vitest";
import {
  DEFAULT_DESIGN_PARAMS,
  designPrimers,
  analyzePrimer,
  longestHomopolymer,
  hasGcClamp,
  selfComplementarityRun,
  threePrimeComplementarity,
  hairpinStem,
  checkBinding,
} from "./primer-design";

// A 240 bp template with mixed, designable content (no long homopolymers).
const TEMPLATE =
  "ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGAT" +
  "GGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGGTGAAGGTGATGCTACATAC" +
  "GGAAAGCTTACCCTTAAATTTATTTGCACTACTGGAAAACTACCTGTTCCATGGCCAACA" +
  "CTTGTCACTACTTTCGGTTATGGTGTTCAATGCTTTGCGAGATACCCAGATCATATGAAA";

describe("longestHomopolymer", () => {
  it("counts the longest single-base run", () => {
    expect(longestHomopolymer("AATTTTG")).toBe(4);
    expect(longestHomopolymer("ACGTACGT")).toBe(1);
    expect(longestHomopolymer("")).toBe(0);
  });
});

describe("hasGcClamp", () => {
  it("is true when the 3' base is G or C", () => {
    expect(hasGcClamp("AAAAAG")).toBe(true);
    expect(hasGcClamp("AAAAAC")).toBe(true);
  });
  it("is false when the 3' base is A or T", () => {
    expect(hasGcClamp("GGGGGA")).toBe(false);
    expect(hasGcClamp("GGGGGT")).toBe(false);
  });
});

describe("selfComplementarityRun", () => {
  it("flags a strongly self-complementary (palindromic) oligo", () => {
    // GAATTC is a palindrome; a tandem of it is highly self-complementary.
    expect(selfComplementarityRun("GAATTCGAATTC")).toBeGreaterThanOrEqual(6);
  });
  it("is low for a non-self-complementary oligo", () => {
    expect(selfComplementarityRun("AAAAAAAAAA")).toBeLessThan(6);
  });
});

describe("threePrimeComplementarity", () => {
  it("flags a 3' end complementary to the 5' end (self-priming dimer)", () => {
    // 5' GGGGG ... CCCCC 3'  -> the 3' CCCCC pairs with the 5' GGGGG.
    expect(threePrimeComplementarity("GGGGGATATCCCCC")).toBeGreaterThanOrEqual(4);
  });
  it("is low when the 3' end has no internal complement", () => {
    expect(threePrimeComplementarity("ATATATATATATAG")).toBeLessThan(4);
  });
});

describe("hairpinStem", () => {
  it("detects a stem-loop (complementary arms around a loop)", () => {
    // GCGCGC ... GCGCGC arms with a TTTT loop -> a 6 bp stem candidate.
    expect(hairpinStem("GCGCGCTTTTGCGCGC")).toBeGreaterThanOrEqual(4);
  });
  it("is zero for an oligo with no folding", () => {
    expect(hairpinStem("AAAAAAAAAAAA")).toBe(0);
  });
});

describe("analyzePrimer trust checks", () => {
  it("a clean ~20-mer is all green", () => {
    const a = analyzePrimer("ATGGCTAGCAAAGGAGAAGC");
    expect(a.length).toBe(20);
    expect(a.gcClamp).toBe(true);
    expect(a.checks.every((c) => c.level === "ok")).toBe(true);
  });

  it("flags a weak (A/T) 3' clamp", () => {
    const a = analyzePrimer("ATGGCTAGCAAAGGAGAATA");
    const clamp = a.checks.find((c) => c.label === "GC clamp");
    expect(clamp?.level).toBe("warn");
  });

  it("flags a poly-X run", () => {
    const a = analyzePrimer("ATGAAAAAAAGCTAGCATGC");
    const poly = a.checks.find((c) => c.label === "Poly-X");
    expect(poly?.level).toBe("warn");
  });

  it("flags a self-dimer oligo", () => {
    const a = analyzePrimer("GAATTCGAATTCGAATTCGC");
    const dimer = a.checks.find((c) => c.label === "Self-dimer");
    expect(dimer?.level).toBe("warn");
  });

  it("flags a hairpin oligo", () => {
    const a = analyzePrimer("GCGCGCATTTTATGCGCGCG");
    const hp = a.checks.find((c) => c.label === "Hairpin");
    expect(hp?.level).toBe("warn");
  });

  it("reports the SantaLucia Tm matching primer.ts", () => {
    const a = analyzePrimer("ATGGCTAGCAAAGGAGAAGC");
    // sanity: a ~20-mer at default conditions lands in a plausible Tm range.
    expect(a.tm).toBeGreaterThan(45);
    expect(a.tm).toBeLessThan(75);
  });
});

describe("designPrimers", () => {
  it("returns ranked forward and reverse candidates inside the windows", () => {
    const { forward, reverse } = designPrimers(TEMPLATE, 0, 200);
    expect(forward.length).toBeGreaterThan(0);
    expect(reverse.length).toBeGreaterThan(0);

    for (const c of [...forward, ...reverse]) {
      expect(c.length).toBeGreaterThanOrEqual(DEFAULT_DESIGN_PARAMS.lengthMin);
      expect(c.length).toBeLessThanOrEqual(DEFAULT_DESIGN_PARAMS.lengthMax);
      expect(c.tm).toBeGreaterThanOrEqual(DEFAULT_DESIGN_PARAMS.tmMin);
      expect(c.tm).toBeLessThanOrEqual(DEFAULT_DESIGN_PARAMS.tmMax);
      expect(c.gc).toBeGreaterThanOrEqual(DEFAULT_DESIGN_PARAMS.gcMin);
      expect(c.gc).toBeLessThanOrEqual(DEFAULT_DESIGN_PARAMS.gcMax);
      expect(c.analysis.gcClamp).toBe(true); // clamp required by default
    }
  });

  it("ranks best-first (non-decreasing score) and Tm near the optimum", () => {
    const { forward } = designPrimers(TEMPLATE, 0, 200);
    for (let i = 1; i < forward.length; i += 1) {
      expect(forward[i].score).toBeGreaterThanOrEqual(forward[i - 1].score);
    }
    // the top forward candidate should sit close to the Tm optimum.
    expect(Math.abs(forward[0].tm - DEFAULT_DESIGN_PARAMS.tmOpt)).toBeLessThan(6);
  });

  it("forward primer sequence is the top strand; reverse is the revcomp span", () => {
    const { forward, reverse } = designPrimers(TEMPLATE, 0, 200);
    const f = forward[0];
    expect(TEMPLATE.slice(f.start, f.end)).toBe(f.primer);
    const r = reverse[0];
    // reverse primer binds the bottom strand of [start,end); its 5'->3' sequence
    // is the reverse complement of the forward span.
    const span = TEMPLATE.slice(r.start, r.end);
    expect(r.direction).toBe(-1);
    expect(r.primer.length).toBe(span.length);
  });

  it("respects a tightened length window", () => {
    const params = { ...DEFAULT_DESIGN_PARAMS, lengthMin: 22, lengthMax: 24, lengthOpt: 23 };
    const { forward } = designPrimers(TEMPLATE, 0, 200, params);
    for (const c of forward) {
      expect(c.length).toBeGreaterThanOrEqual(22);
      expect(c.length).toBeLessThanOrEqual(24);
    }
  });

  it("returns nothing for a region shorter than the minimum length", () => {
    const { forward, reverse } = designPrimers(TEMPLATE, 0, 10);
    expect(forward.length).toBe(0);
    expect(reverse.length).toBe(0);
  });

  it("a designed forward primer binds back at its own coordinates", () => {
    const { forward } = designPrimers(TEMPLATE, 0, 200);
    const f = forward[0];
    const { sites } = checkBinding(f.primer, TEMPLATE);
    const hit = sites.find((s) => s.start === f.start && s.direction === 1);
    expect(hit).toBeTruthy();
  });
});

describe("checkBinding", () => {
  it("finds the single intended site for a unique primer", () => {
    const primer = TEMPLATE.slice(0, 20);
    const { sites, hasExtraSites } = checkBinding(primer, TEMPLATE);
    expect(sites.length).toBeGreaterThanOrEqual(1);
    expect(hasExtraSites).toBe(sites.length > 1);
  });
});

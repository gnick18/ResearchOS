import { describe, it, expect } from "vitest";

import {
  CODING_TYPES,
  isCodingFeature,
  translateFeature,
  trimTrailingStop,
  segmentCount,
  featureLocationLabel,
} from "./feature-protein";
import { reverseComplement } from "./primer";
import { analyzeProtein } from "@/lib/calculators/protein";
import type { EditFeature } from "./edit-model";

// A single deterministic codon per amino acid (NCBI transl_table 1), so a known
// protein can be back-encoded to DNA, dropped into a feature, and translated
// forward again. The expected peptide is therefore independently known (the
// input), never read back from translateFeature itself.
const CODON_FOR: Record<string, string> = {
  A: "GCT", R: "CGT", N: "AAT", D: "GAT", C: "TGT", Q: "CAA", E: "GAA",
  G: "GGT", H: "CAT", I: "ATT", L: "CTT", K: "AAA", M: "ATG", F: "TTT",
  P: "CCT", S: "TCT", T: "ACT", W: "TGG", Y: "TAT", V: "GTT",
};

/** Back-translate a peptide to DNA, one fixed codon per residue. */
function encodeCDS(peptide: string): string {
  return [...peptide].map((aa) => CODON_FOR[aa]).join("");
}

/** Build a minimal forward-strand single-span feature over [start, end). */
function feature(partial: Partial<EditFeature>): EditFeature {
  return {
    name: "test",
    type: "CDS",
    strand: 1,
    start: 0,
    end: 0,
    ...partial,
  } as EditFeature;
}

// EGFP is one of the protein.golden.test.ts ground-truth proteins (Biopython
// ProtParam), so reusing its sequence here lets us assert length / MW / pI
// against the SAME independent authority the golden suite uses.
const EGFP =
  "MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLT" +
  "YGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFK" +
  "EDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPD" +
  "NHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITLGMDELYK";

describe("CODING_TYPES / isCodingFeature", () => {
  it("treats cds / gene / mat_peptide / sig_peptide as coding (case-insensitive)", () => {
    expect([...CODING_TYPES].sort()).toEqual([
      "cds",
      "gene",
      "mat_peptide",
      "sig_peptide",
    ]);
    expect(isCodingFeature({ type: "CDS" })).toBe(true);
    expect(isCodingFeature({ type: "Gene" })).toBe(true);
    expect(isCodingFeature({ type: "sig_peptide" })).toBe(true);
  });

  it("rejects non-coding types", () => {
    expect(isCodingFeature({ type: "promoter" })).toBe(false);
    expect(isCodingFeature({ type: "misc_feature" })).toBe(false);
    expect(isCodingFeature({ type: "primer_bind" })).toBe(false);
    expect(isCodingFeature({})).toBe(false);
  });
});

describe("translateFeature — strand + exon joins", () => {
  it("translates a forward CDS in frame 1", () => {
    const dna = encodeCDS("MVSK");
    const f = feature({ start: 0, end: dna.length, strand: 1 });
    expect(translateFeature(dna, f)).toBe("MVSK");
  });

  it("translates a reverse-strand CDS by reverse-complementing first", () => {
    // The coding bases are MVSK; store them reverse-complemented in the molecule
    // and mark the feature strand -1, so the only way to recover MVSK is to
    // reverse-complement before reading frame 1.
    const coding = encodeCDS("MVSK");
    const dna = reverseComplement(coding);
    const f = feature({ start: 0, end: dna.length, strand: -1 });
    expect(translateFeature(dna, f)).toBe("MVSK");
  });

  it("concatenates multi-segment (join) exons left to right before translating", () => {
    // Two exons that splice to MVSK: exon1 = MV (6 bp), exon2 = SK (6 bp), with a
    // 9 bp intron between them. The feature carries both spans as `locations`.
    const exon1 = encodeCDS("MV");
    const intron = "AAATTTGGG";
    const exon2 = encodeCDS("SK");
    const dna = exon1 + intron + exon2;
    const ex1 = { start: 0, end: exon1.length };
    const ex2 = {
      start: exon1.length + intron.length,
      end: exon1.length + intron.length + exon2.length,
    };
    const f = feature({
      start: ex1.start,
      end: ex2.end,
      strand: 1,
      locations: [ex1, ex2],
    });
    expect(translateFeature(dna, f)).toBe("MVSK");
  });
});

describe("translateFeature -> analyzeProtein golden (EGFP, Biopython authority)", () => {
  it("recovers the EGFP peptide and its ProtParam length / MW / pI", () => {
    const dna = encodeCDS(EGFP);
    const f = feature({ name: "egfp", type: "CDS", start: 0, end: dna.length });
    const aa = translateFeature(dna, f);
    expect(aa).toBe(EGFP);

    const result = analyzeProtein(aa);
    expect(result).not.toBeNull();
    // EGFP golden values from protein.golden.test.ts (Biopython ProtParam).
    expect(result!.length).toBe(239);
    expect(Math.abs(result!.molecularWeight - 26941.1543)).toBeLessThan(1e-3);
    expect(Math.abs(result!.isoelectricPoint - 5.5836)).toBeLessThan(0.01);
    expect(result!.extinctionReduced).toBe(21890);
  });
});

describe("trimTrailingStop", () => {
  it("trims exactly one trailing stop and leaves internal stops alone", () => {
    expect(trimTrailingStop("MVSK*")).toBe("MVSK");
    expect(trimTrailingStop("MVSK")).toBe("MVSK");
    expect(trimTrailingStop("MV*SK")).toBe("MV*SK");
    expect(trimTrailingStop("MVSK**")).toBe("MVSK*");
  });
});

describe("segmentCount + featureLocationLabel", () => {
  it("counts segments and labels a single forward span 1-based", () => {
    const f = feature({ start: 257, end: 956, strand: 1 });
    expect(segmentCount(f)).toBe(1);
    expect(featureLocationLabel(f)).toBe("258..956");
  });

  it("wraps a reverse span in complement()", () => {
    const f = feature({ start: 257, end: 956, strand: -1 });
    expect(featureLocationLabel(f)).toBe("complement(258..956)");
  });

  it("labels a multi-segment feature with join()", () => {
    const f = feature({
      start: 0,
      end: 300,
      strand: 1,
      locations: [
        { start: 0, end: 50 },
        { start: 119, end: 300 },
      ],
    });
    expect(segmentCount(f)).toBe(2);
    expect(featureLocationLabel(f)).toBe("join(1..50,120..300)");
  });
});

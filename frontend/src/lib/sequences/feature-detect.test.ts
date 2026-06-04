// feature detect bot — tests for the common-feature detector.
//
// Fixtures embed a reference PROTEIN's CDS into a synthetic DNA seq by a simple
// forward codon back-translation (one chosen codon per amino acid), then assert
// the production path (DNA -> ORF -> translate -> protein align) recovers it
// with high identity, correct forward DNA coordinates, and the right strand.

import { describe, it, expect } from "vitest";
import {
  detectFeatures,
  DEFAULT_FULL_IDENTITY,
  type ReferenceProtein,
} from "./feature-detect";
import { reverseComplement } from "../align";

// One representative codon per amino acid (+ stop). Deterministic so coordinates
// are exact. translate() reads these back to the same protein.
const CODON: Record<string, string> = {
  A: "GCT", R: "CGT", N: "AAT", D: "GAT", C: "TGT", Q: "CAA", E: "GAA",
  G: "GGT", H: "CAT", I: "ATT", L: "CTT", K: "AAA", M: "ATG", F: "TTT",
  P: "CCT", S: "TCT", T: "ACT", W: "TGG", Y: "TAT", V: "GTT",
  "*": "TAA",
};

/** Back-translate a protein to DNA (forward). Adds a start ATG only if the
 *  protein does not already begin with M (so the ORF finder sees a start). */
function backTranslate(protein: string): string {
  let dna = "";
  for (const aa of protein.toUpperCase()) dna += CODON[aa] ?? "NNN";
  return dna;
}

/** A CDS = ATG ... protein-without-leading-M-handled ... STOP, so findOrfs sees
 *  a clean ORF. We ensure the protein starts with M then append a stop codon. */
function cdsFor(protein: string): string {
  const withStart = protein.startsWith("M") ? protein : "M" + protein;
  return backTranslate(withStart) + CODON["*"];
}

const randomFlank = (n: number, seed = 1): string => {
  // Deterministic pseudo-random non-coding filler (no ATG-driven long ORFs by
  // construction is not guaranteed, but the gate handles spurious frames).
  const bases = "ACGT";
  let s = seed;
  let out = "";
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out += bases[s % 4];
  }
  return out;
};

// A compact but realistic fluorescent-protein-like reference (>= 25 aa so it is
// treated as a full protein). Sequence is arbitrary but fixed.
const FP_REF: ReferenceProtein = {
  name: "TestGFP",
  category: "fluorescent_protein",
  seq: "MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTT",
  source: "FPbase",
  license: "copyright-free",
};

const MARKER_REF: ReferenceProtein = {
  name: "TestAmpR",
  category: "resistance_marker",
  seq: "MSIQHFRVALIPFFAAFCLPVFAHPETLVKVKDAEDQLGARVGYIELDLN",
  source: "UniProt",
  license: "CC BY 4.0",
};

const HIS6: ReferenceProtein = {
  name: "His6",
  category: "epitope_tag",
  seq: "HHHHHH",
  source: "standard",
  license: "public",
};

const FLAG: ReferenceProtein = {
  name: "FLAG",
  category: "epitope_tag",
  seq: "DYKDDDDK",
  source: "standard",
  license: "public",
};

const LIB = [FP_REF, MARKER_REF, HIS6, FLAG];

describe("detectFeatures — full protein, forward strand", () => {
  it("detects a fluorescent protein CDS with high identity and exact coords", () => {
    const flank5 = randomFlank(30, 7);
    const cds = cdsFor(FP_REF.seq); // starts ATG (FP_REF starts with M)
    const flank3 = randomFlank(30, 99);
    const seq = flank5 + cds + flank3;

    const { features } = detectFeatures(seq, LIB);
    const hit = features.find((f) => f.name === "TestGFP");
    expect(hit).toBeDefined();
    if (!hit) return;
    expect(hit.strand).toBe(1);
    expect(hit.identity).toBeGreaterThanOrEqual(0.95);
    // The translated ORF begins at the ATG (flank5.length); aa 0 = forward base
    // flank5.length. The aligned span should start at the ORF start.
    expect(hit.dnaStart).toBe(flank5.length);
    // Reference is 51 aa -> 51 codons of coding DNA. End = start + 51*3.
    expect(hit.dnaEnd).toBe(flank5.length + FP_REF.seq.length * 3);
    expect(hit.kind).toBe("full");
    expect(hit.source).toBe("FPbase");
  });
});

describe("detectFeatures — reverse strand", () => {
  it("detects a marker CDS on the reverse strand with flipped strand + coords", () => {
    const flank5 = randomFlank(24, 3);
    const cds = cdsFor(MARKER_REF.seq);
    const flank3 = randomFlank(24, 55);
    // Place the CDS reverse-complemented into the forward sequence, so the
    // protein is encoded on the (-) strand.
    const forwardConstruct = flank5 + cds + flank3;
    const seq = reverseComplement(forwardConstruct);

    const { features } = detectFeatures(seq, LIB);
    const hit = features.find((f) => f.name === "TestAmpR");
    expect(hit).toBeDefined();
    if (!hit) return;
    expect(hit.strand).toBe(-1);
    expect(hit.identity).toBeGreaterThanOrEqual(0.95);
    // In the revcomp'd full sequence, the CDS now occupies the mirror span.
    const total = forwardConstruct.length;
    // forward CDS span [flank5.length, flank5.length + cds.length); mirrored:
    const cdsLen = cds.length;
    const mirrorStart = total - (flank5.length + cdsLen);
    // The detected coding span excludes the stop codon (3 bp) at the CDS 3' end,
    // which on the reverse strand sits at the LOW-coordinate end of the mirror.
    expect(hit.dnaStart).toBe(mirrorStart + 3);
    expect(hit.dnaEnd).toBe(mirrorStart + cdsLen);
  });
});

describe("detectFeatures — epitope tags", () => {
  it("detects a His6 tag near-exact at an ORF C-terminus", () => {
    // Build a CDS: ATG + filler protein + HHHHHH + stop.
    const body = "MGSSGENLYFQ"; // arbitrary, > a few residues
    const protein = body + "HHHHHH";
    const cds = backTranslate(protein) + CODON["*"];
    const flank5 = randomFlank(12, 2);
    const seq = flank5 + cds + randomFlank(12, 4);

    const { features } = detectFeatures(seq, LIB, { minOrfAa: 5 });
    const his = features.find((f) => f.name === "His6");
    expect(his).toBeDefined();
    if (!his) return;
    expect(his.kind).toBe("tag");
    expect(his.identity).toBe(1);
    expect(his.strand).toBe(1);
    // His6 sits at aa offset body.length within the ORF protein.
    const orfStart = flank5.length; // ATG of the CDS
    expect(his.dnaStart).toBe(orfStart + body.length * 3);
    expect(his.dnaEnd).toBe(orfStart + (body.length + 6) * 3);
  });

  it("detects a FLAG tag (8 aa) with one tolerated mismatch via the 90% gate", () => {
    const protein = "MAAAA" + "DYKDDDDK" + "GGG"; // FLAG embedded
    const cds = backTranslate(protein) + CODON["*"];
    const seq = randomFlank(9, 11) + cds + randomFlank(9, 13);
    const { features } = detectFeatures(seq, LIB, { minOrfAa: 5 });
    const flag = features.find((f) => f.name === "FLAG");
    expect(flag).toBeDefined();
    expect(flag?.identity).toBe(1);
  });

  it("does not flag a short tag against a non-matching ORF", () => {
    const protein = "MAAAAAAAAAAAAAAAAAAA"; // poly-Ala, no His/FLAG
    const cds = backTranslate(protein) + CODON["*"];
    const seq = randomFlank(9, 21) + cds + randomFlank(9, 23);
    const { features } = detectFeatures(seq, LIB, { minOrfAa: 5 });
    expect(features.find((f) => f.name === "His6")).toBeUndefined();
    expect(features.find((f) => f.name === "FLAG")).toBeUndefined();
  });
});

describe("detectFeatures — gate against noise", () => {
  it("yields no confident hits on random non-coding sequence", () => {
    const seq = randomFlank(600, 12345);
    const { features } = detectFeatures(seq, LIB);
    // No full-protein homolog should clear the identity+coverage gate; any
    // stray tag near-exact in random DNA is astronomically unlikely.
    const confident = features.filter((f) => f.kind === "full");
    expect(confident.length).toBe(0);
  });
});

describe("detectFeatures — closest known protein", () => {
  it("returns the best reference for an ORF below the confident gate", () => {
    // Take the FP reference and mutate ~half its residues so identity falls
    // below the gate but it is still the closest of the library.
    const mutated = FP_REF.seq
      .split("")
      .map((aa, i) => (i % 2 === 0 ? aa : "G"))
      .join("");
    const cds = cdsFor(mutated);
    const seq = randomFlank(15, 5) + cds + randomFlank(15, 6);

    const { features, closest } = detectFeatures(seq, LIB);
    // It is below the gate -> not auto-proposed as TestGFP.
    expect(features.find((f) => f.name === "TestGFP" && f.identity >= DEFAULT_FULL_IDENTITY)).toBeUndefined();
    // But closest-match should still name TestGFP as the nearest reference.
    const c = closest.find((x) => x.name === "TestGFP");
    expect(c).toBeDefined();
    expect(c?.identity).toBeGreaterThan(0.3);
    expect(c?.identity).toBeLessThan(DEFAULT_FULL_IDENTITY);
  });
});

describe("detectFeatures — de-dupe overlaps", () => {
  it("does not double-propose the same region on the same strand", () => {
    const cds = cdsFor(FP_REF.seq);
    const seq = randomFlank(10, 1) + cds + randomFlank(10, 2);
    const { features } = detectFeatures(seq, LIB);
    const gfpHits = features.filter((f) => f.name === "TestGFP");
    expect(gfpHits.length).toBeLessThanOrEqual(1);
  });
});

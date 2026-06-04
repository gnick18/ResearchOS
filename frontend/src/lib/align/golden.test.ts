/**
 * GOLDEN / GROUND-TRUTH suite for the pairwise alignment engine.
 *
 * THE CORE PRINCIPLE
 * ------------------
 * Every expected score and alignment below comes from an INDEPENDENT authority,
 * NEVER from this engine's own output. A test that asserts "engine output ==
 * what the engine produced" verifies nothing. Each case is grounded by EITHER:
 *
 *   (a) a CANONICAL published worked example with a documented optimal alignment
 *       and score, OR a value computable BY HAND from the documented scoring
 *       (cited inline), OR
 *   (b) BIOPYTHON `Bio.Align.PairwiseAligner` (v1.87) run with parameters
 *       configured to match our engine exactly. The reference's optimal score
 *       and aligned strings are baked in as fixtures by
 *       `frontend/scripts/gen-align-golden.py` (committed alongside this file).
 *
 * Re-run the generator and diff its printed numbers against the constants here
 * to audit any fixture. This test itself is PURE TS (no Python, no network),
 * so it is CI-safe.
 *
 * CONVENTION RECONCILIATION (done before trusting any Biopython number)
 * --------------------------------------------------------------------
 * Our engine's affine gap model: a gap of length L costs gapOpen + L*gapExtend
 * (open paid once per run, extend paid for EVERY gap cell incl. the first).
 * Defaults: DNA match +2 / mismatch -1, gapOpen 5, gapExtend 1.
 *
 * Biopython scores a length-L gap as open_gap_score + (L-1)*extend_gap_score.
 * Setting open_gap_score = -(gapOpen+gapExtend) and extend_gap_score = -gapExtend
 * makes Biopython's total = -(gapOpen + L*gapExtend), i.e. IDENTICAL to ours.
 * The generator verifies this at runtime on four hand-computed trivial cases
 * (identical 5-mer = +10; one mismatch = +7; one-base gap = 0; length-3 gap
 * = +4) and ALL FOUR agree with Biopython before any fixture is emitted. Those
 * same trivial cases are re-asserted here against our engine as the in-suite
 * convention gate (see "convention gate" describe block).
 *
 * EXACT vs TIE-TOLERANT
 * ---------------------
 * Where the optimal alignment is UNIQUE (verified via Biopython's count of
 * optimal alignments), we assert exact score + alignedA/alignedB + ops/cigar +
 * coords. Where multiple equally-optimal alignments exist (tie-prone), we assert
 * the exact score + identity and that the RETURNED alignment is internally
 * valid (re-scoring its own columns reproduces the reported score), rather than
 * pinning a brittle exact string. Tie-prone cases are labeled as such.
 *
 * Coordinates are 0-based half-open throughout.
 */
import { describe, expect, it } from "vitest";
import { alignGlobal, alignLocal, alignSemiGlobal } from "./core";
import { dnaScoring, proteinScoring, reverseComplement } from "./scoring";
import { seedAndExtend } from "./seed";
import type { AlignmentResult } from "./types";

const DNA = dnaScoring(); // match +2, mismatch -1, IUPAC-aware (engine default)

/**
 * Re-score an alignment from its OWN aligned strings under the given scoring +
 * gap model, independently of the score the engine reported. Used for
 * tie-prone cases: a valid optimal alignment must re-score to its reported
 * score regardless of which of several co-optimal paths the engine returned.
 *
 * This re-scorer is a deliberately independent reimplementation of the gap
 * model (gap run = gapOpen + L*gapExtend) so it cannot mask an engine scoring
 * bug.
 */
function rescore(
  alignedA: string,
  alignedB: string,
  score: (x: string, y: string) => number,
  gapOpen: number,
  gapExtend: number,
): number {
  if (alignedA.length !== alignedB.length) {
    throw new Error("aligned strings must be equal length");
  }
  let total = 0;
  // Track current gap run on each side independently. A gap "run" on one side is
  // a maximal stretch of '-' on that side; it costs gapOpen once + gapExtend per
  // cell. Match/mismatch columns close any open run.
  let runA = 0; // length of current gap-in-A run
  let runB = 0; // length of current gap-in-B run
  const closeA = () => {
    if (runA > 0) total -= gapOpen + runA * gapExtend;
    runA = 0;
  };
  const closeB = () => {
    if (runB > 0) total -= gapOpen + runB * gapExtend;
    runB = 0;
  };
  for (let i = 0; i < alignedA.length; i++) {
    const ca = alignedA[i];
    const cb = alignedB[i];
    if (ca === "-" && cb === "-") {
      throw new Error("double gap column is never optimal");
    } else if (ca === "-") {
      closeB();
      runA += 1; // gap in A this column
    } else if (cb === "-") {
      closeA();
      runB += 1; // gap in B this column
    } else {
      closeA();
      closeB();
      total += score(ca, cb);
    }
  }
  closeA();
  closeB();
  return total;
}

/** Assert a result is internally consistent: cigar matches ops, identity matches. */
function expectInternallyConsistent(r: AlignmentResult): void {
  // identity = count('M') / ops.length
  const matches = r.ops.filter((o) => o === "M").length;
  const expectedId = r.ops.length === 0 ? 0 : matches / r.ops.length;
  expect(r.identity).toBeCloseTo(expectedId, 10);
  // alignedA/alignedB have equal length == ops.length
  expect(r.alignedA.length).toBe(r.ops.length);
  expect(r.alignedB.length).toBe(r.ops.length);
}

// ===========================================================================
// CONVENTION GATE
// The same four trivial, HAND-COMPUTED cases the generator uses to prove the
// Biopython<->engine convention match. If any of these drift, every downstream
// Biopython-grounded fixture is suspect, so they live first and stand alone.
// ===========================================================================
describe("golden: convention gate (hand-computed, no reference impl needed)", () => {
  it("[1] identical 5-mer global == +10 (5 matches * 2)", () => {
    expect(alignGlobal("ACGTA", "ACGTA").score).toBe(10);
  });
  it("[2] single mismatch global == +7 (4*2 + 1*(-1))", () => {
    // ACGTA vs ACCTA, position 2 G->C.
    expect(alignGlobal("ACGTA", "ACCTA").score).toBe(7);
  });
  it("[3] single-base gap global == 0 (3*2 - (5 + 1*1))", () => {
    expect(alignGlobal("ACGT", "ACT").score).toBe(0);
  });
  it("[4] length-3 affine gap global == +4 (6*2 - (5 + 3*1)), one run not three", () => {
    // AAAGGGAAA vs AAAAAA: the GGG is a single length-3 gap, NOT three opens.
    const r = alignGlobal("AAAGGGAAA", "AAAAAA");
    expect(r.score).toBe(4);
    expect(r.alignedA).toBe("AAAGGGAAA");
    expect(r.alignedB).toBe("AAA---AAA");
  });
});

// ===========================================================================
// GLOBAL (Needleman-Wunsch)
// ===========================================================================
describe("golden: global (Needleman-Wunsch)", () => {
  // CANONICAL textbook pair (Needleman-Wunsch / Wikipedia worked example).
  // GATTACA vs GCATGCT under our default scoring is gapless end-to-end (any
  // gap would cost >= 6, more than it could recover here). Biopython
  // (PairwiseAligner, our params): score = 2.0, n_optimal = 1, alignment
  // GATTACA / GCATGCT. Source: gen-align-golden.py "GLOBAL dna A".
  it("GATTACA vs GCATGCT: exact, unique optimum (Biopython score 2)", () => {
    const r = alignGlobal("GATTACA", "GCATGCT");
    expect(r.score).toBe(2);
    expect(r.alignedA).toBe("GATTACA");
    expect(r.alignedB).toBe("GCATGCT");
    expect([r.aStart, r.aEnd, r.bStart, r.bEnd]).toEqual([0, 7, 0, 7]);
    // 3 matches (G_A_T_A positions), gapless => 7 columns, no I/D.
    expect(r.cigar.includes("I")).toBe(false);
    expect(r.cigar.includes("D")).toBe(false);
    expectInternallyConsistent(r);
  });

  // Biopython-validated DNA, single internal 2-base gap, UNIQUE optimum.
  // ACGTGTCATTG vs ACGTCATTG: Biopython score 11.0, alignment
  // ACGTGTCATTG / AC--GTCATTG (n_optimal = 3 -> TIE-PRONE). Source:
  // gen-align-golden.py "GLOBAL dna B".
  it("two-base indel (TIE-PRONE: 3 co-optimal): score 11 + valid re-score", () => {
    const r = alignGlobal("ACGTGTCATTG", "ACGTCATTG");
    expect(r.score).toBe(11);
    // Re-score the engine's chosen alignment independently: must equal 11.
    expect(rescore(r.alignedA, r.alignedB, DNA, 5, 1)).toBe(11);
    expectInternallyConsistent(r);
  });

  // Biopython-validated longer DNA, single 1-base gap, UNIQUE optimum.
  // Biopython score 34.0, n_optimal 1, alignment
  // TGGCCAGGCTGGTCTCGAACT / TGGCCAGG-TGGTCTCGAACT. Source: "GLOBAL dna C".
  it("longer DNA with one deletion: exact, unique optimum (Biopython 34)", () => {
    const r = alignGlobal("TGGCCAGGCTGGTCTCGAACT", "TGGCCAGGTGGTCTCGAACT");
    expect(r.score).toBe(34);
    expect(r.alignedA).toBe("TGGCCAGGCTGGTCTCGAACT");
    expect(r.alignedB).toBe("TGGCCAGG-TGGTCTCGAACT");
    expect(r.cigar).toBe("8M1I12M");
    expect(rescore(r.alignedA, r.alignedB, DNA, 5, 1)).toBe(34);
    expectInternallyConsistent(r);
  });
});

// ===========================================================================
// LOCAL (Smith-Waterman)
// ===========================================================================
describe("golden: local (Smith-Waterman)", () => {
  // Embedded identical island flanked by non-matching bases. The optimal local
  // alignment is the 8-base island ACGTACGT (16 = 8*2). Biopython local:
  // score 16.0, n_optimal 1, ACGTACGT / ACGTACGT. Source: "LOCAL dna A".
  it("embedded identical island: exact, unique optimum (Biopython 16)", () => {
    const r = alignLocal("AAAAACGTACGTAAAAA", "TTTTACGTACGTTTTT");
    expect(r.score).toBe(16);
    expect(r.alignedA).toBe("ACGTACGT");
    expect(r.alignedB).toBe("ACGTACGT");
    expect(r.cigar).toBe("8M");
    expect(r.identity).toBe(1);
    // island spans [4,12) in a and [4,12) in b (0-based half-open): in
    // "AAAAACGTACGT..." the 8-mer ACGTACGT begins at the 5th A (index 4).
    expect([r.aStart, r.aEnd, r.bStart, r.bEnd]).toEqual([4, 12, 4, 12]);
  });

  // Smith-Waterman 1981-style short pair. GGTTGACTA vs TGTTACGG: under default
  // DNA scoring the single best local subalignment is the 3-base GTT (6 = 3*2).
  // Biopython local: score 6.0, n_optimal 1, GTT / GTT. Source: "LOCAL dna B".
  it("Smith-Waterman short pair GGTTGACTA/TGTTACGG: exact, unique (Biopython 6)", () => {
    const r = alignLocal("GGTTGACTA", "TGTTACGG");
    expect(r.score).toBe(6);
    expect(r.alignedA).toBe("GTT");
    expect(r.alignedB).toBe("GTT");
    expect(r.cigar).toBe("3M");
    expect([r.aStart, r.aEnd, r.bStart, r.bEnd]).toEqual([1, 4, 1, 4]);
  });
});

// ===========================================================================
// SEMI-GLOBAL (query end-to-end, target end gaps free)
// ===========================================================================
describe("golden: semi-global (free target end gaps, query end-to-end)", () => {
  // A short primer placed inside a longer template. Biopython global mode with
  // the query/2nd-sequence end gaps freed (end_deletion_score = 0) reproduces
  // our alignSemiGlobal. NOTE the gap SIDE matters: the template's overhanging
  // flanks are gaps in the QUERY, so freeing the deletion (query) end gaps -
  // not the insertion (target) end gaps - is what matches our engine (verified
  // in gen-align-golden.py against a hand value of +16). Source: "SEMIGLOBAL
  // primer-into-template (exact)".
  it("exact primer into template: score 16, query spans fully", () => {
    const r = alignSemiGlobal("AAAAACGTACGTGGGGG", "ACGTACGT");
    expect(r.score).toBe(16); // 8 matches * 2; target flanks free
    expect(r.alignedA).toBe("ACGTACGT");
    expect(r.alignedB).toBe("ACGTACGT");
    expect(r.cigar).toBe("8M");
    expect(r.identity).toBe(1);
    // query [0,8) fully consumed; target sub-span [4,12).
    expect([r.aStart, r.aEnd, r.bStart, r.bEnd]).toEqual([4, 12, 0, 8]);
  });

  // Same, with one internal mismatch in the template region. Biopython 13.0.
  // Source: "SEMIGLOBAL primer-into-template (one mismatch)".
  it("primer with one internal mismatch: score 13", () => {
    const r = alignSemiGlobal("AAAAACGTTCGTGGGGG", "ACGTACGT");
    expect(r.score).toBe(13); // 7 matches*2 - 1 mismatch
    expect(r.alignedA).toBe("ACGTTCGT");
    expect(r.alignedB).toBe("ACGTACGT");
    expect(r.cigar).toBe("4M1X3M");
    expect([r.aStart, r.aEnd, r.bStart, r.bEnd]).toEqual([4, 12, 0, 8]);
    expect(rescore(r.alignedA, r.alignedB, DNA, 5, 1)).toBe(13);
  });
});

// ===========================================================================
// AFFINE GAPS: one long gap must beat several short gaps
// ===========================================================================
describe("golden: affine gaps (one long gap beats many short)", () => {
  // With a HIGH open penalty (gapOpen 10) and LOW extend (gapExtend 1), the
  // optimum collapses the difference into ONE long gap rather than several
  // short gaps (which would each pay the 10 open). ACGTACGTACGT vs ACGTGT:
  // Biopython (our params) score -4.0, n_optimal 1, alignment
  // ACGTACGTACGT / ACGT------GT  (one length-6 gap). Source: "AFFINE
  // one-long-gap-vs-many". Hand-check: 6 matches*2 - (10 + 6*1) = 12 - 16 = -4.
  it("prefers a single length-6 gap (gapOpen 10): exact, unique (Biopython -4)", () => {
    const r = alignGlobal("ACGTACGTACGT", "ACGTGT", { gapOpen: 10, gapExtend: 1 });
    expect(r.score).toBe(-4);
    expect(r.alignedA).toBe("ACGTACGTACGT");
    expect(r.alignedB).toBe("ACGT------GT");
    expect(r.cigar).toBe("4M6I2M"); // ONE gap run of 6, not several
    // independent re-score under the same high-open model
    expect(rescore(r.alignedA, r.alignedB, DNA, 10, 1)).toBe(-4);
  });

  // Contrast: under the DEFAULT cheap-open model (gapOpen 5) the engine is still
  // free to choose, but the optimum is grounded by Biopython at the default
  // params too. We assert the score the cheap model yields differs, proving the
  // gap penalties actually drive placement (not a hardcoded path).
  it("gap penalties change the optimum (default vs high open give different scores)", () => {
    const cheap = alignGlobal("ACGTACGTACGT", "ACGTGT");
    const dear = alignGlobal("ACGTACGTACGT", "ACGTGT", { gapOpen: 10, gapExtend: 1 });
    expect(cheap.score).not.toBe(dear.score);
    // both must self-rescore consistently under their own model
    expect(rescore(cheap.alignedA, cheap.alignedB, DNA, 5, 1)).toBe(cheap.score);
    expect(rescore(dear.alignedA, dear.alignedB, DNA, 10, 1)).toBe(dear.score);
  });
});

// ===========================================================================
// DNA scoring incl. IUPAC degenerate matches (hand-grounded; definitional)
// ===========================================================================
describe("golden: DNA IUPAC degeneracy (hand-grounded, definitional)", () => {
  it("N matches every base: NNNN vs ACGT == +8, 100% identity", () => {
    const r = alignGlobal("NNNN", "ACGT");
    expect(r.score).toBe(8); // 4 compatible columns * 2
    expect(r.cigar).toBe("4M");
    expect(r.identity).toBe(1);
  });

  it("R = A|G: RRRR vs AGAG all compatible == +8", () => {
    const r = alignGlobal("RRRR", "AGAG");
    expect(r.score).toBe(8);
    expect(r.identity).toBe(1);
  });

  it("R is incompatible with C: single column == -1 (mismatch)", () => {
    const r = alignGlobal("R", "C");
    expect(r.score).toBe(-1);
    expect(r.cigar).toBe("1X");
    expect(r.identity).toBe(0);
  });

  it("iupac:false makes N a literal: NNNN vs ACGT == -4 (4 mismatches)", () => {
    const r = alignGlobal("NNNN", "ACGT", { scoring: dnaScoring({ iupac: false }) });
    expect(r.score).toBe(-4); // 4 mismatches * -1
    expect(r.cigar).toBe("4X");
    expect(r.identity).toBe(0);
  });

  it("Y = C|T matches a C, mismatches an A (column-level, hand-grounded)", () => {
    // YY vs CA: Y/C compatible (+2), Y/A incompatible (-1) => +1.
    const r = alignGlobal("YY", "CA");
    expect(r.score).toBe(1);
    expect(r.ops).toEqual(["M", "X"]);
  });
});

// ===========================================================================
// PROTEIN BLOSUM62 (cross-validated against Biopython's BLOSUM62 matrix)
// ===========================================================================
describe("golden: protein BLOSUM62", () => {
  const PROT = proteinScoring();

  // Classic Durbin et al. example HEAGAWGHEE / PAWHEAE. Biopython BLOSUM62,
  // gapOpen 11 / gapExtend 1 (our model), GLOBAL: score 1.0, n_optimal 2
  // (TIE-PRONE), one optimum HEAGAWGHEE / ---PAWHEAE. Source: "PROTEIN global
  // BLOSUM62 A".
  it("global HEAGAWGHEE/PAWHEAE (TIE-PRONE: 2 co-optimal): score 1 + valid re-score", () => {
    const r = alignGlobal("HEAGAWGHEE", "PAWHEAE", {
      scoring: PROT,
      gapOpen: 11,
      gapExtend: 1,
    });
    expect(r.score).toBe(1);
    // independent re-score of whatever co-optimal path the engine returned
    expect(rescore(r.alignedA, r.alignedB, PROT, 11, 1)).toBe(1);
    expectInternallyConsistent(r);
  });

  // Same pair, LOCAL. Biopython BLOSUM62 local: score 17.0, n_optimal 2
  // (TIE-PRONE), best subalignment HEA / HEA. Source: "PROTEIN local BLOSUM62 A".
  it("local HEAGAWGHEE/PAWHEAE (TIE-PRONE: 2 co-optimal): score 17 + valid re-score", () => {
    const r = alignLocal("HEAGAWGHEE", "PAWHEAE", {
      scoring: PROT,
      gapOpen: 11,
      gapExtend: 1,
    });
    expect(r.score).toBe(17);
    expect(rescore(r.alignedA, r.alignedB, PROT, 11, 1)).toBe(17);
    // a positive local score implies a non-empty subalignment
    expect(r.alignedA.length).toBeGreaterThan(0);
    expectInternallyConsistent(r);
  });

  // Conservative-substitution pair MKLVING / MKIVLNG, GLOBAL, UNIQUE optimum.
  // Biopython BLOSUM62: score 30.0, n_optimal 1, gapless MKLVING / MKIVLNG.
  // (L<->I and I<->L are conservative, scored positive by BLOSUM62.) Source:
  // "PROTEIN global BLOSUM62 B".
  it("global MKLVING/MKIVLNG: exact gapless, unique optimum (Biopython 30)", () => {
    const r = alignGlobal("MKLVING", "MKIVLNG", {
      scoring: PROT,
      gapOpen: 11,
      gapExtend: 1,
    });
    expect(r.score).toBe(30);
    expect(r.alignedA).toBe("MKLVING");
    expect(r.alignedB).toBe("MKIVLNG");
    expect(r.cigar.includes("I")).toBe(false);
    expect(r.cigar.includes("D")).toBe(false);
    expect([r.aStart, r.aEnd, r.bStart, r.bEnd]).toEqual([0, 7, 0, 7]);
    expect(rescore(r.alignedA, r.alignedB, PROT, 11, 1)).toBe(30);
  });
});

// ===========================================================================
// REVERSE-STRAND via seedAndExtend (hand-grounded: reverse complement is
// definitional, and forward coords must map back correctly)
// ===========================================================================
describe("golden: reverse-strand seed-and-extend (hand-grounded)", () => {
  it("query == revcomp of an embedded region binds strand -1 at forward coords", () => {
    // Construct a target whose region ACGGTCATGCAA (at index 12, length 12) has
    // a reverse complement TTGCATGACCGT. The query is that reverse complement.
    // The query does NOT occur on the forward strand, so the ONLY hit is reverse.
    const region = "ACGGTCATGCAA";
    const target = "TTTTTTTTTTTT" + region + "GGGGGGGGGGGG"; // region at [12,24)
    const query = reverseComplement(region); // "TTGCATGACCGT"
    expect(query).toBe("TTGCATGACCGT"); // hand-grounded reverse complement
    expect(target.includes(query)).toBe(false); // not present forward

    const hits = seedAndExtend(query, target, {});
    expect(hits.length).toBe(1);
    const hit = hits[0];
    expect(hit.strand).toBe(-1);
    // Forward-target coordinates of the bound region (0-based half-open).
    expect(hit.targetStart).toBe(12);
    expect(hit.targetEnd).toBe(24);
    // Perfect 12-base reverse-complement match: 12 * 2 = 24.
    expect(hit.score).toBe(24);
    expect(hit.alignment.cigar).toBe("12M");
    expect(hit.alignment.identity).toBe(1);
  });

  it("a forward-matching query binds strand +1 (control for the strand tag)", () => {
    const region = "ACGGTCATGCAA";
    const target = "TTTTTTTTTTTT" + region + "GGGGGGGGGGGG";
    const hits = seedAndExtend(region, target, {}); // query == forward region
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].strand).toBe(1);
    expect(hits[0].targetStart).toBe(12);
    expect(hits[0].targetEnd).toBe(24);
    expect(hits[0].score).toBe(24);
  });
});

// ===========================================================================
// EDGE CASES (hand-grounded; several cross-checked as unique via Biopython)
// ===========================================================================
describe("golden: edge cases (hand-grounded)", () => {
  it("identical sequences: 100% identity, full length, no gaps", () => {
    const r = alignGlobal("ACGTACGT", "ACGTACGT");
    expect(r.score).toBe(16); // 8 * 2
    expect(r.cigar).toBe("8M");
    expect(r.identity).toBe(1);
    expect([r.aStart, r.aEnd, r.bStart, r.bEnd]).toEqual([0, 8, 0, 8]);
  });

  it("single mismatch placement: middle column flips to X (Biopython unique)", () => {
    // ACGTACGT vs ACGAACGT differ only at index 3. Biopython n_optimal 1.
    const r = alignGlobal("ACGTACGT", "ACGAACGT");
    expect(r.score).toBe(13); // 7*2 - 1
    expect(r.cigar).toBe("3M1X4M");
    expect(r.ops).toEqual(["M", "M", "M", "X", "M", "M", "M", "M"]);
    expect(r.identity).toBeCloseTo(7 / 8, 10);
  });

  it("single-base indel: one I op, score 8 (Biopython unique: ACGT-CGT)", () => {
    // ACGTACGT vs ACGTCGT: one base deleted from b. Biopython n_optimal 1,
    // alignment ACGTACGT / ACGT-CGT, score 8.0 (7*2 - (5 + 1*1)).
    const r = alignGlobal("ACGTACGT", "ACGTCGT");
    expect(r.score).toBe(8);
    expect(r.alignedA).toBe("ACGTACGT");
    expect(r.alignedB).toBe("ACGT-CGT");
    expect(r.cigar).toBe("4M1I3M");
    expect(rescore(r.alignedA, r.alignedB, DNA, 5, 1)).toBe(8);
  });

  it("empty vs empty (global): zero-length, score 0", () => {
    const r = alignGlobal("", "");
    expect(r.score).toBe(0);
    expect(r.alignedA).toBe("");
    expect(r.alignedB).toBe("");
    expect(r.ops).toEqual([]);
    expect(r.cigar).toBe("");
    expect(r.identity).toBe(0);
  });

  it("empty vs non-empty (global): a full-length gap, score -(open + L*extend)", () => {
    const r = alignGlobal("", "ACGT");
    // gap of length 4: -(5 + 4*1) = -9. Hand-grounded from the gap model.
    expect(r.score).toBe(-9);
    expect(r.cigar).toBe("4D");
    expect(r.alignedA).toBe("----");
    expect(r.alignedB).toBe("ACGT");
  });

  it("one-char match / mismatch (global)", () => {
    expect(alignGlobal("A", "A").score).toBe(2);
    expect(alignGlobal("A", "C").score).toBe(-1);
    expect(alignGlobal("A", "A").cigar).toBe("1M");
    expect(alignGlobal("A", "C").cigar).toBe("1X");
  });

  it("fully divergent (local): no positive island -> empty alignment, score 0", () => {
    const r = alignLocal("AAAAAA", "CCCCCC");
    expect(r.score).toBe(0);
    expect(r.alignedA).toBe("");
    expect(r.alignedB).toBe("");
    expect(r.ops).toEqual([]);
    expect(r.identity).toBe(0);
  });

  it("fully divergent (global): forced end-to-end, all mismatches", () => {
    const r = alignGlobal("AAAA", "CCCC");
    expect(r.score).toBe(-4); // 4 * -1, cheaper than any gap (>= 6 each)
    expect(r.cigar).toBe("4X");
    expect(r.identity).toBe(0);
  });
});

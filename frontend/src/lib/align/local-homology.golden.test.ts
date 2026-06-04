/**
 * GOLDEN / CROSS-VALIDATION suite for the seed-and-chain SHARED-REGION (HSP)
 * finder, `findSharedRegions` in ./local-homology.ts.
 *
 * THE CORE PRINCIPLE
 * ------------------
 * Every expected coordinate, identity, and aligned segment below comes from an
 * INDEPENDENT authority, NEVER from this finder's own output. The authority is
 * BIOPYTHON `Bio.Align.PairwiseAligner` (v1.87) in LOCAL (Smith-Waterman) mode,
 * configured to match our engine's DNA scoring + affine gap model EXACTLY. The
 * committed generator `frontend/scripts/gen-shared-regions-golden.py` builds the
 * SAME constructed pairs this file builds (identical LCG, see randomDna), runs
 * Biopython local over each planted REGION, and prints the optimal aligned span +
 * identity. Those Biopython numbers are baked in below as the BIO_* fixtures.
 * Re-run the generator and diff its printed values against these constants to
 * audit any fixture. This test itself is PURE TS (no Python, no network) and is
 * CI-safe.
 *
 * WHY THE ORACLE IS RUN OVER THE PLANTED REGION (not the whole pair)
 * -----------------------------------------------------------------
 * Biopython local alignment over a WHOLE ~10-20kb pair does NOT recover the
 * planted block: across thousands of bases of random DNA the single optimal
 * local alignment chains a long run of CHANCE matches spanning the entire
 * sequence (empirically score ~3000, identity ~0.50 over 10kb) and drowns the
 * real block. That is a true property of optimal SW on long random sequence, not
 * a bug in either tool. The MEANINGFUL oracle is "Biopython's optimal local
 * alignment OF THE HOMOLOGOUS REGION", so the generator runs Biopython over
 * EXACTLY the planted span (PAD=0), yielding the pristine region truth (identity
 * 1.0 for a clean block, its exact mismatch/indel count otherwise). This is also
 * what our finder does internally (it refines a banded window around each
 * anchor), so the comparison is apples-to-apples.
 *
 * CONVENTION RECONCILIATION (done before trusting any Biopython number)
 * --------------------------------------------------------------------
 * Our engine's affine gap model: a length-L gap costs gapOpen + L*gapExtend
 * (open once per run, extend every gap cell incl. the first). Defaults DNA match
 * +2 / mismatch -1, gapOpen 5, gapExtend 1. The finder passes these straight into
 * alignLocal. Biopython scores a length-L gap as open + (L-1)*extend; setting
 * open = -(gapOpen+gapExtend) and extend = -gapExtend makes Biopython's total ==
 * ours. The generator verifies this on two HAND-COMPUTED local cases (an 8-mer
 * island = score 16 / identity 1.0 at A[5,13) B[4,12); the same island with one
 * point mismatch = score 13 / identity 0.875) BEFORE emitting any fixture, and
 * BOTH agree with Biopython. The RECONCILIATION GATE describe block below
 * re-asserts that exact island case against OUR finder, so if our convention
 * drifts from Biopython's the gate fails first and every downstream fixture is
 * known suspect.
 *
 * HONEST TOLERANCES (the finder is a HEURISTIC, not guaranteed-optimal SW)
 * -----------------------------------------------------------------------
 * The finder seeds k-mers, chains them, and refines a BANDED window, so on a
 * clear region it must agree with Biopython on STRAND and on the CORE of the
 * region, but it is allowed to differ at the EDGES:
 *   * BOUNDARY_TOL = 40 bp. The banded local refine greedily extends a few bases
 *     into the random flanks on chance-match runs that net a small positive
 *     score (the same flank-extension Biopython itself shows when given a padded
 *     window). Observed boundary drift on these cases is <= ~30 bp; 40 bp matches
 *     the slack the existing truth-by-construction test already uses and leaves a
 *     small margin. Asserted on each of aStart/aEnd/bStart/bEnd.
 *   * IDENTITY_TOL = 0.08. Because the finder extends a little into the flanks,
 *     its reported identity is BELOW Biopython's pristine-region identity: the
 *     extra flank columns are random vs random, so ~3/4 of them are mismatches.
 *     With up to BOUNDARY_TOL (40 bp) of extension per edge, a region of length
 *     R picks up at most ~2*40 extra columns, ~3/4 of them mismatches, dropping
 *     identity by up to ~60/(R+80). On the SMALLEST region here (600 bp, CASE B,
 *     which ALSO already carries 6 real mismatches) the observed finder identity
 *     is 0.935 vs Biopython's 0.99, a 0.055 drop; 0.08 covers that with margin
 *     while staying far tighter than the ~0.3+ gap a genuinely WRONG region would
 *     show. We assert the finder's identity is within IDENTITY_TOL BELOW
 *     Biopython's and never above it by more than a rounding hair. We do NOT
 *     loosen this to hide a real drop: a finder identity far under Biopython's
 *     would mean a wrong region and is a reportable bug, not a tolerance.
 *   * CORE MATCH (exact): the finder's recovered aligned-A core (gaps stripped)
 *     must CONTAIN the inner slice of the planted block (the block minus
 *     BOUNDARY_TOL on each end). This is the strong assertion: the actual bases
 *     recovered are the homologous region, exactly, with only boundary slop.
 * If the finder ever disagreed with Biopython on strand, or recovered a core that
 * is NOT the planted region, that is a BUG to report, not a tolerance to widen.
 *
 * Coordinates are 0-based half-open throughout.
 *
 * Source of all BIO_* fixtures: Biopython 1.87 PairwiseAligner (local),
 * frontend/scripts/gen-shared-regions-golden.py.
 */
import { describe, expect, it } from "vitest";
import { findSharedRegions } from "./local-homology";
import { reverseComplement } from "./scoring";
import type { Hsp } from "./local-homology";

// ---------------------------------------------------------------------------
// Deterministic DNA — BYTE-IDENTICAL to the generator's random_dna (same LCG,
// same 2-bit base extraction) AND to local-homology.test.ts's randomDna. This is
// what guarantees the sequences this test builds match the ones the generator
// fed to Biopython, so the baked fixtures describe the same regions.
// ---------------------------------------------------------------------------
function randomDna(length: number, seed: number): string {
  const bases = "ACGT";
  let state = (seed * 2654435761) >>> 0;
  let out = "";
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out += bases[(state >>> 16) & 3];
  }
  return out;
}
function sharedBlock(length: number, seed: number): string {
  return randomDna(length, seed + 9_999);
}

const BOUNDARY_TOL = 40; // bp of edge slop allowed (see header)
const IDENTITY_TOL = 0.08; // how far below Biopython's region identity is OK (see header)

/**
 * Assert one HSP matches a Biopython region fixture: same strand, all four
 * coordinates within BOUNDARY_TOL, identity within IDENTITY_TOL below
 * Biopython's (and not meaningfully above it), and the recovered core contains
 * the inner slice of the planted block. `block` is the planted forward block; for
 * a reverse HSP `block` is still the forward block (the finder's alignedB is
 * reverse-complemented back to forward, so it re-presents `block`).
 */
function expectMatchesRegion(
  hsp: Hsp,
  bio: {
    strand: 1 | -1;
    aStart: number;
    aEnd: number;
    bStart: number;
    bEnd: number;
    identity: number;
  },
  block: string,
): void {
  expect(hsp.strand).toBe(bio.strand);
  expect(Math.abs(hsp.aStart - bio.aStart)).toBeLessThanOrEqual(BOUNDARY_TOL);
  expect(Math.abs(hsp.aEnd - bio.aEnd)).toBeLessThanOrEqual(BOUNDARY_TOL);
  expect(Math.abs(hsp.bStart - bio.bStart)).toBeLessThanOrEqual(BOUNDARY_TOL);
  expect(Math.abs(hsp.bEnd - bio.bEnd)).toBeLessThanOrEqual(BOUNDARY_TOL);
  // Identity: within tolerance BELOW Biopython's, and never more than a rounding
  // hair ABOVE it (the finder cannot be MORE identical than the pristine region).
  expect(hsp.identity).toBeGreaterThanOrEqual(bio.identity - IDENTITY_TOL);
  expect(hsp.identity).toBeLessThanOrEqual(bio.identity + 1e-6);
  // The recovered aligned-A core (gaps stripped) is the homologous region: it
  // must CONTAIN the inner slice of the planted block (block minus the boundary
  // tolerance on each end), exactly. This is the load-bearing "right bases"
  // assertion the coordinate tolerances cannot fake.
  const coreA = hsp.alignedA.replace(/-/g, "");
  const inner = block.slice(BOUNDARY_TOL, block.length - BOUNDARY_TOL);
  expect(coreA).toContain(inner);
}

// ===========================================================================
// RECONCILIATION GATE
// One small, fully HAND-TRACEABLE case where our finder's HSP equals Biopython's
// local alignment EXACTLY. An 8-mer island ACGTACGT embedded in divergent flanks,
// each flank padded to clear the seed-length / minScore floors so the finder
// actually fires. By hand AND by Biopython (gen-shared-regions-golden.py
// reconcile()): the optimal LOCAL alignment is the 8-mer island, score 16
// (8 * 2), identity 1.0, ungapped. If this drifts, every Biopython fixture below
// is suspect, so it stands first and alone.
// ===========================================================================
describe("golden: reconciliation gate (hand-traceable, finder == Biopython local)", () => {
  it("recovers the exact 8-mer island ACGTACGT at score 16, identity 1.0", () => {
    // The finder's smallest seed k is 4 (clamped). Build flanks long enough that
    // the island anchor clears minAnchorSpan/minScore. The flanks are homopolymer
    // runs distinct from the island so the ONLY shared region is the island, and
    // we drop k/minScore/minAnchorSpan to the floor so the tiny island fires.
    const island = "ACGTACGT";
    const aFlankL = "TTTTTTTTTTTTTTTT";
    const aFlankR = "TTTTTTTTTTTTTTTT";
    const bFlankL = "GGGGGGGGGGGGGGGG";
    const bFlankR = "GGGGGGGGGGGGGGGG";
    const a = aFlankL + island + aFlankR; // island at [16, 24)
    const b = bFlankL + island + bFlankR; // island at [16, 24)
    const result = findSharedRegions(a, b, {
      k: 4,
      minAnchorSpan: 4,
      minScore: 8,
      bothStrands: false,
    });
    expect(result.hsps.length).toBeGreaterThanOrEqual(1);
    const hsp = result.hsps[0];
    // EXACT, no tolerance — this is the hand-traced gate.
    expect(hsp.strand).toBe(1);
    expect(hsp.score).toBe(16); // 8 matches * 2, Biopython == 16.0
    expect(hsp.identity).toBe(1);
    expect(hsp.alignedA).toBe("ACGTACGT");
    expect(hsp.alignedB).toBe("ACGTACGT");
    expect([hsp.aStart, hsp.aEnd, hsp.bStart, hsp.bEnd]).toEqual([16, 24, 16, 24]);
  });
});

// ===========================================================================
// CASE A — single clear homologous region in divergent flanks.
// Biopython local over the planted 800bp span (block=sharedBlock(800,1)):
//   score 1600, A[5000,5800), B[4000,4800), identity 1.0, ungapped (800 cols).
// Source: gen-shared-regions-golden.py "CASE A".
// ===========================================================================
describe("golden: CASE A — single clear region (Biopython A[5000,5800)/B[4000,4800) id 1.0)", () => {
  it("recovers the planted block at Biopython's coords, strand +1, id within tol", () => {
    const block = sharedBlock(800, 1);
    const a = randomDna(5_000, 11) + block + randomDna(5_000, 12);
    const b = randomDna(4_000, 21) + block + randomDna(6_000, 22);
    const result = findSharedRegions(a, b);
    expect(result.hsps.length).toBeGreaterThanOrEqual(1);
    expectMatchesRegion(
      result.hsps[0],
      { strand: 1, aStart: 5000, aEnd: 5800, bStart: 4000, bEnd: 4800, identity: 1.0 },
      block,
    );
  });
});

// ===========================================================================
// CASE B — region with 6 point mismatches (every 100th base of a 600-mer block
// flipped in B). Biopython local over the planted span (block=sharedBlock(600,7)):
//   score 1182, A[3000,3600), B[3500,4100), identity 0.99 (594 of 600), ungapped.
// 1182 = 594*2 - 6 (hand-check of Biopython's score). Source: "CASE B".
// ===========================================================================
describe("golden: CASE B — 6 point mismatches (Biopython id 0.99, score 1182)", () => {
  it("recovers the mismatched region with identity near Biopython's 0.99", () => {
    const clean = sharedBlock(600, 7);
    const flip: Record<string, string> = { A: "C", C: "G", G: "T", T: "A" };
    const m = clean.split("");
    for (const p of [50, 150, 250, 350, 450, 550]) m[p] = flip[m[p]];
    const mutated = m.join("");
    const a = randomDna(3_000, 13) + clean + randomDna(3_000, 14);
    const b = randomDna(3_500, 23) + mutated + randomDna(2_500, 24);
    const result = findSharedRegions(a, b);
    expect(result.hsps.length).toBeGreaterThanOrEqual(1);
    // Core assertion uses the CLEAN block (carried by A, so alignedA core == clean).
    expectMatchesRegion(
      result.hsps[0],
      { strand: 1, aStart: 3000, aEnd: 3600, bStart: 3500, bEnd: 4100, identity: 0.99 },
      clean,
    );
  });
});

// ===========================================================================
// CASE C — reverse-complement region. A carries the forward block; B carries
// revcomp(block). The finder must report a strand -1 HSP. Biopython local of A vs
// revcomp(B) over the region, mapped to FORWARD-B coords (len(B)-e / len(B)-s):
//   score 1400, A[4000,4700), forward-B[3000,3700), identity 1.0, ungapped.
// This validates BOTH the strand tag and the reverse coordinate convention.
// Source: gen-shared-regions-golden.py "CASE C".
// ===========================================================================
describe("golden: CASE C — reverse-complement region (Biopython strand -1, fwd-B[3000,3700))", () => {
  it("tags strand -1 and maps to Biopython's forward-B coordinates, id within tol", () => {
    const block = sharedBlock(700, 4);
    const a = randomDna(4_000, 51) + block + randomDna(4_000, 52);
    const b = randomDna(3_000, 61) + reverseComplement(block) + randomDna(5_000, 62);
    const result = findSharedRegions(a, b);
    const rev = result.hsps.find((h) => h.strand === -1);
    expect(rev).toBeDefined();
    // For strand -1, alignedB is the reverse-complemented B segment, i.e. it
    // re-presents the FORWARD block, so `block` is still the right core to assert.
    expectMatchesRegion(
      rev!,
      { strand: -1, aStart: 4000, aEnd: 4700, bStart: 3000, bEnd: 3700, identity: 1.0 },
      block,
    );
    // Extra: the reverse-complemented alignedB core also re-presents the forward
    // block (independent confirmation of the revcomp convention end-to-end).
    expect(rev!.alignedB.replace(/-/g, "")).toContain(
      block.slice(BOUNDARY_TOL, block.length - BOUNDARY_TOL),
    );
  });
});

// ===========================================================================
// CASE D — region with a small (3-base) indel: a 3-base run deleted from B near
// the middle of a 500-mer block. Biopython local over the planted span
// (block=sharedBlock(500,8), del@250):
//   score 986, A[2500,3000), B[2000,2497), identity 0.994 (497/500), 3 gap cols.
// 986 = 497*2 - (5 + 3*1) (hand-check of Biopython's affine score). Source: "CASE D".
// ===========================================================================
describe("golden: CASE D — 3-base indel (Biopython id 0.994, score 986, one gap)", () => {
  it("recovers the indel-bearing region, identity near Biopython's 0.994", () => {
    const clean = sharedBlock(500, 8);
    const bBlock = clean.slice(0, 250) + clean.slice(253); // 3-base deletion in B
    const a = randomDna(2_500, 15) + clean + randomDna(2_500, 16);
    const b = randomDna(2_000, 25) + bBlock + randomDna(3_000, 26);
    const result = findSharedRegions(a, b);
    expect(result.hsps.length).toBeGreaterThanOrEqual(1);
    const top = result.hsps[0];
    expect(top.strand).toBe(1);
    expect(Math.abs(top.aStart - 2500)).toBeLessThanOrEqual(BOUNDARY_TOL);
    expect(Math.abs(top.aEnd - 3000)).toBeLessThanOrEqual(BOUNDARY_TOL);
    expect(Math.abs(top.bStart - 2000)).toBeLessThanOrEqual(BOUNDARY_TOL);
    expect(Math.abs(top.bEnd - 2497)).toBeLessThanOrEqual(BOUNDARY_TOL);
    // Identity near Biopython's 0.994 (allow the same downward flank-extension tol).
    expect(top.identity).toBeGreaterThanOrEqual(0.994 - IDENTITY_TOL);
    // The aligned A core (gaps stripped) is the clean block carried by A. The
    // indel is a gap on the B side, so A's core is contiguous block sequence.
    const coreA = top.alignedA.replace(/-/g, "");
    expect(coreA).toContain(clean.slice(BOUNDARY_TOL, clean.length - BOUNDARY_TOL));
    // A gap is actually present in the recovered alignment (the indel was found).
    expect(top.alignedA.includes("-") || top.alignedB.includes("-")).toBe(true);
  });
});

// ===========================================================================
// CASE E — two distinct regions, each Biopython-scored on its OWN window
// (Biopython local returns one optimum per call; we oracle once per locus, as
// BLAST reports one HSP per locus). big=sharedBlock(1200,2), small=sharedBlock(500,3).
//   big:   score 2400, A[3000,4200), B[2000,3200), identity 1.0.
//   small: score 1000, A[7200,7700), B[7200,7700), identity 1.0.
// Source: gen-shared-regions-golden.py "CASE E-big" / "CASE E-small".
// ===========================================================================
describe("golden: CASE E — two regions, each matched to its own Biopython optimum", () => {
  it("recovers both regions at their Biopython coords, ranked, ids within tol", () => {
    const big = sharedBlock(1_200, 2);
    const small = sharedBlock(500, 3);
    const a =
      randomDna(3_000, 31) + big + randomDna(3_000, 32) + small + randomDna(3_000, 33);
    const b =
      randomDna(2_000, 41) + big + randomDna(4_000, 42) + small + randomDna(2_500, 43);
    const result = findSharedRegions(a, b);
    expect(result.hsps.length).toBeGreaterThanOrEqual(2);

    const nearBig = result.hsps.find(
      (h) => Math.abs(h.aStart - 3000) <= BOUNDARY_TOL,
    );
    const nearSmall = result.hsps.find(
      (h) => Math.abs(h.aStart - 7200) <= BOUNDARY_TOL,
    );
    expect(nearBig).toBeDefined();
    expect(nearSmall).toBeDefined();

    expectMatchesRegion(
      nearBig!,
      { strand: 1, aStart: 3000, aEnd: 4200, bStart: 2000, bEnd: 3200, identity: 1.0 },
      big,
    );
    expectMatchesRegion(
      nearSmall!,
      { strand: 1, aStart: 7200, aEnd: 7700, bStart: 7200, bEnd: 7700, identity: 1.0 },
      small,
    );
    // The bigger region scores higher and therefore ranks ahead of the smaller.
    expect(nearBig!.score).toBeGreaterThan(nearSmall!.score);
  });
});

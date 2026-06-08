import { describe, expect, it } from "vitest";
import { findSharedRegions, chooseSeedK } from "./local-homology";
import { reverseComplement } from "./scoring";

/**
 * Deterministic pseudo-random DNA so the planted-region tests are reproducible
 * and the truth is known purely by construction (no fabricated expected values).
 * A tiny LCG drives base selection; the seed makes each call repeatable.
 */
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

/** A long, distinctive shared block (also deterministic, different seed space). */
function sharedBlock(length: number, seed: number): string {
  return randomDna(length, seed + 9_999);
}

describe("chooseSeedK", () => {
  it("scales the word size up with sequence length", () => {
    expect(chooseSeedK(500)).toBe(11);
    expect(chooseSeedK(10_000)).toBe(14);
    expect(chooseSeedK(100_000)).toBe(16);
  });
});

describe("findSharedRegions — single planted region", () => {
  it("finds one shared block embedded in two otherwise-random large sequences", () => {
    // Build A = randomA-prefix + SHARED + randomA-suffix.
    // Build B = randomB-prefix + SHARED + randomB-suffix, with DIFFERENT random
    // flanks (different seeds) so the only homology is the planted block. The
    // block coordinates are known by construction.
    const block = sharedBlock(800, 1);
    const aPre = randomDna(5_000, 11);
    const aSuf = randomDna(5_000, 12);
    const bPre = randomDna(4_000, 21);
    const bSuf = randomDna(6_000, 22);

    const a = aPre + block + aSuf;
    const b = bPre + block + bSuf;

    const aBlockStart = aPre.length;
    const bBlockStart = bPre.length;

    const result = findSharedRegions(a, b);
    expect(result.hsps.length).toBeGreaterThanOrEqual(1);

    const top = result.hsps[0];
    expect(top.strand).toBe(1);
    expect(top.identity).toBeGreaterThan(0.95);
    // The HSP should cover essentially the whole planted block at the known
    // coordinates. A local refine can nibble a few bases off or extend a few
    // bases into the random flank (chance matches), so allow ~one window-padding
    // (30) of slack at the edges. The block is still recovered end to end.
    const SLACK = 40;
    expect(Math.abs(top.aStart - aBlockStart)).toBeLessThanOrEqual(SLACK);
    expect(top.aEnd).toBeGreaterThanOrEqual(aBlockStart + block.length - SLACK);
    expect(Math.abs(top.bStart - bBlockStart)).toBeLessThanOrEqual(SLACK);
    expect(top.bEnd).toBeGreaterThanOrEqual(bBlockStart + block.length - SLACK);
    // The aligned strings are the recovered block.
    expect(top.alignedA.replace(/-/g, "")).toContain(block.slice(20, block.length - 20));
  });
});

describe("findSharedRegions — two planted regions, both ranked", () => {
  it("returns both shared blocks, ranked, at the right coordinates", () => {
    // Two distinct shared blocks, different lengths so ranking is deterministic
    // (the longer/higher-scoring block ranks first). Random flanks separate them.
    const big = sharedBlock(1_200, 2); // higher score
    const small = sharedBlock(500, 3);
    const aSpacer1 = randomDna(3_000, 31);
    const aSpacer2 = randomDna(3_000, 32);
    const aSpacer3 = randomDna(3_000, 33);
    const bSpacer1 = randomDna(2_000, 41);
    const bSpacer2 = randomDna(4_000, 42);
    const bSpacer3 = randomDna(2_500, 43);

    const a = aSpacer1 + big + aSpacer2 + small + aSpacer3;
    const b = bSpacer1 + big + bSpacer2 + small + bSpacer3;

    const aBigStart = aSpacer1.length;
    const aSmallStart = aSpacer1.length + big.length + aSpacer2.length;
    const bBigStart = bSpacer1.length;
    const bSmallStart = bSpacer1.length + big.length + bSpacer2.length;

    const result = findSharedRegions(a, b);
    expect(result.hsps.length).toBeGreaterThanOrEqual(2);

    // Ranked: the bigger block scores higher and comes first.
    const first = result.hsps[0];
    const second = result.hsps[1];
    expect(first.score).toBeGreaterThanOrEqual(second.score);

    // Locate each HSP by its A coordinate (within one window-padding) and verify
    // it matches the planted block.
    const SLACK = 40;
    const nearBig = result.hsps.find(
      (h) => Math.abs(h.aStart - aBigStart) <= SLACK,
    );
    const nearSmall = result.hsps.find(
      (h) => Math.abs(h.aStart - aSmallStart) <= SLACK,
    );
    expect(nearBig).toBeDefined();
    expect(nearSmall).toBeDefined();

    expect(nearBig!.identity).toBeGreaterThan(0.95);
    expect(nearBig!.aEnd).toBeGreaterThanOrEqual(aBigStart + big.length - SLACK);
    expect(Math.abs(nearBig!.bStart - bBigStart)).toBeLessThanOrEqual(SLACK);

    expect(nearSmall!.identity).toBeGreaterThan(0.95);
    expect(nearSmall!.aEnd).toBeGreaterThanOrEqual(aSmallStart + small.length - SLACK);
    expect(Math.abs(nearSmall!.bStart - bSmallStart)).toBeLessThanOrEqual(SLACK);
  });
});

describe("findSharedRegions — reverse-strand region", () => {
  it("detects a block planted on the opposite strand and tags strand -1", () => {
    // Plant the REVERSE COMPLEMENT of a block into B. A holds the forward block.
    // So A aligns to the reverse complement of B over this region -> strand -1.
    const block = sharedBlock(700, 4);
    const aPre = randomDna(4_000, 51);
    const aSuf = randomDna(4_000, 52);
    const bPre = randomDna(3_000, 61);
    const bSuf = randomDna(5_000, 62);

    const a = aPre + block + aSuf;
    const b = bPre + reverseComplement(block) + bSuf;

    const aBlockStart = aPre.length;
    // Forward-B coordinates of the planted (revcomp) block.
    const bBlockStart = bPre.length;

    const result = findSharedRegions(a, b);
    const rev = result.hsps.find((h) => h.strand === -1);
    expect(rev).toBeDefined();
    expect(rev!.identity).toBeGreaterThan(0.95);
    const SLACK = 40;
    // A coordinates of the forward block.
    expect(Math.abs(rev!.aStart - aBlockStart)).toBeLessThanOrEqual(SLACK);
    expect(rev!.aEnd).toBeGreaterThanOrEqual(aBlockStart + block.length - SLACK);
    // Forward-B coordinates of where the revcomp block sits.
    expect(Math.abs(rev!.bStart - bBlockStart)).toBeLessThanOrEqual(SLACK);
    expect(rev!.bEnd).toBeGreaterThanOrEqual(bBlockStart + block.length - SLACK);
  });
});

describe("findSharedRegions — no homology", () => {
  it("returns an empty HSP list for two unrelated random sequences", () => {
    const a = randomDna(8_000, 71);
    const b = randomDna(8_000, 81);
    const result = findSharedRegions(a, b);
    expect(result.hsps).toHaveLength(0);
    expect(result.totalHsps).toBe(0);
  });
});

describe("findSharedRegions — caps and stats", () => {
  it("caps the returned HSPs and flags truncation when more are found", () => {
    // Plant the SAME short block in each sequence a few times. Because the block
    // is identical, copy i in A is homologous to copy j in B for every (i, j), so
    // N copies yield N*N distinct cross-matched HSPs (each (i, j) pair has a
    // distinct A-span/B-span combination that survives de-dup). N=3 gives 9
    // distinct HSPs, comfortably above the cap of 3, so truncation is proven
    // structurally without needing a large corpus or depending on wall-clock
    // under parallel test load. Each copy sits in its own random flank region so
    // the copies are non-overlapping.
    const block = sharedBlock(400, 5);
    const copies = 3;
    let a = "";
    let b = "";
    for (let i = 0; i < copies; i++) {
      a += randomDna(1_000, 100 + i) + block;
      b += randomDna(1_000, 200 + i) + block;
    }
    const result = findSharedRegions(a, b, { maxRegions: 3 });
    expect(result.hsps.length).toBe(3);
    expect(result.totalHsps).toBeGreaterThan(3);
    expect(result.truncated).toBe(true);
  });
});

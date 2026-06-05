/**
 * Pairwise + long-homology alignment showcase cases for the transparency page.
 *
 * Two flavors, both checked against Biopython:
 *  - PAIRWISE: short global / local alignments. The scalar we compare is the
 *    optimal alignment SCORE (affine Gotoh, DNA match +2 / mismatch -1, gapOpen
 *    5, gapExtend 1), which Biopython's PairwiseAligner reproduces exactly under
 *    the same parameters. Tolerance is effectively exact.
 *  - HOMOLOGY (the "long alignment"): a several-kilobase pair with a planted
 *    homologous block, run through `findSharedRegions`. We compare the top HSP's
 *    score and identity to Biopython's local alignment over the planted span.
 *
 * Scores/coords are lifted verbatim from the committed golden suites
 * (`lib/align/golden.test.ts`, `lib/align/local-homology.golden.test.ts`), which
 * derive them from `gen-align-golden.py` / `gen-shared-regions-golden.py` run
 * against Biopython. The long-homology sequences are rebuilt here from the SAME
 * deterministic LCG the generator and golden test use, so the bytes are
 * identical and the pinned Biopython numbers describe exactly these sequences.
 */

/* ----- deterministic DNA, byte-identical to the generator + golden test ---- */

/** LCG random DNA, matching local-homology.golden.test.ts::randomDna exactly. */
export function randomDna(length: number, seed: number): string {
  const bases = "ACGT";
  let state = (seed * 2654435761) >>> 0;
  let out = "";
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out += bases[(state >>> 16) & 3];
  }
  return out;
}

/** Planted shared block, matching the golden test's sharedBlock exactly. */
export function sharedBlock(length: number, seed: number): string {
  return randomDna(length, seed + 9_999);
}

/* ----------------------------------- pairwise ----------------------------- */

export interface PairwiseCase {
  id: string;
  label: string;
  mode: "global" | "local";
  a: string;
  b: string;
  /** Biopython PairwiseAligner optimal score under our shared parameters. */
  bioScore: number;
}

export const PAIRWISE_CASES: PairwiseCase[] = [
  {
    id: "global_gattaca",
    label: "Global, classic GATTACA / GCATGCT",
    mode: "global",
    a: "GATTACA",
    b: "GCATGCT",
    bioScore: 2,
  },
  {
    id: "global_indel2",
    label: "Global, internal 2-base indel",
    mode: "global",
    a: "ACGTGTCATTG",
    b: "ACGTCATTG",
    bioScore: 11,
  },
  {
    id: "global_long_del",
    label: "Global, 21-mer with one deletion",
    mode: "global",
    a: "TGGCCAGGCTGGTCTCGAACT",
    b: "TGGCCAGGTGGTCTCGAACT",
    bioScore: 34,
  },
  {
    id: "local_island",
    label: "Local, identical 8-mer island in divergent flanks",
    mode: "local",
    a: "AAAAACGTACGTAAAAA",
    b: "TTTTACGTACGTTTTT",
    bioScore: 16,
  },
  {
    id: "local_sw_short",
    label: "Local, Smith-Waterman short pair",
    mode: "local",
    a: "GGTTGACTA",
    b: "TGTTACGG",
    bioScore: 6,
  },
  // --- second batch (2026-06-05): distinct pairs, optimal scores from
  // Biopython 1.87 PairwiseAligner under our matched scoring + affine gaps.
  {
    id: "global_two_mismatch",
    label: "Global, two point mismatches",
    mode: "global",
    a: "ACGTACGTACGT",
    b: "ACGTTCGTACGA",
    bioScore: 18,
  },
  {
    id: "global_del3",
    label: "Global, internal 3-base deletion",
    mode: "global",
    a: "TGCAAAGGGCCCTTTACG",
    b: "TGCAAAGGGTTTACG",
    bioScore: 22,
  },
  {
    id: "local_motif",
    label: "Local, shared motif in unrelated flanks",
    mode: "local",
    a: "GGGGGTGCAGTCATGGGGG",
    b: "AAAATGCAGTCATAAAA",
    bioScore: 18,
  },
  {
    id: "local_sw_offset",
    label: "Local, short Smith-Waterman pair with offset",
    mode: "local",
    a: "ACGTTGACCAG",
    b: "TTGACCTAAA",
    bioScore: 12,
  },
  {
    id: "global_gc_gap",
    label: "Global, GC-rich pair with one gap",
    mode: "global",
    a: "GCGCGGCCGCGC",
    b: "GCGCGCCGCGC",
    bioScore: 16,
  },
];

/* ---------------------------------- homology ------------------------------ */

export interface HomologyCase {
  id: string;
  label: string;
  /** Build the (a, b) pair deterministically. */
  build: () => { a: string; b: string };
  /** Biopython local alignment over the planted span. */
  bioScore: number;
  bioIdentity: number;
}

export const HOMOLOGY_CASES: HomologyCase[] = [
  {
    id: "homology_800bp",
    label: "Long alignment, 800 bp homologous block in ~10 kb sequences",
    build: () => {
      const block = sharedBlock(800, 1);
      return {
        a: randomDna(5_000, 11) + block + randomDna(5_000, 12),
        b: randomDna(4_000, 21) + block + randomDna(6_000, 22),
      };
    },
    bioScore: 1600, // 800 matches * 2
    bioIdentity: 1.0,
  },
  // --- second batch (2026-06-05): different block lengths + seeds. An identical
  // planted block in non-homologous flanks aligns at identity 1.0 (Biopython
  // local), independent of length; the sequences differ from the 800 bp case.
  {
    id: "homology_600bp",
    label: "Long alignment, 600 bp homologous block in ~9 kb sequences",
    build: () => {
      const block = sharedBlock(600, 7);
      return {
        a: randomDna(3_000, 31) + block + randomDna(3_000, 32),
        b: randomDna(2_500, 41) + block + randomDna(3_500, 42),
      };
    },
    bioScore: 1200,
    bioIdentity: 1.0,
  },
  {
    id: "homology_400bp",
    label: "Long alignment, 400 bp homologous block in ~6 kb sequences",
    build: () => {
      const block = sharedBlock(400, 3);
      return {
        a: randomDna(2_000, 51) + block + randomDna(2_000, 52),
        b: randomDna(1_500, 61) + block + randomDna(2_500, 62),
      };
    },
    bioScore: 800,
    bioIdentity: 1.0,
  },
  // --- edge cases (2026-06-05): progressively SHORTER blocks. The block is
  // identical (Biopython local identity 1.0), but our approximate seed-and-extend
  // finder includes more boundary bases proportionally as the block shrinks, so
  // its reported identity diverges further below 1.0. These exist to SHOW that
  // divergence, not to hide it.
  {
    id: "homology_250bp",
    label: "Short homology, 250 bp block (approximation gap grows)",
    build: () => {
      const block = sharedBlock(250, 13);
      return {
        a: randomDna(1_500, 71) + block + randomDna(1_500, 72),
        b: randomDna(1_200, 81) + block + randomDna(1_800, 82),
      };
    },
    bioScore: 500,
    bioIdentity: 1.0,
  },
  {
    id: "homology_180bp",
    label: "Short homology, 180 bp block (approximation gap grows)",
    build: () => {
      const block = sharedBlock(180, 17);
      return {
        a: randomDna(1_000, 91) + block + randomDna(1_000, 92),
        b: randomDna(900, 101) + block + randomDna(1_100, 102),
      };
    },
    bioScore: 360,
    bioIdentity: 1.0,
  },
  {
    id: "homology_130bp",
    label: "Short homology, 130 bp block (largest approximation gap)",
    build: () => {
      const block = sharedBlock(130, 23);
      return {
        a: randomDna(800, 111) + block + randomDna(800, 112),
        b: randomDna(700, 121) + block + randomDna(900, 122),
      };
    },
    bioScore: 260,
    bioIdentity: 1.0,
  },
];

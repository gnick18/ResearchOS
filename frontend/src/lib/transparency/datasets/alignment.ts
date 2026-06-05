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
];

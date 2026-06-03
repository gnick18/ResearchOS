/**
 * Pure pairwise sequence alignment engine.
 *
 * One Gotoh affine-gap DP core, three end-condition modes (local /
 * global / semi-global), pluggable substitution scoring (IUPAC-degenerate-aware
 * DNA by default, with a clean seam for a future protein BLOSUM62 scheme), and a
 * BLAST-style seed-and-extend wrapper for short-query-vs-large-target search on
 * both DNA strands. No DOM, no React, no external dependencies.
 */
export { alignLocal, alignGlobal, alignSemiGlobal, opsToCigar } from "./core";
export {
  dnaScoring,
  iupacCompatible,
  reverseComplement,
  IUPAC_SETS,
} from "./scoring";
export type { ScoringFn, DnaScoringOptions } from "./scoring";
export { seedAndExtend, buildKmerIndex } from "./seed";
export type { SeedHit, SeedAndExtendOptions } from "./seed";
export type {
  AlignOp,
  AlignOptions,
  AlignmentResult,
  GapPenalties,
} from "./types";

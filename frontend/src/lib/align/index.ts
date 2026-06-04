/**
 * Pure pairwise sequence alignment engine.
 *
 * One Gotoh affine-gap DP core, three end-condition modes (local /
 * global / semi-global), pluggable substitution scoring (IUPAC-degenerate-aware
 * DNA, or BLOSUM62 protein), and a BLAST-style seed-and-extend wrapper for
 * short-query-vs-large-target search on both DNA strands. No DOM, no React, no
 * external dependencies.
 */
export { alignLocal, alignGlobal, alignSemiGlobal, opsToCigar } from "./core";
export {
  dnaScoring,
  proteinScoring,
  blosum62,
  iupacCompatible,
  reverseComplement,
  IUPAC_SETS,
} from "./scoring";
export type { ScoringFn, DnaScoringOptions, ProteinScoringOptions } from "./scoring";
export { seedAndExtend, buildKmerIndex } from "./seed";
export type { SeedHit, SeedAndExtendOptions } from "./seed";
export type {
  AlignOp,
  AlignOptions,
  AlignmentResult,
  GapPenalties,
} from "./types";

/**
 * Pluggable substitution scoring for the alignment engine.
 *
 * The DP core only needs a function `(x, y) => number` that scores aligning a
 * single residue `x` against a single residue `y`. Everything else (DNA with
 * IUPAC degeneracy, a future protein BLOSUM62 scheme) is just a different
 * implementation of that function. Keeping the core agnostic to the alphabet is
 * what lets one engine serve DNA today and protein later.
 */

/**
 * A substitution scoring function. Given two single-character residues, returns
 * the score for aligning them in a column. Higher is better. Callers normalize
 * case and alphabet themselves; the function receives raw single characters.
 */
export type ScoringFn = (x: string, y: string) => number;

/**
 * IUPAC nucleotide code expansion. Each ambiguity code maps to the set of plain
 * bases (A, C, G, T) it represents. U is treated as T so RNA sequences score
 * against DNA. Gap and unknown characters are intentionally absent: the DP core
 * never asks the scoring function to score a gap (gaps are handled by the gap
 * penalties), so the scoring function only ever sees residues.
 */
export const IUPAC_SETS: Readonly<Record<string, string>> = {
  A: "A",
  C: "C",
  G: "G",
  T: "T",
  U: "T",
  R: "AG",
  Y: "CT",
  S: "GC",
  W: "AT",
  K: "GT",
  M: "AC",
  B: "CGT",
  D: "AGT",
  H: "ACT",
  V: "ACG",
  N: "ACGT",
};

/** Options for the DNA scoring scheme. */
export interface DnaScoringOptions {
  /** Score awarded when the two bases are compatible. Default 2. */
  match?: number;
  /** Score (penalty, typically negative) when the two bases are incompatible. Default -1. */
  mismatch?: number;
  /**
   * When true (default), IUPAC ambiguity codes are degeneracy-aware: a column is
   * a match when the two base sets intersect (N matches anything, R = A|G, etc.).
   * When false, only exact single-base equality counts as a match and any
   * ambiguity code that is not byte-identical to the other side is a mismatch.
   */
  iupac?: boolean;
}

/**
 * Returns true when two single-character bases are IUPAC-compatible, i.e. the
 * sets of plain bases they represent intersect. Unknown characters (not in the
 * IUPAC table) are treated as a set containing only the literal character, so an
 * unknown only matches itself. Comparison is case-insensitive.
 */
export function iupacCompatible(x: string, y: string): boolean {
  const xs = IUPAC_SETS[x.toUpperCase()] ?? x.toUpperCase();
  const ys = IUPAC_SETS[y.toUpperCase()] ?? y.toUpperCase();
  for (let i = 0; i < xs.length; i++) {
    if (ys.indexOf(xs[i]) !== -1) return true;
  }
  return false;
}

/**
 * Build a DNA scoring function. Compatible bases score `match`, incompatible
 * bases score `mismatch`. With `iupac: true` (default) compatibility is set
 * intersection (degeneracy-aware); with `iupac: false` only exact, case-
 * insensitive single-base equality is a match.
 */
export function dnaScoring(options: DnaScoringOptions = {}): ScoringFn {
  const match = options.match ?? 2;
  const mismatch = options.mismatch ?? -1;
  const iupac = options.iupac ?? true;
  if (iupac) {
    return (x: string, y: string): number => (iupacCompatible(x, y) ? match : mismatch);
  }
  return (x: string, y: string): number =>
    x.toUpperCase() === y.toUpperCase() ? match : mismatch;
}

/**
 * IUPAC-aware single-base complement. Used by the reverse-complement helper for
 * both-strand DNA search. Complementing preserves degeneracy (the complement of
 * R = A|G is Y = T|C). Unknown characters complement to themselves.
 */
const COMPLEMENT: Readonly<Record<string, string>> = {
  A: "T",
  C: "G",
  G: "C",
  T: "A",
  U: "A",
  R: "Y",
  Y: "R",
  S: "S",
  W: "W",
  K: "M",
  M: "K",
  B: "V",
  D: "H",
  H: "D",
  V: "B",
  N: "N",
};

/**
 * Reverse-complement a DNA string, preserving IUPAC degeneracy. Case is
 * normalized to uppercase. Characters with no defined complement pass through
 * unchanged (uppercased), so non-DNA input degrades gracefully rather than
 * throwing.
 */
export function reverseComplement(seq: string): string {
  let out = "";
  for (let i = seq.length - 1; i >= 0; i--) {
    const c = seq[i].toUpperCase();
    out += COMPLEMENT[c] ?? c;
  }
  return out;
}

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
 * BLOSUM62 amino-acid substitution matrix (the de-facto default for protein
 * alignment, e.g. NCBI BLASTP). Encoded as the canonical integer log-odds
 * values from the standard NCBI matrix file (ftp NCBI BLAST matrices), in the
 * usual residue order. The matrix is symmetric; we store it as a flat lookup
 * keyed by an ordered residue pair and look up either order.
 *
 * Columns / rows, in order:
 *   A R N D C Q E G H I L K M F P S T W Y V B Z X *
 *
 * `B` (Asx = N|D), `Z` (Glx = Q|E), `X` (any residue), and `*` (stop / no match
 * with anything but itself) are the standard extra rows BLOSUM62 ships with, so
 * an aligner does not throw on a translated frame that contains a stop codon or
 * an ambiguous residue. `J` (Xle = I|L) is not in the canonical matrix; we map
 * it to `X` (treat as any), which is the conventional fallback.
 */
const BLOSUM62_ORDER = "ARNDCQEGHILKMFPSTWYVBZX*";

// Canonical BLOSUM62 integer values, one row per residue in BLOSUM62_ORDER.
// Transcribed from the standard NCBI BLOSUM62 file; guarded by unit tests that
// assert known canonical cells and full symmetry.
const BLOSUM62_ROWS: readonly (readonly number[])[] = [
  // A   R   N   D   C   Q   E   G   H   I   L   K   M   F   P   S   T   W   Y   V   B   Z   X   *
  [ 4, -1, -2, -2,  0, -1, -1,  0, -2, -1, -1, -1, -1, -2, -1,  1,  0, -3, -2,  0, -2, -1,  0, -4], // A
  [-1,  5,  0, -2, -3,  1,  0, -2,  0, -3, -2,  2, -1, -3, -2, -1, -1, -3, -2, -3, -1,  0, -1, -4], // R
  [-2,  0,  6,  1, -3,  0,  0,  0,  1, -3, -3,  0, -2, -3, -2,  1,  0, -4, -2, -3,  3,  0, -1, -4], // N
  [-2, -2,  1,  6, -3,  0,  2, -1, -1, -3, -4, -1, -3, -3, -1,  0, -1, -4, -3, -3,  4,  1, -1, -4], // D
  [ 0, -3, -3, -3,  9, -3, -4, -3, -3, -1, -1, -3, -1, -2, -3, -1, -1, -2, -2, -1, -3, -3, -2, -4], // C
  [-1,  1,  0,  0, -3,  5,  2, -2,  0, -3, -2,  1,  0, -3, -1,  0, -1, -2, -1, -2,  0,  3, -1, -4], // Q
  [-1,  0,  0,  2, -4,  2,  5, -2,  0, -3, -3,  1, -2, -3, -1,  0, -1, -3, -2, -2,  1,  4, -1, -4], // E
  [ 0, -2,  0, -1, -3, -2, -2,  6, -2, -4, -4, -2, -3, -3, -2,  0, -2, -2, -3, -3, -1, -2, -1, -4], // G
  [-2,  0,  1, -1, -3,  0,  0, -2,  8, -3, -3, -1, -2, -1, -2, -1, -2, -2,  2, -3,  0,  0, -1, -4], // H
  [-1, -3, -3, -3, -1, -3, -3, -4, -3,  4,  2, -3,  1,  0, -3, -2, -1, -3, -1,  3, -3, -3, -1, -4], // I
  [-1, -2, -3, -4, -1, -2, -3, -4, -3,  2,  4, -2,  2,  0, -3, -2, -1, -2, -1,  1, -4, -3, -1, -4], // L
  [-1,  2,  0, -1, -3,  1,  1, -2, -1, -3, -2,  5, -1, -3, -1,  0, -1, -3, -2, -2,  0,  1, -1, -4], // K
  [-1, -1, -2, -3, -1,  0, -2, -3, -2,  1,  2, -1,  5,  0, -2, -1, -1, -1, -1,  1, -3, -1, -1, -4], // M
  [-2, -3, -3, -3, -2, -3, -3, -3, -1,  0,  0, -3,  0,  6, -4, -2, -2,  1,  3, -1, -3, -3, -1, -4], // F
  [-1, -2, -2, -1, -3, -1, -1, -2, -2, -3, -3, -1, -2, -4,  7, -1, -1, -4, -3, -2, -2, -1, -2, -4], // P
  [ 1, -1,  1,  0, -1,  0,  0,  0, -1, -2, -2,  0, -1, -2, -1,  4,  1, -3, -2, -2,  0,  0,  0, -4], // S
  [ 0, -1,  0, -1, -1, -1, -1, -2, -2, -1, -1, -1, -1, -2, -1,  1,  5, -2, -2,  0, -1, -1,  0, -4], // T
  [-3, -3, -4, -4, -2, -2, -3, -2, -2, -3, -2, -3, -1,  1, -4, -3, -2, 11,  2, -3, -4, -3, -2, -4], // W
  [-2, -2, -2, -3, -2, -1, -2, -3,  2, -1, -1, -2, -1,  3, -3, -2, -2,  2,  7, -1, -3, -2, -1, -4], // Y
  [ 0, -3, -3, -3, -1, -2, -2, -3, -3,  3,  1, -2,  1, -1, -2, -2,  0, -3, -1,  4, -3, -2, -1, -4], // V
  [-2, -1,  3,  4, -3,  0,  1, -1,  0, -3, -4,  0, -3, -3, -2,  0, -1, -4, -3, -3,  4,  1, -1, -4], // B
  [-1,  0,  0,  1, -3,  3,  4, -2,  0, -3, -3,  1, -1, -3, -1,  0, -1, -3, -2, -2,  1,  4, -1, -4], // Z
  [ 0, -1, -1, -1, -2, -1, -1, -1, -1, -1, -1, -1, -1, -1, -2,  0,  0, -2, -1, -1, -1, -1, -1, -4], // X
  [-4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4,  1], // *
];

// Index of each residue letter into BLOSUM62_ORDER, built once.
const BLOSUM62_INDEX: Readonly<Record<string, number>> = (() => {
  const idx: Record<string, number> = {};
  for (let i = 0; i < BLOSUM62_ORDER.length; i++) idx[BLOSUM62_ORDER[i]] = i;
  // J (Xle = I|L) is absent from the canonical matrix; fall back to X (any).
  idx.J = idx.X;
  // U (selenocysteine) / O (pyrrolysine) are not in BLOSUM62; treat as X.
  idx.U = idx.X;
  idx.O = idx.X;
  return idx;
})();

/** Options for the protein (BLOSUM62) scoring scheme. */
export interface ProteinScoringOptions {
  /**
   * Score used when a residue is not in the BLOSUM62 alphabet at all (after the
   * J / U / O -> X fallbacks). When omitted, an unknown letter is routed through
   * the BLOSUM62 `X` (any-residue) row, the standard behavior. Set a value here
   * to override with a flat penalty for truly foreign characters.
   */
  unknownScore?: number;
}

/**
 * Look up the canonical BLOSUM62 score for an ordered residue pair. Residues are
 * upper-cased; J / U / O map to X; anything still unknown maps to X (or to
 * `unknownScore` when provided).
 */
export function blosum62(x: string, y: string, unknownScore?: number): number {
  const xu = x.toUpperCase();
  const yu = y.toUpperCase();
  let xi = BLOSUM62_INDEX[xu];
  let yi = BLOSUM62_INDEX[yu];
  if (xi === undefined || yi === undefined) {
    if (unknownScore !== undefined) return unknownScore;
    xi = xi ?? BLOSUM62_INDEX.X;
    yi = yi ?? BLOSUM62_INDEX.X;
  }
  return BLOSUM62_ROWS[xi][yi];
}

/**
 * Build a protein scoring function backed by the canonical BLOSUM62 substitution
 * matrix. Plug it into any alignment mode via `AlignOptions.scoring`, exactly
 * like {@link dnaScoring}. Gaps are NOT scored here; the DP core's affine gap
 * penalties handle insertions/deletions, so this function only ever sees two
 * residues. `X` (any), `*` (stop), and `B`/`Z` (ambiguous) use their standard
 * BLOSUM62 rows; `J`/`U`/`O` fall back to `X`.
 *
 * Note: BLOSUM scores are log-odds, so a positive score means a conservative
 * substitution (similar), not identical. Callers that need strict residue
 * identity should compare the aligned characters directly rather than reading it
 * off the alignment's match/mismatch ops.
 */
export function proteinScoring(options: ProteinScoringOptions = {}): ScoringFn {
  const unknownScore = options.unknownScore;
  return (x: string, y: string): number => blosum62(x, y, unknownScore);
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

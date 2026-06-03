import type { ScoringFn } from "./scoring";

/**
 * Alignment operations, per column of the produced alignment, read left to
 * right along sequence `a`:
 *  - 'M' match     : a residue of `a` aligned to a COMPATIBLE residue of `b`.
 *  - 'X' mismatch  : a residue of `a` aligned to an INCOMPATIBLE residue of `b`.
 *  - 'I' insertion : a residue present in `a` but not in `b` (gap in `b`).
 *  - 'D' deletion  : a residue present in `b` but not in `a` (gap in `a`).
 *
 * 'I' / 'D' are defined RELATIVE TO `a` (the first argument): an insertion is
 * extra sequence in `a`, a deletion is sequence missing from `a` (present in
 * `b`). This mirrors CIGAR convention where the first sequence is the "query".
 */
export type AlignOp = "M" | "X" | "I" | "D";

/** Affine gap penalty configuration (Gotoh). */
export interface GapPenalties {
  /**
   * Cost to OPEN a gap, applied once per gap run. Expressed as a magnitude that
   * is SUBTRACTED from the score (pass a positive number; default 5).
   */
  gapOpen?: number;
  /**
   * Cost to EXTEND a gap by one position, applied to every gap position
   * including the first. Subtracted from the score (pass a positive number;
   * default 1). A gap of length L therefore costs gapOpen + L * gapExtend.
   */
  gapExtend?: number;
}

/** Options shared by all three alignment modes. */
export interface AlignOptions extends GapPenalties {
  /**
   * Substitution scoring function, `(x, y) => number`. Defaults to
   * `dnaScoring()` (IUPAC-aware DNA, match +2 / mismatch -1) when omitted.
   */
  scoring?: ScoringFn;
}

/**
 * A structured, render-ready pairwise alignment result.
 *
 * Coordinates are 0-based, half-open: `[aStart, aEnd)` is the span of `a` that
 * participates in the alignment, likewise `[bStart, bEnd)` for `b`. For a global
 * alignment these are always `[0, a.length)` and `[0, b.length)`. For local /
 * semi-global they are the aligned sub-range.
 *
 * `alignedA` / `alignedB` are the gapped alignment strings (equal length); a gap
 * is the character '-'. `ops` has exactly that same length, one op per column.
 * `identity` is (count of 'M') / (alignment length), in [0, 1].
 * `cigar` is the run-length encoding of `ops`, e.g. "5M1X3M2I4M".
 */
export interface AlignmentResult {
  score: number;
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
  identity: number;
  alignedA: string;
  alignedB: string;
  ops: AlignOp[];
  cigar: string;
}

/**
 * Pairwise alignment DP core (Gotoh affine gaps), one engine, three modes.
 *
 * The recurrence uses three matrices (Gotoh 1982):
 *   M[i][j] = best score for a..i / b..j ending in a (mis)match column.
 *   Ia[i][j] = best score ending in a gap in `b` (a residue consumed, b not):
 *              an INSERTION relative to `a`. Op 'I'.
 *   Ib[i][j] = best score ending in a gap in `a` (b residue consumed, a not):
 *              a DELETION relative to `a`. Op 'D'.
 * Gap of length L costs gapOpen + L*gapExtend (open paid once, extend per cell).
 *
 * Modes differ ONLY in (a) how the first row/column are initialized and (b)
 * where traceback starts and stops:
 *   - global       : end-to-end. Init edges with gap penalties; start at the
 *                    bottom-right corner; stop at the top-left corner.
 *   - local        : Smith-Waterman. Floor scores at 0; start at the global max
 *                    cell; stop when score reaches 0.
 *   - semiGlobal   : `b` (the query, second arg) is aligned end-to-end; `a`
 *                    (the target, first arg) pays NO penalty for leading/trailing
 *                    gaps. Free gaps on the target ends; the query spans fully.
 *
 * To keep the engine readable at plasmid/primer scale we use flat typed arrays
 * for the three score matrices and a Uint8 traceback matrix. Sizes here are
 * (query length) x (windowed target), not whole genomes, so O(m*n) memory is
 * fine; seed-and-extend keeps the windows small.
 */
import type { ScoringFn } from "./scoring";
import { dnaScoring } from "./scoring";
import type { AlignOp, AlignmentResult } from "./types";

type Mode = "global" | "local" | "semiGlobal";

const NEG_INF = -1e9;

// Traceback pointer encoding. Each matrix cell records which predecessor matrix
// it came from, so we can reconstruct the path without recomputing scores.
const FROM_M = 0; // came from a (mis)match step
const FROM_IA = 1; // came from the insertion (gap-in-b) matrix
const FROM_IB = 2; // came from the deletion (gap-in-a) matrix
const STOP = 3; // local: path terminates here (score floored to 0)

interface CoreResult {
  score: number;
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
  alignedA: string;
  alignedB: string;
  ops: AlignOp[];
}

function runCore(
  a: string,
  b: string,
  mode: Mode,
  scoring: ScoringFn,
  gapOpen: number,
  gapExtend: number,
): CoreResult {
  const m = a.length;
  const n = b.length;
  const cols = n + 1;
  const size = (m + 1) * cols;

  // index helper for the flat (m+1) x (n+1) grid.
  const at = (i: number, j: number): number => i * cols + j;

  const M = new Float64Array(size);
  const Ia = new Float64Array(size); // gap in b (insertion in a), consumes a
  const Ib = new Float64Array(size); // gap in a (deletion from a), consumes b

  // Traceback: which matrix produced this cell's value, one Uint8 per matrix.
  const tbM = new Uint8Array(size);
  const tbIa = new Uint8Array(size);
  const tbIb = new Uint8Array(size);

  // --- Initialization of edges ---------------------------------------------
  // Origin.
  M[at(0, 0)] = 0;
  Ia[at(0, 0)] = NEG_INF;
  Ib[at(0, 0)] = NEG_INF;

  // First column (i>0, j=0): only gaps-in-b (consume a) are reachable.
  for (let i = 1; i <= m; i++) {
    M[at(i, 0)] = NEG_INF;
    Ib[at(i, 0)] = NEG_INF;
    if (mode === "local") {
      Ia[at(i, 0)] = NEG_INF; // local never carries a leading-gap score
      M[at(i, 0)] = 0; // but a match-state can start fresh at 0
    } else if (mode === "semiGlobal") {
      // Leading gap in `b` consumes `a` for free: skip target prefix at no cost.
      Ia[at(i, 0)] = 0;
    } else {
      // global: leading gap in `b` is penalized.
      Ia[at(i, 0)] = -(gapOpen + i * gapExtend);
    }
    tbIa[at(i, 0)] = i === 1 ? FROM_M : FROM_IA;
  }

  // First row (i=0, j>0): only gaps-in-a (consume b) are reachable.
  for (let j = 1; j <= n; j++) {
    M[at(0, j)] = NEG_INF;
    Ia[at(0, j)] = NEG_INF;
    if (mode === "local") {
      Ib[at(0, j)] = NEG_INF;
      M[at(0, j)] = 0;
    } else {
      // global AND semiGlobal: the query `b` is aligned end-to-end, so a leading
      // gap in `a` (skipping query prefix) IS penalized in both.
      Ib[at(0, j)] = -(gapOpen + j * gapExtend);
    }
    tbIb[at(0, j)] = j === 1 ? FROM_M : FROM_IB;
  }

  // --- Fill -----------------------------------------------------------------
  let best = NEG_INF;
  let bestI = 0;
  let bestJ = 0;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cell = at(i, j);
      const diag = at(i - 1, j - 1);
      const up = at(i - 1, j); // consume a -> gap in b -> Ia
      const left = at(i, j - 1); // consume b -> gap in a -> Ib

      // Insertion (gap in b): extend Ia or open from M.
      const iaOpen = M[up] - (gapOpen + gapExtend);
      const iaExtend = Ia[up] - gapExtend;
      if (iaExtend >= iaOpen) {
        Ia[cell] = iaExtend;
        tbIa[cell] = FROM_IA;
      } else {
        Ia[cell] = iaOpen;
        tbIa[cell] = FROM_M;
      }

      // Deletion (gap in a): extend Ib or open from M.
      const ibOpen = M[left] - (gapOpen + gapExtend);
      const ibExtend = Ib[left] - gapExtend;
      if (ibExtend >= ibOpen) {
        Ib[cell] = ibExtend;
        tbIb[cell] = FROM_IB;
      } else {
        Ib[cell] = ibOpen;
        tbIb[cell] = FROM_M;
      }

      // Match/mismatch: best predecessor + substitution score.
      const sub = scoring(a[i - 1], b[j - 1]);
      let mScore = M[diag] + sub;
      let mFrom = FROM_M;
      const fromIa = Ia[diag] + sub;
      if (fromIa > mScore) {
        mScore = fromIa;
        mFrom = FROM_IA;
      }
      const fromIb = Ib[diag] + sub;
      if (fromIb > mScore) {
        mScore = fromIb;
        mFrom = FROM_IB;
      }

      if (mode === "local" && mScore < 0) {
        M[cell] = 0;
        tbM[cell] = STOP;
      } else {
        M[cell] = mScore;
        tbM[cell] = mFrom;
      }

      // Track global maximum for local mode (best cell anywhere in M).
      if (mode === "local" && M[cell] > best) {
        best = M[cell];
        bestI = i;
        bestJ = j;
      }
    }
  }

  // --- Choose traceback start ----------------------------------------------
  // `startMat` is which matrix the start cell lives in.
  let startI: number;
  let startJ: number;
  let startMat: number;
  let score: number;

  if (mode === "local") {
    startI = bestI;
    startJ = bestJ;
    startMat = FROM_M;
    score = best <= 0 ? 0 : best;
    if (best <= 0) {
      // Empty alignment (no positive-scoring subalignment).
      return {
        score: 0,
        aStart: 0,
        aEnd: 0,
        bStart: 0,
        bEnd: 0,
        alignedA: "",
        alignedB: "",
        ops: [],
      };
    }
  } else if (mode === "global") {
    startI = m;
    startJ = n;
    [startMat, score] = bestOfCorner(M, Ia, Ib, at(m, n));
  } else {
    // semiGlobal: the query `b` must be fully consumed (reach row.. last query
    // residue), but `a` (target) may have a free trailing gap. So the end cell
    // is the best over the LAST COLUMN (j = n) across all i, allowing the
    // alignment to stop anywhere along the target. Trailing target prefix/suffix
    // is free; the query is end-to-end.
    let bi = 0;
    let bmat = FROM_M;
    let bscore = NEG_INF;
    for (let i = 0; i <= m; i++) {
      const [mat, sc] = bestOfCorner(M, Ia, Ib, at(i, n));
      if (sc > bscore) {
        bscore = sc;
        bi = i;
        bmat = mat;
      }
    }
    startI = bi;
    startJ = n;
    startMat = bmat;
    score = bscore;
  }

  // --- Traceback ------------------------------------------------------------
  const opsRev: AlignOp[] = [];
  const aRev: string[] = [];
  const bRev: string[] = [];

  let i = startI;
  let j = startJ;
  let mat = startMat;

  const stopAtZero = mode === "local";

  while (true) {
    if (mode === "global") {
      if (i === 0 && j === 0) break;
    } else if (mode === "semiGlobal") {
      // Stop when the query is exhausted (j === 0); remaining target prefix is
      // a free leading gap and is NOT emitted into the alignment.
      if (j === 0) break;
    } else {
      // local: stop when we reach a STOP cell or run off an edge.
      if (i === 0 || j === 0) break;
      if (mat === FROM_M && tbM[at(i, j)] === STOP) break;
      if (stopAtZero && mat === FROM_M && M[at(i, j)] === 0) break;
    }

    const cell = at(i, j);
    if (mat === FROM_M) {
      // diagonal step: consume one of each.
      const x = a[i - 1];
      const y = b[j - 1];
      const sub = scoring(x, y);
      // A column is a match when the substitution score is the positive "match"
      // value, i.e. the residues are compatible. We classify by re-scoring:
      // compatible (sub > 0 for default schemes) -> 'M', else 'X'. For arbitrary
      // schemes we treat sub >= 0 as a match column.
      opsRev.push(sub >= 0 ? "M" : "X");
      aRev.push(x);
      bRev.push(y);
      const next = tbM[cell];
      i -= 1;
      j -= 1;
      mat = next;
    } else if (mat === FROM_IA) {
      // gap in b (insertion in a): consume a only.
      opsRev.push("I");
      aRev.push(a[i - 1]);
      bRev.push("-");
      const next = tbIa[cell];
      i -= 1;
      mat = next;
    } else {
      // FROM_IB: gap in a (deletion from a): consume b only.
      opsRev.push("D");
      aRev.push("-");
      bRev.push(b[j - 1]);
      const next = tbIb[cell];
      j -= 1;
      mat = next;
    }
  }

  const ops = opsRev.reverse();
  const alignedA = aRev.reverse().join("");
  const alignedB = bRev.reverse().join("");

  return {
    score,
    aStart: i,
    aEnd: startI,
    bStart: j,
    bEnd: startJ,
    alignedA,
    alignedB,
    ops,
  };
}

/** Pick the best-scoring matrix at a corner cell and return [matrix, score]. */
function bestOfCorner(
  M: Float64Array,
  Ia: Float64Array,
  Ib: Float64Array,
  cell: number,
): [number, number] {
  let mat = FROM_M;
  let sc = M[cell];
  if (Ia[cell] > sc) {
    sc = Ia[cell];
    mat = FROM_IA;
  }
  if (Ib[cell] > sc) {
    sc = Ib[cell];
    mat = FROM_IB;
  }
  return [mat, sc];
}

/** Run-length encode an op list into a CIGAR-like string, e.g. "5M1X3M". */
export function opsToCigar(ops: AlignOp[]): string {
  if (ops.length === 0) return "";
  let out = "";
  let run = 1;
  for (let k = 1; k <= ops.length; k++) {
    if (k < ops.length && ops[k] === ops[k - 1]) {
      run += 1;
    } else {
      out += String(run) + ops[k - 1];
      run = 1;
    }
  }
  return out;
}

function finalize(core: CoreResult): AlignmentResult {
  const matches = core.ops.reduce((acc, op) => acc + (op === "M" ? 1 : 0), 0);
  const identity = core.ops.length === 0 ? 0 : matches / core.ops.length;
  return {
    score: core.score,
    aStart: core.aStart,
    aEnd: core.aEnd,
    bStart: core.bStart,
    bEnd: core.bEnd,
    identity,
    alignedA: core.alignedA,
    alignedB: core.alignedB,
    ops: core.ops,
    cigar: opsToCigar(core.ops),
  };
}

function resolveOpts(opts: import("./types").AlignOptions | undefined): {
  scoring: ScoringFn;
  gapOpen: number;
  gapExtend: number;
} {
  return {
    scoring: opts?.scoring ?? dnaScoring(),
    gapOpen: opts?.gapOpen ?? 5,
    gapExtend: opts?.gapExtend ?? 1,
  };
}

/**
 * Smith-Waterman local alignment: the single best-scoring local subalignment of
 * `a` and `b`. Returns an empty alignment (score 0, zero-length spans) when no
 * positively-scoring subalignment exists.
 */
export function alignLocal(
  a: string,
  b: string,
  opts?: import("./types").AlignOptions,
): AlignmentResult {
  const { scoring, gapOpen, gapExtend } = resolveOpts(opts);
  return finalize(runCore(a, b, "local", scoring, gapOpen, gapExtend));
}

/**
 * Needleman-Wunsch global alignment: end-to-end alignment of the full `a` and
 * full `b`. Spans are always the full lengths.
 */
export function alignGlobal(
  a: string,
  b: string,
  opts?: import("./types").AlignOptions,
): AlignmentResult {
  const { scoring, gapOpen, gapExtend } = resolveOpts(opts);
  return finalize(runCore(a, b, "global", scoring, gapOpen, gapExtend));
}

/**
 * Semi-global ("glocal") alignment: the SECOND argument `b` (the short query,
 * e.g. a primer/oligo) is aligned end-to-end, while the FIRST argument `a` (the
 * long target/template) pays no penalty for leading or trailing gaps. The result
 * spans the full query against the best region of the target. This is the
 * natural call for "place this whole primer into this template."
 */
export function alignSemiGlobal(
  a: string,
  b: string,
  opts?: import("./types").AlignOptions,
): AlignmentResult {
  const { scoring, gapOpen, gapExtend } = resolveOpts(opts);
  return finalize(runCore(a, b, "semiGlobal", scoring, gapOpen, gapExtend));
}

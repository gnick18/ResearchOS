/**
 * compare align bot — pure formatting helpers for the Compare / align-two-
 * sequences view. Takes an `AlignmentResult` from `lib/align` and turns it into
 * render-ready, wrapped rows (aligned A / midline / aligned B) plus the summary
 * stats the dialog header shows. No DOM, no React; strict TS so the rendering
 * logic is unit-tested independently of the canvas.
 */
import type { AlignmentResult, AlignOp } from "@/lib/align";

/** A single column class, mirroring the engine ops collapsed for rendering. */
export type ColumnKind = "match" | "mismatch" | "gap";

/**
 * One wrapped block of the alignment, `width` columns wide (the last block may
 * be shorter). Coordinates are 1-based, inclusive, in the ORIGINAL sequence
 * (gaps do not advance a coordinate). `aStart`/`aEnd` are the residue numbers of
 * sequence A spanned by this block; likewise for B. When a block contains only
 * gaps for a sequence (rare at the very edges), its start/end fall back to the
 * surrounding residue number so ticks stay monotonic.
 */
export interface AlignmentBlock {
  /** Column index (0-based) where this block begins in the full alignment. */
  colStart: number;
  /** The gapped A row text for this block. */
  aRow: string;
  /** The gapped B row text for this block. */
  bRow: string;
  /** Midline: '|' for a match column, ' ' for mismatch/gap. */
  midline: string;
  /** Per-column kind, same length as the rows. */
  kinds: ColumnKind[];
  /** 1-based first residue of A in this block (null if the block is all-gap for A). */
  aStart: number | null;
  /** 1-based last residue of A in this block (null if all-gap for A). */
  aEnd: number | null;
  /** 1-based first residue of B in this block (null if all-gap for B). */
  bStart: number | null;
  /** 1-based last residue of B in this block (null if all-gap for B). */
  bEnd: number | null;
}

/** Summary stats for the Compare header line. */
export interface AlignmentSummary {
  /** Total alignment columns. */
  columns: number;
  /** Count of match columns. */
  matches: number;
  /** Count of mismatch columns. */
  mismatches: number;
  /** Count of gap columns (gap in either row). */
  gaps: number;
  /** Identity fraction in [0, 1] (matches / columns). */
  identity: number;
  /** Identity as a rounded whole percent, e.g. 97. */
  identityPct: number;
  /** Alignment score from the engine. */
  score: number;
}

/** The full render model the Compare view consumes. */
export interface CompareModel {
  blocks: AlignmentBlock[];
  summary: AlignmentSummary;
}

/** Classify one engine op into a render column kind. */
function kindForOp(op: AlignOp): ColumnKind {
  if (op === "M") return "match";
  if (op === "X") return "mismatch";
  return "gap"; // 'I' or 'D'
}

/**
 * Compute the summary stats for an alignment. Identity here is matches over
 * total columns (gaps and mismatches both count against it), matching the
 * engine's `identity` definition.
 */
export function summarizeAlignment(result: AlignmentResult): AlignmentSummary {
  let matches = 0;
  let mismatches = 0;
  let gaps = 0;
  for (const op of result.ops) {
    const k = kindForOp(op);
    if (k === "match") matches += 1;
    else if (k === "mismatch") mismatches += 1;
    else gaps += 1;
  }
  const columns = result.ops.length;
  const identity = columns === 0 ? 0 : matches / columns;
  return {
    columns,
    matches,
    mismatches,
    gaps,
    identity,
    identityPct: Math.round(identity * 100),
    score: result.score,
  };
}

/**
 * Slice an alignment into fixed-width wrapped blocks with per-column kinds, a
 * match/mismatch midline, and 1-based coordinate ticks per row.
 *
 * `aStart` / `bStart` are the 0-based offsets in the ORIGINAL sequences where
 * this alignment begins (i.e. `result.aStart` / `result.bStart`). They seed the
 * residue counters so the ticks read in real sequence coordinates (important for
 * local alignments that begin partway in).
 *
 * `width` is the column count per wrapped row (default 60). Must be >= 1.
 */
export function toAlignmentBlocks(
  result: AlignmentResult,
  width = 60,
): AlignmentBlock[] {
  if (width < 1) throw new RangeError("width must be >= 1");
  const { alignedA, alignedB } = result;
  const len = alignedA.length;
  if (len === 0) return [];

  // Running 1-based residue numbers. We pre-increment when a real (non-gap)
  // residue is consumed, so the first residue of A is `result.aStart + 1`.
  let aPos = result.aStart; // 0-based count consumed so far
  let bPos = result.bStart;

  const blocks: AlignmentBlock[] = [];

  for (let colStart = 0; colStart < len; colStart += width) {
    const colEnd = Math.min(colStart + width, len);
    let aRow = "";
    let bRow = "";
    let midline = "";
    const kinds: ColumnKind[] = [];
    let aStart: number | null = null;
    let aEnd: number | null = null;
    let bStart: number | null = null;
    let bEnd: number | null = null;

    for (let c = colStart; c < colEnd; c++) {
      const ca = alignedA[c];
      const cb = alignedB[c];
      aRow += ca;
      bRow += cb;

      if (ca !== "-") {
        aPos += 1;
        if (aStart === null) aStart = aPos;
        aEnd = aPos;
      }
      if (cb !== "-") {
        bPos += 1;
        if (bStart === null) bStart = bPos;
        bEnd = bPos;
      }

      let kind: ColumnKind;
      if (ca === "-" || cb === "-") kind = "gap";
      else kind = result.ops[c] === "X" ? "mismatch" : "match";
      kinds.push(kind);
      midline += kind === "match" ? "|" : " ";
    }

    blocks.push({
      colStart,
      aRow,
      bRow,
      midline,
      kinds,
      aStart,
      aEnd,
      bStart,
      bEnd,
    });
  }

  return blocks;
}

/** Build the full Compare render model (blocks + summary) in one call. */
export function buildCompareModel(
  result: AlignmentResult,
  width = 60,
): CompareModel {
  return {
    blocks: toAlignmentBlocks(result, width),
    summary: summarizeAlignment(result),
  };
}

/**
 * Format the one-line header stat, e.g. "97% identity over 1,203 cols, score 2410".
 * Pure string builder so the exact copy is testable.
 */
export function formatSummaryLine(summary: AlignmentSummary): string {
  const cols = summary.columns.toLocaleString();
  const score = summary.score.toLocaleString();
  return `${summary.identityPct}% identity over ${cols} ${
    summary.columns === 1 ? "col" : "cols"
  }, score ${score}`;
}

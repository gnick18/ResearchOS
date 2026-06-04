/**
 * large align bot — seed-and-chain local-homology finder for LARGE sequence
 * pairs that exceed the full O(m*n) DP budget. Instead of one global matrix it
 * finds the shared regions (HSPs, "high-scoring segment pairs", BLAST's term)
 * by seeding exact k-mers, chaining collinear seeds onto diagonals, and refining
 * each chained anchor with a BANDED local alignment over a small window. This is
 * a heuristic: it reports the strong shared blocks, NOT a guaranteed-optimal
 * global alignment, so the UI labels it "shared regions / local homology".
 *
 * Pipeline (minimap2 / BLAST style):
 *   1. SEED   — k-mer index of A; walk every k-mer of B on BOTH strands; each
 *               shared k-mer is a seed pinned to a diagonal d = bPos - aPos
 *               (for the reverse strand, B is reverse-complemented first and the
 *               coordinates are mapped back to forward-B space).
 *   2. CHAIN  — bucket seeds by (strand, diagonal) with a small diagonal band so
 *               an indel that nudges the diagonal by a few bases still chains;
 *               merge collinear seeds in a bucket into one anchor span.
 *   3. REFINE — for each anchor, cut out only the A-window and B-window the
 *               anchor spans (plus padding), and run alignLocal over that small
 *               window. This is the "banded" step: the window is O(anchor span),
 *               never O(m*n).
 *   4. RANK   — sort HSPs by score, drop HSPs whose A AND B spans both overlap a
 *               higher-scoring HSP on the same strand (de-dup), cap the count.
 *
 * Complexity: O(|A| + |B|) to index + seed, O(seeds) to chain, and the refine
 * cost is the sum of (window area) over anchors, which stays bounded because
 * each window is sized to its anchor. On 60kb+ inputs this runs in the browser
 * without freezing; the seed budget is capped to keep repetitive sequence from
 * exploding the seed list.
 */
import { alignLocal } from "./core";
import { dnaScoring, reverseComplement } from "./scoring";
import type { AlignOptions, AlignmentResult } from "./types";

/** A single shared region (high-scoring segment pair) between A and B. */
export interface Hsp {
  /** Start of the region in A, 0-based inclusive (forward A coordinates). */
  aStart: number;
  /** End of the region in A, 0-based exclusive (forward A coordinates). */
  aEnd: number;
  /** Start of the region in B, 0-based inclusive (forward B coordinates). */
  bStart: number;
  /** End of the region in B, 0-based exclusive (forward B coordinates). */
  bEnd: number;
  /**
   * +1 when A aligns to B as-is; -1 when A aligns to the reverse complement of
   * B (the region is an inverted repeat / opposite-strand match). For a reverse
   * HSP, `alignedB` is the reverse-complemented B segment and `bStart`/`bEnd`
   * are still forward-B coordinates of the spanned region.
   */
  strand: 1 | -1;
  /** Fraction of aligned columns that are exact matches, in [0, 1]. */
  identity: number;
  /** Alignment score from the banded local refine. */
  score: number;
  /** Aligned A row (gapped, '-' for gaps). */
  alignedA: string;
  /** Aligned B row (gapped, '-' for gaps); reverse-complemented for strand -1. */
  alignedB: string;
  /** Length of the region in A bases (aEnd - aStart). */
  aLength: number;
  /** Length of the region in B bases (bEnd - bStart). */
  bLength: number;
}

/** Result of {@link findSharedRegions}: the ranked HSPs plus discovery stats. */
export interface SharedRegionResult {
  /** Ranked shared regions, best score first, capped at `maxRegions`. */
  hsps: Hsp[];
  /** k-mer word length used for seeding. */
  k: number;
  /** Number of distinct anchors found before refine + de-dup. */
  anchorsFound: number;
  /**
   * True when more than `maxRegions` distinct HSPs survived de-dup and the list
   * was truncated, so the UI can note "showing top N of M".
   */
  truncated: boolean;
  /** Total distinct HSPs after de-dup, before the `maxRegions` cap. */
  totalHsps: number;
}

/** Options for {@link findSharedRegions}. */
export interface SharedRegionOptions extends AlignOptions {
  /**
   * Seed k-mer length. Larger k = fewer, more specific seeds (faster, less
   * sensitive). Default is chosen from sequence length when omitted (see
   * {@link chooseSeedK}).
   */
  k?: number;
  /** Search the reverse strand too (DNA). Default true. */
  bothStrands?: boolean;
  /**
   * Diagonal band half-width for chaining: seeds within this many bases of a
   * bucket's diagonal still chain into it, absorbing small indels. Default 24.
   */
  diagonalBand?: number;
  /**
   * Drop anchors whose chained seed span (in A) is shorter than this; isolated
   * one-off k-mer hits between unrelated sequences are noise. Default is `2 * k`
   * so an anchor needs at least two overlapping/adjacent seeds worth of signal.
   */
  minAnchorSpan?: number;
  /** Padding added around each anchor window before the banded refine. Default 30. */
  windowPadding?: number;
  /** Hard cap on returned HSPs. Default 25. */
  maxRegions?: number;
  /**
   * Cap on raw seeds collected per strand before chaining. Protects against a
   * highly repetitive sequence producing millions of seeds. Default 200,000.
   */
  maxSeeds?: number;
  /**
   * Repeat masking: a k-mer that occurs in A more than this many times is a
   * low-information repeat (microsatellite, common motif) and is dropped from the
   * seed index, exactly as BLAST/minimap2 mask over-abundant seeds. This is what
   * keeps a repetitive sequence from producing one giant anchor that would force
   * a huge banded refine. Default 64.
   */
  maxKmerHits?: number;
  /**
   * Hard cap on the banded-refine window AREA (A-window length times B-window
   * length). An anchor whose window would exceed this is centered and clipped to
   * a band of this area around its seed diagonal, so a single refine can never
   * cost more than O(maxWindowArea). Default 4,000,000 (~2000 x 2000).
   */
  maxWindowArea?: number;
  /**
   * Minimum HSP score to keep after refine. Filters weak windows that chained on
   * a single shared k-mer but did not extend. Default `4 * k` (a couple of solid
   * match columns beyond the seed itself).
   */
  minScore?: number;
}

/**
 * Choose a seed k-mer length from the shorter sequence length. Long sequences
 * can afford a longer, more specific word (fewer spurious seeds); short ones
 * need a smaller word or no seed survives. Clamped to [11, 18].
 */
export function chooseSeedK(minLen: number): number {
  if (minLen < 2_000) return 11;
  if (minLen < 50_000) return 14;
  return 16;
}

/** A raw seed: an exact k-mer shared by A and (forward) B at these offsets. */
interface Seed {
  aPos: number;
  bPos: number;
  diag: number; // bPos - aPos
}

/** A chained anchor: the merged span of collinear seeds in one diagonal bucket. */
interface Anchor {
  aLo: number;
  aHi: number; // inclusive last seed A start
  bLo: number;
  bHi: number; // inclusive last seed B start
}

/**
 * Build a k-mer index of `a`: each k-mer string maps to its sorted start
 * positions. Exact, case-folded. O(|a|) time and space. After building, any
 * k-mer occurring more than `maxKmerHits` times is deleted (repeat masking): an
 * over-abundant k-mer is a low-information repeat that would otherwise chain into
 * one enormous anchor and an unbounded refine, so dropping it is what keeps the
 * finder fast on repetitive sequence (BLAST/minimap2 do the same).
 */
function indexKmers(
  a: string,
  k: number,
  maxKmerHits: number,
): Map<string, number[]> {
  const index = new Map<string, number[]>();
  if (k <= 0 || a.length < k) return index;
  for (let i = 0; i + k <= a.length; i++) {
    const word = a.slice(i, i + k);
    const list = index.get(word);
    if (list) list.push(i);
    else index.set(word, [i]);
  }
  for (const [word, list] of index) {
    if (list.length > maxKmerHits) index.delete(word);
  }
  return index;
}

/**
 * Collect seeds between A (pre-indexed) and a forward B string. Each shared
 * k-mer yields one seed pinned to diagonal d = bPos - aPos. Capped at
 * `maxSeeds`; returns the seeds and whether the cap was hit.
 */
function collectSeeds(
  index: Map<string, number[]>,
  b: string,
  k: number,
  maxSeeds: number,
): { seeds: Seed[]; capped: boolean } {
  const seeds: Seed[] = [];
  if (k <= 0 || b.length < k) return { seeds, capped: false };
  for (let j = 0; j + k <= b.length; j++) {
    const hits = index.get(b.slice(j, j + k));
    if (!hits) continue;
    for (const i of hits) {
      seeds.push({ aPos: i, bPos: j, diag: j - i });
      if (seeds.length >= maxSeeds) return { seeds, capped: true };
    }
  }
  return { seeds, capped: false };
}

/**
 * Chain seeds into anchors. Seeds are bucketed by diagonal (quantized by the
 * band so near-diagonals merge), and within a bucket consecutive seeds (sorted
 * by A position) are merged while they stay within the band and do not jump too
 * far apart, producing one anchor span per collinear run.
 */
function chainSeeds(seeds: Seed[], k: number, band: number): Anchor[] {
  if (seeds.length === 0) return [];
  // Sort by diagonal, then by A position, so collinear seeds are adjacent.
  seeds.sort((s1, s2) => (s1.diag - s2.diag) || (s1.aPos - s2.aPos));
  const anchors: Anchor[] = [];
  let cur: Anchor | null = null;
  let curDiag = 0;
  // Max A-gap between consecutive seeds in the same chain. Beyond this we start a
  // new anchor even on the same diagonal (two separate blocks of homology).
  const maxAGap = Math.max(band, k) * 4 + k;
  for (const s of seeds) {
    if (
      cur &&
      Math.abs(s.diag - curDiag) <= band &&
      s.aPos - cur.aHi <= maxAGap
    ) {
      if (s.aPos > cur.aHi) {
        cur.aHi = s.aPos;
        cur.bHi = s.bPos;
      }
      if (s.aPos < cur.aLo) cur.aLo = s.aPos;
      if (s.bPos < cur.bLo) cur.bLo = s.bPos;
      if (s.bPos > cur.bHi) cur.bHi = s.bPos;
    } else {
      if (cur) anchors.push(cur);
      cur = { aLo: s.aPos, aHi: s.aPos, bLo: s.bPos, bHi: s.bPos };
      curDiag = s.diag;
    }
  }
  if (cur) anchors.push(cur);
  return anchors;
}

/**
 * Refine one anchor with a banded local alignment over the windowed substrings,
 * returning an HSP in forward A / forward-B-for-this-strand window coordinates,
 * or null if the window produced no positive-scoring local alignment. `bSpace`
 * is the B string actually aligned (forward B for strand +1, reverse-complement
 * of B for strand -1); window coords are in that space.
 */
function refineAnchor(
  a: string,
  bSpace: string,
  anchor: Anchor,
  k: number,
  pad: number,
  maxWindowArea: number,
  opts: AlignOptions,
): {
  alignment: AlignmentResult;
  aWinStart: number;
  bWinStart: number;
} | null {
  let aWinStart = Math.max(0, anchor.aLo - pad);
  let aWinEnd = Math.min(a.length, anchor.aHi + k + pad);
  let bWinStart = Math.max(0, anchor.bLo - pad);
  let bWinEnd = Math.min(bSpace.length, anchor.bHi + k + pad);

  // Bound the refine cost: if the window area exceeds the cap, shrink each axis
  // by the same factor, centered on the anchor midpoint, so a pathological
  // anchor (e.g. a long repeat run that slipped past masking) still refines in
  // O(maxWindowArea) instead of blowing up. The center stays on the homology, so
  // the core of the block is still recovered.
  const aLen = aWinEnd - aWinStart;
  const bLen = bWinEnd - bWinStart;
  const area = aLen * bLen;
  if (area > maxWindowArea && aLen > 0 && bLen > 0) {
    const factor = Math.sqrt(maxWindowArea / area);
    const aKeep = Math.max(k, Math.floor(aLen * factor));
    const bKeep = Math.max(k, Math.floor(bLen * factor));
    const aMid = Math.floor((anchor.aLo + anchor.aHi + k) / 2);
    const bMid = Math.floor((anchor.bLo + anchor.bHi + k) / 2);
    aWinStart = Math.max(0, aMid - Math.floor(aKeep / 2));
    aWinEnd = Math.min(a.length, aWinStart + aKeep);
    bWinStart = Math.max(0, bMid - Math.floor(bKeep / 2));
    bWinEnd = Math.min(bSpace.length, bWinStart + bKeep);
  }

  const aWin = a.slice(aWinStart, aWinEnd);
  const bWin = bSpace.slice(bWinStart, bWinEnd);
  if (aWin.length === 0 || bWin.length === 0) return null;
  const alignment = alignLocal(aWin, bWin, opts);
  if (alignment.ops.length === 0) return null;
  return { alignment, aWinStart, bWinStart };
}

/**
 * Find the shared regions (HSPs) between two sequences without a full O(m*n)
 * matrix. Returns a ranked, de-duplicated, capped list plus discovery stats.
 * This is the large-sequence path for the Compare tool; it is a local-homology
 * heuristic, not a guaranteed-optimal global alignment.
 */
export function findSharedRegions(
  a: string,
  b: string,
  options: SharedRegionOptions = {},
): SharedRegionResult {
  const A = a.toUpperCase();
  const B = b.toUpperCase();
  const scoring = options.scoring ?? dnaScoring();
  const baseOpts: AlignOptions = {
    scoring,
    gapOpen: options.gapOpen,
    gapExtend: options.gapExtend,
  };
  const k = Math.max(
    4,
    options.k ?? chooseSeedK(Math.min(A.length, B.length)),
  );
  const bothStrands = options.bothStrands ?? true;
  const band = options.diagonalBand ?? 24;
  const minAnchorSpan = options.minAnchorSpan ?? 2 * k;
  const pad = options.windowPadding ?? 30;
  const maxRegions = options.maxRegions ?? 25;
  const maxSeeds = options.maxSeeds ?? 200_000;
  const minScore = options.minScore ?? 4 * k;
  const maxKmerHits = options.maxKmerHits ?? 64;
  const maxWindowArea = options.maxWindowArea ?? 4_000_000;

  if (A.length < k || B.length < k) {
    return { hsps: [], k, anchorsFound: 0, truncated: false, totalHsps: 0 };
  }

  const index = indexKmers(A, k, maxKmerHits);

  // Per strand: the B string actually aligned, and a coordinate mapper from that
  // space back to forward-B coordinates.
  const strands: Array<{
    strand: 1 | -1;
    bSpace: string;
  }> = [{ strand: 1, bSpace: B }];
  if (bothStrands) strands.push({ strand: -1, bSpace: reverseComplement(B) });

  const rawHsps: Hsp[] = [];
  let anchorsFound = 0;

  for (const { strand, bSpace } of strands) {
    const { seeds } = collectSeeds(index, bSpace, k, maxSeeds);
    if (seeds.length === 0) continue;
    const anchors = chainSeeds(seeds, k, band);

    for (const anchor of anchors) {
      // Skip anchors that are too short to be meaningful homology.
      if (anchor.aHi + k - anchor.aLo < minAnchorSpan) continue;
      anchorsFound += 1;

      const refined = refineAnchor(
        A,
        bSpace,
        anchor,
        k,
        pad,
        maxWindowArea,
        baseOpts,
      );
      if (!refined) continue;
      const { alignment, aWinStart, bWinStart } = refined;
      if (alignment.score < minScore) continue;

      // Map window-local coordinates to forward A and to the strand's B space.
      const aStart = aWinStart + alignment.aStart;
      const aEnd = aWinStart + alignment.aEnd;
      const bSpaceStart = bWinStart + alignment.bStart;
      const bSpaceEnd = bWinStart + alignment.bEnd;

      // Convert B-space coords to forward-B coords. For the reverse strand the
      // aligned B was reverse-complemented, so a span [s, e) in revcomp space maps
      // to [len - e, len - s) in forward space.
      let bStart: number;
      let bEnd: number;
      if (strand === 1) {
        bStart = bSpaceStart;
        bEnd = bSpaceEnd;
      } else {
        bStart = B.length - bSpaceEnd;
        bEnd = B.length - bSpaceStart;
      }

      rawHsps.push({
        aStart,
        aEnd,
        bStart,
        bEnd,
        strand,
        identity: alignment.identity,
        score: alignment.score,
        alignedA: alignment.alignedA,
        alignedB: alignment.alignedB,
        aLength: aEnd - aStart,
        bLength: bEnd - bStart,
      });
    }
  }

  // Rank by score (desc), then de-duplicate: drop an HSP whose A span AND B span
  // both overlap an already-kept, higher-scoring HSP on the same strand. This
  // removes redundant anchors that refined to the same block while keeping
  // genuinely distinct shared regions.
  rawHsps.sort((h1, h2) => h2.score - h1.score);
  const kept: Hsp[] = [];
  for (const h of rawHsps) {
    const dup = kept.find(
      (k2) =>
        k2.strand === h.strand &&
        rangesOverlap(k2.aStart, k2.aEnd, h.aStart, h.aEnd) &&
        rangesOverlap(k2.bStart, k2.bEnd, h.bStart, h.bEnd),
    );
    if (!dup) kept.push(h);
  }

  const totalHsps = kept.length;
  const truncated = totalHsps > maxRegions;
  const hsps = truncated ? kept.slice(0, maxRegions) : kept;

  return { hsps, k, anchorsFound, truncated, totalHsps };
}

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

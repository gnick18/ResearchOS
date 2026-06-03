/**
 * BLAST-style seed-and-extend wrapper for aligning a short query (a primer or
 * oligo) against a large target (a contig or whole plasmid), on BOTH strands.
 *
 * Strategy (proposal section 4):
 *   1. SEED: build a k-mer index of the target, then find exact k-mer hits of
 *      the query in the target. Each hit pins a diagonal.
 *   2. EXTEND: run a windowed semi-global (or local) alignment only in a band of
 *      the target around each seed, not the whole target.
 *   3. RANK: sort the windowed alignments by score, dedupe overlapping hits, and
 *      return the best plus any near-ties.
 *
 * For DNA both strands are searched: the reverse strand is handled by reverse-
 * complementing the QUERY and seeding/extending that against the same forward
 * target, then mapping the reported coordinates back to forward-target space and
 * tagging the hit strand -1. Forward hits are strand +1.
 *
 * Small targets can skip seeding entirely (a single full windowed align over the
 * whole target on each strand) via `directIfTargetUnder`.
 */
import { alignLocal, alignSemiGlobal } from "./core";
import { dnaScoring, reverseComplement } from "./scoring";
import type { AlignOptions, AlignmentResult } from "./types";

/** A ranked hit from seed-and-extend, with strand and target coordinates. */
export interface SeedHit {
  /** +1 for a forward-strand hit, -1 for a reverse-strand hit. */
  strand: 1 | -1;
  /**
   * The windowed alignment. Its `aStart`/`aEnd` are in TARGET coordinates of the
   * strand that was aligned. For a reverse hit (strand -1) these have already
   * been mapped back to forward-target coordinates (see `targetStart`/`targetEnd`).
   */
  alignment: AlignmentResult;
  /** Alignment span start in FORWARD target coordinates, 0-based inclusive. */
  targetStart: number;
  /** Alignment span end in FORWARD target coordinates, 0-based exclusive. */
  targetEnd: number;
  /** Convenience copy of `alignment.score`. */
  score: number;
}

/** Options for {@link seedAndExtend}. */
export interface SeedAndExtendOptions extends AlignOptions {
  /** Seed k-mer length. Default 11 (clamped to the query length). */
  k?: number;
  /**
   * Half-width of slack added to the window beyond the query length on each side
   * of a seed, to absorb indels. Default 8.
   */
  windowPadding?: number;
  /** Search both strands (DNA). Default true. When false only strand +1. */
  bothStrands?: boolean;
  /**
   * Extension mode. "semiGlobal" (default) aligns the whole query end-to-end
   * into the window (best for placing a primer); "local" finds the best local
   * subalignment (best when only part of the query is expected to match).
   */
  mode?: "semiGlobal" | "local";
  /**
   * If the target length is <= this, skip the k-mer index and run a single
   * windowed alignment over the whole target per strand. Default 2000.
   */
  directIfTargetUnder?: number;
  /**
   * Keep hits whose score is within this fraction of the best score (0..1). E.g.
   * 0.1 keeps hits scoring >= 90% of the top hit. Default 0.05.
   */
  nearTieFraction?: number;
  /** Hard cap on returned hits. Default 10. */
  maxHits?: number;
}

interface RawHit {
  strand: 1 | -1;
  alignment: AlignmentResult;
  targetStart: number;
  targetEnd: number;
}

/**
 * Build a k-mer index of `target`: maps each k-mer string to the list of its
 * start positions. Exact bases only; ambiguity codes in the target are indexed
 * verbatim, so degenerate seeding relies on exact k-mer identity (extension then
 * handles IUPAC scoring). O(target length) time and space.
 */
export function buildKmerIndex(target: string, k: number): Map<string, number[]> {
  const index = new Map<string, number[]>();
  if (k <= 0 || target.length < k) return index;
  const upper = target.toUpperCase();
  for (let i = 0; i + k <= upper.length; i++) {
    const kmer = upper.slice(i, i + k);
    const list = index.get(kmer);
    if (list) list.push(i);
    else index.set(kmer, [i]);
  }
  return index;
}

/**
 * Collect candidate diagonals (target offsets where the query likely starts) by
 * matching every query k-mer against the index. For a query k-mer at query
 * offset `q` found at target position `t`, the implied query-start on the target
 * is `t - q`. Returns a deduped, sorted set of candidate query-start offsets.
 */
function seedDiagonals(
  query: string,
  index: Map<string, number[]>,
  k: number,
): number[] {
  const starts = new Set<number>();
  const upper = query.toUpperCase();
  for (let q = 0; q + k <= upper.length; q++) {
    const hits = index.get(upper.slice(q, q + k));
    if (!hits) continue;
    for (const t of hits) starts.add(t - q);
  }
  return Array.from(starts).sort((x, y) => x - y);
}

function extendOne(
  target: string,
  query: string,
  windowStart: number,
  windowEnd: number,
  mode: "semiGlobal" | "local",
  opts: AlignOptions,
): { alignment: AlignmentResult; windowStart: number } {
  const window = target.slice(windowStart, windowEnd);
  const alignment =
    mode === "local" ? alignLocal(window, query, opts) : alignSemiGlobal(window, query, opts);
  return { alignment, windowStart };
}

/**
 * Seed-and-extend alignment of a short `query` against a large `target`, both
 * strands by default. Returns ranked {@link SeedHit}s (best first), including
 * near-ties, with strand and forward-target coordinates resolved.
 */
export function seedAndExtend(
  query: string,
  target: string,
  options: SeedAndExtendOptions = {},
): SeedHit[] {
  const scoring = options.scoring ?? dnaScoring();
  const baseOpts: AlignOptions = {
    scoring,
    gapOpen: options.gapOpen,
    gapExtend: options.gapExtend,
  };
  const mode = options.mode ?? "semiGlobal";
  const bothStrands = options.bothStrands ?? true;
  const directThreshold = options.directIfTargetUnder ?? 2000;
  const padding = options.windowPadding ?? 8;
  const nearTie = options.nearTieFraction ?? 0.05;
  const maxHits = options.maxHits ?? 10;
  const k = Math.max(1, Math.min(options.k ?? 11, query.length));

  const raw: RawHit[] = [];

  const strands: Array<{ strand: 1 | -1; q: string }> = [{ strand: 1, q: query }];
  if (bothStrands) strands.push({ strand: -1, q: reverseComplement(query) });

  for (const { strand, q } of strands) {
    const windows: Array<[number, number]> = [];

    if (target.length <= directThreshold) {
      // Small target: one window over the whole thing.
      windows.push([0, target.length]);
    } else {
      const index = buildKmerIndex(target, k);
      const diagonals = seedDiagonals(q, index, k);
      if (diagonals.length === 0) continue;
      // Turn each candidate query-start into a padded window, then merge
      // overlapping windows so adjacent seeds on the same diagonal collapse.
      const proto: Array<[number, number]> = diagonals.map((start) => {
        const ws = Math.max(0, start - padding);
        const we = Math.min(target.length, start + q.length + padding);
        return [ws, we];
      });
      proto.sort((p1, p2) => p1[0] - p2[0]);
      let cur: [number, number] | null = null;
      for (const w of proto) {
        if (cur && w[0] <= cur[1]) {
          cur[1] = Math.max(cur[1], w[1]);
        } else {
          if (cur) windows.push(cur);
          cur = [w[0], w[1]];
        }
      }
      if (cur) windows.push(cur);
    }

    for (const [ws, we] of windows) {
      const { alignment } = extendOne(target, q, ws, we, mode, baseOpts);
      if (alignment.ops.length === 0) continue;

      // Map window-relative target coords to absolute, forward-target coords.
      let fwdStart: number;
      let fwdEnd: number;
      if (strand === 1) {
        fwdStart = ws + alignment.aStart;
        fwdEnd = ws + alignment.aEnd;
      } else {
        // The aligned target was forward; we aligned the revcomp QUERY against
        // it, so target coordinates are already forward. The strand tag -1
        // simply records that the query bound as its reverse complement.
        fwdStart = ws + alignment.aStart;
        fwdEnd = ws + alignment.aEnd;
      }
      raw.push({ strand, alignment, targetStart: fwdStart, targetEnd: fwdEnd });
    }
  }

  if (raw.length === 0) return [];

  // Rank by score (desc). Dedupe hits covering the same target span+strand,
  // keeping the highest score.
  raw.sort((h1, h2) => h2.alignment.score - h1.alignment.score);
  const kept: RawHit[] = [];
  for (const h of raw) {
    const dup = kept.find(
      (k2) =>
        k2.strand === h.strand &&
        rangesOverlap(k2.targetStart, k2.targetEnd, h.targetStart, h.targetEnd),
    );
    if (!dup) kept.push(h);
  }

  const top = kept[0].alignment.score;
  const cutoff = top - Math.abs(top) * nearTie;
  const result: SeedHit[] = [];
  for (const h of kept) {
    if (h.alignment.score < cutoff) break;
    result.push({
      strand: h.strand,
      alignment: h.alignment,
      targetStart: h.targetStart,
      targetEnd: h.targetEnd,
      score: h.alignment.score,
    });
    if (result.length >= maxHits) break;
  }
  return result;
}

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

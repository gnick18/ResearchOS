// linear map bot — pure, renderer-free LABEL PACKING for the linear map's
// above-line (enzyme / primer) and below-line (feature) labels.
//
// THE PROBLEM: every label wants to sit centered over its anchor tick (the cut
// position, the primer midpoint, the feature midpoint). When two anchors are
// close, their labels would overlap. SnapGene solves this by (a) nudging a label
// horizontally a little so it still reads as "near" its tick, and (b) when that
// is not enough, lifting it into a higher TIER (a stacked row further from the
// baseline) with a LEADER LINE connecting the label back down to its tick.
//
// This module computes that packing as pure math: given items with an anchor x
// and a measured pixel width, it returns a tier index + a final label-center x
// for each, guaranteeing NO TWO LABELS IN THE SAME TIER OVERLAP. The renderer
// turns (tier, labelX, anchorX) into a <text> + a leader <polyline>.
//
// Kept DOM-free + dependency-free so it is unit-testable in isolation (the
// no-overlap guarantee is the crux of the linear map and is covered thoroughly
// in label-layout.test.ts).

/** One label to place. `id` is opaque (used by the caller to map back). */
export interface LabelItem {
  id: string;
  /** the x (px) of the tick this label belongs to — its ideal center. */
  anchorX: number;
  /** measured rendered width of the label text (px). */
  width: number;
}

/** A placed label: its tier (0 = closest to the baseline) and final center x. */
export interface PlacedLabel {
  id: string;
  anchorX: number;
  width: number;
  /** 0-based tier; higher = further from the baseline. */
  tier: number;
  /** final center x of the label (px); may be nudged off `anchorX`. */
  labelX: number;
}

export interface LabelLayoutOptions {
  /** minimum horizontal gap (px) between two labels in the same tier. */
  gap?: number;
  /** the left edge (px) labels may not cross (e.g. the track's left inset). */
  minX?: number;
  /** the right edge (px) labels may not cross (e.g. the track's right inset). */
  maxX?: number;
  /**
   * how far (px) a label may be nudged horizontally off its anchor before we
   * give up and push it to a higher tier instead. Larger => fewer tiers but
   * labels drift further from their ticks (longer leader lines). SnapGene keeps
   * this modest so labels stay visibly "near" their cut.
   */
  maxNudge?: number;
}

const DEFAULTS = {
  gap: 4,
  maxNudge: 1e9, // effectively "always nudge before stacking" unless overridden
};

/**
 * Pack labels into non-overlapping tiers.
 *
 * Algorithm (greedy, left-to-right by anchor):
 *   1. sort items by anchorX (stable on ties by id) so we always place the
 *      left-most remaining label next;
 *   2. for each item, try tier 0, then 1, then 2, ...; a tier accepts the label
 *      if it can be placed with its center within `maxNudge` of its anchor AND
 *      not overlapping the previous label already in that tier (respecting
 *      `gap`). The accepted center is `max(idealLeftClampedToPrev, anchor)` then
 *      clamped — i.e. shoved just far enough right to clear the previous label,
 *      but never left of its anchor's natural slot;
 *   3. labels are also clamped to [minX, maxX] (the track bounds) by shifting
 *      their center, which can only push a label RIGHT (never causing a new
 *      left-overlap because we place left-to-right).
 *
 * Guarantees: within any returned tier, sorted by labelX, each label's left edge
 * is >= the previous label's right edge + gap (NO OVERLAP). This is the property
 * the unit tests assert exhaustively.
 *
 * Pure + DOM-free.
 */
export function layoutLabels(items: LabelItem[], opts: LabelLayoutOptions = {}): PlacedLabel[] {
  const gap = opts.gap ?? DEFAULTS.gap;
  const maxNudge = opts.maxNudge ?? DEFAULTS.maxNudge;
  const minX = Number.isFinite(opts.minX as number) ? (opts.minX as number) : -Infinity;
  const maxX = Number.isFinite(opts.maxX as number) ? (opts.maxX as number) : Infinity;

  // Stable sort by anchorX, tie-break on id for determinism.
  const sorted = [...items].sort((a, b) => a.anchorX - b.anchorX || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // For each tier, the right edge (px) of the last label placed in it.
  const tierRightEdge: number[] = [];
  const placed: PlacedLabel[] = [];

  for (const item of sorted) {
    const half = item.width / 2;
    // The ideal center, clamped to the track so a label never spills past the
    // ends. Clamping can only move the center toward the interior.
    const idealCenter = clampCenter(item.anchorX, half, minX, maxX);

    let chosenTier = -1;
    let chosenCenter = idealCenter;

    for (let tier = 0; ; tier++) {
      const prevRight = tierRightEdge[tier];
      // The left-most center this label can take in this tier without overlapping
      // the previous label: previous right edge + gap + our half-width.
      const minCenterForTier =
        prevRight === undefined ? -Infinity : prevRight + gap + half;
      // Place at the ideal center, but shoved right if needed to clear the prev.
      let center = Math.max(idealCenter, minCenterForTier);
      // Re-clamp to the track (only matters if the shove pushed us past maxX).
      center = clampCenter(center, half, minX, maxX);

      // Did the track clamp pull us back UNDER the no-overlap floor? Then this
      // tier genuinely cannot hold the label without overlap — try the next.
      const fitsNoOverlap = prevRight === undefined || center - half >= prevRight + gap - 1e-6;
      // Is the label still "near" its anchor (within the nudge budget)?
      const withinNudge = Math.abs(center - idealCenter) <= maxNudge + 1e-6;

      if (fitsNoOverlap && withinNudge) {
        chosenTier = tier;
        chosenCenter = center;
        break;
      }
      // Safety: never loop forever. With enough tiers every label fits in its
      // ideal slot (an empty tier has prevRight === undefined). The loop is thus
      // bounded by the number of items, but guard anyway.
      if (tier > sorted.length + 1) {
        chosenTier = tier;
        chosenCenter = idealCenter;
        break;
      }
    }

    tierRightEdge[chosenTier] = chosenCenter + half;
    placed.push({
      id: item.id,
      anchorX: item.anchorX,
      width: item.width,
      tier: chosenTier,
      labelX: chosenCenter,
    });
  }

  return placed;
}

/** Clamp a label CENTER so the whole label [center-half, center+half] stays in
 *  [minX, maxX]. When the track is narrower than the label, we bias to minX. */
function clampCenter(center: number, half: number, minX: number, maxX: number): number {
  let c = center;
  if (Number.isFinite(minX) && c - half < minX) c = minX + half;
  if (Number.isFinite(maxX) && c + half > maxX) c = maxX - half;
  return c;
}

/** The number of tiers a placement uses (max tier + 1). 0 if empty. */
export function tierCount(placed: PlacedLabel[]): number {
  let max = -1;
  for (const p of placed) if (p.tier > max) max = p.tier;
  return max + 1;
}

/** Above this many stacked above-line label tiers (enzyme cut sites + primers), the
 *  linear map's leaders grow long and the stack reads as an unreadable thicket, so
 *  the editor surfaces a "crowded, hide some or zoom in" advisory. The labels never
 *  overlap (layoutLabels guarantees it) and the canvas grows to fit, so this is a
 *  legibility threshold, not a collision. */
export const CUT_SITE_TIER_LIMIT = 5;
export function cutSiteStackTooDeep(tiers: number): boolean {
  return tiers >= CUT_SITE_TIER_LIMIT;
}

/**
 * Test/verification helper: do any two labels in the SAME tier overlap (ignoring
 * the gap, just geometric overlap)? Returns true if a collision exists. Used by
 * the unit tests to assert the no-overlap guarantee; cheap enough to call in
 * dev assertions too.
 */
export function hasTierOverlap(placed: PlacedLabel[]): boolean {
  const byTier = new Map<number, PlacedLabel[]>();
  for (const p of placed) {
    const arr = byTier.get(p.tier) ?? [];
    arr.push(p);
    byTier.set(p.tier, arr);
  }
  for (const arr of byTier.values()) {
    arr.sort((a, b) => a.labelX - b.labelX);
    for (let i = 1; i < arr.length; i++) {
      const prev = arr[i - 1];
      const cur = arr[i];
      const prevRight = prev.labelX + prev.width / 2;
      const curLeft = cur.labelX - cur.width / 2;
      if (curLeft < prevRight - 1e-6) return true;
    }
  }
  return false;
}

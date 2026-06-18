// linear map bot — pure, renderer-free LABEL PLANNING for the read-only feature
// RIBBON drawn by the note SequenceEmbed (and any other compact linear ribbon).
//
// THE PROBLEM: the embed used to paint every feature name centered ON its bar.
// When a feature is short, or two features sit close together, the inline names
// collide, overlap, and truncate ("CMV enhanc…" jammed against "SV40 pr"). The
// editor's LinearMap already solves the equivalent problem with SnapGene-style
// stacked tiers + leader lines via layoutLabels; this helper brings the same
// behavior to the ribbon, but with one extra step the editor does not need: a
// name that DOES fit inside its own bar stays INLINE (no leader, no tier), and
// only the names that do NOT fit get lifted into external stacked tiers below
// the track with a leader line back to their feature.
//
// Kept DOM-free + dependency-free (it only leans on the already-pure
// layoutLabels) so the inline/external partition + the tier packing are unit
// testable in isolation. The renderer turns (inlineIds, external) into <text>
// for the inline names and <text> + leader <polyline> for the stacked ones.

import { layoutLabels, tierCount, type PlacedLabel } from "./label-layout";

/** One feature bar to label. `id` is opaque (the caller maps it back). */
export interface RibbonLabelInput {
  id: string;
  /** the feature display name. */
  name: string;
  /** the bar's left edge x (px). */
  x0: number;
  /** the bar's right edge x (px). */
  x1: number;
}

export interface RibbonLabelOptions {
  /** label font size (px) — drives the estimated text width. */
  fontPx: number;
  /** padding (px) a label needs INSIDE a bar to count as fitting inline. */
  inlinePad?: number;
  /** minimum horizontal gap (px) between two stacked labels in a tier. */
  gap?: number;
  /** how far (px) a stacked label may nudge off its anchor before it stacks. */
  maxNudge?: number;
  /** the left edge (px) stacked labels may not cross (track inset). */
  minX: number;
  /** the right edge (px) stacked labels may not cross (track inset). */
  maxX: number;
  /**
   * cap (px) on a stacked label's reserved width. A name wider than this is
   * packed (and later rendered) at the cap and ellipsized by the renderer, with
   * the full name on hover. Keeps one very long name from eating a whole tier.
   */
  maxLabelPx?: number;
}

export interface RibbonLabelPlan {
  /** ids of features whose name fits inside their own bar (drawn inline). */
  inlineIds: string[];
  /** external (stacked) labels with tier + final labelX from layoutLabels. */
  external: PlacedLabel[];
  /** how many stacked tiers the external labels use (0 when none). */
  tiers: number;
}

const DEFAULTS = {
  inlinePad: 8,
  gap: 6,
  maxNudge: 10,
  maxLabelPx: 200,
};

/**
 * Estimate a label's pixel width from its text + font size. ~0.58em average
 * advance for the app's UI font at small sizes (matches LinearMap's estimate),
 * floored at 8px so an empty / one-char name still reserves a sliver.
 */
export function estLabelWidth(text: string, fontPx: number): number {
  return Math.max(8, text.length * fontPx * 0.58);
}

/**
 * How many characters of `name` fit in `maxPx` at `fontPx`, leaving room for a
 * trailing ellipsis. Pure; used by the renderer to ellipsize an over-cap label.
 */
export function charsThatFit(name: string, fontPx: number, maxPx: number): number {
  const per = fontPx * 0.58;
  if (per <= 0) return name.length;
  // -1 leaves room for the "…" we append.
  return Math.max(1, Math.floor(maxPx / per) - 1);
}

/**
 * Plan a ribbon's labels.
 *
 * A name whose estimated width + inlinePad fits within its bar stays INLINE.
 * Every other name becomes an external label anchored at its bar's midpoint and
 * packed into collision-free stacked tiers by layoutLabels (the same packer the
 * editor's linear map uses), so stacked labels NEVER overlap. An over-cap name
 * is packed at maxLabelPx (the renderer ellipsizes it).
 *
 * Pure + DOM-free.
 */
export function planRibbonLabels(
  items: RibbonLabelInput[],
  opts: RibbonLabelOptions,
): RibbonLabelPlan {
  const fontPx = opts.fontPx;
  const inlinePad = opts.inlinePad ?? DEFAULTS.inlinePad;
  const gap = opts.gap ?? DEFAULTS.gap;
  const maxNudge = opts.maxNudge ?? DEFAULTS.maxNudge;
  const maxLabelPx = opts.maxLabelPx ?? DEFAULTS.maxLabelPx;

  const inlineIds: string[] = [];
  const externalItems: { id: string; anchorX: number; width: number }[] = [];

  for (const it of items) {
    const barWidth = Math.abs(it.x1 - it.x0);
    const labelWidth = estLabelWidth(it.name || "feature", fontPx);
    if (labelWidth + inlinePad <= barWidth) {
      inlineIds.push(it.id);
      continue;
    }
    externalItems.push({
      id: it.id,
      anchorX: (it.x0 + it.x1) / 2,
      // Reserve the real width, but never more than the cap (over-cap names are
      // ellipsized by the renderer, so packing more would waste a whole tier).
      width: Math.min(labelWidth, maxLabelPx),
    });
  }

  const external = layoutLabels(externalItems, {
    gap,
    maxNudge,
    minX: opts.minX,
    maxX: opts.maxX,
  });

  return { inlineIds, external, tiers: tierCount(external) };
}

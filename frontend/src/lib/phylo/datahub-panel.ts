// Phylo Phase 4: the phylo side of "true Data Hub linking" (tip-aligned plots).
// See docs/proposals/2026-06-13-phylo-phase4-datahub-linking.md.
//
// This is the LANE-SAFE first brick: the pure mapping from the shared TipAxis to
// the alignedAxis the Data Hub renderer will accept (locked with the Data
// optimizer lane: order + per-category design-px positions; the renderer uses
// them for the category band centers instead of self-sorting + even-spacing).
// The renderPlot() call + the datahubPlot AlignedPanel kind land once the Data
// Hub seam is committed; this side does not depend on that and compiles today.
//
// v1 is RECTANGULAR only (the linear seam). Circular rings are a fast-follow
// that needs a polar render mode, so this guards against the circular axis.
//
// HARD INVARIANT: this is LAYOUT ONLY. It decides WHERE a category draws, never
// WHAT it computes; every figure number still comes from the validated engine.
//
// No em-dashes, no emojis.

import type { TipAxis } from "./layout";

/** The contract handed to the Data Hub renderer's optional alignedAxis arg.
 *  `order` is the category (tip) ids in tree-tip order; `positions[i]` is the
 *  category-axis center for `order[i]` in the plot's design-px space; `band` is
 *  the per-tip band thickness (px), so the renderer can size bars without
 *  overlap. */
export interface AlignedAxisInput {
  order: string[];
  positions: number[];
  band: number;
}

/** Build the alignedAxis from a rectangular TipAxis: tip names in tree order,
 *  each tip's y center as its category-axis position (design-px), and the
 *  uniform tip band as the band thickness. Throws on a circular axis (v1 is
 *  rectangular; circular is the documented fast-follow). */
export function tipAxisToAlignedAxis(axis: TipAxis): AlignedAxisInput {
  if (axis.layout !== "rectangular") {
    throw new Error(
      "tipAxisToAlignedAxis: v1 supports rectangular only; circular rings are a fast-follow (polar render mode).",
    );
  }
  return {
    order: axis.tips.map((t) => t.name),
    positions: axis.tips.map((t) => t.y),
    band: axis.bandHeight,
  };
}

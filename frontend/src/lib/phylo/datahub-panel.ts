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
import type { AlignedAxis } from "@/lib/datahub/plot-spec";

// The adapter emits the Data Hub renderer's own `AlignedAxis` type (the seam),
// so it maps 1:1 onto renderPlot(spec, content, analysis, { alignedAxis }). The
// renderer keys category bands on `order` (tip ids) + the matching content row
// labels; tip NAMES are display-only and never used to match (two tips that
// share a display name would collapse). `positions[i]` is the band center for
// `order[i]` in design-px (the tip's y for "rows"); `band` is the per-tip band
// thickness; `length` is the panel's value-axis thickness (px, renderer default
// 120). v1 is "rows" (rectangular).
export type { AlignedAxis } from "@/lib/datahub/plot-spec";

/** Back-compat alias for the pre-seam name; identical to the seam's AlignedAxis. */
export type AlignedAxisInput = AlignedAxis;

/** Build the seam's alignedAxis from a rectangular TipAxis: tip IDS in tree
 *  order (the metadata-matching key, not the display name), each tip's y center
 *  as its band position (design-px), the uniform tip band as the band thickness,
 *  orientation "rows", and an optional panel value-axis `length`. Throws on a
 *  circular axis (v1 is rectangular; circular rings are the documented
 *  fast-follow that needs a polar render mode). */
export function tipAxisToAlignedAxis(
  axis: TipAxis,
  length?: number,
): AlignedAxis {
  if (axis.layout !== "rectangular") {
    throw new Error(
      "tipAxisToAlignedAxis: v1 supports rectangular only; circular rings are a fast-follow (polar render mode).",
    );
  }
  return {
    order: axis.tips.map((t) => String(t.id)),
    positions: axis.tips.map((t) => t.y),
    band: axis.bandHeight,
    orientation: "rows",
    ...(length !== undefined ? { length } : {}),
  };
}

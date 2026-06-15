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
import { matchMetadataToTips, tipColumnMatchRate } from "./layout";
import type { TreeNode } from "./parse";
import type { AlignedAxis } from "@/lib/datahub/plot-spec";
import type { DataHubDocContent } from "@/lib/datahub/model/types";

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

/** Stringify a Data Hub content's rows for the tip matcher, keyed by column id and
 *  tagged with the source row id so the matched tip can be mapped back. */
const JOIN_ROWID_TAG = "__rosSourceRowId";
function rowsForMatch(content: DataHubDocContent): Record<string, string>[] {
  return content.rows.map((r) => {
    const o: Record<string, string> = { [JOIN_ROWID_TAG]: r.id };
    for (const [colId, value] of Object.entries(r.cells)) {
      o[colId] = value == null ? "" : String(value);
    }
    return o;
  });
}

/** Fraction (0..1) of tree tips that join `content` on `joinColumnId` by tip name.
 *  Drives the Studio "matched N of M tips" indicator + the best-column default. */
export function datahubJoinRate(
  content: DataHubDocContent,
  joinColumnId: string,
  tree: TreeNode,
): number {
  return tipColumnMatchRate(tree, rowsForMatch(content), joinColumnId);
}

/**
 * Relabel a Data Hub table's rows so its x-role (label) column carries the matched
 * tree tip IDS, which is the key the alignedAxis `order` matches on. Rows are
 * joined to tips by the values in `joinColumnId` (tip-name match via the shared
 * matchMetadataToTips, so normalized + composite labels resolve); each matched tip
 * contributes one row, a row that joins no tip is dropped. Returns a FRESH content
 * (the source table is never mutated). With no x-role column there is nothing to
 * relabel, so the content is returned unchanged.
 *
 * LAYOUT ONLY: this moves WHERE a row's bars draw (onto its tip), never the values.
 */
export function joinContentToTips(
  content: DataHubDocContent,
  joinColumnId: string,
  tree: TreeNode,
): DataHubDocContent {
  const xCol = content.columns.find((c) => c.role === "x");
  if (!xCol) return content;
  const match = matchMetadataToTips(tree, rowsForMatch(content), joinColumnId);
  const byRowId = new Map(content.rows.map((r) => [r.id, r]));
  const rows = [];
  for (const [tipId, stringRow] of match.matched) {
    const source = byRowId.get(stringRow[JOIN_ROWID_TAG]);
    if (!source) continue;
    rows.push({
      ...source,
      cells: { ...source.cells, [xCol.id]: String(tipId) },
    });
  }
  return { ...content, rows };
}

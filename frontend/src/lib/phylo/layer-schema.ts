// Tree Studio layer schema (Phase 0 of the findability redesign,
// docs/proposals/2026-06-14-phylo-tree-studio-findability-audit.md).
//
// The per-kind inspector logic used to be long `panel.kind === …` chains spread
// through PhyloLayers.tsx, which leaked no-op controls (an sd/sem selector that
// did nothing when an error column was set, a Legend toggle on a boxplot that
// draws no key, a categorical color scale on length-encoded bars/dots) and
// offered every metadata column for every binding regardless of type.
//
// This module is the single declarative source the inspector consults. It is
// pure data + pure functions (no React), so it is unit-tested independently and
// a new layer kind is one set of entries here, not edits across six conditionals.
// Phase 0 changes BEHAVIOR ONLY (which controls/columns show), not layout; the
// `category` / `isRemovable` seam is consumed by a later phase's UI grouping.

import type { AlignedPanel, AlignedPanelKind } from "./types";

/** The three kinds of thing a layer can be (drives later grouping + Smart Add +
 *  removability). Tree elements are intrinsic styling of the tree itself; data
 *  overlays exist only because data was attached; highlights are annotations. */
export type LayerCategory = "tree-element" | "data-overlay" | "highlight";

/** The metadata-column type an inspector field needs. Only the UNAMBIGUOUS
 *  fields are constrained; color bindings stay "any" because categorical AND
 *  continuous both read meaningfully there. */
export type ColumnFilter = "numeric" | "categorical" | "any";

const CATEGORY: Record<AlignedPanelKind, LayerCategory> = {
  // intrinsic tree rendering — you style + show/hide these, never remove them
  labels: "tree-element",
  points: "tree-element",
  support: "tree-element",
  nodepoints: "tree-element",
  // exist only because data was attached
  strip: "data-overlay",
  heat: "data-overlay",
  bars: "data-overlay",
  dots: "data-overlay",
  box: "data-overlay",
  violin: "data-overlay",
  scatter: "data-overlay",
  point: "data-overlay",
  msa: "data-overlay",
  datahubPlot: "data-overlay",
  // annotations drawn onto the tree
  clade: "highlight",
  taxalink: "highlight",
  taxastrip: "highlight",
  nodepie: "highlight",
  noderange: "highlight",
};

export function layerCategory(kind: AlignedPanelKind): LayerCategory {
  return CATEGORY[kind] ?? "data-overlay";
}

/** Tree elements (labels/points/support/nodepoints) are part of the tree — you
 *  show/hide + restyle them but never delete them. Everything else is an added
 *  overlay or annotation and can be removed. (Seam for the later typed-stack UI;
 *  the proposal locks "tree elements are non-removable".) */
export function isRemovableLayer(kind: AlignedPanelKind): boolean {
  return layerCategory(kind) !== "tree-element";
}

/** The metadata-column type a given inspector field on a kind should offer.
 *  Returns "any" for fields where both types read (color-by, strip, heat). */
export function columnFilterFor(
  kind: AlignedPanelKind,
  field: string,
): ColumnFilter {
  if (kind === "points" && field === "sizeColumn") return "numeric"; // size needs a number
  if (kind === "points" && field === "shapeColumn") return "categorical"; // shape needs categories
  if (
    kind === "point" &&
    (field === "column" || field === "errorColumn" || field === "columns")
  )
    return "numeric"; // value + error are magnitudes
  if ((kind === "bars" || kind === "dots") && field === "column")
    return "numeric"; // length encodes a number
  if (
    (kind === "box" || kind === "violin" || kind === "scatter") &&
    field === "columns"
  )
    return "numeric"; // distributions of numbers
  return "any";
}

/** Filter a flat column list to those matching a field's type, always keeping
 *  the currently-bound value even if it no longer matches (never orphan an
 *  existing figure's binding). When classification is unavailable (no metadata
 *  bound yet) every column is offered. */
export function filterColumns(
  columns: string[],
  columnKinds: Record<string, ColumnFilter> | undefined,
  filter: ColumnFilter,
  current?: string,
): string[] {
  if (filter === "any" || !columnKinds || Object.keys(columnKinds).length === 0)
    return columns;
  const keep = columns.filter((c) => {
    if (current && c === current) return true; // never drop the active binding
    const k = columnKinds[c];
    return k === undefined || k === filter; // unclassified columns stay visible
  });
  return keep;
}

/** Whether a kind draws a color legend the Legend toggle actually controls. A
 *  boxplot has no color scale, so its toggle was inert and is removed. */
export function kindDrawsLegend(kind: AlignedPanelKind): boolean {
  return (
    kind === "heat" ||
    kind === "bars" ||
    kind === "dots" ||
    kind === "points" ||
    kind === "strip" ||
    kind === "msa"
  );
}

/** The error-bar control mode for a point+error panel.
 *  - "verbatim":  a value column is set, so the error column is used as-is — the
 *    sd/sem distinction is a no-op, only show/hide matters.
 *  - "replicate": no value column, error is derived from replicate columns, so
 *    sd vs sem IS meaningful. */
export function errorBarControl(panel: AlignedPanel): "verbatim" | "replicate" {
  return panel.column ? "verbatim" : "replicate";
}

/** Whether a kind uses the categorical/continuous Scale select. bars/dots encode
 *  value by LENGTH and only honor a NUMERIC color scale (a categorical scale
 *  falls back to a flat fill — a no-op), so they get a plain "color by value"
 *  toggle instead. points/strip/heat use the full select. */
export function usesScaleKindSelect(kind: AlignedPanelKind): boolean {
  return kind === "points" || kind === "strip" || kind === "heat";
}

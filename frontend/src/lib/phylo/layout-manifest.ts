// Layout manifest — the geometry SEAM for the collision-aware layout advisor.
//
// The renderer (render.ts) draws an SVG string, but the advisor needs to know
// WHERE each collision-relevant element landed (its bounding box) so it can detect
// overlap and, later, compute fixes + previews. Rather than parse the emitted SVG
// (fragile) or recompute the layout (drift), render.ts EMITS this manifest from
// the exact positions it already computes during the draw, via an optional
// out-parameter (renderTreeWithManifest). One source of truth: the boxes are the
// same numbers the SVG was drawn from.
//
// v1 covers the rectangular layout (where the crowding was reported); circular +
// the other layouts can populate the same shape later.
//
// No em-dashes, no emojis, no mid-sentence colons.

/** What a placed box represents, so the collision detector can reason about which
 *  overlaps matter (a legend over a tip label is bad; two branches crossing is the
 *  tree). */
export type PlacedKind =
  | "tipLabel" // one tip's text label
  | "panel" // one aligned overlay column (heat / bars / strip / ...)
  | "legend" // the reserved legend column (right edge)
  | "cladeLabel"; // a clade bracket / highlight label

/** An axis-aligned bounding box of one drawn element, in SVG user units (the same
 *  coordinate space as the rendered figure). */
export interface PlacedBox {
  /** Stable id for dedupe / referencing in a fix (e.g. the panel id). */
  id: string;
  kind: PlacedKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Human label for messages ("MIC", a tip name), when meaningful. */
  label?: string;
}

/** The placed geometry of one rendered figure. */
export interface LayoutManifest {
  width: number;
  height: number;
  /** The usable plot width (right edge of the tree+panels+labels region); the
   *  legend column lives to the right of this. An element extending past plotRight
   *  is overflowing toward / into the legend zone. */
  plotRight: number;
  boxes: PlacedBox[];
}

/** Whether two boxes overlap, and by how much (intersection area in px^2; 0 = no
 *  overlap). Pure geometry, the primitive the detector is built on. */
export function boxOverlapArea(a: PlacedBox, b: PlacedBox): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ix * iy;
}

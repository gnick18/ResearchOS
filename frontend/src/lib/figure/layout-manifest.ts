// Layout manifest — the geometry SEAM for the collision-aware layout advisor,
// now SHARED across every figure surface (phylo trees, Data Hub plots, composer
// panels). A renderer draws an SVG string, but the advisor needs to know WHERE
// each collision-relevant element landed (its bounding box) so it can detect
// overlap and compute fixes + previews. Rather than parse the emitted SVG
// (fragile) or recompute the layout (drift), a surface EMITS this manifest from
// the exact positions it already computes during the draw. One source of truth:
// the boxes are the same numbers the SVG was drawn from.
//
// This file lives under lib/figure (not lib/phylo) so the surface-agnostic
// FigureSource seam can reference it without depending on any one surface. Phylo
// re-exports it from lib/phylo/layout-manifest for back-compat. See
// docs/proposals/2026-06-15-collision-aware-layout-advisor.md (Phase 5).
//
// No em-dashes, no emojis, no mid-sentence colons.

/** What a placed box represents, so the collision detector can reason about which
 *  overlaps matter (a legend over a label is bad; the tree branches crossing is
 *  not). The kinds cover every surface; a source emits only the ones it draws. */
export type PlacedKind =
  | "tipLabel" // phylo: one tip's text label (a crowdable label)
  | "axisLabel" // a category / axis tick label (a crowdable label)
  | "panel" // one aligned overlay column or data panel (heat / bars / strip)
  | "legend" // the legend block (column at the right edge, or a bottom strip)
  | "cladeLabel" // phylo: a clade bracket / highlight label
  | "mark" // a data mark (bar / point / cluster), for legend-over-content
  | "content"; // the plotted data region as a whole, for legend-over-content

/** The label kinds that can crowd each other (vertically or horizontally). */
export function isLabelKind(kind: PlacedKind): boolean {
  return kind === "tipLabel" || kind === "axisLabel";
}

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
  /**
   * Optional rotation (degrees) of the box about its anchor -- the left edge,
   * vertically centered (x, y + h/2) -- matching how a tilted tip label rotates
   * about its baseline anchor. When set (and non-zero), overlap is computed on the
   * true ORIENTED rectangle (SAT), so tilting a long label into a parallel diagonal
   * strip correctly stops it colliding with its neighbor. Absent / 0 = axis-aligned
   * (every existing emitter is unchanged). */
  angle?: number;
}

/** The placed geometry of one rendered figure. */
export interface LayoutManifest {
  width: number;
  height: number;
  /** The usable plot width (right edge of the data + labels region); the legend
   *  column lives to the right of this. An element extending past plotRight is
   *  overflowing toward / into the legend zone. */
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

/** The four corners of a box, rotated by its `angle` about its anchor (the left
 *  edge, vertically centered) -- the pivot a tilted tip label spins around. */
function boxCorners(b: PlacedBox): Array<[number, number]> {
  const pts: Array<[number, number]> = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
  const deg = b.angle ?? 0;
  if (!deg) return pts;
  const a = (deg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const px = b.x;
  const py = b.y + b.h / 2;
  return pts.map(([x, y]) => {
    const dx = x - px;
    const dy = y - py;
    return [px + dx * ca - dy * sa, py + dx * sa + dy * ca];
  });
}

/** Separating-axis test: do two convex quads overlap (touching counts)? */
function quadsOverlap(A: Array<[number, number]>, B: Array<[number, number]>): boolean {
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const nx = -(y2 - y1);
      const ny = x2 - x1;
      let aMin = Infinity;
      let aMax = -Infinity;
      let bMin = Infinity;
      let bMax = -Infinity;
      for (const [x, y] of A) {
        const p = x * nx + y * ny;
        if (p < aMin) aMin = p;
        if (p > aMax) aMax = p;
      }
      for (const [x, y] of B) {
        const p = x * nx + y * ny;
        if (p < bMin) bMin = p;
        if (p > bMax) bMax = p;
      }
      if (aMax < bMin || bMax < aMin) return false; // a separating axis exists
    }
  }
  return true;
}

/** Whether two labels overlap, honoring rotation. With no angle on either, this is
 *  the axis-aligned area test (unchanged); when a label is tilted, it tests the true
 *  oriented rectangles, so parallel diagonal labels no longer count as colliding. */
export function labelsOverlap(a: PlacedBox, b: PlacedBox): boolean {
  if (!a.angle && !b.angle) return boxOverlapArea(a, b) > 0;
  return quadsOverlap(boxCorners(a), boxCorners(b));
}

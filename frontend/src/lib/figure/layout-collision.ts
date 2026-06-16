// Collision detection — the pure, surface-agnostic engine of the collision-aware
// layout advisor. Given a LayoutManifest (emitted by a surface, exact bboxes) it
// finds the overlaps that hurt legibility and proposes the fixes that would
// resolve each. Pure, no DOM, no React, no I/O. The host turns a FixSuggestion
// into a setting change + preview; this module only measures and names.
//
// Phase 5 lifted this out of lib/phylo so Data Hub plots + composer panels reuse
// the same detector. The detection is orientation-neutral: label crowding is
// found among label boxes whether they stack vertically (phylo tip labels) or sit
// in a row (Data Hub axis labels). See
// docs/proposals/2026-06-15-collision-aware-layout-advisor.md.
//
// No em-dashes, no emojis, no mid-sentence colons.

import {
  type LayoutManifest,
  type PlacedBox,
  boxOverlapArea,
  labelsOverlap,
  isLabelKind,
} from "./layout-manifest";

export type CollisionKind =
  | "legend-over-content" // the legend overlaps a label / panel / mark
  | "legend-overflow" // the legend block is taller than the figure (runs off-canvas)
  | "label-crowding" // adjacent labels overlap (vertically or horizontally)
  | "panel-overlap" // two overlay columns overlap horizontally
  | "duplicate-overlay" // one column bound to two overlay panels
  | "content-overflow"; // content stacked off the TOP of the canvas (a lane / tier
// stack that ran out of vertical room, e.g. a dense sequence map whose feature rows
// stack upward until they clip off the figure)

export interface Collision {
  kind: CollisionKind;
  /** The PlacedBox ids involved, for highlighting / referencing in a fix. */
  boxIds: string[];
  /** Rough 0..1 badness (overlap fraction of the smaller box; 1 for redundancy). */
  severity: number;
  message: string;
}

export type FixId =
  | "drop-duplicate-overlay"
  | "shrink-label-font"
  | "increase-canvas-height"
  | "relocate-legend"
  | "increase-column-gap"
  | "tilt-tip-labels";

export interface FixSuggestion {
  id: FixId;
  title: string;
  rationale: string;
  /** Whether the figure-spec toggle this fix needs ALREADY exists. The wand can
   *  only apply available fixes; the rest are build items (see proposal). */
  available: boolean;
}

const area = (b: PlacedBox) => Math.max(0, b.w) * Math.max(0, b.h);

/** Detect the legibility-hurting overlaps in a rendered figure's manifest. */
export function detectCollisions(manifest: LayoutManifest): Collision[] {
  const out: Collision[] = [];
  const boxes = manifest.boxes;
  const legend = boxes.find((b) => b.kind === "legend");
  // Crowdable labels, sorted by (y, x) so consecutive pairs are true neighbors
  // for BOTH a vertical stack (phylo tip labels, same x) and a horizontal row
  // (Data Hub axis labels, same y).
  const labels = boxes
    .filter((b) => isLabelKind(b.kind))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const panels = boxes.filter((b) => b.kind === "panel");

  // 1. Legend over content (the headline crowding): the legend box overlaps any
  // label / panel / mark. Require a real (>2px both ways) intersection, not a
  // sub-pixel touch at the reserved-margin boundary, so a label sitting flush
  // against the legend gap is not a false positive.
  const TOUCH = 2;
  const realOverlap = (a: PlacedBox, b: PlacedBox): boolean => {
    const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return ix > TOUCH && iy > TOUCH;
  };
  if (legend) {
    const covered = boxes.filter(
      (b) => b.kind !== "legend" && realOverlap(legend, b),
    );
    if (covered.length > 0) {
      const worst = Math.max(
        ...covered.map((b) => boxOverlapArea(legend, b) / (area(b) || 1)),
      );
      out.push({
        kind: "legend-over-content",
        boxIds: [legend.id, ...covered.map((b) => b.id)],
        severity: Math.min(1, worst),
        message: `The legend overlaps ${covered.length} element${covered.length === 1 ? "" : "s"} (labels / data).`,
      });
    }
    // 1b. Legend overflow: the legend block is taller than the figure (too many
    // entries), so it runs off the top / bottom edge. Common on a many-category
    // pie / donut, where the legend lives in a reserved column and just gets too
    // long. A small box inside the canvas never trips this.
    const EDGE = 2;
    const overBottom = legend.y + legend.h - manifest.height;
    const overTop = -legend.y;
    if (overBottom > EDGE || overTop > EDGE) {
      const over = Math.max(overBottom, overTop, 0);
      out.push({
        kind: "legend-overflow",
        boxIds: [legend.id],
        severity: Math.min(1, over / (legend.h || 1)),
        message: "The legend is too long to fit and runs off the figure.",
      });
    }
  }

  // 2. Label crowding: neighboring labels (in the (y, x) sort order) whose boxes
  // intersect. Works for a vertical column of tip labels and a horizontal row of
  // axis labels alike.
  for (let i = 1; i < labels.length; i++) {
    const a = labels[i - 1];
    const b = labels[i];
    // labelsOverlap honors rotation: tilted tip labels become parallel diagonal
    // strips that genuinely de-collide, so tilt is a real fix (not just a height
    // shrink). Axis-aligned (untilted) labels fall back to the area test unchanged.
    if (labelsOverlap(a, b)) {
      out.push({
        kind: "label-crowding",
        boxIds: [a.id, b.id],
        severity: Math.min(1, boxOverlapArea(a, b) / (area(b) || 1)),
        message: `Labels ${a.label ?? a.id} and ${b.label ?? b.id} overlap.`,
      });
    }
  }

  // 3. Panel-column overlap: two overlay columns whose x-ranges intersect (gap too
  // small / overflow). Compared on x only, since columns share the data y-band.
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      const a = panels[i];
      const b = panels[j];
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (ix > 0.5) {
        out.push({
          kind: "panel-overlap",
          boxIds: [a.id, b.id],
          severity: Math.min(1, ix / (Math.min(a.w, b.w) || 1)),
          message: `Overlay columns ${a.label ?? a.id} and ${b.label ?? b.id} overlap.`,
        });
      }
    }
  }

  // 4. Duplicate overlay: one column drives two overlay panels (same label). This
  // is the MIC heat + MIC bars redundancy - flagged even if not geometrically
  // overlapping, since it draws the same data twice.
  const byLabel = new Map<string, PlacedBox[]>();
  for (const p of panels) {
    if (!p.label) continue;
    const arr = byLabel.get(p.label) ?? [];
    arr.push(p);
    byLabel.set(p.label, arr);
  }
  for (const [label, group] of byLabel) {
    if (group.length > 1) {
      out.push({
        kind: "duplicate-overlay",
        boxIds: group.map((b) => b.id),
        severity: 1,
        message: `Column ${label} is shown as ${group.length} overlays (redundant).`,
      });
    }
  }

  // 5. Content overflow: an element stacked off the TOP or BOTTOM of the canvas. A
  // lane / tier / label stack ran out of vertical room and clipped (a dense linear
  // map packs feature rows upward off the top; a busy plasmid's de-collided label
  // column runs off both ends). The legend is handled by legend-overflow above, and
  // a `panel` legitimately spans the whole data band to the edges, so both are
  // excluded; every other kind sitting meaningfully past a vertical edge is an
  // unambiguous overflow. Aggregated into one collision listing the clipped ids.
  const OVER = 6;
  const clipped = boxes.filter(
    (b) =>
      b.kind !== "legend" &&
      b.kind !== "panel" &&
      (b.y < -OVER || b.y + b.h > manifest.height + OVER),
  );
  if (clipped.length > 0) {
    const worst = Math.max(
      ...clipped.map((b) => Math.max(-b.y, b.y + b.h - manifest.height)),
    );
    out.push({
      kind: "content-overflow",
      boxIds: clipped.map((b) => b.id),
      severity: Math.min(1, worst / 60),
      message: `${clipped.length} element${clipped.length > 1 ? "s" : ""} run off the edge of the figure.`,
    });
  }

  return out;
}

/** Map a set of collisions to the fixes that would resolve them, de-duplicated.
 *  `available` flags whether the toggle exists yet (see proposal phase 1). */
export function suggestFixes(collisions: Collision[]): FixSuggestion[] {
  const kinds = new Set(collisions.map((c) => c.kind));
  const fixes: FixSuggestion[] = [];
  const add = (f: FixSuggestion) => {
    if (!fixes.some((x) => x.id === f.id)) fixes.push(f);
  };

  if (kinds.has("duplicate-overlay")) {
    add({
      id: "drop-duplicate-overlay",
      title: "Drop the duplicate overlay",
      rationale: "A column is drawn more than once; keep one geom.",
      available: true,
    });
  }
  if (kinds.has("legend-over-content")) {
    add({
      // Neutral title: each surface relocates the legend with its own lever (Data
      // Hub to a right gutter, phylo below the tree), so do not name a direction.
      id: "relocate-legend",
      title: "Move the legend off the data",
      rationale: "The legend overlaps the data / labels.",
      available: true,
    });
    add({
      id: "drop-duplicate-overlay",
      title: "Drop a redundant overlay to free a legend slot",
      rationale: "Fewer overlays means fewer legend keys to place.",
      available: true,
    });
  }
  if (kinds.has("legend-overflow")) {
    add({
      id: "shrink-label-font",
      title: "Shrink the legend to fit",
      rationale: "A smaller font lets every legend entry fit on the figure.",
      available: true,
    });
  }
  if (kinds.has("label-crowding")) {
    add({
      id: "increase-canvas-height",
      title: "Make the figure taller",
      rationale: "More room separates the labels.",
      available: true,
    });
    add({
      id: "shrink-label-font",
      title: "Shrink the label font",
      rationale: "Smaller labels stop colliding.",
      available: true,
    });
    add({
      id: "tilt-tip-labels",
      title: "Tilt the labels",
      rationale: "Angled labels need less room.",
      available: true,
    });
  }
  if (kinds.has("panel-overlap")) {
    add({
      id: "increase-column-gap",
      title: "Increase the spacing between overlay columns",
      rationale: "A wider gap separates the columns.",
      available: true,
    });
  }
  if (kinds.has("content-overflow")) {
    add({
      id: "shrink-label-font",
      title: "Shrink the figure contents to fit",
      rationale: "Smaller elements stack into less height and stop clipping.",
      available: true,
    });
    add({
      id: "increase-canvas-height",
      title: "Make the figure taller",
      rationale: "More height lets the stacked rows fit.",
      available: true,
    });
  }
  return fixes;
}

// Collision detection — the pure engine of the collision-aware layout advisor.
//
// Given a LayoutManifest (emitted by render.ts, exact bboxes) it finds the
// overlaps that hurt legibility and proposes the fixes that would resolve each.
// Pure, no DOM, no React, no I/O - the Phase 4 discipline. The host turns a
// FixSuggestion into a setting change + preview; this module only measures and
// names. See docs/proposals/2026-06-15-collision-aware-layout-advisor.md.
//
// v1 detects the reported crowding: the legend column overdrawing the
// tree/labels, tip labels colliding vertically, panel columns overlapping, and a
// column added as two overlays (redundant). Fix enumeration marks whether the
// underlying figure toggle EXISTS yet (the wand can only move what exists) so the
// build order is honest.
//
// No em-dashes, no emojis, no mid-sentence colons.

import {
  type LayoutManifest,
  type PlacedBox,
  boxOverlapArea,
} from "./layout-manifest";

export type CollisionKind =
  | "legend-over-content" // the legend column overlaps a label / panel
  | "label-crowding" // adjacent tip labels overlap vertically
  | "panel-overlap" // two overlay columns overlap horizontally
  | "duplicate-overlay"; // one column bound to two overlay panels

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
   *  only apply available fixes; the rest are Phase 1 build items (see proposal). */
  available: boolean;
}

const area = (b: PlacedBox) => Math.max(0, b.w) * Math.max(0, b.h);

/** Detect the legibility-hurting overlaps in a rendered figure's manifest. */
export function detectCollisions(manifest: LayoutManifest): Collision[] {
  const out: Collision[] = [];
  const boxes = manifest.boxes;
  const legend = boxes.find((b) => b.kind === "legend");
  const labels = boxes
    .filter((b) => b.kind === "tipLabel")
    .sort((a, b) => a.y - b.y);
  const panels = boxes.filter((b) => b.kind === "panel");

  // 1. Legend over content (the headline crowding): the legend column overlaps any
  // label or panel. Reported once, listing what it covers.
  if (legend) {
    const covered = boxes.filter(
      (b) => b.kind !== "legend" && boxOverlapArea(legend, b) > 0,
    );
    if (covered.length > 0) {
      const worst = Math.max(
        ...covered.map((b) => boxOverlapArea(legend, b) / (area(b) || 1)),
      );
      out.push({
        kind: "legend-over-content",
        boxIds: [legend.id, ...covered.map((b) => b.id)],
        severity: Math.min(1, worst),
        message: `The legend overlaps ${covered.length} element${covered.length === 1 ? "" : "s"} (labels / overlay columns).`,
      });
    }
  }

  // 2. Tip-label crowding: adjacent labels (by y) whose boxes intersect.
  for (let i = 1; i < labels.length; i++) {
    const a = labels[i - 1];
    const b = labels[i];
    const ov = boxOverlapArea(a, b);
    if (ov > 0) {
      out.push({
        kind: "label-crowding",
        boxIds: [a.id, b.id],
        severity: Math.min(1, ov / (area(b) || 1)),
        message: `Tip labels ${a.label ?? a.id} and ${b.label ?? b.id} overlap.`,
      });
    }
  }

  // 3. Panel-column overlap: two overlay columns whose x-ranges intersect (gap too
  // small / overflow). Compared on x only, since columns share the tip y-band.
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      const a = panels[i];
      const b = panels[j];
      const ix =
        Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
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
      id: "relocate-legend",
      title: "Move the legend out of the plot",
      rationale: "The legend column overlaps the tree / labels.",
      available: false,
    });
    add({
      id: "drop-duplicate-overlay",
      title: "Drop a redundant overlay to free a legend slot",
      rationale: "Fewer overlays means fewer legend keys to place.",
      available: true,
    });
  }
  if (kinds.has("label-crowding")) {
    add({
      id: "increase-canvas-height",
      title: "Make the figure taller",
      rationale: "More vertical room separates the tip labels.",
      available: true,
    });
    add({
      id: "shrink-label-font",
      title: "Shrink the tip-label font",
      rationale: "Smaller labels stop colliding.",
      available: true,
    });
    add({
      id: "tilt-tip-labels",
      title: "Tilt the tip labels",
      rationale: "Angled labels need less vertical room.",
      available: false,
    });
  }
  if (kinds.has("panel-overlap")) {
    add({
      id: "increase-column-gap",
      title: "Increase the spacing between overlay columns",
      rationale: "A wider gap separates the columns.",
      available: false,
    });
  }
  return fixes;
}

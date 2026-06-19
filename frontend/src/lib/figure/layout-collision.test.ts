// Shared collision detector: the surface-agnostic behaviors Phase 5 added when
// the engine moved out of lib/phylo. The phylo-specific tests still live in
// lib/phylo/layout-collision.test.ts (real renderTreeWithManifest integration);
// this file proves the generic kinds (axisLabel / mark / content) and the
// orientation-neutral label crowding that Data Hub plots + composer panels need.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import {
  detectCollisions,
  suggestFixes,
  recommendedHeightToClearLabelStack,
} from "./layout-collision";
import {
  boxOverlapArea,
  labelsOverlap,
  isLabelKind,
  type LayoutManifest,
  type PlacedBox,
} from "./layout-manifest";

function manifest(boxes: PlacedBox[]): LayoutManifest {
  const nonLegend = boxes.filter((b) => b.kind !== "legend");
  const plotRight = nonLegend.length
    ? Math.max(...nonLegend.map((b) => b.x + b.w))
    : 100;
  return { width: 430, height: 340, plotRight, boxes };
}

describe("labelsOverlap (oriented strips)", () => {
  const lbl = (x: number, y: number, w: number, h: number, angle?: number): PlacedBox => ({
    id: `${x},${y}`,
    kind: "tipLabel",
    x,
    y,
    w,
    h,
    angle,
  });

  it("falls back to the axis-aligned area test when neither box is tilted", () => {
    // Two wide labels in a row, overlapping horizontally at the same baseline.
    expect(labelsOverlap(lbl(0, 0, 60, 12), lbl(40, 0, 60, 12))).toBe(true);
    expect(labelsOverlap(lbl(0, 0, 60, 12), lbl(80, 0, 60, 12))).toBe(false);
  });

  it("tilting a crowded horizontal row de-collides it (the case tilt is for)", () => {
    // Same overlapping row, now both tilted -45: the wide strips rotate off each
    // other's path and no longer collide.
    const a = lbl(0, 0, 60, 12, -45);
    const b = lbl(40, 0, 60, 12, -45);
    expect(labelsOverlap(lbl(0, 0, 60, 12), lbl(40, 0, 60, 12))).toBe(true); // flat: collide
    expect(labelsOverlap(a, b)).toBe(false); // tilted: clear
  });

  it("does NOT pretend tilt separates a tight vertical stack", () => {
    // Same x, stacked closer than the font height: tilting cannot fix this (the
    // anchors stay put), so it is honestly still flagged.
    const a = lbl(0, 0, 60, 12, -45);
    const b = lbl(0, 6, 60, 12, -45);
    expect(labelsOverlap(a, b)).toBe(true);
  });
});

describe("isLabelKind", () => {
  it("treats tip labels and axis labels as crowdable, others not", () => {
    expect(isLabelKind("tipLabel")).toBe(true);
    expect(isLabelKind("axisLabel")).toBe(true);
    expect(isLabelKind("legend")).toBe(false);
    expect(isLabelKind("panel")).toBe(false);
    expect(isLabelKind("mark")).toBe(false);
  });
});

describe("legend-over-content (generic kinds)", () => {
  it("flags a legend drawn over the data marks (overlay legend inside the frame)", () => {
    const m = manifest([
      // The plotted data region.
      { id: "content", kind: "content", x: 40, y: 20, w: 300, h: 240 },
      // A few bars.
      { id: "mark:0", kind: "mark", x: 60, y: 120, w: 30, h: 120, label: "A" },
      { id: "mark:1", kind: "mark", x: 110, y: 80, w: 30, h: 160, label: "B" },
      // An overlay legend block sitting on top of the bars.
      { id: "legend", kind: "legend", x: 70, y: 100, w: 90, h: 60 },
    ]);
    const cs = detectCollisions(m);
    const hit = cs.find((c) => c.kind === "legend-over-content");
    expect(hit).toBeTruthy();
    expect(hit!.boxIds).toContain("legend");
  });

  it("does NOT flag a legend parked in the right margin, clear of the data", () => {
    const m = manifest([
      { id: "content", kind: "content", x: 40, y: 20, w: 280, h: 240 },
      { id: "mark:0", kind: "mark", x: 60, y: 120, w: 30, h: 120, label: "A" },
      { id: "legend", kind: "legend", x: 340, y: 30, w: 70, h: 120 },
    ]);
    expect(
      detectCollisions(m).some((c) => c.kind === "legend-over-content"),
    ).toBe(false);
  });
});

describe("label-crowding (orientation-neutral)", () => {
  it("flags a horizontal ROW of axis labels that overlap (Data Hub x-axis)", () => {
    // Three category labels along the bottom axis, same y, overlapping in x.
    const m = manifest([
      { id: "axis:0", kind: "axisLabel", x: 50, y: 300, w: 60, h: 12, label: "control" },
      { id: "axis:1", kind: "axisLabel", x: 95, y: 300, w: 60, h: 12, label: "treated" },
      { id: "axis:2", kind: "axisLabel", x: 140, y: 300, w: 60, h: 12, label: "washout" },
    ]);
    const crowd = detectCollisions(m).filter((c) => c.kind === "label-crowding");
    expect(crowd.length).toBeGreaterThan(0);
    // Neighbors in x are the pairs flagged.
    expect(crowd[0].boxIds).toEqual(["axis:0", "axis:1"]);
  });

  it("does NOT flag a horizontal row of axis labels with clear gaps", () => {
    const m = manifest([
      { id: "axis:0", kind: "axisLabel", x: 50, y: 300, w: 40, h: 12, label: "a" },
      { id: "axis:1", kind: "axisLabel", x: 120, y: 300, w: 40, h: 12, label: "b" },
      { id: "axis:2", kind: "axisLabel", x: 190, y: 300, w: 40, h: 12, label: "c" },
    ]);
    expect(
      detectCollisions(m).some((c) => c.kind === "label-crowding"),
    ).toBe(false);
  });

  it("still flags a vertical STACK of tip labels (phylo, via the shared engine)", () => {
    const m = manifest([
      { id: "tip:0", kind: "tipLabel", x: 0, y: 0, w: 30, h: 12, label: "A" },
      { id: "tip:1", kind: "tipLabel", x: 0, y: 8, w: 30, h: 12, label: "B" },
    ]);
    expect(detectCollisions(m).some((c) => c.kind === "label-crowding")).toBe(true);
  });
});

describe("a clean Data-Hub-shaped figure is quiet", () => {
  it("no collisions when legend clears the data and labels have gaps", () => {
    const m = manifest([
      { id: "content", kind: "content", x: 52, y: 34, w: 280, h: 240 },
      { id: "mark:0", kind: "mark", x: 80, y: 150, w: 40, h: 124 },
      { id: "mark:1", kind: "mark", x: 160, y: 110, w: 40, h: 164 },
      { id: "axis:0", kind: "axisLabel", x: 70, y: 280, w: 40, h: 12, label: "a" },
      { id: "axis:1", kind: "axisLabel", x: 150, y: 280, w: 40, h: 12, label: "b" },
      { id: "legend", kind: "legend", x: 350, y: 40, w: 70, h: 60 },
    ]);
    expect(detectCollisions(m)).toEqual([]);
  });
});

describe("legend-overflow (legend taller than the figure)", () => {
  it("flags a legend block that runs off the bottom of the canvas", () => {
    // A many-entry legend, taller than the 340 canvas (y+h = 366 > 340).
    const m = manifest([
      { id: "legend", kind: "legend", x: 300, y: 6, w: 120, h: 360 },
    ]);
    expect(detectCollisions(m).some((c) => c.kind === "legend-overflow")).toBe(true);
  });

  it("does NOT flag a small legend that fits inside the canvas", () => {
    const m = manifest([
      { id: "legend", kind: "legend", x: 300, y: 40, w: 70, h: 60 },
      { id: "mark", kind: "mark", x: 60, y: 120, w: 30, h: 60 },
    ]);
    expect(detectCollisions(m).some((c) => c.kind === "legend-overflow")).toBe(false);
  });
});

describe("suggestFixes is shared", () => {
  it("offers relocate-legend for a legend-over-content collision", () => {
    const fixes = suggestFixes([
      { kind: "legend-over-content", boxIds: ["legend"], severity: 0.5, message: "" },
    ]);
    expect(fixes.find((f) => f.id === "relocate-legend")?.available).toBe(true);
  });

  it("offers shrink-label-font (shrink to fit) for a legend-overflow collision", () => {
    const fixes = suggestFixes([
      { kind: "legend-overflow", boxIds: ["legend"], severity: 0.5, message: "" },
    ]);
    const fit = fixes.find((f) => f.id === "shrink-label-font");
    expect(fit?.available).toBe(true);
    expect(fit?.title).toBe("Shrink the legend to fit");
  });

  it("boxOverlapArea is re-exported and pure", () => {
    const a: PlacedBox = { id: "a", kind: "mark", x: 0, y: 0, w: 10, h: 10 };
    const b: PlacedBox = { id: "b", kind: "mark", x: 5, y: 5, w: 10, h: 10 };
    expect(boxOverlapArea(a, b)).toBe(25);
  });
});

describe("recommendedHeightToClearLabelStack", () => {
  /** A vertical stack of n label boxes, height h each, pitch px apart, in a figure
   *  of the given total height. */
  function stack(n: number, h: number, pitch: number, figH: number): LayoutManifest {
    const boxes: PlacedBox[] = Array.from({ length: n }, (_, i) => ({
      id: `tip:${i}`,
      kind: "tipLabel" as const,
      x: 0,
      y: i * pitch,
      w: 40,
      h,
      label: `T${i}`,
    }));
    return { width: 620, height: figH, plotRight: 40, boxes };
  }

  it("leaves a roomy stack unchanged (pitch already clears the labels)", () => {
    // 12px labels, 20px apart: no crowding, so no growth.
    const m = stack(10, 12, 20, 460);
    expect(recommendedHeightToClearLabelStack(m)).toBe(460);
  });

  it("grows a crowded stack so the new pitch clears the label height", () => {
    // 12px labels only 5px apart -> crowded. The recommended height must lift the
    // pitch to at least the label height (with breathing room).
    const figH = 460;
    const m = stack(90, 12, 5, figH);
    const taller = recommendedHeightToClearLabelStack(m);
    expect(taller).toBeGreaterThan(figH);
    // After scaling the figure to `taller`, the pitch scales by the same factor and
    // must now exceed the 12px label height, so adjacent labels separate.
    const newPitch = 5 * (taller / figH);
    expect(newPitch).toBeGreaterThanOrEqual(12);
  });

  it("ignores a horizontal row (a taller figure does not separate it)", () => {
    // Same y (an axis row), so no vertical pitch to grow.
    const boxes: PlacedBox[] = Array.from({ length: 6 }, (_, i) => ({
      id: `ax:${i}`,
      kind: "axisLabel" as const,
      x: i * 4,
      y: 300,
      w: 30,
      h: 12,
    }));
    const m: LayoutManifest = { width: 430, height: 340, plotRight: 124, boxes };
    expect(recommendedHeightToClearLabelStack(m)).toBe(340);
  });

  it("returns the current height when there is nothing to separate", () => {
    const m: LayoutManifest = { width: 430, height: 340, plotRight: 100, boxes: [] };
    expect(recommendedHeightToClearLabelStack(m)).toBe(340);
  });
});

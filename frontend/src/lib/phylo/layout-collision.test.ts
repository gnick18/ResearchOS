// Collision-aware layout advisor: the pure detector + the manifest the renderer
// emits. Unit tests drive detectCollisions/suggestFixes off hand-built manifests
// (deterministic geometry), plus one integration test that renderTreeWithManifest
// produces a real manifest from a rendered figure.

import { describe, it, expect } from "vitest";
import { parseNewick } from "./parse";
import { matchMetadataToTips } from "./layout";
import { renderTreeWithManifest, type RenderSpec } from "./render";
import {
  detectCollisions,
  suggestFixes,
} from "./layout-collision";
import { boxOverlapArea, type LayoutManifest, type PlacedBox } from "./layout-manifest";

function manifest(boxes: PlacedBox[]): LayoutManifest {
  const nonLegend = boxes.filter((b) => b.kind !== "legend");
  const plotRight = nonLegend.length
    ? Math.max(...nonLegend.map((b) => b.x + b.w))
    : 100;
  return { width: 200, height: 200, plotRight, boxes };
}

describe("boxOverlapArea", () => {
  it("is the intersection area, 0 when disjoint", () => {
    const a = { id: "a", kind: "panel" as const, x: 0, y: 0, w: 10, h: 10 };
    const b = { id: "b", kind: "panel" as const, x: 5, y: 5, w: 10, h: 10 };
    expect(boxOverlapArea(a, b)).toBe(25);
    const far = { id: "c", kind: "panel" as const, x: 50, y: 50, w: 10, h: 10 };
    expect(boxOverlapArea(a, far)).toBe(0);
  });
});

describe("detectCollisions", () => {
  it("flags the legend overlapping content", () => {
    const m = manifest([
      { id: "tipLabel:1", kind: "tipLabel", x: 90, y: 10, w: 40, h: 12, label: "A" },
      { id: "legend", kind: "legend", x: 100, y: 0, w: 60, h: 200 },
    ]);
    const cs = detectCollisions(m);
    expect(cs.some((c) => c.kind === "legend-over-content")).toBe(true);
  });

  it("does NOT flag a legend that clears the content", () => {
    const m = manifest([
      { id: "tipLabel:1", kind: "tipLabel", x: 10, y: 10, w: 40, h: 12, label: "A" },
      { id: "legend", kind: "legend", x: 120, y: 0, w: 60, h: 200 },
    ]);
    expect(detectCollisions(m).some((c) => c.kind === "legend-over-content")).toBe(
      false,
    );
  });

  it("flags vertically crowded tip labels", () => {
    const m = manifest([
      { id: "tipLabel:1", kind: "tipLabel", x: 0, y: 0, w: 30, h: 12, label: "A" },
      { id: "tipLabel:2", kind: "tipLabel", x: 0, y: 8, w: 30, h: 12, label: "B" },
    ]);
    expect(detectCollisions(m).some((c) => c.kind === "label-crowding")).toBe(true);
  });

  it("flags one column shown as two overlays (duplicate)", () => {
    const m = manifest([
      { id: "p1", kind: "panel", x: 0, y: 0, w: 10, h: 50, label: "MIC" },
      { id: "p2", kind: "panel", x: 20, y: 0, w: 10, h: 50, label: "MIC" },
    ]);
    const dup = detectCollisions(m).find((c) => c.kind === "duplicate-overlay");
    expect(dup).toBeTruthy();
    expect(dup!.boxIds).toEqual(["p1", "p2"]);
  });

  it("a clean figure has no collisions", () => {
    const m = manifest([
      { id: "p1", kind: "panel", x: 0, y: 0, w: 10, h: 50, label: "MIC" },
      { id: "tipLabel:1", kind: "tipLabel", x: 20, y: 0, w: 30, h: 12, label: "A" },
      { id: "tipLabel:2", kind: "tipLabel", x: 20, y: 30, w: 30, h: 12, label: "B" },
    ]);
    expect(detectCollisions(m)).toEqual([]);
  });
});

describe("suggestFixes", () => {
  it("offers drop-duplicate (available) for a duplicate overlay", () => {
    const fixes = suggestFixes([
      { kind: "duplicate-overlay", boxIds: ["p1", "p2"], severity: 1, message: "" },
    ]);
    const drop = fixes.find((f) => f.id === "drop-duplicate-overlay");
    expect(drop?.available).toBe(true);
  });

  it("all Phase 1 toggles now exist, so their fixes are available", () => {
    const fixes = suggestFixes([
      { kind: "label-crowding", boxIds: [], severity: 1, message: "" },
      { kind: "panel-overlap", boxIds: [], severity: 1, message: "" },
      { kind: "legend-over-content", boxIds: [], severity: 1, message: "" },
    ]);
    // column spacing, tilt labels, and move-legend all shipped in Phase 1.
    expect(fixes.find((f) => f.id === "tilt-tip-labels")?.available).toBe(true);
    expect(fixes.find((f) => f.id === "increase-column-gap")?.available).toBe(true);
    expect(fixes.find((f) => f.id === "relocate-legend")?.available).toBe(true);
    expect(fixes.find((f) => f.id === "shrink-label-font")?.available).toBe(true);
    // every offered fix is now applicable (no unbuilt toggles remain)
    expect(fixes.every((f) => f.available)).toBe(true);
  });
});

describe("renderTreeWithManifest (integration)", () => {
  const TREE = parseNewick("((A:0.1,B:0.1):0.2,(C:0.1,D:0.1):0.2);");
  const META = matchMetadataToTips(
    TREE,
    [
      { tip: "A", mic: "2" },
      { tip: "B", mic: "4" },
      { tip: "C", mic: "1" },
      { tip: "D", mic: "8" },
    ],
    "tip",
  ).matched;

  it("emits tip-label + panel + legend boxes from a real render", () => {
    const spec: RenderSpec = {
      layout: "rectangular",
      phylogram: false,
      tracks: {
        labels: true,
        labelsItalic: false,
        points: false,
        strip: false,
        bars: false,
        heat: false,
        clade: false,
        support: false,
      },
      columns: {},
      width: 600,
      height: 360,
      metadata: META,
      panels: [
        { id: "labels", kind: "labels", visible: true },
        { id: "bars", kind: "bars", visible: true, column: "mic", legend: true },
      ],
    };
    const { svg, manifest: m } = renderTreeWithManifest(TREE, spec);
    expect(svg).toContain("viewBox");
    expect(m.boxes.some((b) => b.kind === "tipLabel")).toBe(true);
    expect(m.boxes.some((b) => b.kind === "panel")).toBe(true);
    expect(m.boxes.some((b) => b.kind === "legend")).toBe(true);
    // 4 tips -> 4 tip-label boxes.
    expect(m.boxes.filter((b) => b.kind === "tipLabel")).toHaveLength(4);
    // The detector runs without throwing on a real manifest.
    expect(Array.isArray(detectCollisions(m))).toBe(true);
  });

  it("columnGap widens the spacing between overlay columns", () => {
    const base: RenderSpec = {
      layout: "rectangular",
      phylogram: false,
      tracks: {
        labels: false,
        labelsItalic: false,
        points: false,
        strip: false,
        bars: false,
        heat: false,
        clade: false,
        support: false,
      },
      columns: {},
      width: 600,
      height: 360,
      metadata: META,
      panels: [
        { id: "bars", kind: "bars", visible: true, column: "mic" },
        { id: "dots", kind: "dots", visible: true, column: "mic" },
      ],
    };
    // The inter-column delta = first column width + gap (absolute x shifts because
    // a bigger gap enlarges the reserved room and compresses the tree).
    const interColumnGap = (spec: RenderSpec) => {
      const cols = renderTreeWithManifest(TREE, spec).manifest.boxes.filter(
        (b) => b.kind === "panel",
      );
      return cols[1].x - cols[0].x;
    };
    const tight = interColumnGap({ ...base, columnGap: 4 });
    const wide = interColumnGap({ ...base, columnGap: 30 });
    // A larger columnGap widens the space between the two columns by ~the delta.
    expect(wide).toBeGreaterThan(tight);
    expect(wide - tight).toBeCloseTo(26, 0); // 30 - 4
  });

  it("tilting tip labels rotates them and carries the tilt as a box angle", () => {
    const mk = (tilt: number): RenderSpec => ({
      layout: "rectangular",
      phylogram: false,
      tracks: {
        labels: false,
        labelsItalic: false,
        points: false,
        strip: false,
        bars: false,
        heat: false,
        clade: false,
        support: false,
      },
      columns: {},
      width: 600,
      height: 360,
      metadata: META,
      panels: [
        { id: "labels", kind: "labels", visible: true, options: { tilt } },
      ],
    });
    const flat = renderTreeWithManifest(TREE, mk(0));
    const tilted = renderTreeWithManifest(TREE, mk(45));
    // The rendered labels carry a rotate() transform only when tilted.
    expect(flat.svg).not.toContain("rotate(45");
    expect(tilted.svg).toContain("rotate(45");
    // The manifest carries the tilt as the box ANGLE (a real rotation for oriented
    // overlap), not as a narrowed width -- the ink width + height are unchanged.
    const box = (r: typeof flat) => r.manifest.boxes.find((b) => b.kind === "tipLabel")!;
    expect(box(flat).angle ?? 0).toBe(0);
    expect(box(tilted).angle).toBe(45);
    expect(box(tilted).w).toBeCloseTo(box(flat).w, 5);
    expect(box(tilted).h).toBeCloseTo(box(flat).h, 5);
  });

  it("legendPlacement 'bottom' moves the legend below the figure, freeing the right edge", () => {
    const base: RenderSpec = {
      layout: "rectangular",
      phylogram: false,
      tracks: {
        labels: false,
        labelsItalic: false,
        points: false,
        strip: false,
        bars: false,
        heat: false,
        clade: false,
        support: false,
      },
      columns: {},
      width: 600,
      height: 360,
      metadata: META,
      panels: [
        { id: "labels", kind: "labels", visible: true },
        { id: "bars", kind: "bars", visible: true, column: "mic", legend: true },
      ],
    };
    const right = renderTreeWithManifest(TREE, base);
    const bottom = renderTreeWithManifest(TREE, {
      ...base,
      legendPlacement: "bottom",
    });
    const legendOf = (r: typeof right) =>
      r.manifest.boxes.find((b) => b.kind === "legend")!;
    // Right legend sits at the right edge (x near full width); bottom legend sits
    // low (y in the lower part of the canvas) and spans the full width.
    expect(legendOf(right).x).toBeGreaterThan(300);
    expect(legendOf(bottom).x).toBe(0);
    expect(legendOf(bottom).y).toBeGreaterThan(200);
    expect(legendOf(bottom).w).toBe(600);
    // Bottom placement frees the right edge, so the tree+labels region (plotRight)
    // extends further right than with the reserved right column.
    expect(bottom.manifest.plotRight).toBeGreaterThan(right.manifest.plotRight);
  });
});

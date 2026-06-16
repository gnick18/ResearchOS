// Data Hub collision manifest: plotLayoutManifest turns a laid-out grouped-bar
// geometry into the shared advisor manifest. The key guard is the drift check:
// the legend box this emits must match where renderGroupedBarSvg actually draws
// the legend swatch (the false-positive class the phylo advisor hit). Plus the
// shared detector flags a legend piled on tall bars and stays quiet otherwise.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { plotLayoutManifest } from "./plot-manifest";
import {
  renderGroupedBarSvg,
  GROUPED_LEGEND,
  type GroupedBarGeometry,
  type SurvivalCurveGeometry,
  type PlotStyle,
} from "./plot-spec";
import type { PartsOfWholeGeometry } from "./parts-of-whole-plot";
import { detectCollisions } from "@/lib/figure/layout-collision";

// Only the fields plotLayoutManifest + renderGroupedBarSvg read; the rest of
// PlotStyle is irrelevant to legend / label / bar geometry.
const style = { fontSize: 11, title: "", yTitle: "", xTitle: "" } as PlotStyle;

/** A grouped bar with a legend top-right. y1 is the plot-area top, y0 the bottom. */
function geo(opts: { tallTopRightBar: boolean }): GroupedBarGeometry {
  // A bar under the legend zone (x near x1, reaching up toward y1) only when tall.
  const topRightBar = opts.tallTopRightBar
    ? { x: 250, y: 30, width: 24, height: 180, color: "#1d4ed8", error: null }
    : { x: 250, y: 190, width: 24, height: 20, color: "#1d4ed8", error: null };
  return {
    width: 430,
    height: 340,
    x0: 52,
    x1: 320,
    y0: 280, // bottom axis
    y1: 28, // top
    yMax: 100,
    ticks: [],
    xLabelAngle: 0,
    clusters: [
      {
        label: "control",
        labelX: 120,
        bars: [
          { x: 100, y: 120, width: 24, height: 160, color: "#94a3b8", error: null },
        ],
      },
      {
        label: "treated",
        labelX: 250,
        bars: [topRightBar],
      },
    ],
    legend: [
      { name: "series one", color: "#1d4ed8" },
      { name: "series two", color: "#f59e0b" },
    ],
  };
}

describe("plotLayoutManifest (grouped bar)", () => {
  it("emits bar marks, axis labels, and one legend box", () => {
    const m = plotLayoutManifest(geo({ tallTopRightBar: false }), style);
    expect(m.boxes.filter((b) => b.kind === "mark").length).toBe(2);
    expect(m.boxes.filter((b) => b.kind === "axisLabel").length).toBe(2);
    expect(m.boxes.filter((b) => b.kind === "legend").length).toBe(1);
    expect(m.plotRight).toBe(320);
  });

  it("places the legend box where the serializer draws it (no drift)", () => {
    const g = geo({ tallTopRightBar: false });
    const m = plotLayoutManifest(g, style);
    const legend = m.boxes.find((b) => b.kind === "legend")!;
    // The manifest legend left edge equals the swatch x in the rendered SVG.
    const svg = renderGroupedBarSvg(g, style);
    const swatch = svg.match(/data-series="0" x="([0-9.]+)"/);
    expect(swatch).toBeTruthy();
    expect(Number(swatch![1])).toBe(legend.x);
    expect(legend.x).toBe(g.x1 - GROUPED_LEGEND.swatchInsetFromX1);
    expect(legend.y).toBe(g.y1 + GROUPED_LEGEND.topPad);
    expect(legend.h).toBe(g.legend.length * GROUPED_LEGEND.rowH);
  });
});

describe("detectCollisions on a Data Hub grouped bar", () => {
  it("flags legend-over-content when a tall bar reaches the top-right legend", () => {
    const m = plotLayoutManifest(geo({ tallTopRightBar: true }), style);
    expect(
      detectCollisions(m).some((c) => c.kind === "legend-over-content"),
    ).toBe(true);
  });

  it("stays quiet when the bars clear the legend zone", () => {
    const m = plotLayoutManifest(geo({ tallTopRightBar: false }), style);
    expect(
      detectCollisions(m).some((c) => c.kind === "legend-over-content"),
    ).toBe(false);
  });

  it("legendPlacement 'right' moves the legend into the gutter, clearing the bars", () => {
    const g = geo({ tallTopRightBar: true });
    const right = { ...style, legendPlacement: "right" as const };
    const m = plotLayoutManifest(g, right);
    const legend = m.boxes.find((b) => b.kind === "legend")!;
    // The legend box now sits past the plot edge (to the right of every bar), so
    // the relocate-legend fix resolves the collision the overlay had.
    expect(legend.x).toBe(g.x1 + GROUPED_LEGEND.gutterPad);
    expect(
      detectCollisions(m).some((c) => c.kind === "legend-over-content"),
    ).toBe(false);
  });
});

// Two long level names centered close together, so their flat boxes overlap.
function crowdedGeo(xLabelAngle: number): GroupedBarGeometry {
  return {
    width: 430,
    height: 340,
    x0: 52,
    x1: 320,
    y0: 280,
    y1: 28,
    yMax: 100,
    ticks: [],
    xLabelAngle,
    clusters: [
      {
        label: "vehicle control 24h",
        labelX: 120,
        bars: [{ x: 100, y: 120, width: 24, height: 160, color: "#94a3b8", error: null }],
      },
      {
        label: "treated cohort 24h",
        labelX: 200,
        bars: [{ x: 188, y: 120, width: 24, height: 160, color: "#1d4ed8", error: null }],
      },
    ],
    legend: [],
  };
}

describe("plotLayoutManifest (x-label crowding + tilt)", () => {
  it("flags label-crowding when long flat labels overlap", () => {
    const m = plotLayoutManifest(crowdedGeo(0), style);
    expect(m.boxes.filter((b) => b.kind === "axisLabel").length).toBe(2);
    expect(detectCollisions(m).some((c) => c.kind === "label-crowding")).toBe(true);
  });

  it("tilting the labels drops the axis-label boxes, clearing the crowding", () => {
    const m = plotLayoutManifest(crowdedGeo(-40), style);
    // Angled labels run diagonally and no longer collide, so none are emitted.
    expect(m.boxes.some((b) => b.kind === "axisLabel")).toBe(false);
    expect(detectCollisions(m).some((c) => c.kind === "label-crowding")).toBe(false);
  });
});

// A survival figure with a high-staying (slow-decline) curve whose flat right
// segment passes under the top-right legend. y1 is the plot-area top.
function survGeo(): SurvivalCurveGeometry {
  return {
    width: 430,
    height: 340,
    x0: 52,
    x1: 320,
    y0: 280, // survival 0 (bottom)
    y1: 28, // survival 1 (top)
    tMax: 10,
    xTicks: [],
    yTicks: [],
    curves: [
      {
        name: "Arm A",
        color: "#1d4ed8",
        median: null,
        // Drops a little then runs flat at y=45 across the right half (under the
        // legend, which sits at y 32..58 for two arms).
        path: [
          { x: 52, y: 30 },
          { x: 200, y: 45 },
          { x: 320, y: 45 },
        ],
      },
      {
        name: "Arm B",
        color: "#f59e0b",
        median: null,
        // Drops low quickly, clear of the legend zone.
        path: [
          { x: 52, y: 30 },
          { x: 120, y: 220 },
          { x: 320, y: 220 },
        ],
      },
    ],
    legend: [
      { name: "Arm A", color: "#1d4ed8" },
      { name: "Arm B", color: "#f59e0b" },
    ],
  };
}

describe("plotLayoutManifest (survival curve)", () => {
  it("emits curve-segment marks + one legend box", () => {
    const m = plotLayoutManifest(survGeo(), style);
    expect(m.boxes.some((b) => b.kind === "mark")).toBe(true);
    expect(m.boxes.filter((b) => b.kind === "legend")).toHaveLength(1);
  });

  it("flags legend-over-content when a high curve runs under the legend", () => {
    const m = plotLayoutManifest(survGeo(), style);
    expect(
      detectCollisions(m).some((c) => c.kind === "legend-over-content"),
    ).toBe(true);
  });

  it("legendPlacement 'right' moves the legend off the curves", () => {
    const m = plotLayoutManifest(survGeo(), {
      ...style,
      legendPlacement: "right" as const,
    });
    expect(
      detectCollisions(m).some((c) => c.kind === "legend-over-content"),
    ).toBe(false);
  });
});

/** A pie with n equal categories, so n drives how tall the right-column legend is. */
function partsGeo(n: number): PartsOfWholeGeometry {
  const segments = Array.from({ length: n }, (_, i) => ({
    index: i,
    label: `Category ${i + 1}`,
    value: 1,
    fraction: 1 / n,
    percent: 100 / n,
    color: "#888888",
  }));
  return {
    kind: "pie",
    width: 430,
    height: 340,
    segments,
    total: n,
    cx: 140,
    cy: 170,
    radius: 100,
    innerRadius: 0,
    bar: { x: 0, y: 0, width: 0, height: 0 },
    emptyMessage: null,
  };
}

describe("plotLayoutManifest (parts of whole)", () => {
  it("flags legend-overflow when a many-category legend runs off the figure", () => {
    const m = plotLayoutManifest(partsGeo(20), style);
    expect(detectCollisions(m).some((c) => c.kind === "legend-overflow")).toBe(true);
  });

  it("stays quiet when the legend fits on the figure", () => {
    const m = plotLayoutManifest(partsGeo(4), style);
    expect(detectCollisions(m).some((c) => c.kind === "legend-overflow")).toBe(false);
  });
});

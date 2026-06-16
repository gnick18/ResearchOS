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
  type PlotStyle,
} from "./plot-spec";
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

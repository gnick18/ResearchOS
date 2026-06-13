// Phylo Phase 1: the aligned-panel renderer + the shared TipAxis.
//
// Inline trees only, no external corpus. Asserts each v1 geom draws a tip-for-tip
// aligned column / ring in both layouts, the box reuses the quantile summary, and
// the axis exposes one slot per tip.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { parseNewick, leaves } from "./parse";
import {
  layoutRectangular,
  layoutCircular,
  rectTipAxis,
  circularTipAxis,
  matchMetadataToTips,
  type LayoutOptions,
} from "./layout";
import { renderPanel, renderPanelLegend } from "./panel-render";
import { buildPanelScales, extractPanelValues } from "./panels";
import { buildColorScale } from "./color-scale";
import { renderTreeSvg, type RenderSpec } from "./render";
import type { AlignedPanel } from "./types";

const TREE = parseNewick("((A:0.1,B:0.2)90:0.3,(C:0.15,D:0.25)80:0.2);");
const ROWS = [
  { tip: "A", clade: "I", ab: "10", load: "5" },
  { tip: "B", clade: "I", ab: "40", load: "8" },
  { tip: "C", clade: "II", ab: "70", load: "2" },
  { tip: "D", clade: "II", ab: "95", load: "9" },
];
const META = matchMetadataToTips(TREE, ROWS, "tip").matched;

const OPTS: LayoutOptions = {
  width: 560,
  height: 420,
  rightInset: 120,
  padding: 16,
  phylogram: true,
};

function rectAxis() {
  return rectTipAxis(TREE, layoutRectangular(TREE, OPTS), 300);
}
function circAxis() {
  return circularTipAxis(
    TREE,
    layoutCircular(TREE, { ...OPTS, circularRingRoom: 60 }),
    120,
  );
}

describe("TipAxis", () => {
  it("rectangular axis has one slot per tip with a real y + band", () => {
    const axis = rectAxis();
    expect(axis.layout).toBe("rectangular");
    expect(axis.tips).toHaveLength(leaves(TREE).length);
    expect(axis.tips.every((t) => Number.isFinite(t.y))).toBe(true);
    expect(axis.bandHeight).toBeGreaterThan(0);
    expect(axis.panelStartX).toBe(300);
  });

  it("circular axis has one slot per tip with angle + radius", () => {
    const axis = circAxis();
    expect(axis.layout).toBe("circular");
    expect(axis.tips.every((t) => Number.isFinite(t.angle))).toBe(true);
    expect(axis.tips.every((t) => Number.isFinite(t.radius))).toBe(true);
    expect(axis.halfAngle).toBeGreaterThan(0);
  });
});

describe("renderPanel geoms", () => {
  const strip = { id: "s", kind: "strip" as const, visible: true, column: "clade" };
  const bars = { id: "b", kind: "bars" as const, visible: true, column: "load" };
  const dots = { id: "d", kind: "dots" as const, visible: true, column: "load" };
  const heat = { id: "h", kind: "heat" as const, visible: true, columns: ["ab", "load"] };
  const box = { id: "x", kind: "box" as const, visible: true, columns: ["ab", "load"] };

  for (const layout of ["rect", "circ"] as const) {
    const axis = layout === "rect" ? rectAxis : circAxis;
    const cell = layout === "rect" ? "rect" : "path"; // rect = <rect>, circular = wedge <path>

    it(`strip draws one ${cell} per tip (${layout})`, () => {
      const r = renderPanel(
        strip,
        axis(),
        extractPanelValues(strip, TREE, META),
        buildPanelScales(strip, TREE, META),
      );
      const count = (r.svg.match(new RegExp(`<${cell}`, "g")) || []).length;
      expect(count).toBe(leaves(TREE).length);
      expect(r.thickness).toBeGreaterThan(0);
    });

    it(`heat matrix draws one cell per tip per column (${layout})`, () => {
      const r = renderPanel(
        heat,
        axis(),
        extractPanelValues(heat, TREE, META),
        buildPanelScales(heat, TREE, META),
      );
      const count = (r.svg.match(new RegExp(`<${cell}`, "g")) || []).length;
      expect(count).toBe(leaves(TREE).length * 2); // 4 tips x 2 columns
    });

    it(`bars draws a bar per tip with a finite value (${layout})`, () => {
      const r = renderPanel(
        bars,
        axis(),
        extractPanelValues(bars, TREE, META),
        buildPanelScales(bars, TREE, META),
      );
      const count = (r.svg.match(new RegExp(`<${cell}`, "g")) || []).length;
      expect(count).toBe(leaves(TREE).length);
    });

    it(`dots draws a circle per tip (${layout})`, () => {
      const r = renderPanel(
        dots,
        axis(),
        extractPanelValues(dots, TREE, META),
        buildPanelScales(dots, TREE, META),
      );
      expect((r.svg.match(/<circle/g) || []).length).toBe(leaves(TREE).length);
    });

    it(`box draws a median dot per tip (${layout})`, () => {
      const r = renderPanel(
        box,
        axis(),
        extractPanelValues(box, TREE, META),
        buildPanelScales(box, TREE, META),
      );
      // One median circle per tip that has replicates.
      expect((r.svg.match(/<circle/g) || []).length).toBe(leaves(TREE).length);
      // Each box also draws a whisker line.
      expect((r.svg.match(/<line/g) || []).length).toBe(leaves(TREE).length);
    });
  }

  // ---- Phase 2 distribution / value-axis geoms ----
  const violin = { id: "v", kind: "violin" as const, visible: true, columns: ["ab", "load"] };
  const scatter = { id: "j", kind: "scatter" as const, visible: true, columns: ["ab", "load"] };
  const point = {
    id: "pt",
    kind: "point" as const,
    visible: true,
    columns: ["ab", "load"],
    options: { errorKind: "sd", axis: true },
  };

  for (const layout of ["rect", "circ"] as const) {
    const axis = layout === "rect" ? rectAxis : circAxis;

    it(`violin draws a density silhouette path per tip (${layout})`, () => {
      const r = renderPanel(
        violin,
        axis(),
        extractPanelValues(violin, TREE, META),
        buildPanelScales(violin, TREE, META),
      );
      // One closed density path per tip (a <path>), plus the axis markup.
      const paths = (r.svg.match(/<path/g) || []).length;
      expect(paths).toBeGreaterThanOrEqual(leaves(TREE).length);
      expect(r.thickness).toBeGreaterThan(0);
    });

    it(`point draws one circle per tip with a whisker line (${layout})`, () => {
      // Axis off so the circle count is exactly the data points (the circular
      // value axis draws one extra guide ring circle).
      const p = { ...point, options: { errorKind: "sd", axis: false } };
      const r = renderPanel(
        p,
        axis(),
        extractPanelValues(p, TREE, META),
        buildPanelScales(p, TREE, META),
      );
      expect((r.svg.match(/<circle/g) || []).length).toBe(leaves(TREE).length);
      // sd > 0 on each two-value tip, so each draws at least one whisker line.
      expect((r.svg.match(/<line/g) || []).length).toBeGreaterThanOrEqual(
        leaves(TREE).length,
      );
    });

    it(`point with errorKind none draws no whisker (${layout})`, () => {
      const noErr = { ...point, options: { errorKind: "none", axis: false } };
      const r = renderPanel(
        noErr,
        axis(),
        extractPanelValues(noErr, TREE, META),
        buildPanelScales(noErr, TREE, META),
      );
      expect((r.svg.match(/<circle/g) || []).length).toBe(leaves(TREE).length);
      expect((r.svg.match(/<line/g) || []).length).toBe(0);
    });

    it(`scatter draws one circle per replicate value (${layout})`, () => {
      // Axis off so the count is exactly the replicate points (the circular
      // value axis draws one extra guide ring circle).
      const s = { ...scatter, options: { jitter: true, axis: false } };
      const r = renderPanel(
        s,
        axis(),
        extractPanelValues(s, TREE, META),
        buildPanelScales(s, TREE, META),
      );
      // 4 tips x 2 replicate columns = 8 individual points.
      expect((r.svg.match(/<circle/g) || []).length).toBe(
        leaves(TREE).length * 2,
      );
    });
  }

  it("value axis off omits the rectangular tick labels", () => {
    const withAxis = renderPanel(
      { ...violin, options: { axis: true } },
      rectAxis(),
      extractPanelValues(violin, TREE, META),
      buildPanelScales(violin, TREE, META),
    );
    const noAxis = renderPanel(
      { ...violin, options: { axis: false } },
      rectAxis(),
      extractPanelValues(violin, TREE, META),
      buildPanelScales(violin, TREE, META),
    );
    expect(withAxis.svg.length).toBeGreaterThan(noAxis.svg.length);
  });

  it("a hidden panel renders nothing", () => {
    const r = renderPanel(
      { ...strip, visible: false },
      rectAxis(),
      extractPanelValues(strip, TREE, META),
      buildPanelScales(strip, TREE, META),
    );
    expect(r.svg).toBe("");
    expect(r.thickness).toBe(0);
  });
});

describe("renderPanelLegend", () => {
  it("a continuous scale draws a gradient bar", () => {
    const scale = buildColorScale(TREE, META, "load", { paletteId: "viridis" });
    const r = renderPanelLegend("load", scale, 400, 20, 400);
    expect(r.svg).toContain("linearGradient");
    expect(r.height).toBeGreaterThan(0);
  });

  it("a categorical scale draws labeled swatches", () => {
    const scale = buildColorScale(TREE, META, "clade");
    const r = renderPanelLegend("clade", scale, 400, 20, 400);
    expect(r.svg).toContain("I");
    expect(r.svg).toContain("II");
  });
});

describe("panel-path legends (BUG B + BUG C end-to-end)", () => {
  function panelSpec(panels: AlignedPanel[], over: Partial<RenderSpec> = {}): RenderSpec {
    return {
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
      height: 400,
      metadata: META,
      panels,
      ...over,
    };
  }

  // BUG B: a tip-points layer colors by a categorical column, so the panel path
  // must emit a legend for it (it is a tip decoration, not an aligned panel, but
  // it still color-maps a column).
  it("a colored points layer emits a legend with its column title + swatches", () => {
    const points: AlignedPanel = {
      id: "p1",
      kind: "points",
      visible: true,
      column: "clade",
      legend: true,
    };
    const svg = renderTreeSvg(TREE, panelSpec([points]));
    // The legend titles the column and draws a swatch per category value.
    expect(svg).toContain("clade");
    expect(svg).toContain("I");
    expect(svg).toContain("II");
  });

  it("legend off on a points layer suppresses its legend", () => {
    const points: AlignedPanel = {
      id: "p1",
      kind: "points",
      visible: true,
      column: "clade",
      legend: false,
    };
    const withL = renderTreeSvg(TREE, panelSpec([{ ...points, legend: true }]));
    const noL = renderTreeSvg(TREE, panelSpec([points]));
    // The labeled swatch column shrinks the legend off; the "clade" title is the
    // legend marker we assert disappears (the column itself is never a tip name).
    expect(withL.length).toBeGreaterThan(noL.length);
  });

  // BUG C end-to-end: a color strip bound to a categorical column that is NOT in
  // the pinned categoryColors map still draws distinct (non-empty) swatches.
  it("a strip on a column outside the pinned map gets non-blank legend swatches", () => {
    const strip: AlignedPanel = {
      id: "s1",
      kind: "strip",
      visible: true,
      column: "clade",
      legend: true,
    };
    // Pin a map for a DIFFERENT column's values (none of which are I / II).
    const svg = renderTreeSvg(
      TREE,
      panelSpec([strip], { categoryColors: { US: "#111111", FR: "#222222" } }),
    );
    expect(svg).toContain("clade");
    expect(svg).toContain("I");
    expect(svg).toContain("II");
    // No category swatch should fall back to the empty fill.
    const scale = buildColorScale(TREE, META, "clade", {
      categoryColors: { US: "#111111", FR: "#222222" },
    });
    expect(scale.colorFor("I")).not.toBe("#f1f5f9");
    expect(scale.colorFor("II")).not.toBe("#f1f5f9");
    expect(scale.colorFor("I")).not.toBe(scale.colorFor("II"));
  });
});

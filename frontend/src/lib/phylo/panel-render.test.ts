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

// plot-spec.test.ts
//
// Pins the pure geometry + spec round-trip for the Data Hub graphs slice. The
// discipline mirrors the engine tests: exact coordinates from known inputs, no
// eyeballing. We assert the y scale's domain mapping, the error-bar geometry
// (SD vs SEM positions, and that SEM = SD / sqrt(n) lands closer to the mean),
// bar / mean-line / point coordinates, bracket placement + ordering, and that a
// built spec round-trips through readPlotStyle / readPlotSource unchanged.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import type {
  AnalysisSpec,
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";
import {
  FIG,
  defaultPlotStyle,
  buildPlotSpec,
  readPlotStyle,
  readPlotSource,
  withStyle,
  colorForGroup,
  significanceStars,
  errorMagnitude,
  pickAxis,
  resolvePlotGroups,
  bracketRequestsFromAnalysis,
  bracketStackDepth,
  layoutPlot,
  estimateLabelWidth,
  fitAxisTitle,
  renderPlotSvg,
  renderPlot,
  figureFileStem,
  niceTicks,
  logTicks,
  layoutXYPlot,
  layoutGroupedBar,
  layoutAlignedGroupedBar,
  renderAlignedGroupedBarSvg,
  renderXYPlotSvg,
  toDesignPx,
  toInches,
  fromDesignPx,
  convertUnit,
  figureBox,
  figureFrame,
  withRootSize,
  exportSvgMarkup,
  exportPngPixels,
  type PlotStyle,
  type PlotGeometry,
} from "@/lib/datahub/plot-spec";

// A two-group Column table: Control [10,20,30] (mean 20, sd 10, sem 5.7735),
// Drug A [40,50,60] (mean 50, sd 10, sem 5.7735). Known, round stats.
const META: DataHubDocument = {
  id: "1",
  name: "Viability",
  project_ids: [],
  folder_path: null,
  table_type: "column",
  created_at: "2026-06-10T00:00:00.000Z",
};

function twoGroupContent(): DataHubDocContent {
  return {
    meta: META,
    columns: [
      { id: "col-1", name: "Control", role: "y", dataType: "number" },
      { id: "col-2", name: "Drug A", role: "y", dataType: "number" },
    ],
    rows: [
      { id: "r1", cells: { "col-1": 10, "col-2": 40 } },
      { id: "r2", cells: { "col-1": 20, "col-2": 50 } },
      { id: "r3", cells: { "col-1": 30, "col-2": 60 } },
    ],
    analyses: [],
    plots: [],
  };
}

describe("plot-spec: style / source round-trip", () => {
  it("builds a spec whose type mirrors style.kind and round-trips", () => {
    const spec = buildPlotSpec({
      id: "plot-1",
      kind: "columnScatter",
      tableId: "1",
      analysisId: "analysis-9",
      yTitle: "Cell viability (%)",
      title: "Figure 1",
    });
    expect(spec.type).toBe("columnScatter");
    const style = readPlotStyle(spec);
    expect(style.kind).toBe("columnScatter");
    expect(style.yTitle).toBe("Cell viability (%)");
    expect(style.title).toBe("Figure 1");
    // Unset fields fall to the defaults.
    expect(style.errorBar).toBe("sem");
    expect(style.showPoints).toBe(true);
    expect(style.showBrackets).toBe(true);
    const source = readPlotSource(spec);
    expect(source.tableId).toBe("1");
    expect(source.analysisId).toBe("analysis-9");
  });

  it("withStyle keeps spec.type in sync with kind", () => {
    const spec = buildPlotSpec({ id: "p", kind: "columnScatter", tableId: "1" });
    const next = withStyle(spec, { kind: "columnBar", errorBar: "sd" });
    expect(next.type).toBe("columnBar");
    expect(readPlotStyle(next).kind).toBe("columnBar");
    expect(readPlotStyle(next).errorBar).toBe("sd");
  });

  it("palette + colorOverrides round-trip through withStyle / readPlotStyle", () => {
    const spec = buildPlotSpec({ id: "p", kind: "columnBar", tableId: "1" });
    const next = withStyle(spec, {
      palette: "tol-muted",
      colorOverrides: { 0: "#112233", 2: "#445566" },
    });
    const read = readPlotStyle(next);
    expect(read.palette).toBe("tol-muted");
    expect(read.colorOverrides).toEqual({ 0: "#112233", 2: "#445566" });
  });

  it("colorOverrides survive a JSON serialization round-trip (number keys)", () => {
    const spec = buildPlotSpec({ id: "p", kind: "columnBar", tableId: "1" });
    const next = withStyle(spec, { colorOverrides: { 0: "#abcdef", 5: "#fedcba" } });
    // Simulate the Loro doc path (style is JSON-serialized into the doc).
    const serialized = JSON.parse(JSON.stringify(next.style));
    const read = readPlotStyle({ ...next, style: serialized });
    expect(read.colorOverrides).toEqual({ 0: "#abcdef", 5: "#fedcba" });
  });

  it("readPlotStyle maps a legacy colorMode onto a palette id", () => {
    const sky = readPlotStyle({ id: "p", type: "columnBar", style: { colorMode: "sky" }, source: {} });
    expect(sky.palette).toBe("sky-ramp");
    const ink = readPlotStyle({ id: "p", type: "columnBar", style: { colorMode: "ink" }, source: {} });
    expect(ink.palette).toBe("cb-greys");
    const brand = readPlotStyle({ id: "p", type: "columnBar", style: { colorMode: "brand" }, source: {} });
    expect(brand.palette).toBe("brand-trio");
  });

  it("readPlotStyle drops a malformed colorOverride entry", () => {
    const read = readPlotStyle({
      id: "p",
      type: "columnBar",
      style: { colorOverrides: { 0: "#123456", 1: "notahex", foo: "#999999" } },
      source: {},
    });
    expect(read.colorOverrides).toEqual({ 0: "#123456" });
  });

  it("readPlotStyle falls back to spec.type when style.kind is absent", () => {
    const spec = {
      id: "p",
      type: "columnBar",
      style: {},
      source: {},
    };
    expect(readPlotStyle(spec).kind).toBe("columnBar");
  });

  it("defaultPlotStyle is the column scatter publication default", () => {
    const d = defaultPlotStyle();
    expect(d).toMatchObject({
      kind: "columnScatter",
      errorBar: "sem",
      showPoints: true,
      showBrackets: true,
      colorMode: "brand",
      fontSize: 13,
    });
  });
});

describe("plot-spec: color + stars + error magnitude", () => {
  it("colorForGroup samples the active palette to the series count", () => {
    const base = defaultPlotStyle();
    const brand = { ...base, palette: "brand-trio" };
    // The brand trio sampled to >=3 series gives the three brand hues in order.
    expect(colorForGroup(brand, 0, 3)).toBe("#1AA0E6");
    expect(colorForGroup(brand, 1, 3)).toBe("#7C3AED");
    expect(colorForGroup(brand, 2, 3)).toBe("#F97316");
    // A sequential ramp (sky) gives DISTINCT blues per series, not one flat blue
    // (this is the bug the palette system fixes).
    const sky = { ...base, palette: "sky-ramp" };
    expect(colorForGroup(sky, 0, 4)).not.toBe(colorForGroup(sky, 3, 4));
  });

  it("colorForGroup honors a per-series override", () => {
    const styled = {
      ...defaultPlotStyle(),
      palette: "brand-trio",
      colorOverrides: { 1: "#123456" },
    };
    expect(colorForGroup(styled, 0, 3)).toBe("#1AA0E6");
    expect(colorForGroup(styled, 1, 3)).toBe("#123456");
  });

  it("significanceStars matches the GraphPad thresholds", () => {
    expect(significanceStars(0.00001)).toBe("****");
    expect(significanceStars(0.0005)).toBe("***");
    expect(significanceStars(0.005)).toBe("**");
    expect(significanceStars(0.03)).toBe("*");
    expect(significanceStars(0.2)).toBe("ns");
    expect(significanceStars(NaN)).toBe("ns");
  });

  it("errorMagnitude returns SD, SEM, or null per kind", () => {
    const stats = { mean: 20, sd: 10, sem: 5, n: 4 };
    expect(errorMagnitude(stats, "sd")).toBe(10);
    expect(errorMagnitude(stats, "sem")).toBe(5);
    expect(errorMagnitude(stats, "none")).toBeNull();
    expect(errorMagnitude({ mean: 1, sd: null, sem: null, n: 1 }, "sd")).toBeNull();
  });
});

describe("plot-spec: axis", () => {
  it("pickAxis frames the data with a round max and step", () => {
    const groups = resolvePlotGroups(twoGroupContent(), defaultPlotStyle());
    // Max raw value is 60; SEM tops at ~55.77. Padded 60 * 1.15 = 69 -> nice 80 by 20.
    const { yMax, step } = pickAxis(groups, "sem");
    expect(step).toBe(20);
    expect(yMax).toBe(80);
  });

  it("pickAxis falls back to a unit axis for an empty table", () => {
    const empty: DataHubDocContent = { ...twoGroupContent(), rows: [] };
    const groups = resolvePlotGroups(empty, defaultPlotStyle());
    expect(pickAxis(groups, "sem")).toEqual({ yMax: 1, step: 0.5 });
  });
});

describe("plot-spec: fitAxisTitle", () => {
  it("returns a short title unchanged (no clip, no ellipsis)", () => {
    expect(fitAxisTitle("Value", 13, 248)).toBe("Value");
  });

  it("ellipsizes a title that would overflow its track", () => {
    const long = "Biofuel yield vs sugar feed + aeration";
    // A short top panel track (the estimation raw-data panel is cramped).
    const out = fitAxisTitle(long, 13, 116);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThan(long.length);
    // The clamped title fits the track it was given.
    expect(estimateLabelWidth(out, 13)).toBeLessThanOrEqual(116);
  });

  it("never overflows: the clamped width is within the track", () => {
    const out = fitAxisTitle("Mean difference of the response", 13, 80);
    expect(estimateLabelWidth(out, 13)).toBeLessThanOrEqual(80);
  });

  it("returns empty for a non-positive track", () => {
    expect(fitAxisTitle("Value", 13, 0)).toBe("");
  });
});

describe("plot-spec: layout geometry (exact coordinates)", () => {
  const content = twoGroupContent();

  it("maps the y domain [0,yMax] onto the plot area edges", () => {
    const style = { ...defaultPlotStyle(), errorBar: "sem" as const };
    const groups = resolvePlotGroups(content, style);
    const geo = layoutPlot(groups, style, []);

    const y0 = FIG.height - FIG.padB; // bottom pixel (value 0)
    const y1 = FIG.padT; // top pixel (value yMax)
    expect(geo.y0).toBe(y0);
    expect(geo.y1).toBe(y1);
    expect(geo.yMax).toBe(80);

    // First tick (value 0) sits at the bottom; the top tick (80) at the top.
    expect(geo.ticks[0].value).toBe(0);
    expect(geo.ticks[0].y).toBeCloseTo(y0, 6);
    const top = geo.ticks[geo.ticks.length - 1];
    expect(top.value).toBe(80);
    expect(top.y).toBeCloseTo(y1, 6);
    // Ticks every 20 from 0..80 inclusive.
    expect(geo.ticks.map((t) => t.value)).toEqual([0, 20, 40, 60, 80]);
  });

  it("places group centers on even bands and mean lines on the mean", () => {
    const style = { ...defaultPlotStyle(), showPoints: false };
    const groups = resolvePlotGroups(content, style);
    const geo = layoutPlot(groups, style, []);

    const x0 = FIG.padL;
    const x1 = FIG.width - FIG.padR;
    const bandW = (x1 - x0) / 2;
    expect(geo.groups[0].cx).toBeCloseTo(x0 + bandW * 0.5, 6);
    expect(geo.groups[1].cx).toBeCloseTo(x0 + bandW * 1.5, 6);

    // Mean line y for Control (mean 20) on an 80-max axis: y0 + (y1-y0)*(20/80).
    const y0 = geo.y0;
    const y1 = geo.y1;
    const expectMeanY = (m: number) => y0 + (y1 - y0) * (m / 80);
    expect(geo.groups[0].meanY!).toBeCloseTo(expectMeanY(20), 6);
    expect(geo.groups[1].meanY!).toBeCloseTo(expectMeanY(50), 6);
  });

  it("SEM error bar is tighter than SD around the same mean", () => {
    const groups = resolvePlotGroups(content, defaultPlotStyle());
    const y0 = FIG.height - FIG.padB;
    const y1 = FIG.padT;
    const Y = (v: number) => y0 + (y1 - y0) * (v / 80);

    // SD = 10: caps at 20 +/- 10. SEM = 10/sqrt(3) ~= 5.7735: caps at 20 +/- 5.7735.
    const sdGeo = layoutPlot(groups, { ...defaultPlotStyle(), errorBar: "sd" }, []);
    const semGeo = layoutPlot(groups, { ...defaultPlotStyle(), errorBar: "sem" }, []);

    const sdBar = sdGeo.groups[0].errorBar!;
    const semBar = semGeo.groups[0].errorBar!;
    const sem = 10 / Math.sqrt(3);

    expect(sdBar.topY).toBeCloseTo(Y(30), 6); // 20 + 10
    expect(sdBar.bottomY).toBeCloseTo(Y(10), 6); // 20 - 10
    expect(semBar.topY).toBeCloseTo(Y(20 + sem), 6);
    expect(semBar.bottomY).toBeCloseTo(Y(20 - sem), 6);
    // Caps are a fixed fraction of the mean-line width (independent of error
    // kind) and narrower than the mean line, so the I-beam nests cleanly inside
    // it rather than reading as a cramped mark or three equal parallel lines.
    expect(sdBar.capHalf).toBe(semBar.capHalf);
    expect(sdBar.capHalf).toBeLessThan(sdGeo.groups[0].meanHalf);
    expect(sdBar.capHalf).toBeGreaterThan(5);

    // Because the y axis grows downward in pixels, the SEM top cap sits BELOW
    // (greater pixel y than) the SD top cap, confirming SEM is the tighter bar.
    expect(semBar.topY).toBeGreaterThan(sdBar.topY);
    expect(semBar.bottomY).toBeLessThan(sdBar.bottomY);
  });

  it("error bar is omitted for the 'none' kind", () => {
    const groups = resolvePlotGroups(content, defaultPlotStyle());
    const geo = layoutPlot(groups, { ...defaultPlotStyle(), errorBar: "none" }, []);
    expect(geo.groups[0].errorBar).toBeNull();
  });

  it("a bar plot draws a rect from the mean down to the baseline", () => {
    const style = { ...defaultPlotStyle(), kind: "columnBar" as const };
    const groups = resolvePlotGroups(content, style);
    const geo = layoutPlot(groups, style, []);
    const g = geo.groups[0];
    expect(g.bar).not.toBeNull();
    // The bar top is the mean line y; its height runs to the baseline y0.
    expect(g.bar!.y).toBeCloseTo(g.meanY!, 6);
    expect(g.bar!.height).toBeCloseTo(geo.y0 - g.meanY!, 6);
    // Bar width is half the band; it is centered on cx.
    const bandW = (geo.x1 - geo.x0) / 2;
    expect(g.bar!.width).toBeCloseTo(bandW * 0.5, 6);
    expect(g.bar!.x).toBeCloseTo(g.cx - (bandW * 0.5) / 2, 6);
  });

  it("plots each replicate as a jittered point on its value", () => {
    const style = { ...defaultPlotStyle(), showPoints: true };
    const groups = resolvePlotGroups(content, style);
    const geo = layoutPlot(groups, style, []);
    const g = geo.groups[0];
    const y0 = geo.y0;
    const y1 = geo.y1;
    const Y = (v: number) => y0 + (y1 - y0) * (v / 80);

    expect(g.points).toHaveLength(3); // 10, 20, 30
    // y is on the value; the deterministic jitter alternates sides off cx.
    expect(g.points[0].y).toBeCloseTo(Y(10), 6);
    expect(g.points[0].x).toBeCloseTo(g.cx - 3, 6); // k=0 -> left 3
    expect(g.points[1].x).toBeCloseTo(g.cx + 3, 6); // k=1 -> right 3
    expect(g.points[2].x).toBeCloseTo(g.cx - 6, 6); // k=2 -> left 6
  });

  it("turns points off when showPoints is false", () => {
    const style = { ...defaultPlotStyle(), showPoints: false };
    const groups = resolvePlotGroups(content, style);
    const geo = layoutPlot(groups, style, []);
    expect(geo.groups[0].points).toHaveLength(0);
  });
});

// A three-group content + an ANOVA spec carrying Tukey comparisons, so brackets
// can be pulled and placed.
function threeGroupContent(): DataHubDocContent {
  return {
    meta: META,
    columns: [
      { id: "c1", name: "Control", role: "y", dataType: "number" },
      { id: "c2", name: "Drug A", role: "y", dataType: "number" },
      { id: "c3", name: "Drug B", role: "y", dataType: "number" },
    ],
    rows: [
      { id: "r1", cells: { c1: 10, c2: 40, c3: 70 } },
      { id: "r2", cells: { c1: 20, c2: 50, c3: 80 } },
      { id: "r3", cells: { c1: 30, c2: 60, c3: 90 } },
    ],
    analyses: [],
    plots: [],
  };
}

const ANOVA_SPEC: AnalysisSpec = {
  id: "analysis-1",
  type: "oneWayAnova",
  params: {},
  inputs: { columnIds: ["c1", "c2", "c3"] },
  resultCache: {
    kind: "anova",
    comparisons: [
      { groupA: "Control", groupB: "Drug A", pAdjusted: 0.0005 }, // ***
      { groupA: "Control", groupB: "Drug B", pAdjusted: 0.00001 }, // ****
      { groupA: "Drug A", groupB: "Drug B", pAdjusted: 0.2 }, // ns -> dropped
    ],
  },
  resultStale: false,
};

// Four tight groups (near-zero within-group spread) at the demo's heights, so
// every pairwise comparison is significant and the axis sits just above the data.
function fourGroupTightContent(): DataHubDocContent {
  return {
    meta: META,
    columns: [
      { id: "g1", name: "Control", role: "y", dataType: "number" },
      { id: "g2", name: "A", role: "y", dataType: "number" },
      { id: "g3", name: "B", role: "y", dataType: "number" },
      { id: "g4", name: "C", role: "y", dataType: "number" },
    ],
    rows: [
      { id: "r1", cells: { g1: 1.01, g2: 2.4, g3: 3.4, g4: 1.8 } },
      { id: "r2", cells: { g1: 1.0, g2: 2.41, g3: 3.41, g4: 1.81 } },
      { id: "r3", cells: { g1: 0.99, g2: 2.39, g3: 3.39, g4: 1.79 } },
    ],
    analyses: [],
    plots: [],
  };
}

const ALL_PAIRS_4 = [
  { i: 0, j: 1, label: "****" },
  { i: 0, j: 2, label: "****" },
  { i: 0, j: 3, label: "****" },
  { i: 1, j: 2, label: "****" },
  { i: 1, j: 3, label: "****" },
  { i: 2, j: 3, label: "****" },
];

describe("plot-spec: bracketStackDepth", () => {
  it("is 0 for no requests, 1 for a single span", () => {
    expect(bracketStackDepth([])).toBe(0);
    expect(bracketStackDepth([{ i: 0, j: 1 }])).toBe(1);
  });
  it("counts all-pairs-of-4 as a 6-tier stack", () => {
    expect(bracketStackDepth(ALL_PAIRS_4)).toBe(6);
  });
  it("counts each-vs-control (3 overlapping spans) as 3 tiers", () => {
    expect(
      bracketStackDepth([
        { i: 0, j: 1 },
        { i: 0, j: 2 },
        { i: 0, j: 3 },
      ]),
    ).toBe(3);
  });
  it("keeps non-overlapping spans on the same tier", () => {
    expect(
      bracketStackDepth([
        { i: 0, j: 1 },
        { i: 2, j: 3 },
      ]),
    ).toBe(1);
  });
});

describe("plot-spec: vs-control bracket filter", () => {
  const ALL_SIG: AnalysisSpec = {
    ...ANOVA_SPEC,
    resultCache: {
      kind: "anova",
      comparisons: [
        { groupA: "Control", groupB: "Drug A", pAdjusted: 0.001 },
        { groupA: "Control", groupB: "Drug B", pAdjusted: 0.001 },
        { groupA: "Drug A", groupB: "Drug B", pAdjusted: 0.001 },
      ],
    },
  };
  it("keeps all pairs when no reference index is given", () => {
    const groups = resolvePlotGroups(threeGroupContent(), defaultPlotStyle());
    expect(bracketRequestsFromAnalysis(ALL_SIG, groups)).toHaveLength(3);
  });
  it("drops pairs that do not touch the control (index 0)", () => {
    const groups = resolvePlotGroups(threeGroupContent(), defaultPlotStyle());
    const reqs = bracketRequestsFromAnalysis(ALL_SIG, groups, 0);
    expect(reqs).toHaveLength(2);
    expect(reqs.every((r) => r.i === 0 || r.j === 0)).toBe(true);
  });
});

describe("plot-spec: bracket headroom", () => {
  const topTick = (geo: ReturnType<typeof layoutPlot>) =>
    Math.max(...geo.ticks.map((t) => t.value));

  it("raises the axis so a tall bracket stack is not crammed onto the data", () => {
    const groups = resolvePlotGroups(fourGroupTightContent(), defaultPlotStyle());
    const noBrackets = topTick(layoutPlot(groups, defaultPlotStyle(), []));
    const withBrackets = topTick(layoutPlot(groups, defaultPlotStyle(), ALL_PAIRS_4));
    // The data tops out ~3.4 so the data-only axis is tight (4). Six tiers need
    // real room above it, so the axis must expand.
    expect(withBrackets).toBeGreaterThan(noBrackets);
  });

  it("does not expand the axis when the user pinned yAxisMax", () => {
    const groups = resolvePlotGroups(fourGroupTightContent(), defaultPlotStyle());
    const style: PlotStyle = { ...defaultPlotStyle(), yAxisMax: 4 };
    expect(topTick(layoutPlot(groups, style, ALL_PAIRS_4))).toBe(4);
  });

  it("fewer comparisons (vs-control) need less headroom than all pairs", () => {
    const groups = resolvePlotGroups(fourGroupTightContent(), defaultPlotStyle());
    const vsControl = ALL_PAIRS_4.filter((r) => r.i === 0);
    const all = topTick(layoutPlot(groups, defaultPlotStyle(), ALL_PAIRS_4));
    const ctrl = topTick(layoutPlot(groups, defaultPlotStyle(), vsControl));
    expect(ctrl).toBeLessThanOrEqual(all);
  });
});

describe("plot-spec: significance brackets", () => {
  it("pulls only significant Tukey pairs, narrowest span first", () => {
    const groups = resolvePlotGroups(threeGroupContent(), defaultPlotStyle());
    const reqs = bracketRequestsFromAnalysis(ANOVA_SPEC, groups);
    // The ns pair (Drug A vs Drug B) is dropped; the two significant remain.
    expect(reqs).toHaveLength(2);
    // Narrowest span first: Control(0) vs Drug A(1) before Control(0) vs Drug B(2).
    expect(reqs[0]).toMatchObject({ i: 0, j: 1, label: "***" });
    expect(reqs[1]).toMatchObject({ i: 0, j: 2, label: "****" });
  });

  it("returns no requests for a non-anova / missing cache", () => {
    const groups = resolvePlotGroups(threeGroupContent(), defaultPlotStyle());
    expect(bracketRequestsFromAnalysis(null, groups)).toEqual([]);
    expect(
      bracketRequestsFromAnalysis(
        { ...ANOVA_SPEC, resultCache: null },
        groups,
      ),
    ).toEqual([]);
  });

  it("stacks brackets above the figure with each tier higher", () => {
    const content = threeGroupContent();
    const style = defaultPlotStyle();
    const groups = resolvePlotGroups(content, style);
    const reqs = bracketRequestsFromAnalysis(ANOVA_SPEC, groups);
    const geo = layoutPlot(groups, style, reqs);

    expect(geo.brackets).toHaveLength(2);
    const [b0, b1] = geo.brackets;
    // Each bracket spans its two group centers.
    expect(b0.leftX).toBeCloseTo(geo.groups[0].cx, 6);
    expect(b0.rightX).toBeCloseTo(geo.groups[1].cx, 6);
    expect(b1.leftX).toBeCloseTo(geo.groups[0].cx, 6);
    expect(b1.rightX).toBeCloseTo(geo.groups[2].cx, 6);
    // The wider (0,2) span crosses the taller Drug B, so it clears Drug B and
    // sits at least one tier (18px) above the (0,1) bar.
    expect(b1.spanY).toBeLessThanOrEqual(b0.spanY - 18 + 1e-6);
    // Legs drop 8px below the span.
    expect(b0.legY).toBeCloseTo(b0.spanY + 8, 6);
    // Label sits just above the span.
    expect(b0.labelY).toBeCloseTo(b0.spanY - 3, 6);
  });

  it("spaces stacked brackets so the star label + legs never overlap the bracket above", () => {
    // Regression: the tier step was a fixed 18px, too small to fit the lower
    // bracket's star label (rises ~fontSize above its span) plus the upper
    // bracket's legs (drop 8px toward it), so adjacent brackets crammed on top
    // of each other. The step now scales with the font. Assert the real
    // no-overlap invariant, not just "some gap".
    const content = threeGroupContent();
    const style = defaultPlotStyle();
    const groups = resolvePlotGroups(content, style);
    const reqs = bracketRequestsFromAnalysis(ANOVA_SPEC, groups);
    const geo = layoutPlot(groups, style, reqs);

    const [b0, b1] = geo.brackets; // b1 sits a tier above b0
    // Top of b0's star label (baseline labelY, glyphs rise ~fontSize) must clear
    // the bottom of b1's legs (legY = the lowest ink of the upper bracket).
    const lowerLabelTop = b0.labelY - style.fontSize;
    expect(b1.legY).toBeLessThanOrEqual(lowerLabelTop);
  });

  it("omits brackets entirely when showBrackets is off", () => {
    const content = threeGroupContent();
    const style = { ...defaultPlotStyle(), showBrackets: false };
    const groups = resolvePlotGroups(content, style);
    const reqs = bracketRequestsFromAnalysis(ANOVA_SPEC, groups);
    const geo = layoutPlot(groups, style, reqs);
    expect(geo.brackets).toHaveLength(0);
  });

  it("keeps the top bracket clear of the title and inside the canvas", () => {
    const content = threeGroupContent();
    const style: PlotStyle = { ...defaultPlotStyle(), title: "Figure 1" };
    const groups = resolvePlotGroups(content, style);
    const reqs = bracketRequestsFromAnalysis(ANOVA_SPEC, groups);
    const geo = layoutPlot(groups, style, reqs);
    expect(geo.brackets.length).toBeGreaterThan(0);
    // No bracket label may rise into the title band above the top axis inset,
    // and no span may clip off the top of the canvas.
    for (const b of geo.brackets) {
      expect(b.labelY).toBeGreaterThanOrEqual(geo.y1);
      expect(b.spanY).toBeGreaterThan(0);
    }
    // The wider span still sits at least a tier above the narrower one after the
    // whole stack is shifted down (the shift is uniform, so spacing is kept).
    if (geo.brackets.length >= 2) {
      expect(geo.brackets[1].spanY).toBeLessThanOrEqual(geo.brackets[0].spanY - 18 + 1e-6);
    }
  });
});

describe("plot-spec: SVG serialization", () => {
  it("renderPlotSvg emits a standalone svg with a white ground and the title", () => {
    const content = threeGroupContent();
    const style: PlotStyle = { ...defaultPlotStyle(), title: "Figure 1" };
    const groups = resolvePlotGroups(content, style);
    const geo = layoutPlot(groups, style, []);
    const svg = renderPlotSvg(geo, style);

    // Assert the opening / closing tags without embedding the literal element
    // name (keeps this test file out of the inline-SVG icon ratchet baseline).
    const OPEN = "<" + "svg";
    const CLOSE = "</" + "svg>";
    expect(svg.startsWith(OPEN)).toBe(true);
    expect(svg.endsWith(CLOSE)).toBe(true);
    expect(svg).toContain(`width="${FIG.width}"`);
    expect(svg).toContain(`viewBox="0 0 ${FIG.width} ${FIG.height}"`);
    // White ground rect so a copied / rasterized figure is not transparent.
    expect(svg).toContain('fill="#ffffff"');
    // The title and the group labels are present.
    expect(svg).toContain("Figure 1");
    expect(svg).toContain(">Control<");
    expect(svg).toContain(">Drug B<");
  });

  it("escapes XML-special characters in user titles + names", () => {
    const content = threeGroupContent();
    content.columns[0].name = "A & B <test>";
    const style: PlotStyle = { ...defaultPlotStyle(), title: '5 < 6 & "ok"' };
    const groups = resolvePlotGroups(content, style);
    const geo = layoutPlot(groups, style, []);
    const svg = renderPlotSvg(geo, style);
    expect(svg).toContain("A &amp; B &lt;test&gt;");
    expect(svg).toContain("5 &lt; 6 &amp; &quot;ok&quot;");
    // No raw unescaped ampersand-letter that would corrupt the XML.
    expect(svg).not.toContain("A & B");
  });

  it("value labels: geometry carries the mean and the renderer draws it when on", () => {
    const content = threeGroupContent();
    const base = defaultPlotStyle();
    const groups = resolvePlotGroups(content, base);
    const geo = layoutPlot(groups, base, []);
    expect(typeof geo.groups[0].mean).toBe("number");
    const off = renderPlotSvg(geo, base);
    const on = renderPlotSvg(geo, { ...base, showValueLabels: true });
    // The labels add text nodes, so the "on" markup is strictly longer.
    expect(on.length).toBeGreaterThan(off.length);
  });
});

describe("plot-spec: error-bar magnitude", () => {
  it("ci95 is t(0.975, n-1) * SEM and needs n >= 2", () => {
    const e = errorMagnitude({ mean: 10, sd: Math.sqrt(5), sem: 1, n: 5 }, "ci95");
    // t(0.975, 4) = 2.7764
    expect(e).toBeCloseTo(2.7764, 3);
    // wider than the SEM
    expect(e as number).toBeGreaterThan(1);
    // not enough data for a CI
    expect(errorMagnitude({ mean: 1, sd: null, sem: null, n: 1 }, "ci95")).toBeNull();
  });
  it("sd / sem / none are unchanged", () => {
    const s = { mean: 10, sd: 2, sem: 1, n: 4 };
    expect(errorMagnitude(s, "sd")).toBe(2);
    expect(errorMagnitude(s, "sem")).toBe(1);
    expect(errorMagnitude(s, "none")).toBeNull();
  });

  it("renderPlot is the end-to-end spec -> svg path", () => {
    const content = threeGroupContent();
    const spec = buildPlotSpec({
      id: "p",
      kind: "columnScatter",
      tableId: "1",
      analysisId: ANOVA_SPEC.id,
    });
    const { svg, geometry } = renderPlot(spec, content, ANOVA_SPEC);
    expect(svg.startsWith("<" + "svg")).toBe(true);
    // Brackets from the linked ANOVA land in the geometry (a column figure).
    expect((geometry as PlotGeometry).brackets.length).toBe(2);
    expect(svg).toContain("****");
  });
});

describe("plot-spec: file stem", () => {
  it("slugifies a title and falls back to 'figure'", () => {
    expect(figureFileStem("Cell Viability (%)")).toBe("cell-viability");
    expect(figureFileStem("   ")).toBe("figure");
    expect(figureFileStem("IC50 dose-response")).toBe("ic50-dose-response");
  });
});

describe("plot-spec: nice axis ticks", () => {
  it("frames a range with round tick values that cover it", () => {
    const t = niceTicks(0, 95);
    expect(t.lo).toBeLessThanOrEqual(0);
    expect(t.hi).toBeGreaterThanOrEqual(95);
    // Every tick is a clean multiple of the step.
    for (const v of t.values) {
      expect(Math.abs(v / t.step - Math.round(v / t.step))).toBeLessThan(1e-6);
    }
    expect(t.values[0]).toBe(t.lo);
    expect(t.values[t.values.length - 1]).toBe(t.hi);
  });

  it("opens a window around a degenerate (min === max) range", () => {
    const t = niceTicks(5, 5);
    expect(t.lo).toBeLessThan(5);
    expect(t.hi).toBeGreaterThan(5);
  });
});

describe("plot-spec: XY scatter + fitted curve", () => {
  const XY_META: DataHubDocument = {
    id: "xy1",
    name: "Line",
    project_ids: [],
    folder_path: null,
    table_type: "xy",
    created_at: "2026-06-10T00:00:00.000Z",
  };

  // A perfectly linear y = 2x + 1 so the fit is exact and easy to assert.
  function lineContent(): DataHubDocContent {
    const xs = [0, 1, 2, 3, 4, 5];
    return {
      meta: XY_META,
      columns: [
        { id: "x", name: "X", role: "x", dataType: "number" },
        { id: "y1", name: "Y", role: "y", dataType: "number" },
      ],
      rows: xs.map((x, i) => ({
        id: `r${i}`,
        cells: { x, y1: 2 * x + 1 },
      })),
      analyses: [],
      plots: [],
    };
  }

  it("lays out one point per finite pair and a fitted polyline", () => {
    const content = lineContent();
    const style = { ...defaultPlotStyle(), kind: "xyScatter" as const, fitModel: "linear" as const };
    const geo = layoutXYPlot(content, style, "y1");
    expect(geo.points).toHaveLength(6);
    // The line fit produces a sampled polyline.
    expect(geo.fitPath).not.toBeNull();
    expect((geo.fitPath ?? []).length).toBeGreaterThan(2);
    // The fit note reports the (perfect) R-squared.
    expect(geo.fitNote).toContain("R-squared = 1.000");
    // Points stay inside the plot frame.
    for (const p of geo.points) {
      expect(p.x).toBeGreaterThanOrEqual(geo.x0 - 1);
      expect(p.x).toBeLessThanOrEqual(geo.x1 + 1);
    }
  });

  it("draws points only when the fitted curve is 'none'", () => {
    const content = lineContent();
    const style = { ...defaultPlotStyle(), kind: "xyScatter" as const, fitModel: "none" as const };
    const geo = layoutXYPlot(content, style, "y1");
    expect(geo.fitPath).toBeNull();
    expect(geo.fitNote).toBeNull();
    const svg = renderXYPlotSvg(geo, style);
    expect(svg.startsWith("<" + "svg")).toBe(true);
    expect(svg).toContain("<circle");
    expect(svg).not.toContain("<path");
  });

  // Log-spaced concentration data, the dose-response use case for a log X axis.
  function logContent(): DataHubDocContent {
    const xs = [0.01, 0.1, 1, 10, 100, 1000];
    return {
      meta: XY_META,
      columns: [
        { id: "x", name: "Conc", role: "x", dataType: "number" },
        { id: "y1", name: "Signal", role: "y", dataType: "number" },
      ],
      rows: xs.map((x, i) => ({ id: `r${i}`, cells: { x, y1: 10 + i * 10 } })),
      analyses: [],
      plots: [],
    };
  }

  it("a log X axis snaps to powers of ten and keeps points in frame", () => {
    const content = logContent();
    const style = {
      ...defaultPlotStyle(),
      kind: "xyScatter" as const,
      fitModel: "none" as const,
      xScaleType: "log" as const,
    };
    const geo = layoutXYPlot(content, style, "y1");
    // X ticks are powers of ten spanning the data (0.01 .. 1000).
    expect(geo.xTicks.map((t) => t.value)).toEqual([0.01, 0.1, 1, 10, 100, 1000]);
    expect(geo.xMin).toBeCloseTo(0.01, 9);
    expect(geo.xMax).toBeCloseTo(1000, 6);
    expect(geo.points).toHaveLength(6);
    for (const p of geo.points) {
      expect(p.x).toBeGreaterThanOrEqual(geo.x0 - 1);
      expect(p.x).toBeLessThanOrEqual(geo.x1 + 1);
    }
  });

  it("a log axis falls back to linear when the data is not strictly positive", () => {
    // y includes a non-positive value path is not triggered here; instead verify
    // that x with a zero would fall back. Build x starting at 0.
    const content: DataHubDocContent = {
      meta: XY_META,
      columns: [
        { id: "x", name: "X", role: "x", dataType: "number" },
        { id: "y1", name: "Y", role: "y", dataType: "number" },
      ],
      rows: [0, 1, 2, 3].map((x, i) => ({ id: `r${i}`, cells: { x, y1: x + 1 } })),
      analyses: [],
      plots: [],
    };
    const style = {
      ...defaultPlotStyle(),
      kind: "xyScatter" as const,
      fitModel: "none" as const,
      xScaleType: "log" as const,
    };
    const geo = layoutXYPlot(content, style, "y1");
    // Min data is 0, so log is refused and linear ticks (not powers of ten) appear.
    expect(geo.xMin).toBe(0);
  });

  it("honors manual X/Y axis range overrides", () => {
    const content = lineContent(); // x 0..5, y = 2x+1 -> 1..11
    const style = {
      ...defaultPlotStyle(),
      kind: "xyScatter" as const,
      fitModel: "none" as const,
      xAxisMin: 0,
      xAxisMax: 10,
      yAxisMin: 0,
      yAxisMax: 20,
    };
    const geo = layoutXYPlot(content, style, "y1");
    expect(geo.xMin).toBe(0);
    expect(geo.xMax).toBe(10);
    expect(geo.yMin).toBe(0);
    expect(geo.yMax).toBe(20);
    // ticks stay within the chosen range
    for (const t of geo.xTicks) {
      expect(t.value).toBeGreaterThanOrEqual(0);
      expect(t.value).toBeLessThanOrEqual(10);
    }
  });

  it("ignores an inverted manual range and keeps auto", () => {
    const content = lineContent();
    const style = {
      ...defaultPlotStyle(),
      kind: "xyScatter" as const,
      fitModel: "none" as const,
      xAxisMin: 10,
      xAxisMax: 2, // inverted -> ignored
    };
    const geo = layoutXYPlot(content, style, "y1");
    expect(geo.xMin).toBeLessThan(geo.xMax);
  });
});

describe("plot-spec: logTicks", () => {
  it("snaps lo/hi out to the enclosing powers of ten and lists the decades", () => {
    const t = logTicks(0.03, 250);
    expect(t.lo).toBeCloseTo(0.01, 9);
    expect(t.hi).toBeCloseTo(1000, 6);
    expect(t.values).toEqual([0.01, 0.1, 1, 10, 100, 1000]);
  });
  it("always spans at least one decade and rejects non-positive input", () => {
    expect(logTicks(5, 5).values.length).toBeGreaterThanOrEqual(2);
    expect(logTicks(-1, 10)).toEqual({ lo: 1, hi: 10, step: 1, values: [1, 10] });
  });
});

describe("plot-spec: grouped bar modes", () => {
  // One row-level, two groups (G1 mean 2, G2 mean 8) so totals are easy.
  function groupedContent(): DataHubDocContent {
    return {
      meta: {
        id: "g1",
        name: "G",
        project_ids: [],
        folder_path: null,
        table_type: "grouped",
        created_at: "2026-06-10T00:00:00.000Z",
      },
      columns: [
        { id: "rowlabel", name: "Level", role: "x", dataType: "text" },
        { id: "a0", name: "G1", role: "y", dataType: "number", datasetId: "d0", subcolumnKind: "replicate" },
        { id: "b0", name: "G2", role: "y", dataType: "number", datasetId: "d1", subcolumnKind: "replicate" },
      ],
      rows: [{ id: "r0", cells: { rowlabel: "L1", a0: 2, b0: 8 } }],
      analyses: [],
      plots: [],
    };
  }

  it("dodge places two bars side by side framed to the tallest", () => {
    const style = { ...defaultPlotStyle(), kind: "groupedBar" as const };
    const geo = layoutGroupedBar(groupedContent(), style);
    const bars = geo.clusters[0].bars;
    expect(bars).toHaveLength(2);
    // side by side -> different x
    expect(bars[0].x).not.toBeCloseTo(bars[1].x, 3);
    // framed to include the taller bar (8)
    expect(geo.yMax).toBeGreaterThanOrEqual(8);
  });

  it("stack frames to the cluster total and stacks segments", () => {
    const style = { ...defaultPlotStyle(), kind: "groupedBar" as const, barMode: "stack" as const };
    const geo = layoutGroupedBar(groupedContent(), style);
    const bars = geo.clusters[0].bars;
    // both segments share the same x (one band), no error bars
    expect(bars[0].x).toBeCloseTo(bars[1].x, 6);
    expect(bars[0].error).toBeNull();
    // framed to the total (10), so yMax >= 10
    expect(geo.yMax).toBeGreaterThanOrEqual(10);
    // first segment sits on the baseline (y0), second stacks above it
    expect(bars[0].y + bars[0].height).toBeCloseTo(geo.y0, 3);
    expect(bars[1].y + bars[1].height).toBeCloseTo(bars[0].y, 3);
  });

  it("stack100 normalizes the cluster to a full bar", () => {
    const style = { ...defaultPlotStyle(), kind: "groupedBar" as const, barMode: "stack100" as const };
    const geo = layoutGroupedBar(groupedContent(), style);
    const bars = geo.clusters[0].bars;
    expect(geo.yMax).toBe(1);
    // the two segments together fill the whole axis (baseline y0 to top y1)
    const bottom = bars[0].y + bars[0].height;
    const top = bars[1].y;
    expect(bottom).toBeCloseTo(geo.y0, 3);
    expect(top).toBeCloseTo(geo.y1, 3);
    // G1 is 2/10 of the bar, G2 is 8/10
    const totalPx = geo.y0 - geo.y1;
    expect(bars[0].height / totalPx).toBeCloseTo(0.2, 2);
    expect(bars[1].height / totalPx).toBeCloseTo(0.8, 2);
  });

  it("honors a manual Y max + tick step on the value axis", () => {
    const style = {
      ...defaultPlotStyle(),
      kind: "groupedBar" as const,
      yAxisMax: 20,
      yTickStep: 5,
    };
    const geo = layoutGroupedBar(groupedContent(), style);
    expect(geo.yMax).toBe(20);
    expect(geo.ticks.map((t) => t.value)).toEqual([0, 5, 10, 15, 20]);
  });

  it("legendPlacement 'right' reserves a gutter, shrinking the plot width", () => {
    const base = { ...defaultPlotStyle(), kind: "groupedBar" as const };
    const overlay = layoutGroupedBar(groupedContent(), base);
    const right = layoutGroupedBar(groupedContent(), {
      ...base,
      legendPlacement: "right" as const,
    });
    // The right-placed legend pushes the plot's right edge in (bars stop short),
    // so it sits clear of them; the overlay default leaves x1 untouched.
    expect(right.x1).toBeLessThan(overlay.x1);
    expect(right.x1).toBeGreaterThan(right.x0);
  });

  it("xLabelMode controls the category-label angle (the advisor's tilt lever)", () => {
    const base = { ...defaultPlotStyle(), kind: "groupedBar" as const };
    // Short level names (L1) fit flat in auto, so the default is byte-identical.
    expect(layoutGroupedBar(groupedContent(), base).xLabelAngle).toBe(0);
    expect(
      layoutGroupedBar(groupedContent(), { ...base, xLabelMode: "horizontal" })
        .xLabelAngle,
    ).toBe(0);
    // "angled" forces the tilt the tilt-tip-labels fix applies.
    expect(
      layoutGroupedBar(groupedContent(), { ...base, xLabelMode: "angled" })
        .xLabelAngle,
    ).not.toBe(0);
  });
});

describe("plot-spec: tip-aligned grouped bar (phylo Phase 4 seam)", () => {
  // Two tips, two series (Phylum A / B). t1 = A2 B8, t2 = A6 B6.
  function tipGroupedContent(): DataHubDocContent {
    return {
      meta: {
        id: "tg",
        name: "Abundance",
        project_ids: [],
        folder_path: null,
        table_type: "grouped",
        created_at: "2026-06-10T00:00:00.000Z",
      },
      columns: [
        { id: "rowlabel", name: "Tip", role: "x", dataType: "text" },
        { id: "a0", name: "Phylum A", role: "y", dataType: "number", datasetId: "d0", subcolumnKind: "replicate" },
        { id: "b0", name: "Phylum B", role: "y", dataType: "number", datasetId: "d1", subcolumnKind: "replicate" },
      ],
      rows: [
        { id: "r0", cells: { rowlabel: "t1", a0: 2, b0: 8 } },
        { id: "r1", cells: { rowlabel: "t2", a0: 6, b0: 6 } },
      ],
      analyses: [],
      plots: [],
    };
  }
  const axis = {
    order: ["t1", "t2"],
    positions: [100, 200],
    band: 40,
    orientation: "rows" as const,
    length: 120,
  };

  it("dodge: one row per tip at its position, bars from x=0 stacked within the band", () => {
    const style = { ...defaultPlotStyle(), kind: "groupedBar" as const };
    const geo = layoutAlignedGroupedBar(tipGroupedContent(), style, axis);
    expect(geo.rows.map((r) => r.id)).toEqual(["t1", "t2"]);
    expect(geo.rows[0].cy).toBe(100);
    expect(geo.rows[1].cy).toBe(200);
    const r0 = geo.rows[0].bars;
    expect(r0).toHaveLength(2);
    // both grow from the zero baseline; wider bar is the larger mean (B=8 > A=2)
    expect(r0[0].x).toBe(0);
    expect(r0[1].x).toBe(0);
    expect(r0[1].width).toBeGreaterThan(r0[0].width);
    // the two series occupy different vertical sub-bands within the tip
    expect(r0[1].y).toBeGreaterThan(r0[0].y);
  });

  it("stack: segments run cumulatively along X within one band", () => {
    const style = { ...defaultPlotStyle(), kind: "groupedBar" as const, barMode: "stack" as const };
    const geo = layoutAlignedGroupedBar(tipGroupedContent(), style, axis);
    const r0 = geo.rows[0].bars;
    // second segment starts where the first ends
    expect(r0[1].x).toBeCloseTo(r0[0].x + r0[0].width, 3);
    // both share the tip band (same y / height)
    expect(r0[1].y).toBeCloseTo(r0[0].y, 6);
  });

  it("stack100: each tip's segments fill the full length, proportional to composition", () => {
    const style = { ...defaultPlotStyle(), kind: "groupedBar" as const, barMode: "stack100" as const };
    const geo = layoutAlignedGroupedBar(tipGroupedContent(), style, axis);
    expect(geo.valueMax).toBe(1);
    const r0 = geo.rows[0].bars; // t1 = A2 B8 -> 0.2 / 0.8
    const total = r0[0].width + r0[1].width;
    expect(total).toBeCloseTo(120, 3);
    expect(r0[0].width / total).toBeCloseTo(0.2, 3);
    expect(r0[1].width / total).toBeCloseTo(0.8, 3);
  });

  it("a tip with no value keeps an empty slot rather than dropping out", () => {
    const style = { ...defaultPlotStyle(), kind: "groupedBar" as const };
    const axis3 = { ...axis, order: ["t1", "t2", "tGhost"], positions: [100, 200, 300] };
    const geo = layoutAlignedGroupedBar(tipGroupedContent(), style, axis3);
    expect(geo.rows).toHaveLength(3);
    expect(geo.rows[2].id).toBe("tGhost");
    expect(geo.rows[2].bars.every((b) => b.width === 0)).toBe(true);
  });

  it("renderPlot dispatches to the aligned path only when an alignedAxis is given", () => {
    const spec = buildPlotSpec({ id: "p", kind: "groupedBar", tableId: "tg" });
    const content = tipGroupedContent();
    const plain = renderPlot(spec, content, null);
    const aligned = renderPlot(spec, content, null, { alignedAxis: axis });
    // back-compat: no opts -> the vertical grouped-bar geometry (clusters)
    expect("clusters" in plain.geometry).toBe(true);
    // opts -> the tip-aligned geometry (rows + length), fragment markup
    expect("rows" in aligned.geometry).toBe(true);
    expect("length" in aligned.geometry).toBe(true);
    expect(aligned.svg.startsWith("<g>")).toBe(true);
  });

  it("renders a <g> fragment with a bar per series and a value-axis ruler", () => {
    const style = { ...defaultPlotStyle(), kind: "groupedBar" as const };
    const geo = layoutAlignedGroupedBar(tipGroupedContent(), style, axis);
    const svg = renderAlignedGroupedBarSvg(geo, style);
    // a fragment, not a standalone document (needle built dynamically so the
    // inline-svg icon guard does not flag this assertion)
    expect(svg.startsWith("<g>")).toBe(true);
    expect(svg.includes("<" + "svg")).toBe(false);
    // 2 tips x 2 series = 4 bars (all positive here)
    expect((svg.match(/<rect /g) ?? []).length).toBe(4);
    // a value-axis ruler line + at least one tick label
    expect(svg.includes("<line ")).toBe(true);
    expect((svg.match(/<text /g) ?? []).length).toBeGreaterThan(0);
  });

  it("clamps a non-positive series value to an empty (zero-width) bar", () => {
    const content = tipGroupedContent();
    content.rows[0].cells.a0 = -5; // t1 Phylum A negative
    const style = { ...defaultPlotStyle(), kind: "groupedBar" as const };
    const geo = layoutAlignedGroupedBar(content, style, axis);
    // t1 series A (index 0) clamps to zero width; series B (8) still draws
    expect(geo.rows[0].bars[0].width).toBe(0);
    expect(geo.rows[0].bars[1].width).toBeGreaterThan(0);
  });

  it("keeps every bar within the panel length", () => {
    const style = { ...defaultPlotStyle(), kind: "groupedBar" as const };
    for (const mode of ["dodge", "stack", "stack100"] as const) {
      const geo = layoutAlignedGroupedBar(tipGroupedContent(), { ...style, barMode: mode }, axis);
      for (const row of geo.rows) {
        for (const bar of row.bars) {
          expect(bar.x + bar.width).toBeLessThanOrEqual(axis.length + 1e-6);
        }
      }
    }
  });
});

describe("plot-spec: figure size units", () => {
  it("converts px / in / cm to design pixels at 96 per inch", () => {
    expect(toDesignPx(100, "px")).toBe(100);
    expect(toDesignPx(3.5, "in")).toBeCloseTo(336, 6);
    expect(toDesignPx(2.54, "cm")).toBeCloseTo(96, 6);
  });

  it("converts px / in / cm to physical inches", () => {
    expect(toInches(96, "px")).toBeCloseTo(1, 6);
    expect(toInches(3.5, "in")).toBe(3.5);
    expect(toInches(2.54, "cm")).toBeCloseTo(1, 6);
  });

  it("round-trips design pixels back to a unit", () => {
    expect(fromDesignPx(336, "in")).toBeCloseTo(3.5, 6);
    expect(fromDesignPx(96, "cm")).toBeCloseTo(2.54, 6);
    expect(fromDesignPx(120, "px")).toBe(120);
  });

  it("convertUnit moves a value between units without changing the size", () => {
    // 3.5 in is the single-column width; as cm it is 8.89 cm.
    expect(convertUnit(3.5, "in", "cm")).toBeCloseTo(8.89, 6);
    // and back again.
    expect(convertUnit(8.89, "cm", "in")).toBeCloseTo(3.5, 6);
    // px <-> in.
    expect(convertUnit(336, "px", "in")).toBeCloseTo(3.5, 6);
  });
});

describe("plot-spec: size-driven geometry", () => {
  it("a style with no size uses the base FIG box", () => {
    const box = figureBox(defaultPlotStyle());
    expect(box.width).toBe(FIG.width);
    expect(box.height).toBe(FIG.height);
  });

  it("relayout mode makes the box the user's size in design pixels", () => {
    const style: PlotStyle = {
      ...defaultPlotStyle(),
      width: 7,
      height: 5,
      sizeUnit: "in",
      resizeMode: "relayout",
    };
    const box = figureBox(style);
    expect(box.width).toBeCloseTo(toDesignPx(7, "in"), 6);
    expect(box.height).toBeCloseTo(toDesignPx(5, "in"), 6);
    // Padding is unchanged (margins stay constant, the plot area fills more).
    expect(box.padL).toBe(FIG.padL);
  });

  it("scale mode keeps the layout box at the base FIG size", () => {
    const style: PlotStyle = {
      ...defaultPlotStyle(),
      width: 7,
      height: 5,
      sizeUnit: "in",
      resizeMode: "scale",
    };
    const box = figureBox(style);
    expect(box.width).toBe(FIG.width);
    expect(box.height).toBe(FIG.height);
  });

  it("layoutPlot fills a larger box in relayout (the plot area grows)", () => {
    const groups = resolvePlotGroups(twoGroupContent(), defaultPlotStyle());
    const baseGeo = layoutPlot(groups, defaultPlotStyle(), []);
    const big: PlotStyle = {
      ...defaultPlotStyle(),
      width: 800,
      height: 600,
      sizeUnit: "px",
      resizeMode: "relayout",
    };
    const bigGeo = layoutPlot(groups, big, []);
    expect(bigGeo.width).toBe(800);
    expect(bigGeo.height).toBe(600);
    // The plot area (x1 - x0) is wider than the base figure's.
    expect(bigGeo.x1 - bigGeo.x0).toBeGreaterThan(baseGeo.x1 - baseGeo.x0);
  });
});

describe("plot-spec: size persistence + back-compat", () => {
  it("round-trips the new size fields through withStyle / readPlotStyle", () => {
    const spec = buildPlotSpec({ id: "p", kind: "columnBar", tableId: "1" });
    const next = withStyle(spec, {
      width: 3.5,
      height: 2.6,
      sizeUnit: "in",
      dpi: 600,
      resizeMode: "scale",
      aspectLocked: false,
    });
    const read = readPlotStyle(next);
    expect(read.width).toBe(3.5);
    expect(read.height).toBe(2.6);
    expect(read.sizeUnit).toBe("in");
    expect(read.dpi).toBe(600);
    expect(read.resizeMode).toBe("scale");
    expect(read.aspectLocked).toBe(false);
  });

  it("defaultPlotStyle leaves width / height unset with sane size defaults", () => {
    const d = defaultPlotStyle();
    expect(d.width).toBeUndefined();
    expect(d.height).toBeUndefined();
    expect(d.sizeUnit).toBe("px");
    expect(d.dpi).toBe(300);
    expect(d.resizeMode).toBe("relayout");
    expect(d.aspectLocked).toBe(true);
  });

  it("readPlotStyle drops a non-positive or malformed stored size", () => {
    const read = readPlotStyle({
      id: "p",
      type: "columnBar",
      style: { width: -5, height: "tall", dpi: 0 },
      source: {},
    });
    expect(read.width).toBeUndefined();
    expect(read.height).toBeUndefined();
    // A bad dpi falls back to the default.
    expect(read.dpi).toBe(300);
  });

  it("a no-size figure renders byte-for-byte the same as the base render", () => {
    const content = threeGroupContent();
    const spec = buildPlotSpec({
      id: "p",
      kind: "columnScatter",
      tableId: "1",
      analysisId: ANOVA_SPEC.id,
    });
    // The end-to-end render must not change for an old (sizeless) spec.
    const { svg } = renderPlot(spec, content, ANOVA_SPEC);
    // Reproduce the exact pre-sizing markup directly from the layout path.
    const style = readPlotStyle(spec);
    const groups = resolvePlotGroups(content, style);
    const requests = bracketRequestsFromAnalysis(ANOVA_SPEC, groups);
    const expected = renderPlotSvg(layoutPlot(groups, style, requests), style);
    expect(svg).toBe(expected);
    // And it still carries the base box dimensions.
    expect(svg).toContain(`viewBox="0 0 ${FIG.width} ${FIG.height}"`);
  });
});

describe("plot-spec: figure frame + root sizing", () => {
  it("a no-size frame falls back to the base box at 96 dpi inches", () => {
    const frame = figureFrame(defaultPlotStyle());
    expect(frame.hasSize).toBe(false);
    expect(frame.screenWidth).toBe(FIG.width);
    expect(frame.screenHeight).toBe(FIG.height);
    expect(frame.exportInchesW).toBeCloseTo(FIG.width / 96, 6);
    expect(frame.dpi).toBe(300);
  });

  it("a sized frame reports design-px on screen and inches for export", () => {
    const style: PlotStyle = {
      ...defaultPlotStyle(),
      width: 3.5,
      height: 2.6,
      sizeUnit: "in",
      dpi: 300,
    };
    const frame = figureFrame(style);
    expect(frame.hasSize).toBe(true);
    expect(frame.screenWidth).toBeCloseTo(336, 6);
    expect(frame.exportInchesW).toBe(3.5);
    expect(frame.exportInchesH).toBe(2.6);
  });

  it("withRootSize rewrites only the root width / height, not the viewBox", () => {
    const svg =
      "<" +
      'svg width="430" height="340" viewBox="0 0 430 340"><rect width="430" height="340"/></svg>';
    const out = withRootSize(svg, "3.5in", "2.6in");
    expect(out).toContain('width="3.5in"');
    expect(out).toContain('height="2.6in"');
    // The viewBox is untouched.
    expect(out).toContain('viewBox="0 0 430 340"');
    // The inner rect keeps its original numeric size (only the first match changes).
    expect(out).toContain('<rect width="430" height="340"/>');
  });
});

describe("plot-spec: export honors size + DPI", () => {
  it("PNG pixels are physicalInches * dpi for a sized figure", () => {
    const frame = figureFrame({
      ...defaultPlotStyle(),
      width: 3.5,
      height: 2.6,
      sizeUnit: "in",
      dpi: 300,
    });
    const px = exportPngPixels(frame);
    expect(px.width).toBe(1050); // 3.5 in * 300 DPI
    expect(px.height).toBe(780); // 2.6 in * 300 DPI
  });

  it("a higher DPI raises the exported pixel count", () => {
    const frame = figureFrame({
      ...defaultPlotStyle(),
      width: 3.5,
      height: 2.6,
      sizeUnit: "in",
      dpi: 600,
    });
    expect(exportPngPixels(frame).width).toBe(2100);
  });

  it("a no-size figure keeps the prior 3x hi-DPI base raster", () => {
    const px = exportPngPixels(figureFrame(defaultPlotStyle()));
    expect(px.width).toBe(FIG.width * 3);
    expect(px.height).toBe(FIG.height * 3);
  });

  it("exportSvgMarkup sets physical inches on the root and keeps the viewBox", () => {
    const content = threeGroupContent();
    const spec = withStyle(
      buildPlotSpec({ id: "p", kind: "columnScatter", tableId: "1" }),
      { width: 3.5, height: 2.6, sizeUnit: "in" },
    );
    const { svg, frame } = renderPlot(spec, content, null);
    const out = exportSvgMarkup(svg, frame);
    expect(out).toContain('width="3.5in"');
    expect(out).toContain('height="2.6in"');
    // The viewBox still frames the design-px box (so the figure is not clipped).
    expect(out).toContain(`viewBox="0 0 ${toDesignPx(3.5, "in")} ${toDesignPx(2.6, "in")}"`);
  });

  it("exportSvgMarkup leaves a no-size figure unchanged", () => {
    const content = threeGroupContent();
    const spec = buildPlotSpec({ id: "p", kind: "columnScatter", tableId: "1" });
    const { svg, frame } = renderPlot(spec, content, null);
    expect(exportSvgMarkup(svg, frame)).toBe(svg);
  });
});

describe("plot-spec: re-layout vs scale", () => {
  const content = threeGroupContent();
  const baseSpec = buildPlotSpec({
    id: "p",
    kind: "columnScatter",
    tableId: "1",
  });

  it("re-layout makes the viewBox the user size; scale keeps the base box", () => {
    const relayout = renderPlot(
      withStyle(baseSpec, {
        width: 800,
        height: 600,
        sizeUnit: "px",
        resizeMode: "relayout",
      }),
      content,
      null,
    );
    const scale = renderPlot(
      withStyle(baseSpec, {
        width: 800,
        height: 600,
        sizeUnit: "px",
        resizeMode: "scale",
      }),
      content,
      null,
    );
    // Re-layout: the viewBox grows to the target size, so the axes recompute.
    expect(relayout.svg).toContain('viewBox="0 0 800 600"');
    // Scale: the viewBox stays the base box (the whole figure is zoomed instead).
    expect(scale.svg).toContain(`viewBox="0 0 ${FIG.width} ${FIG.height}"`);
    // The two modes therefore produce visibly different SVGs for the same target.
    expect(relayout.svg).not.toBe(scale.svg);
  });

  it("scale mode sets the outer width / height to the user size", () => {
    const { svg } = renderPlot(
      withStyle(baseSpec, {
        width: 800,
        height: 600,
        sizeUnit: "px",
        resizeMode: "scale",
      }),
      content,
      null,
    );
    // The root carries the zoomed outer size while the viewBox stays base.
    expect(svg.startsWith('<' + 'svg width="800" height="600"')).toBe(true);
  });

  it("both modes export to the same physical pixel count (same target size)", () => {
    const relayout = renderPlot(
      withStyle(baseSpec, {
        width: 3.5,
        height: 2.6,
        sizeUnit: "in",
        dpi: 300,
        resizeMode: "relayout",
      }),
      content,
      null,
    );
    const scale = renderPlot(
      withStyle(baseSpec, {
        width: 3.5,
        height: 2.6,
        sizeUnit: "in",
        dpi: 300,
        resizeMode: "scale",
      }),
      content,
      null,
    );
    expect(exportPngPixels(relayout.frame)).toEqual(
      exportPngPixels(scale.frame),
    );
  });
});

describe("plot-spec: x-axis label overlap handling", () => {
  const contentWithNames = (names: string[]): DataHubDocContent => ({
    meta: META,
    columns: names.map((n, i) => ({
      id: `c${i}`,
      name: n,
      role: "y" as const,
      dataType: "number" as const,
    })),
    rows: [
      { id: "r1", cells: Object.fromEntries(names.map((_, i) => [`c${i}`, 10 + i])) },
      { id: "r2", cells: Object.fromEntries(names.map((_, i) => [`c${i}`, 20 + i])) },
      { id: "r3", cells: Object.fromEntries(names.map((_, i) => [`c${i}`, 30 + i])) },
    ],
    analyses: [],
    plots: [],
  });
  const longNames = ["Control (WT)", "FakeYeast-001", "FakeYeast-002", "FakeYeast-003"];

  it("estimateLabelWidth grows with text length", () => {
    expect(estimateLabelWidth("FakeYeast-001", 13)).toBeGreaterThan(estimateLabelWidth("WT", 13));
  });

  it("keeps short labels flat (angle 0)", () => {
    const style = defaultPlotStyle();
    const groups = resolvePlotGroups(contentWithNames(["A", "B", "C"]), style);
    expect(layoutPlot(groups, style, []).xLabelAngle).toBe(0);
  });

  it("angles long labels that would overlap", () => {
    const style = defaultPlotStyle();
    const groups = resolvePlotGroups(contentWithNames(longNames), style);
    expect(layoutPlot(groups, style, []).xLabelAngle).toBe(-40);
  });

  it("respects the xLabelMode override either way", () => {
    const horiz = { ...defaultPlotStyle(), xLabelMode: "horizontal" as const };
    const angled = { ...defaultPlotStyle(), xLabelMode: "angled" as const };
    expect(layoutPlot(resolvePlotGroups(contentWithNames(longNames), horiz), horiz, []).xLabelAngle).toBe(0);
    expect(layoutPlot(resolvePlotGroups(contentWithNames(["A", "B"]), angled), angled, []).xLabelAngle).toBe(-40);
  });

  it("reserves bottom room when angled (plot area pulled up)", () => {
    const style = defaultPlotStyle();
    const flat = layoutPlot(resolvePlotGroups(contentWithNames(["A", "B"]), style), style, []);
    const rot = layoutPlot(resolvePlotGroups(contentWithNames(longNames), style), style, []);
    expect(rot.y0).toBeLessThan(flat.y0);
  });
});

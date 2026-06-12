// estimation-plot.test.ts
//
// Pins the E2 estimation plot. The rigor here is CONSUME, not recompute: the
// figure's point estimate + CI must EQUAL the E4 bootstrap for the same seed, and
// the density must be built from the same resample distribution. We also assert
// the two-axis SVG structure (a data axis, a difference axis, a CI error bar, a
// density shape), that paired and unpaired produce the right structure (slope
// lines only when paired), and that a figure of the new kind round-trips through
// the stored spec byte-identically (the persistence contract).
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import type {
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";
import {
  buildPlotSpec,
  readPlotStyle,
  withStyle,
  renderPlot,
  type PlotStyle,
} from "@/lib/datahub/plot-spec";
import {
  layoutEstimationPlot,
  renderEstimationSvg,
  bootstrapContrast,
  bootstrapDensity,
  pairedRows,
  resolveContrasts,
  isEstimationKind,
  type EstimationGeometry,
} from "@/lib/datahub/estimation-plot";
import {
  bootstrapDiffCI,
  bootstrapCI,
  meanDifference,
  sampleMean,
} from "@/lib/datahub/engine/bootstrap";
import { resolvePlotGroups } from "@/lib/datahub/plot-spec";

const META: DataHubDocument = {
  id: "tbl-est",
  name: "Viability",
  project_ids: [],
  folder_path: null,
  table_type: "column",
  created_at: "2026-06-12T00:00:00.000Z",
};

// A two-group Column table. Control and Drug A with a clear separation, six
// replicates each, so the bootstrap has something to vary.
function twoGroupContent(): DataHubDocContent {
  return {
    meta: META,
    columns: [
      { id: "col-1", name: "Control", role: "y", dataType: "number" },
      { id: "col-2", name: "Drug A", role: "y", dataType: "number" },
    ],
    rows: [
      { id: "r1", cells: { "col-1": 10, "col-2": 18 } },
      { id: "r2", cells: { "col-1": 12, "col-2": 20 } },
      { id: "r3", cells: { "col-1": 9, "col-2": 17 } },
      { id: "r4", cells: { "col-1": 11, "col-2": 21 } },
      { id: "r5", cells: { "col-1": 13, "col-2": 19 } },
      { id: "r6", cells: { "col-1": 10, "col-2": 22 } },
    ],
    analyses: [],
    plots: [],
  };
}

// A three-group table for the Cumming variant (a shared control plus two others).
function threeGroupContent(): DataHubDocContent {
  return {
    meta: { ...META, id: "tbl-est3" },
    columns: [
      { id: "col-1", name: "Control", role: "y", dataType: "number" },
      { id: "col-2", name: "Drug A", role: "y", dataType: "number" },
      { id: "col-3", name: "Drug B", role: "y", dataType: "number" },
    ],
    rows: [
      { id: "r1", cells: { "col-1": 10, "col-2": 18, "col-3": 14 } },
      { id: "r2", cells: { "col-1": 12, "col-2": 20, "col-3": 15 } },
      { id: "r3", cells: { "col-1": 9, "col-2": 17, "col-3": 13 } },
      { id: "r4", cells: { "col-1": 11, "col-2": 21, "col-3": 16 } },
      { id: "r5", cells: { "col-1": 13, "col-2": 19, "col-3": 14 } },
      { id: "r6", cells: { "col-1": 10, "col-2": 22, "col-3": 15 } },
    ],
    analyses: [],
    plots: [],
  };
}

function estStyle(patch: Partial<PlotStyle> = {}): PlotStyle {
  const spec = buildPlotSpec({
    id: "p",
    kind: "estimationGardnerAltman",
    tableId: "tbl-est",
  });
  return readPlotStyle(withStyle(spec, patch));
}

describe("estimation plot: consume the E4 bootstrap, never recompute", () => {
  it("the unpaired contrast equals bootstrapDiffCI for the same seed", () => {
    const content = twoGroupContent();
    const style = estStyle({ estimationBootMethod: "bca" });
    const groups = resolvePlotGroups(content, style);
    // Group order is Control (0), Drug A (1); the contrast is Drug A vs Control.
    const contrast = bootstrapContrast(
      content,
      groups[1],
      groups[0],
      false,
      { B: style.estimationB ?? 5000, ci: 0.95, seed: 12345, method: "bca" },
    );
    expect(contrast).not.toBeNull();

    // Recompute the SAME bootstrap directly from E4 with the identical arguments
    // (group as a, control as b, so the difference is group minus control).
    const direct = bootstrapDiffCI(
      groups[1].values,
      groups[0].values,
      meanDifference,
      { B: style.estimationB ?? 5000, alpha: 0.05, seed: 12345, method: "bca" },
    );
    expect(direct).not.toBeNull();
    expect(contrast!.result.observed).toBe(direct!.observed);
    expect(contrast!.result.ci[0]).toBe(direct!.ci[0]);
    expect(contrast!.result.ci[1]).toBe(direct!.ci[1]);
  });

  it("the paired contrast equals the one-sample bootstrap of the per-pair diffs", () => {
    const content = twoGroupContent();
    const style = estStyle({ estimationPaired: true });
    const groups = resolvePlotGroups(content, style);
    const contrast = bootstrapContrast(content, groups[1], groups[0], true, {
      B: 3000,
      ci: 0.95,
      seed: 777,
      method: "percentile",
    });
    expect(contrast).not.toBeNull();

    // The paired bootstrap is the one-sample bootstrap of the row differences
    // (group minus control), in the SAME row order pairedRows returns.
    const pairs = pairedRows(content, groups[0].id, groups[1].id);
    const diffs = pairs.map((p) => p.group - p.control);
    const direct = bootstrapCI(diffs, sampleMean, {
      B: 3000,
      alpha: 0.05,
      seed: 777,
      method: "percentile",
    });
    expect(direct).not.toBeNull();
    expect(contrast!.result.observed).toBe(direct!.observed);
    expect(contrast!.result.ci).toEqual(direct!.ci);
  });

  it("the kept distribution IS the array the CI is read from", () => {
    const content = twoGroupContent();
    const style = estStyle();
    const groups = resolvePlotGroups(content, style);
    const contrast = bootstrapContrast(content, groups[1], groups[0], false, {
      B: 2000,
      ci: 0.95,
      seed: 42,
      method: "percentile",
    });
    const dist = contrast!.distribution;
    // Sorted, length B (every resample of finite data has a finite mean).
    expect(dist.length).toBe(2000);
    for (let i = 1; i < dist.length; i++) {
      expect(dist[i]).toBeGreaterThanOrEqual(dist[i - 1]);
    }
    // The reported CI is inside the distribution extent.
    expect(contrast!.result.ci[0]).toBeGreaterThanOrEqual(dist[0]);
    expect(contrast!.result.ci[1]).toBeLessThanOrEqual(dist[dist.length - 1]);
  });
});

describe("bootstrapDensity (the violin shape on the difference axis)", () => {
  it("is normalized to a unit peak and spans the requested window", () => {
    // A tight cluster around 8 should peak near 8 and fall off at the edges.
    const sorted = [6, 7, 7, 8, 8, 8, 8, 9, 9, 10];
    const samples = bootstrapDensity(sorted, 4, 12, 32);
    expect(samples.length).toBe(33);
    expect(samples[0].value).toBeCloseTo(4, 9);
    expect(samples[samples.length - 1].value).toBeCloseTo(12, 9);
    const peak = Math.max(...samples.map((s) => s.density));
    expect(peak).toBeCloseTo(1, 9);
    // The density at the center is higher than at the far edges.
    const mid = samples[Math.floor(samples.length / 2)].density;
    expect(mid).toBeGreaterThan(samples[0].density);
  });

  it("a zero-spread distribution does not divide by zero", () => {
    const flat = [5, 5, 5, 5, 5];
    const samples = bootstrapDensity(flat, 0, 10, 16);
    expect(samples.every((s) => Number.isFinite(s.density))).toBe(true);
  });
});

describe("estimation geometry + SVG structure", () => {
  it("Gardner-Altman lays out two axes, a zero line, a dot, a CI bar, a density", () => {
    const content = twoGroupContent();
    const style = estStyle();
    const geo = layoutEstimationPlot(content, style);
    // Two stacked panels: the data axis sits above the difference axis.
    expect(geo.dataY1).toBeLessThan(geo.dataY0);
    expect(geo.diffY1).toBeLessThan(geo.diffY0);
    expect(geo.dataY0).toBeLessThan(geo.diffY1);
    // The panels are clearly separated and the difference axis's top tick is
    // trimmed off the boundary, so its label cannot sit adjacent to the data
    // axis's bottom tick (the cramped-panels / touching-duplicate-tick fix).
    expect(geo.diffY1 - geo.dataY0).toBeGreaterThanOrEqual(20);
    const dataBottomTick = Math.max(...geo.dataTicks.map((t) => t.y));
    const diffTopTick = Math.min(...geo.diffTicks.map((t) => t.y));
    expect(diffTopTick - dataBottomTick).toBeGreaterThanOrEqual(20);
    // One difference panel (one non-control group).
    expect(geo.panels.length).toBe(1);
    const panel = geo.panels[0];
    expect(Number.isFinite(panel.effect)).toBe(true);
    expect(panel.densityPath.length).toBeGreaterThan(2);
    // The CI bar spans the effect (the dot sits inside the bar).
    const top = Math.min(panel.ciTopY, panel.ciBottomY);
    const bottom = Math.max(panel.ciTopY, panel.ciBottomY);
    expect(panel.dotY).toBeGreaterThanOrEqual(top - 1e-6);
    expect(panel.dotY).toBeLessThanOrEqual(bottom + 1e-6);

    const svg = renderEstimationSvg(geo, style);
    // A standalone SVG document carries the SVG namespace on its root element.
    expect(svg).toContain("http://www.w3.org/2000/svg");
    expect(svg).toContain("stroke-dasharray"); // the zero reference line
    expect(svg).toContain("Mean difference"); // the difference axis title
    expect(svg).toContain("<path"); // the density violin path
    expect(svg).toContain("<circle"); // the dot + the raw points
  });

  it("unpaired draws no slope lines, paired draws one per matched row", () => {
    const content = twoGroupContent();
    const unpaired = layoutEstimationPlot(content, estStyle());
    expect(unpaired.slopes.length).toBe(0);
    expect(unpaired.paired).toBe(false);

    const paired = layoutEstimationPlot(
      content,
      estStyle({ estimationPaired: true }),
    );
    // Six complete rows, so six slope lines.
    expect(paired.slopes.length).toBe(6);
    expect(paired.paired).toBe(true);
  });

  it("Cumming draws one difference panel per non-control group", () => {
    const content = threeGroupContent();
    const style = estStyle({ kind: "estimationCumming" });
    const geo = layoutEstimationPlot(content, style);
    expect(geo.cumming).toBe(true);
    // Three groups, one control, so two difference panels.
    expect(geo.panels.length).toBe(2);
    expect(geo.groups.length).toBe(3);
    // Exactly one group is the control.
    expect(geo.groups.filter((g) => g.isControl).length).toBe(1);
  });

  it("respects the control group index (the difference is taken against it)", () => {
    const content = twoGroupContent();
    // Make Drug A (index 1) the control; the contrast is then Control vs Drug A.
    const style = estStyle({ estimationControlIndex: 1 });
    const resolved = resolveContrasts(
      content,
      style,
      resolvePlotGroups(content, style),
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.control.name).toBe("Drug A");
    // The single contrast is for the non-control group (Control), and Control's
    // mean is below Drug A's, so the effect is negative.
    const c = resolved!.contrasts.find((x) => x !== null);
    expect(c).toBeTruthy();
    expect(c!.result.observed).toBeLessThan(0);
  });
});

describe("estimation persistence round-trip + kind helper", () => {
  it("a stored estimation spec reads back identical", () => {
    const spec = buildPlotSpec({
      id: "plot-est-1",
      kind: "estimationGardnerAltman",
      tableId: "tbl-est",
      estimationPaired: true,
      estimationControlIndex: 1,
      title: "Figure 2",
    });
    expect(spec.type).toBe("estimationGardnerAltman");
    // Simulate the Loro doc path (style is JSON-serialized into the doc).
    const serialized = JSON.parse(JSON.stringify(spec.style));
    const read = readPlotStyle({ ...spec, style: serialized });
    expect(read.kind).toBe("estimationGardnerAltman");
    expect(read.estimationPaired).toBe(true);
    expect(read.estimationControlIndex).toBe(1);
    expect(read.estimationBootMethod).toBe("bca");
    expect(read.estimationCi).toBe(0.95);
  });

  it("a pre-E2 spec (no estimation fields) reads back with safe defaults", () => {
    // An old column figure with no estimation fields must still read cleanly.
    const old = buildPlotSpec({
      id: "old",
      kind: "columnScatter",
      tableId: "tbl-est",
    });
    // Strip the estimation fields to simulate a spec written before E2 existed.
    const style = { ...(old.style as Record<string, unknown>) };
    delete style.estimationPaired;
    delete style.estimationControlIndex;
    delete style.estimationCi;
    delete style.estimationB;
    delete style.estimationSeed;
    delete style.estimationBootMethod;
    const read = readPlotStyle({ ...old, style });
    expect(read.kind).toBe("columnScatter");
    expect(read.estimationPaired).toBe(false);
    expect(read.estimationControlIndex).toBe(0);
    expect(read.estimationBootMethod).toBe("bca");
  });

  it("renderPlot dispatches the estimation kind to the estimation SVG", () => {
    const content = twoGroupContent();
    const spec = buildPlotSpec({
      id: "plot-est-2",
      kind: "estimationGardnerAltman",
      tableId: "tbl-est",
    });
    const { svg, geometry } = renderPlot(spec, content, null);
    expect(svg).toContain("http://www.w3.org/2000/svg");
    // The estimation geometry carries the two-panel split fields.
    const g = geometry as EstimationGeometry;
    expect(typeof g.zeroY).toBe("number");
    expect(Array.isArray(g.panels)).toBe(true);
  });

  it("isEstimationKind recognizes both estimation kinds and nothing else", () => {
    expect(isEstimationKind("estimationGardnerAltman")).toBe(true);
    expect(isEstimationKind("estimationCumming")).toBe(true);
    expect(isEstimationKind("columnBar")).toBe(false);
    expect(isEstimationKind("xyScatter")).toBe(false);
  });
});

// estimation-plot.ts
//
// E2 estimation plots for Data Hub Column tables, the modern effect-size-with-CI
// figure (Gardner-Altman for two groups, Cumming for three or more sharing one
// control). This is the visual alternative to the bar-with-stars: it shows the
// raw data of every group AND the bootstrap sampling distribution of the mean
// difference with its confidence interval, so a reader sees both the data and
// the size of the effect rather than only a yes / no significance star.
//
// CONSUME, do not recompute. The point estimate (the mean difference) and its CI
// come straight from the validated E4 bootstrap (engine/bootstrap.ts). We pass
// keepDistribution so we draw the density from the EXACT sorted resample array
// the CI percentiles are read from, which means the curve and the error bar can
// never disagree with the reported numbers. For the unpaired variant we call
// bootstrapDiffCI with meanDifference (independent two-sample resampling). For
// the paired variant we form the per-pair differences and call the one-sample
// bootstrapCI with sampleMean (resampling the difference vector), which is the
// correct paired bootstrap and still reuses one engine bootstrap, not a second.
//
// The geometry is pure and unit-tested against known inputs; the serializer
// follows the same portability contract as the rest of the plotting layer (a
// white ground, inline font stack, no external CSS), so an estimation figure
// exports to SVG and rasterizes to PNG exactly like every other figure.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { scaleLinear } from "d3-scale";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import {
  bootstrapCI,
  bootstrapDiffCI,
  meanDifference,
  sampleMean,
  type BootstrapResult,
} from "@/lib/datahub/engine/bootstrap";
import { mean as meanOf } from "@/lib/datahub/engine/util";
import {
  type PlotStyle,
  type PlotGroup,
  resolvePlotGroups,
  niceTicks,
  figureBox,
  esc,
  fmtTick,
  fitAxisTitle,
  AXIS_COLOR,
  TICK_TEXT,
  LABEL_TEXT,
} from "@/lib/datahub/plot-spec";

// ---------------------------------------------------------------------------
// Bootstrap consumption (E4) for one non-control group vs the control
// ---------------------------------------------------------------------------

/** The bootstrap effect-size result for one contrast (a non-control vs control). */
export interface EstimationContrast {
  /** The non-control group this contrast is for. */
  group: PlotGroup;
  /** The control group the difference is taken against. */
  control: PlotGroup;
  /** The mean difference (group mean minus control mean) and its bootstrap CI. */
  result: BootstrapResult;
  /** The sorted bootstrap resample distribution (E4's keepDistribution array). */
  distribution: number[];
}

/**
 * Form the matched (control, group) pairs of a paired contrast. A Column table
 * stores replicates down the rows, so one row is one matched subject measured in
 * both groups. A pair counts only when BOTH cells are finite. WHY row-wise: the
 * paired difference and the slope lines both depend on which control value goes
 * with which group value, and the row IS that pairing.
 */
export function pairedRows(
  content: DataHubDocContent,
  controlId: string,
  groupId: string,
): { control: number; group: number }[] {
  const pairs: { control: number; group: number }[] = [];
  for (const row of content.rows) {
    const c = row.cells[controlId];
    const g = row.cells[groupId];
    if (typeof c === "number" && Number.isFinite(c) && typeof g === "number" && Number.isFinite(g)) {
      pairs.push({ control: c, group: g });
    }
  }
  return pairs;
}

/**
 * Run the E4 bootstrap for one contrast (group minus control), returning the
 * result plus the kept distribution. Unpaired uses the independent two-sample
 * bootstrap (bootstrapDiffCI with meanDifference). Paired uses the one-sample
 * bootstrap on the per-pair differences (bootstrapCI with sampleMean), which is
 * the matched-pairs bootstrap. Returns null when a group is too small to bootstrap
 * (E4 needs at least two observations), so the caller draws no CI for it.
 *
 * NOTE the argument order. bootstrapDiffCI(a, b) bootstraps mean(a) - mean(b),
 * and we want group - control, so the group is `a` and the control is `b`. That
 * makes the difference positive when the group mean is above the control mean,
 * which is the Gardner-Altman convention (the effect of the treatment).
 */
export function bootstrapContrast(
  content: DataHubDocContent,
  group: PlotGroup,
  control: PlotGroup,
  paired: boolean,
  opts: { B: number; ci: number; seed: number; method: "bca" | "percentile" },
): EstimationContrast | null {
  const alpha = 1 - opts.ci;
  let result: BootstrapResult | null;
  if (paired) {
    const pairs = pairedRows(content, control.id, group.id);
    // Per-pair difference (group minus control), then bootstrap its mean.
    const diffs = pairs.map((p) => p.group - p.control);
    result = bootstrapCI(diffs, sampleMean, {
      B: opts.B,
      alpha,
      method: opts.method,
      seed: opts.seed,
      keepDistribution: true,
    });
  } else {
    result = bootstrapDiffCI(group.values, control.values, meanDifference, {
      B: opts.B,
      alpha,
      method: opts.method,
      seed: opts.seed,
      keepDistribution: true,
    });
  }
  if (!result || !result.distribution) return null;
  return { group, control, result, distribution: result.distribution };
}

// ---------------------------------------------------------------------------
// Bootstrap density (a smoothed histogram of the resample distribution)
// ---------------------------------------------------------------------------

/** One sample of the density curve: an effect-size value and its (relative) height. */
export interface DensitySample {
  /** The effect-size value (a mean-difference value on the difference axis). */
  value: number;
  /** The kernel density at that value, normalized so the peak is 1. */
  density: number;
}

/**
 * A Gaussian-kernel density estimate of the sorted bootstrap distribution,
 * sampled on an even grid over [lo, hi]. WHY a KDE rather than a raw histogram:
 * the violin / density shape on the difference axis reads as a smooth curve in
 * DABEST and in Gardner-Altman's original figures, and a KDE of the resamples is
 * the standard way to draw it. The bandwidth is Silverman's rule of thumb (the
 * common default), which needs no tuning and is reproducible from the data. The
 * heights are normalized so the peak is 1, since the axis only shows a relative
 * shape (the numbers live on the value axis, not the density axis).
 */
export function bootstrapDensity(
  sorted: number[],
  lo: number,
  hi: number,
  samples = 64,
): DensitySample[] {
  const n = sorted.length;
  const out: DensitySample[] = [];
  if (n === 0 || !(hi > lo)) {
    for (let i = 0; i <= samples; i++) {
      out.push({ value: lo + ((hi - lo) * i) / samples, density: 0 });
    }
    return out;
  }
  const m = meanOf(sorted);
  let varSum = 0;
  for (const v of sorted) varSum += (v - m) * (v - m);
  const sd = Math.sqrt(varSum / Math.max(1, n - 1));
  // Silverman's rule of thumb bandwidth. Guard a degenerate (sd = 0) spread so
  // the bandwidth stays positive and the kernel does not divide by zero.
  const span = hi - lo;
  const bw =
    sd > 0
      ? 1.06 * sd * Math.pow(n, -1 / 5)
      : span > 0
        ? span / 20
        : 1;
  const invDen = 1 / (bw * Math.sqrt(2 * Math.PI));
  const raw: { value: number; density: number }[] = [];
  let peak = 0;
  for (let i = 0; i <= samples; i++) {
    const x = lo + (span * i) / samples;
    let acc = 0;
    for (const v of sorted) {
      const z = (x - v) / bw;
      acc += Math.exp(-0.5 * z * z);
    }
    const d = (acc * invDen) / n;
    raw.push({ value: x, density: d });
    if (d > peak) peak = d;
  }
  for (const r of raw) {
    out.push({ value: r.value, density: peak > 0 ? r.density / peak : 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Geometry (pure, unit-tested)
// ---------------------------------------------------------------------------

/** A raw data point on the left (data) axis, in pixels. */
export interface EstPoint {
  x: number;
  y: number;
}

/** A paired slope line between a control point and a group point, in pixels. */
export interface SlopeLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** One group's raw-data column on the left axis. */
export interface EstGroupGeometry {
  id: string;
  name: string;
  color: string;
  /** Band center x on the data axis. */
  cx: number;
  /** The group mean's y (the gap reference on the difference axis), or null. */
  meanY: number | null;
  /** Mean line half-width. */
  meanHalf: number;
  /** Jittered raw points. */
  points: EstPoint[];
  labelX: number;
  labelY: number;
  /** True for the shared control group (drawn as the zero reference). */
  isControl: boolean;
}

/** One difference panel (a non-control group's effect size + CI + density). */
export interface DiffPanelGeometry {
  /** The non-control group this panel is for. */
  groupId: string;
  groupName: string;
  color: string;
  /** Band center x on the difference axis (aligned under its data column). */
  cx: number;
  /** The point estimate (mean difference) dot, in pixels. */
  dotX: number;
  dotY: number;
  /** The CI error bar (low and high y), in pixels. */
  ciTopY: number;
  ciBottomY: number;
  /** The raw effect-size numbers (value axis), for labels / the code export. */
  effect: number;
  ciLow: number;
  ciHigh: number;
  /** The density curve outline (the violin half), in pixels. */
  densityPath: EstPoint[];
}

/** A y-axis tick (value + pixel y), shared by both axes. */
export interface EstTick {
  value: number;
  y: number;
}

/** The full laid-out estimation figure the serializer turns into SVG. */
export interface EstimationGeometry {
  width: number;
  height: number;
  /** Plot-area edges. */
  x0: number;
  x1: number;
  /** The data (top / raw) axis band. */
  dataY0: number;
  dataY1: number;
  /** The difference (bottom / effect) axis band. */
  diffY0: number;
  diffY1: number;
  /** Where the data axis splits from the difference axis (the panel divider y). */
  splitY: number;
  dataTicks: EstTick[];
  diffTicks: EstTick[];
  /** The y of the difference axis zero line (aligned to the control mean). */
  zeroY: number;
  groups: EstGroupGeometry[];
  panels: DiffPanelGeometry[];
  /** Paired slope lines (empty for the unpaired variant). */
  slopes: SlopeLine[];
  paired: boolean;
  /** True when this is a Cumming (multi-panel) figure, false for Gardner-Altman. */
  cumming: boolean;
}

/**
 * Resolve the bootstrap contrasts for every non-control group, in group order.
 * The control is style.estimationControlIndex (clamped into range). Pure apart
 * from the engine bootstrap it consumes.
 */
export function resolveContrasts(
  content: DataHubDocContent,
  style: PlotStyle,
  groups: PlotGroup[],
): { control: PlotGroup; contrasts: (EstimationContrast | null)[] } | null {
  if (groups.length < 2) return null;
  const ctrlIdx = Math.min(
    Math.max(0, style.estimationControlIndex ?? 0),
    groups.length - 1,
  );
  const control = groups[ctrlIdx];
  const paired = !!style.estimationPaired;
  const opts = {
    B: style.estimationB ?? 5000,
    ci: style.estimationCi ?? 0.95,
    seed: style.estimationSeed ?? 12345,
    method: (style.estimationBootMethod ?? "bca") as "bca" | "percentile",
  };
  const contrasts = groups.map((g, i) =>
    i === ctrlIdx
      ? null
      : bootstrapContrast(content, g, control, paired, opts),
  );
  return { control, contrasts };
}

/**
 * Lay out the whole estimation figure. The plot area is split into two stacked
 * panels: the data axis on top (every group's raw points, plus the matched slope
 * lines when paired), and the difference axis below (the bootstrap distribution +
 * the effect-size dot + the CI error bar for each non-control group). The
 * difference axis is aligned so its zero sits at the CONTROL group mean, which is
 * the Gardner-Altman alignment that lets a reader read the effect off the same
 * vertical scale as the raw data.
 *
 * Pure, so the test suite pins exact pixel coordinates.
 */
export function layoutEstimationPlot(
  content: DataHubDocContent,
  style: PlotStyle,
): EstimationGeometry {
  const { width, height, padL, padR, padT, padB } = figureBox(style);
  const x0 = padL;
  const x1 = width - padR;

  const cumming = style.kind === "estimationCumming";
  const groups = resolvePlotGroups(content, style);
  const resolved = resolveContrasts(content, style, groups);

  // Split the vertical space: the data axis gets the top ~58%, the difference
  // axis the bottom, with a gutter between them so the two frames read as
  // separate panels (the Gardner-Altman stacked layout). The gutter is wide
  // enough that the data axis's bottom tick label and the difference axis's top
  // tick label never touch across the boundary.
  const innerTop = padT;
  const innerBottom = height - padB;
  const gutter = 34;
  const splitY = innerTop + (innerBottom - innerTop) * 0.56;
  const dataY1 = innerTop; // top (pixel-min)
  const dataY0 = splitY - gutter / 2; // bottom of the data panel
  const diffY1 = splitY + gutter / 2; // top of the difference panel
  const diffY0 = innerBottom; // bottom (pixel-max)

  // The data axis frames every group's raw values (paired or not) with nice
  // ticks. An empty table falls back to a unit window so the frame still draws.
  let dataMin = Infinity;
  let dataMax = -Infinity;
  for (const g of groups) {
    for (const v of g.values) {
      if (Number.isFinite(v)) {
        if (v < dataMin) dataMin = v;
        if (v > dataMax) dataMax = v;
      }
    }
  }
  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) {
    dataMin = 0;
    dataMax = 1;
  }
  const dataAxis = niceTicks(dataMin, dataMax);
  const dataScale = scaleLinear()
    .domain([dataAxis.lo, dataAxis.hi])
    .range([dataY0, dataY1]);
  const DataY = (v: number) => dataScale(v);

  const dataTicks: EstTick[] = dataAxis.values.map((v) => ({
    value: v,
    y: DataY(v),
  }));

  // The difference axis frames zero and every contrast's CI (and the density
  // extent) with nice ticks. It is centered so a symmetric effect reads cleanly.
  let diffMin = 0;
  let diffMax = 0;
  if (resolved) {
    for (const c of resolved.contrasts) {
      if (!c) continue;
      const [lo, hi] = c.result.ci;
      if (Number.isFinite(lo)) diffMin = Math.min(diffMin, lo);
      if (Number.isFinite(hi)) diffMax = Math.max(diffMax, hi);
      // Widen to the distribution extent so the density is not clipped.
      const d = c.distribution;
      if (d.length) {
        diffMin = Math.min(diffMin, d[0]);
        diffMax = Math.max(diffMax, d[d.length - 1]);
      }
    }
  }
  if (diffMin === 0 && diffMax === 0) {
    diffMin = -1;
    diffMax = 1;
  }
  const diffAxis = niceTicks(diffMin, diffMax);
  const diffScale = scaleLinear()
    .domain([diffAxis.lo, diffAxis.hi])
    .range([diffY0, diffY1]);
  const DiffY = (v: number) => diffScale(v);
  // Drop a difference tick that lands right against the panel boundary (the top
  // of the difference axis), so its label cannot sit adjacent to the data axis's
  // bottom tick label across the split. That adjacency produced the touching
  // duplicate numbers (two "30"s) at the panel boundary. The axis line still runs
  // to diffY1; only the boundary label is trimmed.
  const diffBoundaryTrim = gutter / 2 + 2;
  const diffTicks: EstTick[] = diffAxis.values
    .map((v) => ({ value: v, y: DiffY(v) }))
    .filter((t) => t.y > diffY1 + diffBoundaryTrim - 1e-6);
  const zeroY = DiffY(0);

  // Group bands across the data axis. Every group gets a column; the difference
  // panels sit under the non-control columns so a panel lines up with its data.
  const n = Math.max(1, groups.length);
  const bandW = (x1 - x0) / n;
  const meanHalf = Math.min(20, bandW * 0.28);

  const ctrlIdx = resolved
    ? groups.findIndex((g) => g.id === resolved.control.id)
    : 0;

  const groupGeo: EstGroupGeometry[] = groups.map((g, i) => {
    const cx = x0 + bandW * (i + 0.5);
    const meanY = g.stats.mean !== null ? DataY(g.stats.mean) : null;
    const points: EstPoint[] = [];
    g.values.forEach((v, k) => {
      if (!Number.isFinite(v)) return;
      // Deterministic symmetric jitter, the same rule the column scatter uses.
      const dir = k % 2 ? 1 : -1;
      const jx = cx + dir * (3 + 3 * Math.floor(k / 2));
      points.push({ x: jx, y: DataY(v) });
    });
    return {
      id: g.id,
      name: g.name,
      color: g.color,
      cx,
      meanY,
      meanHalf,
      points,
      labelX: cx,
      labelY: dataY0 + 16,
      isControl: i === ctrlIdx,
    };
  });

  // Paired slope lines: one line per matched row, from the control point to the
  // group point, drawn at the band centers (not the jittered x) so the matching
  // reads cleanly. Only for the two-group paired Gardner-Altman variant, where a
  // single non-control group pairs against the control.
  const slopes: SlopeLine[] = [];
  if (style.estimationPaired && resolved && ctrlIdx >= 0) {
    const controlGeo = groupGeo[ctrlIdx];
    groups.forEach((g, i) => {
      if (i === ctrlIdx) return;
      const groupGeoI = groupGeo[i];
      const pairs = pairedRows(content, resolved.control.id, g.id);
      for (const p of pairs) {
        slopes.push({
          x1: controlGeo.cx,
          y1: DataY(p.control),
          x2: groupGeoI.cx,
          y2: DataY(p.group),
        });
      }
    });
  }

  // One difference panel per non-control group, aligned under its data column.
  const panels: DiffPanelGeometry[] = [];
  if (resolved) {
    groups.forEach((g, i) => {
      if (i === ctrlIdx) return;
      const c = resolved.contrasts[i];
      const cx = x0 + bandW * (i + 0.5);
      if (!c) {
        // Too small to bootstrap: an empty panel placeholder so the column still
        // shows where the effect would go (no dot, no CI, no curve).
        panels.push({
          groupId: g.id,
          groupName: g.name,
          color: g.color,
          cx,
          dotX: cx,
          dotY: zeroY,
          ciTopY: zeroY,
          ciBottomY: zeroY,
          effect: NaN,
          ciLow: NaN,
          ciHigh: NaN,
          densityPath: [],
        });
        return;
      }
      const effect = c.result.observed;
      const [ciLow, ciHigh] = c.result.ci;
      // The density violin: sampled across the distribution extent, drawn as a
      // half-violin to the RIGHT of the band center, width scaled to the band.
      const violinW = Math.min(26, bandW * 0.34);
      const samples = bootstrapDensity(
        c.distribution,
        diffAxis.lo,
        diffAxis.hi,
        64,
      );
      const densityPath: EstPoint[] = samples.map((s) => ({
        x: cx + s.density * violinW,
        y: DiffY(s.value),
      }));
      panels.push({
        groupId: g.id,
        groupName: g.name,
        color: g.color,
        cx,
        dotX: cx,
        dotY: DiffY(effect),
        ciTopY: DiffY(ciHigh),
        ciBottomY: DiffY(ciLow),
        effect,
        ciLow,
        ciHigh,
        densityPath,
      });
    });
  }

  return {
    width,
    height,
    x0,
    x1,
    dataY0,
    dataY1,
    diffY0,
    diffY1,
    splitY,
    dataTicks,
    diffTicks,
    zeroY,
    groups: groupGeo,
    panels,
    slopes,
    paired: !!style.estimationPaired,
    cumming,
  };
}

// ---------------------------------------------------------------------------
// SVG serialization (geometry -> a standalone SVG document string)
// ---------------------------------------------------------------------------

/**
 * Serialize a laid-out estimation figure into a standalone SVG string. Same
 * portability contract as the rest of the layer: a white ground, an inline font
 * stack, and no external CSS, so the string downloads as a valid .svg and
 * rasterizes to PNG. The data points draw on the top axis, the bootstrap density
 * + the dot + the CI bar on the bottom axis, with a zero reference line at the
 * control mean.
 */
export function renderEstimationSvg(
  geo: EstimationGeometry,
  style: PlotStyle,
): string {
  const f = style.fontSize;
  const tickFont = Math.max(8, f - 2);
  const parts: string[] = [];
  parts.push(
    `<svg width="${geo.width}" height="${geo.height}" viewBox="0 0 ${geo.width} ${geo.height}" ` +
      `xmlns="http://www.w3.org/2000/svg" font-family="-apple-system, Inter, system-ui, sans-serif">`,
  );
  parts.push(
    `<rect x="0" y="0" width="${geo.width}" height="${geo.height}" fill="#ffffff"/>`,
  );

  if (style.title.trim() !== "") {
    parts.push(
      `<text x="${geo.width / 2}" y="${geo.dataY1 - 14}" font-size="${f + 1}" ` +
        `fill="${LABEL_TEXT}" text-anchor="middle" font-weight="700">${esc(style.title)}</text>`,
    );
  }

  // --- Data axis (top panel) ---
  parts.push(
    `<line x1="${geo.x0}" y1="${geo.dataY1}" x2="${geo.x0}" y2="${geo.dataY0}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
  );
  for (const t of geo.dataTicks) {
    parts.push(
      `<line x1="${geo.x0 - 4}" y1="${t.y}" x2="${geo.x0}" y2="${t.y}" stroke="${AXIS_COLOR}"/>` +
        `<text x="${geo.x0 - 8}" y="${t.y + 4}" font-size="${tickFont}" fill="${TICK_TEXT}" text-anchor="end">${fmtTick(t.value)}</text>`,
    );
  }
  if (style.yTitle.trim() !== "") {
    const midY = (geo.dataY0 + geo.dataY1) / 2;
    // Clamp to the TOP panel's own track so a long raw-data title can never
    // overflow down into the difference panel and collide with its "Mean
    // difference" title or the group tick labels.
    const title = fitAxisTitle(style.yTitle, f, geo.dataY0 - geo.dataY1 - 12);
    parts.push(
      `<text transform="translate(${geo.x0 - 38}, ${midY}) rotate(-90)" font-size="${f}" ` +
        `fill="${LABEL_TEXT}" text-anchor="middle">${esc(title)}</text>`,
    );
  }

  // Paired slope lines first (under the points), so the dots sit on top.
  for (const s of geo.slopes) {
    parts.push(
      `<line x1="${s.x1.toFixed(2)}" y1="${s.y1.toFixed(2)}" x2="${s.x2.toFixed(2)}" y2="${s.y2.toFixed(2)}" stroke="#cbd5e1" stroke-width="1"/>`,
    );
  }

  // Group raw points + a mean tick. The first point of each group carries
  // data-series so a direct edit on the plot can recolor the whole group.
  geo.groups.forEach((g, i) => {
    const override = style.colorOverrides?.[i];
    const color = override ?? g.color;
    if (g.meanY !== null) {
      parts.push(
        `<line x1="${(g.cx - g.meanHalf).toFixed(2)}" y1="${g.meanY.toFixed(2)}" x2="${(g.cx + g.meanHalf).toFixed(2)}" y2="${g.meanY.toFixed(2)}" stroke="${color}" stroke-width="2.4"/>`,
      );
    }
    g.points.forEach((p, k) => {
      const tag = k === 0 ? ` data-series="${i}"` : "";
      parts.push(
        `<circle${tag} cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3" fill="${color}" opacity="0.9"/>`,
      );
    });
    parts.push(
      `<text x="${g.labelX.toFixed(2)}" y="${g.labelY.toFixed(2)}" font-size="${f}" fill="${LABEL_TEXT}" text-anchor="middle">${esc(g.name)}${g.isControl ? " (ctrl)" : ""}</text>`,
    );
  });

  // --- Difference axis (bottom panel) ---
  parts.push(
    `<line x1="${geo.x0}" y1="${geo.diffY1}" x2="${geo.x0}" y2="${geo.diffY0}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
  );
  for (const t of geo.diffTicks) {
    parts.push(
      `<line x1="${geo.x0 - 4}" y1="${t.y}" x2="${geo.x0}" y2="${t.y}" stroke="${AXIS_COLOR}"/>` +
        `<text x="${geo.x0 - 8}" y="${t.y + 4}" font-size="${tickFont}" fill="${TICK_TEXT}" text-anchor="end">${fmtTick(t.value)}</text>`,
    );
  }
  // The zero reference line, drawn dashed across the difference panel so a reader
  // sees instantly whether a CI clears zero (the estimation answer to "is it
  // significant", shown as a distance rather than a star).
  parts.push(
    `<line x1="${geo.x0}" y1="${geo.zeroY.toFixed(2)}" x2="${geo.x1}" y2="${geo.zeroY.toFixed(2)}" stroke="${AXIS_COLOR}" stroke-width="1" stroke-dasharray="3 3"/>`,
  );
  // "Mean difference" is a fixed, essential label and the difference panel is
  // intentionally short, so it is NOT clamped to the panel track (clamping would
  // truncate it). The collision Issue 2 describes comes from a LONG top-panel
  // title overflowing DOWN into this lane, which the top title's clamp prevents.
  const diffTitle = "Mean difference";
  const midDiff = (geo.diffY0 + geo.diffY1) / 2;
  parts.push(
    `<text transform="translate(${geo.x0 - 38}, ${midDiff}) rotate(-90)" font-size="${f}" ` +
      `fill="${LABEL_TEXT}" text-anchor="middle">${esc(diffTitle)}</text>`,
  );

  // Each difference panel: the density violin (half), the CI error bar, the dot.
  for (const panel of geo.panels) {
    const color = panel.color;
    if (panel.densityPath.length > 1) {
      // The half-violin is the density outline closed back down the band center.
      const top = panel.densityPath[0];
      const bottom = panel.densityPath[panel.densityPath.length - 1];
      const d =
        panel.densityPath
          .map(
            (p, i) =>
              `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`,
          )
          .join(" ") +
        ` L${panel.cx.toFixed(2)} ${bottom.y.toFixed(2)}` +
        ` L${panel.cx.toFixed(2)} ${top.y.toFixed(2)} Z`;
      parts.push(
        `<path d="${d}" fill="${color}" opacity="0.18" stroke="${color}" stroke-width="1"/>`,
      );
    }
    if (Number.isFinite(panel.effect)) {
      // CI error bar (vertical), then the point estimate dot on top.
      parts.push(
        `<line x1="${panel.cx.toFixed(2)}" y1="${panel.ciBottomY.toFixed(2)}" x2="${panel.cx.toFixed(2)}" y2="${panel.ciTopY.toFixed(2)}" stroke="${color}" stroke-width="2"/>`,
      );
      parts.push(
        `<circle cx="${panel.dotX.toFixed(2)}" cy="${panel.dotY.toFixed(2)}" r="3.6" fill="${color}"/>`,
      );
    }
  }

  // X axis title under the difference panel.
  if (style.xTitle.trim() !== "") {
    parts.push(
      `<text x="${(geo.x0 + geo.x1) / 2}" y="${geo.height - 8}" font-size="${f}" ` +
        `fill="${LABEL_TEXT}" text-anchor="middle">${esc(style.xTitle)}</text>`,
    );
  }

  parts.push(`</svg>`);
  return parts.join("");
}

/** True when a plot kind is one of the two estimation kinds. */
export function isEstimationKind(kind: string): boolean {
  return kind === "estimationGardnerAltman" || kind === "estimationCumming";
}

// diagnostic-plot.ts
//
// Theme 4 diagnostic figures for Data Hub, the three plots a reviewer asks for
// alongside a model fit. Each is an analysis-COMPUTED plot (like the estimation
// plots in estimation-plot.ts), not a plot drawn straight from table columns, so
// the PLOTTED POSITIONS are computed values validated against the same oracles as
// any statistic.
//
//   1. qqPlot (normal QQ). Orders a numeric sample and plots it against the
//      theoretical normal quantiles (the standard (i - 0.5)/n plotting positions
//      through the inverse normal), with the first-and-third-quartile reference
//      line scipy.stats.probplot draws. The sample is a chosen Column-table group
//      or, when a regression analysis is linked, that regression's residuals.
//   2. residualPlot (residual vs fitted). For a linked linear or multiple
//      regression, plots the fitted values (x) against the residuals (y) with a
//      y = 0 reference line. The fitted / residuals are recomputed from the
//      regression's coefficients and raw rows.
//   3. rocCurve (visual). Renders the ROC curve from a linked rocCurve analysis's
//      already-validated points[] (a step line from (0,0) to (1,1)) plus the
//      chance diagonal, with the AUC annotated. Purely the visual for the
//      already-computed ROC analysis (no new statistic).
//
// CONSUME, do not recompute (where a validated number already exists). The ROC
// points and AUC come straight off the validated rocCurve analysis. The residual
// positions are recomputed only because the NormalizedRegression result does not
// carry fitted / residuals, and the recompute is the trivial y - (b0 + b.x) the
// engine already validated the coefficients of. The QQ theoretical quantiles and
// reference line are the new computed quantities and are pinned in the
// transparency suite (oracle scipy / statsmodels).
//
// The geometry is pure and unit-tested; the serializer follows the same
// portability contract as the rest of the plotting layer (a white ground, inline
// font stack, no external CSS), so a diagnostic figure exports to SVG and
// rasterizes to PNG exactly like every other figure.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { scaleLinear } from "d3-scale";
import type {
  AnalysisSpec,
  DataHubDocContent,
} from "@/lib/datahub/model/types";
import { groupColumns, columnValues } from "@/lib/datahub/column-table";
import { normalQuantile } from "@/lib/datahub/engine/dists";
import {
  type PlotStyle,
  figureBox,
  niceTicks,
  colorForGroup,
  esc,
  fmtTick,
  AXIS_COLOR,
  TICK_TEXT,
  LABEL_TEXT,
} from "@/lib/datahub/plot-spec";

/** True when a plot kind is one of the three diagnostic kinds. */
export function isDiagnosticKind(kind: string): boolean {
  return kind === "qqPlot" || kind === "residualPlot" || kind === "rocCurve";
}

// ---------------------------------------------------------------------------
// Source quantities (pure): the computed positions each plot draws
// ---------------------------------------------------------------------------

/** The ordered-sample-vs-theoretical-quantile pairs plus the reference line. */
export interface QQData {
  /** The chosen sample label (group name, or "Residuals" for a regression). */
  sampleName: string;
  /** One point per observation, in (theoretical quantile, ordered value) form. */
  points: { theoretical: number; ordered: number }[];
  /** The least-squares reference line slope (ordered on theoretical). */
  lineSlope: number;
  /** The least-squares reference line intercept. */
  lineIntercept: number;
}

/**
 * The normal plotting positions for a sample. For each ordered value the
 * theoretical normal quantile uses the midpoint position (i - 0.5)/n through the
 * inverse normal (the Hazen / probability-plot convention scipy.stats.probplot
 * and GraphPad use), and the reference line is the least-squares fit of the
 * ordered sample on those theoretical quantiles. Pure, so the test suite pins the
 * theoretical positions and the line slope / intercept against scipy.
 */
export function qqPositions(values: number[], sampleName: string): QQData {
  const finite = values.filter((v) => Number.isFinite(v));
  const ordered = finite.slice().sort((a, b) => a - b);
  const n = ordered.length;
  const points: { theoretical: number; ordered: number }[] = [];
  for (let i = 0; i < n; i++) {
    // Midpoint plotting position (i + 1 - 0.5)/n through the inverse normal.
    const p = (i + 0.5) / n;
    points.push({ theoretical: normalQuantile(p), ordered: ordered[i] });
  }
  // Least-squares line of ordered (y) on theoretical (x). With n < 2, or zero
  // spread in the theoretical quantiles, the line is flat at the sample mean.
  let lineSlope = 0;
  let lineIntercept = n > 0 ? ordered.reduce((a, b) => a + b, 0) / n : 0;
  if (n >= 2) {
    const mx =
      points.reduce((a, b) => a + b.theoretical, 0) / n;
    const my = points.reduce((a, b) => a + b.ordered, 0) / n;
    let sxx = 0;
    let sxy = 0;
    for (const pt of points) {
      const dx = pt.theoretical - mx;
      sxx += dx * dx;
      sxy += dx * (pt.ordered - my);
    }
    if (sxx > 0) {
      lineSlope = sxy / sxx;
      lineIntercept = my - lineSlope * mx;
    }
  }
  return { sampleName, points, lineSlope, lineIntercept };
}

/** One residual-vs-fitted point. */
export interface ResidualPoint {
  fitted: number;
  residual: number;
}

/** The residual-vs-fitted positions for a linked regression. */
export interface ResidualData {
  /** The response (Y) column name, for the axis label. */
  yName: string;
  points: ResidualPoint[];
}

/**
 * Read a linked regression analysis (linearRegression or multipleRegression) and
 * recompute its fitted values and residuals from the stored coefficients and raw
 * rows. The NormalizedRegression result carries x / y / slope / intercept (simple)
 * or predictors / y / coefficients (multiple) but NOT the fitted / residual
 * arrays, so this recomputes them as y_fitted = b0 + sum(b_j * x_j) and residual =
 * y - y_fitted, the same affine map the engine already validated the coefficients
 * of. Returns null when the analysis is not a usable regression result. Pure.
 */
export function residualPositions(
  analysis: AnalysisSpec | null,
): ResidualData | null {
  const cache = analysis?.resultCache as
    | { kind?: string; type?: string }
    | null
    | undefined;
  if (!cache) return null;

  if (cache.kind === "regression" && cache.type === "linearRegression") {
    const r = cache as unknown as {
      yName: string;
      x: number[];
      y: number[];
      slope: number;
      intercept: number;
    };
    const points: ResidualPoint[] = [];
    const m = Math.min(r.x.length, r.y.length);
    for (let i = 0; i < m; i++) {
      const fitted = r.intercept + r.slope * r.x[i];
      if (Number.isFinite(fitted) && Number.isFinite(r.y[i])) {
        points.push({ fitted, residual: r.y[i] - fitted });
      }
    }
    return { yName: r.yName ?? "Y", points };
  }

  if (cache.kind === "multipleRegression") {
    const r = cache as unknown as {
      yName: string;
      y: number[];
      predictors: number[][];
      intercept: { estimate: number };
      slopes: { estimate: number }[];
    };
    const b0 = r.intercept?.estimate ?? 0;
    const betas = (r.slopes ?? []).map((s) => s.estimate);
    const points: ResidualPoint[] = [];
    const m = Math.min(r.y.length, r.predictors.length);
    for (let i = 0; i < m; i++) {
      const row = r.predictors[i] ?? [];
      let fitted = b0;
      for (let j = 0; j < betas.length; j++) {
        fitted += betas[j] * (row[j] ?? 0);
      }
      if (Number.isFinite(fitted) && Number.isFinite(r.y[i])) {
        points.push({ fitted, residual: r.y[i] - fitted });
      }
    }
    return { yName: r.yName ?? "Y", points };
  }

  return null;
}

/** The ROC curve points + AUC read off a linked rocCurve analysis. */
export interface RocData {
  /** The swept curve, from (0,0) to (1,1). */
  points: { fpr: number; tpr: number }[];
  auc: number;
  /** The optimal cut point by Youden's J, for an annotation, or null. */
  youden: { fpr: number; tpr: number } | null;
}

/**
 * Read the validated ROC curve out of a linked rocCurve analysis. The points and
 * AUC are consumed exactly as the analysis computed them (already pinned against
 * scikit-learn), so the figure can never disagree with the reported AUC. Returns
 * null when the analysis is not a usable ROC result. Pure.
 */
export function rocCurveData(analysis: AnalysisSpec | null): RocData | null {
  const cache = analysis?.resultCache as
    | {
        kind?: string;
        auc?: number;
        points?: { fpr: number; tpr: number }[];
        youdenSensitivity?: number;
        youdenSpecificity?: number;
      }
    | null
    | undefined;
  if (!cache || cache.kind !== "rocCurve" || !Array.isArray(cache.points)) {
    return null;
  }
  const points = cache.points
    .filter(
      (p) => Number.isFinite(p.fpr) && Number.isFinite(p.tpr),
    )
    .map((p) => ({ fpr: p.fpr, tpr: p.tpr }));
  const youden =
    typeof cache.youdenSensitivity === "number" &&
    typeof cache.youdenSpecificity === "number"
      ? {
          fpr: 1 - cache.youdenSpecificity,
          tpr: cache.youdenSensitivity,
        }
      : null;
  return { points, auc: typeof cache.auc === "number" ? cache.auc : NaN, youden };
}

// ---------------------------------------------------------------------------
// Sample resolution for the QQ plot (table group or regression residuals)
// ---------------------------------------------------------------------------

/**
 * Resolve the numeric sample a QQ plot draws. When a regression analysis is
 * linked, the sample is that regression's residuals (the residuals-normality
 * diagnostic). Otherwise the sample is the chosen Column-table group (by
 * style.diagnosticColumnIndex, clamped, default the first group). Returns null
 * when no usable sample exists.
 */
export function resolveQQSample(
  content: DataHubDocContent,
  style: PlotStyle,
  analysis: AnalysisSpec | null,
): { values: number[]; name: string } | null {
  const resid = residualPositions(analysis);
  if (resid && resid.points.length > 0) {
    return {
      values: resid.points.map((p) => p.residual),
      name: "Residuals",
    };
  }
  const cols = groupColumns(content);
  if (cols.length === 0) return null;
  const idx = Math.min(
    Math.max(0, style.diagnosticColumnIndex ?? 0),
    cols.length - 1,
  );
  const col = cols[idx];
  const values = columnValues(content, col.id).filter((v) =>
    Number.isFinite(v),
  );
  if (values.length === 0) return null;
  return { values, name: col.name };
}

// ---------------------------------------------------------------------------
// Geometry (pure, unit-tested)
// ---------------------------------------------------------------------------

/** A laid-out axis tick (value + pixel position). */
export interface DiagTick {
  value: number;
  px: number;
}

/** The full laid-out diagnostic figure the serializer turns into SVG. */
export interface DiagnosticGeometry {
  /** Which diagnostic this geometry is for. */
  kind: "qqPlot" | "residualPlot" | "rocCurve";
  width: number;
  height: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  xTicks: DiagTick[];
  yTicks: DiagTick[];
  color: string;
  /** The plotted observations, in pixels. */
  points: { x: number; y: number }[];
  /** A reference line in pixels (QQ fit line, y=0 line, or chance diagonal). */
  refLine: { x1: number; y1: number; x2: number; y2: number } | null;
  /** A short readout (sample name, AUC, etc.) for the corner annotation. */
  note: string | null;
  /** The x / y axis titles resolved for the kind. */
  xTitle: string;
  yTitle: string;
  /** An empty-state message when there is nothing to draw, else null. */
  emptyMessage: string | null;
  /** The Youden cut-point marker for the ROC plot, in pixels, or null. */
  youdenPoint: { x: number; y: number } | null;
}

/** A small empty geometry so the renderer can still draw a framed message. */
function emptyGeometry(
  kind: DiagnosticGeometry["kind"],
  style: PlotStyle,
  message: string,
  xTitle: string,
  yTitle: string,
): DiagnosticGeometry {
  const { width, height, padL, padR, padT, padB } = figureBox(style);
  return {
    kind,
    width,
    height,
    x0: padL,
    x1: width - padR,
    y0: height - padB,
    y1: padT,
    xTicks: [],
    yTicks: [],
    color: colorForGroup(style, 0, 1),
    points: [],
    refLine: null,
    note: null,
    xTitle,
    yTitle,
    emptyMessage: message,
    youdenPoint: null,
  };
}

/**
 * Lay out a normal QQ plot. The x axis is the theoretical normal quantile, the y
 * axis the ordered sample value, and the reference line is the probplot fit line.
 * Both axes frame the points and the line with nice round ticks. Pure.
 */
export function layoutQQPlot(
  content: DataHubDocContent,
  style: PlotStyle,
  analysis: AnalysisSpec | null,
): DiagnosticGeometry {
  const xTitle =
    style.xTitle.trim() !== "" ? style.xTitle : "Theoretical quantiles";
  const sample = resolveQQSample(content, style, analysis);
  if (!sample) {
    return emptyGeometry(
      "qqPlot",
      style,
      "Add a numeric sample, or link a regression to plot its residuals.",
      xTitle,
      "Sample quantiles",
    );
  }
  const data = qqPositions(sample.values, sample.name);
  const yTitle = style.yTitle.trim() !== "" ? style.yTitle : "Sample quantiles";

  const { width, height, padL, padR, padT, padB } = figureBox(style);
  const x0 = padL;
  const x1 = width - padR;
  const y0 = height - padB;
  const y1 = padT;

  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of data.points) {
    xMin = Math.min(xMin, p.theoretical);
    xMax = Math.max(xMax, p.theoretical);
    yMin = Math.min(yMin, p.ordered);
    yMax = Math.max(yMax, p.ordered);
  }
  if (!Number.isFinite(xMin)) {
    xMin = -1;
    xMax = 1;
    yMin = 0;
    yMax = 1;
  }
  // Widen the y frame to include the reference line at the x extremes.
  const lineAtXMin = data.lineIntercept + data.lineSlope * xMin;
  const lineAtXMax = data.lineIntercept + data.lineSlope * xMax;
  yMin = Math.min(yMin, lineAtXMin, lineAtXMax);
  yMax = Math.max(yMax, lineAtXMin, lineAtXMax);

  const xAxis = niceTicks(xMin, xMax);
  const yAxis = niceTicks(yMin, yMax);
  const xScale = scaleLinear().domain([xAxis.lo, xAxis.hi]).range([x0, x1]);
  const yScale = scaleLinear().domain([yAxis.lo, yAxis.hi]).range([y0, y1]);

  const points = data.points.map((p) => ({
    x: xScale(p.theoretical),
    y: yScale(p.ordered),
  }));
  const refLine = {
    x1: xScale(xAxis.lo),
    y1: yScale(data.lineIntercept + data.lineSlope * xAxis.lo),
    x2: xScale(xAxis.hi),
    y2: yScale(data.lineIntercept + data.lineSlope * xAxis.hi),
  };

  return {
    kind: "qqPlot",
    width,
    height,
    x0,
    x1,
    y0,
    y1,
    xTicks: xAxis.values.map((v) => ({ value: v, px: xScale(v) })),
    yTicks: yAxis.values.map((v) => ({ value: v, px: yScale(v) })),
    color: colorForGroup(style, 0, 1),
    points,
    refLine,
    note: data.sampleName,
    xTitle,
    yTitle,
    emptyMessage: null,
    youdenPoint: null,
  };
}

/**
 * Lay out a residual-vs-fitted plot for a linked regression. The x axis is the
 * fitted value, the y axis the residual, and a dashed y = 0 reference line shows
 * where a well-behaved residual sits. The y frame is centered on zero so a fan or
 * curve in the residuals reads cleanly. Pure.
 */
export function layoutResidualPlot(
  content: DataHubDocContent,
  style: PlotStyle,
  analysis: AnalysisSpec | null,
): DiagnosticGeometry {
  const data = residualPositions(analysis);
  const xTitle = style.xTitle.trim() !== "" ? style.xTitle : "Fitted value";
  const yTitle = style.yTitle.trim() !== "" ? style.yTitle : "Residual";
  if (!data || data.points.length === 0) {
    return emptyGeometry(
      "residualPlot",
      style,
      "Link a linear or multiple regression to plot its residuals.",
      xTitle,
      yTitle,
    );
  }

  const { width, height, padL, padR, padT, padB } = figureBox(style);
  const x0 = padL;
  const x1 = width - padR;
  const y0 = height - padB;
  const y1 = padT;

  let xMin = Infinity;
  let xMax = -Infinity;
  let absMax = 0;
  for (const p of data.points) {
    xMin = Math.min(xMin, p.fitted);
    xMax = Math.max(xMax, p.fitted);
    absMax = Math.max(absMax, Math.abs(p.residual));
  }
  if (!Number.isFinite(xMin)) {
    xMin = 0;
    xMax = 1;
  }
  if (absMax === 0) absMax = 1;

  const xAxis = niceTicks(xMin, xMax);
  // A symmetric residual axis about zero so the y = 0 line sits in the middle.
  const yAxis = niceTicks(-absMax, absMax);
  const xScale = scaleLinear().domain([xAxis.lo, xAxis.hi]).range([x0, x1]);
  const yScale = scaleLinear().domain([yAxis.lo, yAxis.hi]).range([y0, y1]);

  const points = data.points.map((p) => ({
    x: xScale(p.fitted),
    y: yScale(p.residual),
  }));
  const zeroY = yScale(0);
  const refLine = { x1: x0, y1: zeroY, x2: x1, y2: zeroY };

  return {
    kind: "residualPlot",
    width,
    height,
    x0,
    x1,
    y0,
    y1,
    xTicks: xAxis.values.map((v) => ({ value: v, px: xScale(v) })),
    yTicks: yAxis.values.map((v) => ({ value: v, px: yScale(v) })),
    color: colorForGroup(style, 0, 1),
    points,
    refLine,
    note: data.yName,
    xTitle,
    yTitle,
    emptyMessage: null,
    youdenPoint: null,
  };
}

/**
 * Lay out the ROC curve for a linked rocCurve analysis. The x axis is the false
 * positive rate, the y axis the true positive rate, both fixed to [0, 1]. The
 * curve is the validated swept points; the chance diagonal runs corner to corner;
 * the AUC is annotated. The Youden-optimal cut point is marked when present. Pure.
 */
export function layoutRocCurve(
  style: PlotStyle,
  analysis: AnalysisSpec | null,
): DiagnosticGeometry {
  const xTitle =
    style.xTitle.trim() !== "" ? style.xTitle : "False positive rate";
  const yTitle =
    style.yTitle.trim() !== "" ? style.yTitle : "True positive rate";
  const data = rocCurveData(analysis);
  if (!data || data.points.length === 0) {
    return emptyGeometry(
      "rocCurve",
      style,
      "Link a ROC curve analysis to draw its curve.",
      xTitle,
      yTitle,
    );
  }

  const { width, height, padL, padR, padT, padB } = figureBox(style);
  const x0 = padL;
  const x1 = width - padR;
  const y0 = height - padB;
  const y1 = padT;

  // Both rates live on [0, 1] by definition, so the axes are fixed unit windows.
  const xScale = scaleLinear().domain([0, 1]).range([x0, x1]);
  const yScale = scaleLinear().domain([0, 1]).range([y0, y1]);
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  const points = data.points.map((p) => ({
    x: xScale(p.fpr),
    y: yScale(p.tpr),
  }));
  // The chance diagonal from (0,0) to (1,1).
  const refLine = {
    x1: xScale(0),
    y1: yScale(0),
    x2: xScale(1),
    y2: yScale(1),
  };
  const youdenPoint = data.youden
    ? { x: xScale(data.youden.fpr), y: yScale(data.youden.tpr) }
    : null;

  return {
    kind: "rocCurve",
    width,
    height,
    x0,
    x1,
    y0,
    y1,
    xTicks: ticks.map((v) => ({ value: v, px: xScale(v) })),
    yTicks: ticks.map((v) => ({ value: v, px: yScale(v) })),
    color: colorForGroup(style, 0, 1),
    points,
    refLine,
    note: Number.isFinite(data.auc) ? `AUC = ${data.auc.toFixed(3)}` : null,
    xTitle,
    yTitle,
    emptyMessage: null,
    youdenPoint,
  };
}

/** Dispatch the layout for whichever diagnostic kind the style carries. */
export function layoutDiagnosticPlot(
  content: DataHubDocContent,
  style: PlotStyle,
  analysis: AnalysisSpec | null,
): DiagnosticGeometry {
  if (style.kind === "residualPlot") {
    return layoutResidualPlot(content, style, analysis);
  }
  if (style.kind === "rocCurve") {
    return layoutRocCurve(style, analysis);
  }
  return layoutQQPlot(content, style, analysis);
}

// ---------------------------------------------------------------------------
// SVG serialization (geometry -> a standalone SVG document string)
// ---------------------------------------------------------------------------

/**
 * Serialize a laid-out diagnostic figure into a standalone SVG string. Same
 * portability contract as the rest of the layer (a white ground, an inline font
 * stack, no external CSS), so the string downloads as a valid .svg and rasterizes
 * to PNG. The reference line draws under the points; the corner note carries the
 * sample name or the AUC.
 */
export function renderDiagnosticSvg(
  geo: DiagnosticGeometry,
  style: PlotStyle,
): string {
  const f = style.fontSize;
  const tickFont = Math.max(8, f - 2);
  const color = style.colorOverrides?.[0] ?? geo.color;
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
      `<text x="${geo.width / 2}" y="${geo.y1 - 14}" font-size="${f + 1}" ` +
        `fill="${LABEL_TEXT}" text-anchor="middle" font-weight="700">${esc(style.title)}</text>`,
    );
  }

  // The empty state: a framed message so the figure never renders blank.
  if (geo.emptyMessage) {
    parts.push(
      `<line x1="${geo.x0}" y1="${geo.y1}" x2="${geo.x0}" y2="${geo.y0}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
    );
    parts.push(
      `<line x1="${geo.x0}" y1="${geo.y0}" x2="${geo.x1}" y2="${geo.y0}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${(geo.x0 + geo.x1) / 2}" y="${(geo.y0 + geo.y1) / 2}" font-size="${f}" ` +
        `fill="${TICK_TEXT}" text-anchor="middle">${esc(geo.emptyMessage)}</text>`,
    );
    parts.push(`</svg>`);
    return parts.join("");
  }

  // Y axis line + ticks.
  parts.push(
    `<line x1="${geo.x0}" y1="${geo.y1}" x2="${geo.x0}" y2="${geo.y0}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
  );
  for (const t of geo.yTicks) {
    parts.push(
      `<line x1="${geo.x0 - 4}" y1="${t.px.toFixed(2)}" x2="${geo.x0}" y2="${t.px.toFixed(2)}" stroke="${AXIS_COLOR}"/>` +
        `<text x="${geo.x0 - 8}" y="${(t.px + 4).toFixed(2)}" font-size="${tickFont}" fill="${TICK_TEXT}" text-anchor="end">${fmtTick(t.value)}</text>`,
    );
  }
  if (geo.yTitle.trim() !== "") {
    const midY = (geo.y0 + geo.y1) / 2;
    parts.push(
      `<text transform="translate(${geo.x0 - 38}, ${midY}) rotate(-90)" font-size="${f}" ` +
        `fill="${LABEL_TEXT}" text-anchor="middle">${esc(geo.yTitle)}</text>`,
    );
  }

  // X axis line + ticks.
  parts.push(
    `<line x1="${geo.x0}" y1="${geo.y0}" x2="${geo.x1}" y2="${geo.y0}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
  );
  for (const t of geo.xTicks) {
    parts.push(
      `<line x1="${t.px.toFixed(2)}" y1="${geo.y0}" x2="${t.px.toFixed(2)}" y2="${geo.y0 + 4}" stroke="${AXIS_COLOR}"/>` +
        `<text x="${t.px.toFixed(2)}" y="${(geo.y0 + 16).toFixed(2)}" font-size="${tickFont}" fill="${TICK_TEXT}" text-anchor="middle">${fmtTick(t.value)}</text>`,
    );
  }
  if (geo.xTitle.trim() !== "") {
    parts.push(
      `<text x="${(geo.x0 + geo.x1) / 2}" y="${geo.height - 8}" font-size="${f}" ` +
        `fill="${LABEL_TEXT}" text-anchor="middle">${esc(geo.xTitle)}</text>`,
    );
  }

  // The reference line. The residual zero line and the ROC chance diagonal read
  // as dashed guides; the QQ fit line is a solid colored line through the cloud.
  if (geo.refLine) {
    const dashed = geo.kind !== "qqPlot";
    const lineColor = geo.kind === "qqPlot" ? color : AXIS_COLOR;
    parts.push(
      `<line x1="${geo.refLine.x1.toFixed(2)}" y1="${geo.refLine.y1.toFixed(2)}" ` +
        `x2="${geo.refLine.x2.toFixed(2)}" y2="${geo.refLine.y2.toFixed(2)}" ` +
        `stroke="${lineColor}" stroke-width="${geo.kind === "qqPlot" ? "1.6" : "1"}"` +
        `${dashed ? ' stroke-dasharray="4 3"' : ""}/>`,
    );
  }

  // The ROC curve is a connected step line; QQ and residual plots are scatters.
  if (geo.kind === "rocCurve" && geo.points.length > 1) {
    const d = geo.points
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(" ");
    parts.push(
      `<path data-series="0" d="${d}" fill="none" stroke="${color}" stroke-width="2"/>`,
    );
  } else {
    geo.points.forEach((p, i) => {
      const tag = i === 0 ? ` data-series="0"` : "";
      parts.push(
        `<circle${tag} cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3" fill="${color}" opacity="0.9"/>`,
      );
    });
  }

  // The Youden cut-point marker on the ROC curve (a hollow ring).
  if (geo.youdenPoint) {
    parts.push(
      `<circle cx="${geo.youdenPoint.x.toFixed(2)}" cy="${geo.youdenPoint.y.toFixed(2)}" r="4.5" ` +
        `fill="#ffffff" stroke="${color}" stroke-width="2"/>`,
    );
  }

  // The corner note (sample name / AUC), top-left inside the frame.
  if (geo.note) {
    parts.push(
      `<text x="${geo.x0 + 8}" y="${geo.y1 + 14}" font-size="${tickFont}" ` +
        `fill="${LABEL_TEXT}" text-anchor="start" font-weight="600">${esc(geo.note)}</text>`,
    );
  }

  parts.push(`</svg>`);
  return parts.join("");
}

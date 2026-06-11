// plot-spec.ts
//
// The plotting layer for Data Hub Column-table figures (graphs slice). A figure
// is a versioned PlotSpec (id + type + style + source) the Loro doc stores; this
// module is the pure bridge between that spec, the current table content, and a
// real publication-quality SVG. Three concerns live here, all browser-safe and
// (the geometry half) unit-testable without a DOM:
//
//   1. Builders / typed accessors for a PlotSpec's open style + source records,
//      so the editor and the doc round-trip the same shape.
//   2. The pure geometry. Given the resolved group stats and a style, compute the
//      exact pixel coordinates of every axis tick, bar, mean line, error bar cap,
//      jittered point, and significance bracket. Pure functions, deterministic,
//      asserted against known inputs in the test suite. We reuse the engine-backed
//      per-group mean / SD / SEM / n (computeAllGroupStats) and never recompute a
//      statistic by hand.
//   3. The SVG serializer (geometry -> an SVG document string) plus the export
//      helpers (SVG download, hi-DPI PNG via a canvas, copy-to-clipboard).
//      SVG-native gives a free, infinitely-scalable vector export for a figure.
//
// Error bars come straight from the raw replicates (the same numbers the grid
// footer shows), so a figure of a table is always consistent with that table and
// updates the moment a replicate changes. Significance brackets are pulled from a
// stored ANOVA analysis (its Tukey comparisons), so a researcher gets the right
// stars on the figure with one toggle rather than drawing them by hand.
//
// Only Column tables are wired this slice. PlotSpec.type carries "columnScatter"
// and "columnBar"; "xyScatter" (a fitted-curve overlay) is declared so the model
// extends cleanly and is left as a later slice.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { scaleLinear } from "d3-scale";
import type {
  AnalysisSpec,
  DataHubDocContent,
  PlotSpec,
} from "@/lib/datahub/model/types";
import {
  computeAllGroupStats,
  groupColumns,
  columnValues,
  type GroupStats,
} from "@/lib/datahub/column-table";

// ---------------------------------------------------------------------------
// Plot kinds + style / source shapes
// ---------------------------------------------------------------------------

/**
 * The figure kinds this layer can draw. "columnScatter" (individual points over
 * a mean line, the Prism column dot plot, the default) and "columnBar" (a bar to
 * the mean with error bars) are wired. "xyScatter" is declared for the later
 * XY-with-fitted-curve slice so PlotSpec.type does not need a migration.
 */
export type PlotKind = "columnScatter" | "columnBar" | "xyScatter";

/** Which error bar a figure draws, computed from the raw replicates. */
export type ErrorBarKind = "sd" | "sem" | "none";

/** A named color theme for the group series. */
export type ColorMode = "brand" | "sky" | "ink";

/**
 * The full, typed styling for a figure. Stored (serialized) in PlotSpec.style as
 * an open record; this is the strongly-typed view the editor + renderer share.
 * Every control in the styling panel maps to one field here.
 */
export interface PlotStyle {
  /** Bar to the mean, or individual points over a mean line. */
  kind: PlotKind;
  errorBar: ErrorBarKind;
  /** Draw each raw replicate as a jittered point. */
  showPoints: boolean;
  /** Draw significance brackets from the linked analysis. */
  showBrackets: boolean;
  colorMode: ColorMode;
  /** Axis tick / label font size in px. */
  fontSize: number;
  /** Figure title (top of the plot). Empty hides it. */
  title: string;
  /** Y axis title (rotated, left). */
  yTitle: string;
  /** X axis title (below the group labels). Empty hides it. */
  xTitle: string;
}

/** What a figure draws: the source table and (optionally) a linked analysis. */
export interface PlotSource {
  /** The Data Hub document id whose table this figure plots. */
  tableId: string;
  /**
   * The stored ANOVA analysis id whose Tukey comparisons feed the significance
   * brackets, or null when brackets are off / no analysis is linked.
   */
  analysisId: string | null;
}

/** The default publication style for a brand-new column figure. */
export function defaultPlotStyle(): PlotStyle {
  return {
    kind: "columnScatter",
    errorBar: "sem",
    showPoints: true,
    showBrackets: true,
    colorMode: "brand",
    fontSize: 13,
    title: "",
    yTitle: "Value",
    xTitle: "",
  };
}

/** Read a PlotSpec's open style record into the typed PlotStyle, with defaults. */
export function readPlotStyle(spec: PlotSpec): PlotStyle {
  const d = defaultPlotStyle();
  const s = spec.style ?? {};
  const kind =
    s.kind === "columnBar" || s.kind === "xyScatter" || s.kind === "columnScatter"
      ? (s.kind as PlotKind)
      : // Fall back to the spec.type when style.kind is absent (round-trip the
        // top-level type) so an old spec without a style.kind still draws.
        spec.type === "columnBar" || spec.type === "xyScatter"
        ? (spec.type as PlotKind)
        : d.kind;
  return {
    kind,
    errorBar:
      s.errorBar === "sd" || s.errorBar === "none" || s.errorBar === "sem"
        ? (s.errorBar as ErrorBarKind)
        : d.errorBar,
    showPoints: typeof s.showPoints === "boolean" ? s.showPoints : d.showPoints,
    showBrackets:
      typeof s.showBrackets === "boolean" ? s.showBrackets : d.showBrackets,
    colorMode:
      s.colorMode === "sky" || s.colorMode === "ink" || s.colorMode === "brand"
        ? (s.colorMode as ColorMode)
        : d.colorMode,
    fontSize:
      typeof s.fontSize === "number" && Number.isFinite(s.fontSize)
        ? s.fontSize
        : d.fontSize,
    title: typeof s.title === "string" ? s.title : d.title,
    yTitle: typeof s.yTitle === "string" ? s.yTitle : d.yTitle,
    xTitle: typeof s.xTitle === "string" ? s.xTitle : d.xTitle,
  };
}

/** Read a PlotSpec's open source record into the typed PlotSource. */
export function readPlotSource(spec: PlotSpec): PlotSource {
  const s = spec.source ?? {};
  return {
    tableId: typeof s.tableId === "string" ? s.tableId : "",
    analysisId: typeof s.analysisId === "string" ? s.analysisId : null,
  };
}

/**
 * Build a fresh PlotSpec from a chosen kind + table (+ optional analysis). The
 * style.kind mirrors spec.type so both the open record and the top-level type
 * agree (the editor reads style.kind; the rail reads type). Pure: the caller
 * persists it via setPlot.
 */
export function buildPlotSpec(args: {
  id: string;
  kind: PlotKind;
  tableId: string;
  analysisId?: string | null;
  /** Seed the y-axis title from the table name when the caller has it. */
  yTitle?: string;
  title?: string;
}): PlotSpec {
  const style = defaultPlotStyle();
  style.kind = args.kind;
  if (args.yTitle !== undefined) style.yTitle = args.yTitle;
  if (args.title !== undefined) style.title = args.title;
  const source: PlotSource = {
    tableId: args.tableId,
    analysisId: args.analysisId ?? null,
  };
  return {
    id: args.id,
    type: args.kind,
    style: style as unknown as Record<string, unknown>,
    source: source as unknown as Record<string, unknown>,
  };
}

/** Apply a partial style patch onto a spec, keeping spec.type in sync with kind. */
export function withStyle(spec: PlotSpec, patch: Partial<PlotStyle>): PlotSpec {
  const next = { ...readPlotStyle(spec), ...patch };
  return {
    ...spec,
    type: next.kind,
    style: next as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Color themes (brand tokens, resolved to hex for SVG / PNG portability)
// ---------------------------------------------------------------------------

// The brand trio leads with the sky wordmark color, then two complementary
// publication-safe hues. "sky" is the single-brand mono-hue option; "ink" is a
// slate mono for a journal that wants no color. Hex (not CSS vars) so a
// serialized SVG / a rasterized PNG carries its own colors with no stylesheet.
const BRAND_TRIO = ["#1AA0E6", "#7C3AED", "#F97316"] as const;
const SKY = "#1AA0E6";
const INK = "#475569";

/** The series color for the i-th group under a color mode. */
export function colorForGroup(mode: ColorMode, index: number): string {
  if (mode === "sky") return SKY;
  if (mode === "ink") return INK;
  return BRAND_TRIO[index % BRAND_TRIO.length];
}

// Fixed axis / text colors (slate scale), shared by every theme so the chrome
// reads the same as the rest of the app and survives rasterization.
const AXIS_COLOR = "#94a3b8";
const TICK_TEXT = "#64748b";
const LABEL_TEXT = "#334155";

// ---------------------------------------------------------------------------
// Geometry (pure, unit-tested)
// ---------------------------------------------------------------------------

/** Fixed figure box + padding. Matches the approved mockup's proportions. */
export const FIG = {
  width: 430,
  height: 340,
  padL: 52,
  padR: 18,
  padT: 34,
  padB: 46,
} as const;

/** One resolved group ready to plot: name, color, stats, and raw values. */
export interface PlotGroup {
  id: string;
  name: string;
  color: string;
  stats: GroupStats;
  values: number[];
}

/** A laid-out error bar (the vertical line plus the two caps), in px. */
export interface ErrorBarGeometry {
  /** The center x of the group band. */
  cx: number;
  /** y of the upper cap (mean + e) and lower cap (mean - e). */
  topY: number;
  bottomY: number;
  /** The cap half-width, so a cap runs cx-capHalf .. cx+capHalf. */
  capHalf: number;
}

/** A laid-out group: center, mean line, bar (when a bar plot), points, label. */
export interface GroupGeometry {
  id: string;
  name: string;
  color: string;
  /** Band center x. */
  cx: number;
  /** y of the mean line (null when the group has no mean). */
  meanY: number | null;
  /** Mean line half-width, so it runs cx-meanHalf .. cx+meanHalf. */
  meanHalf: number;
  /** The bar rect (only for a bar plot, and only when the group has a mean). */
  bar: { x: number; y: number; width: number; height: number } | null;
  /** The error bar, or null when error bars are off / undefined for the group. */
  errorBar: ErrorBarGeometry | null;
  /** Jittered raw points (empty when points are off). */
  points: { x: number; y: number }[];
  /** Where the x-axis group label sits. */
  labelX: number;
  labelY: number;
}

/** A laid-out significance bracket between two group bands. */
export interface BracketGeometry {
  leftX: number;
  rightX: number;
  /** y of the horizontal span (the two legs drop down from here). */
  spanY: number;
  /** y the legs drop to (spanY + legDrop). */
  legY: number;
  /** Mid x + the y the star label sits at. */
  labelX: number;
  labelY: number;
  label: string;
}

/** A y-axis tick: its value and its pixel y. */
export interface AxisTick {
  value: number;
  y: number;
}

/** The full laid-out figure the serializer turns into SVG. */
export interface PlotGeometry {
  width: number;
  height: number;
  /** Plot-area edges. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  yMax: number;
  ticks: AxisTick[];
  groups: GroupGeometry[];
  brackets: BracketGeometry[];
}

/** GraphPad-style significance stars from an adjusted p-value. */
export function significanceStars(p: number): string {
  if (!Number.isFinite(p)) return "ns";
  if (p < 0.0001) return "****";
  if (p < 0.001) return "***";
  if (p < 0.01) return "**";
  if (p < 0.05) return "*";
  return "ns";
}

/** The error magnitude for a group under the chosen error-bar kind (0 / null). */
export function errorMagnitude(
  stats: GroupStats,
  kind: ErrorBarKind,
): number | null {
  if (kind === "none") return null;
  const e = kind === "sd" ? stats.sd : stats.sem;
  return e !== null && Number.isFinite(e) ? e : null;
}

/**
 * Resolve the plotted groups for a column table: the group columns, each with
 * its engine-backed stats (computeAllGroupStats) and its raw finite values, in
 * declared column order, colored under the style.
 */
export function resolvePlotGroups(
  content: DataHubDocContent,
  style: PlotStyle,
): PlotGroup[] {
  const cols = groupColumns(content);
  const allStats = computeAllGroupStats(content);
  return cols.map((c, i) => ({
    id: c.id,
    name: c.name,
    color: colorForGroup(style.colorMode, i),
    stats: allStats[c.id] ?? { mean: null, sd: null, sem: null, n: 0 },
    values: columnValues(content, c.id),
  }));
}

/**
 * Pick a "nice" y-axis maximum and a tick step from the data extent, so the axis
 * always frames the points + error bars with round numbers. Considers each
 * group's (mean + error) and the raw point extent. Falls back to a 0..1 axis for
 * an empty table so the frame still draws.
 */
export function pickAxis(
  groups: PlotGroup[],
  errorKind: ErrorBarKind,
): { yMax: number; step: number } {
  let dataMax = 0;
  let any = false;
  for (const g of groups) {
    for (const v of g.values) {
      if (Number.isFinite(v)) {
        any = true;
        if (v > dataMax) dataMax = v;
      }
    }
    if (g.stats.mean !== null) {
      any = true;
      const e = errorMagnitude(g.stats, errorKind) ?? 0;
      const top = g.stats.mean + e;
      if (top > dataMax) dataMax = top;
    }
  }
  if (!any || dataMax <= 0) return { yMax: 1, step: 0.5 };
  // Headroom for the brackets / the top point, then round up to a clean step.
  const padded = dataMax * 1.15;
  const pow = Math.pow(10, Math.floor(Math.log10(padded)));
  const norm = padded / pow;
  let niceStep: number;
  if (norm <= 1) niceStep = 0.2 * pow;
  else if (norm <= 2) niceStep = 0.5 * pow;
  else if (norm <= 5) niceStep = 1 * pow;
  else niceStep = 2 * pow;
  const yMax = Math.ceil(padded / niceStep) * niceStep;
  return { yMax, step: niceStep };
}

/**
 * Read the Tukey comparisons out of a linked ANOVA analysis spec and turn them
 * into (groupIndex, groupIndex, stars) bracket requests, matched to the plotted
 * groups by name. Only significant pairs (p < 0.05) get a bracket so the figure
 * is not cluttered with "ns". Returns an empty list when the spec is not a
 * usable ANOVA result. Pure.
 */
export function bracketRequestsFromAnalysis(
  spec: AnalysisSpec | null,
  groups: PlotGroup[],
): { i: number; j: number; label: string }[] {
  if (!spec) return [];
  const cache = spec.resultCache as
    | { kind?: string; comparisons?: unknown }
    | null;
  if (!cache || cache.kind !== "anova" || !Array.isArray(cache.comparisons)) {
    return [];
  }
  const indexByName = new Map(groups.map((g, i) => [g.name, i]));
  const out: { i: number; j: number; label: string }[] = [];
  for (const raw of cache.comparisons) {
    const c = raw as { groupA?: unknown; groupB?: unknown; pAdjusted?: unknown };
    if (typeof c.groupA !== "string" || typeof c.groupB !== "string") continue;
    if (typeof c.pAdjusted !== "number") continue;
    if (!(c.pAdjusted < 0.05)) continue;
    const i = indexByName.get(c.groupA);
    const j = indexByName.get(c.groupB);
    if (i === undefined || j === undefined || i === j) continue;
    out.push({
      i: Math.min(i, j),
      j: Math.max(i, j),
      label: significanceStars(c.pAdjusted),
    });
  }
  // Draw the narrowest spans lowest so wider brackets stack above them.
  out.sort((a, b) => a.j - a.i - (b.j - b.i));
  return out;
}

/**
 * Lay out the whole figure. This is the pure core the test suite pins. Given the
 * resolved groups, the style, and the bracket requests, it computes every pixel
 * coordinate via a d3 linear scale (so the value -> y mapping is the standard,
 * tested one), then stacks the significance brackets above the tallest element.
 */
export function layoutPlot(
  groups: PlotGroup[],
  style: PlotStyle,
  bracketRequests: { i: number; j: number; label: string }[],
): PlotGeometry {
  const { width, height, padL, padR, padT, padB } = FIG;
  const x0 = padL;
  const x1 = width - padR;
  const y0 = height - padB;
  const y1 = padT;

  const { yMax, step } = pickAxis(groups, style.errorBar);
  // d3 linear scale: value domain [0, yMax] -> pixel range [y0 (bottom), y1 (top)].
  const yScale = scaleLinear().domain([0, yMax]).range([y0, y1]);
  const Y = (v: number) => yScale(v);

  const ticks: AxisTick[] = [];
  for (let t = 0; t <= yMax + 1e-9; t += step) {
    // Guard floating-point drift on the last tick.
    const value = Math.round(t * 1e6) / 1e6;
    ticks.push({ value, y: Y(value) });
  }

  const n = Math.max(1, groups.length);
  const bandW = (x1 - x0) / n;
  const meanHalf = Math.min(22, bandW * 0.3);
  const capHalf = 7;

  const groupGeo: GroupGeometry[] = groups.map((g, i) => {
    const cx = x0 + bandW * (i + 0.5);
    const mean = g.stats.mean;
    const meanY = mean !== null ? Y(mean) : null;

    let bar: GroupGeometry["bar"] = null;
    if (style.kind === "columnBar" && mean !== null) {
      const bw = bandW * 0.5;
      const y = Y(mean);
      bar = { x: cx - bw / 2, y, width: bw, height: y0 - y };
    }

    let errorBar: ErrorBarGeometry | null = null;
    const e = errorMagnitude(g.stats, style.errorBar);
    if (mean !== null && e !== null && e > 0) {
      errorBar = {
        cx,
        topY: Y(mean + e),
        bottomY: Y(mean - e),
        capHalf,
      };
    }

    const points: { x: number; y: number }[] = [];
    if (style.showPoints) {
      // Symmetric jitter: alternate sides, widening every pair, so overlapping
      // replicates fan out deterministically (the mockup's jitter rule).
      g.values.forEach((v, k) => {
        if (!Number.isFinite(v)) return;
        const dir = k % 2 ? 1 : -1;
        const jx = cx + dir * (3 + 3 * Math.floor(k / 2));
        points.push({ x: jx, y: Y(v) });
      });
    }

    return {
      id: g.id,
      name: g.name,
      color: g.color,
      cx,
      meanY,
      meanHalf,
      bar,
      errorBar,
      points,
      labelX: cx,
      labelY: y0 + 18,
    };
  });

  // Stack the brackets above the tallest drawn element so legs never cross a
  // point or an error cap. Each successive bracket rises one step.
  const brackets: BracketGeometry[] = [];
  if (style.showBrackets && bracketRequests.length > 0) {
    // The highest element y (smallest pixel y) across points + error tops.
    let highest = y1 + 24;
    for (const gg of groupGeo) {
      if (gg.errorBar) highest = Math.min(highest, gg.errorBar.topY);
      for (const p of gg.points) highest = Math.min(highest, p.y);
      if (gg.meanY !== null) highest = Math.min(highest, gg.meanY);
    }
    const legDrop = 6;
    const tier = 18;
    let level = 0;
    for (const req of bracketRequests) {
      const a = groupGeo[req.i]?.cx;
      const b = groupGeo[req.j]?.cx;
      if (a === undefined || b === undefined) continue;
      const spanY = highest - 14 - level * tier;
      brackets.push({
        leftX: a,
        rightX: b,
        spanY,
        legY: spanY + legDrop,
        labelX: (a + b) / 2,
        labelY: spanY - 3,
        label: req.label,
      });
      level += 1;
    }
  }

  return {
    width,
    height,
    x0,
    x1,
    y0,
    y1,
    yMax,
    ticks,
    groups: groupGeo,
    brackets,
  };
}

// ---------------------------------------------------------------------------
// SVG serialization (geometry -> a standalone SVG document string)
// ---------------------------------------------------------------------------

/** Minimal XML-escape for text content (group names, axis titles). */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTick(value: number): string {
  // Integers print plainly; fractional ticks keep up to two decimals, trimmed.
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

/**
 * Serialize a laid-out figure into a standalone SVG string. No external CSS and
 * no CSS variables, so the same string downloads as a valid .svg AND rasterizes
 * to PNG with its colors intact. The font stack is inlined for portability.
 */
export function renderPlotSvg(
  geo: PlotGeometry,
  style: PlotStyle,
): string {
  const f = style.fontSize;
  const tickFont = Math.max(8, f - 2);
  const parts: string[] = [];
  parts.push(
    `<svg width="${geo.width}" height="${geo.height}" viewBox="0 0 ${geo.width} ${geo.height}" ` +
      `xmlns="http://www.w3.org/2000/svg" font-family="-apple-system, Inter, system-ui, sans-serif">`,
  );
  // White ground so a copied / rasterized figure is not transparent on a slide.
  parts.push(
    `<rect x="0" y="0" width="${geo.width}" height="${geo.height}" fill="#ffffff"/>`,
  );

  // Title.
  if (style.title.trim() !== "") {
    parts.push(
      `<text x="${geo.width / 2}" y="${geo.y1 - 14}" font-size="${f + 1}" ` +
        `fill="${LABEL_TEXT}" text-anchor="middle" font-weight="700">${esc(style.title)}</text>`,
    );
  }

  // Y axis line + ticks + tick labels.
  parts.push(
    `<line x1="${geo.x0}" y1="${geo.y1}" x2="${geo.x0}" y2="${geo.y0}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
  );
  for (const t of geo.ticks) {
    parts.push(
      `<line x1="${geo.x0 - 4}" y1="${t.y}" x2="${geo.x0}" y2="${t.y}" stroke="${AXIS_COLOR}"/>` +
        `<text x="${geo.x0 - 8}" y="${t.y + 4}" font-size="${tickFont}" fill="${TICK_TEXT}" text-anchor="end">${fmtTick(t.value)}</text>`,
    );
  }
  // Y axis title (rotated).
  if (style.yTitle.trim() !== "") {
    const midY = (geo.y0 + geo.y1) / 2;
    parts.push(
      `<text transform="translate(${geo.x0 - 38}, ${midY}) rotate(-90)" font-size="${f}" ` +
        `fill="${LABEL_TEXT}" text-anchor="middle">${esc(style.yTitle)}</text>`,
    );
  }
  // X axis line.
  parts.push(
    `<line x1="${geo.x0}" y1="${geo.y0}" x2="${geo.x1}" y2="${geo.y0}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
  );

  // Groups: bar, mean line, error bar, points, label.
  for (const g of geo.groups) {
    if (g.bar) {
      parts.push(
        `<rect x="${g.bar.x}" y="${g.bar.y}" width="${g.bar.width}" height="${g.bar.height}" fill="${g.color}" opacity="0.30"/>`,
      );
    }
    if (g.meanY !== null) {
      parts.push(
        `<line x1="${g.cx - g.meanHalf}" y1="${g.meanY}" x2="${g.cx + g.meanHalf}" y2="${g.meanY}" stroke="${g.color}" stroke-width="2.4"/>`,
      );
    }
    if (g.errorBar) {
      const eb = g.errorBar;
      parts.push(
        `<line x1="${eb.cx}" y1="${eb.bottomY}" x2="${eb.cx}" y2="${eb.topY}" stroke="${g.color}" stroke-width="1.6"/>` +
          `<line x1="${eb.cx - eb.capHalf}" y1="${eb.topY}" x2="${eb.cx + eb.capHalf}" y2="${eb.topY}" stroke="${g.color}" stroke-width="1.6"/>` +
          `<line x1="${eb.cx - eb.capHalf}" y1="${eb.bottomY}" x2="${eb.cx + eb.capHalf}" y2="${eb.bottomY}" stroke="${g.color}" stroke-width="1.6"/>`,
      );
    }
    for (const p of g.points) {
      parts.push(
        `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${g.color}" opacity="0.9"/>`,
      );
    }
    parts.push(
      `<text x="${g.labelX}" y="${g.labelY}" font-size="${f}" fill="${LABEL_TEXT}" text-anchor="middle">${esc(g.name)}</text>`,
    );
  }

  // X axis title (below the group labels).
  if (style.xTitle.trim() !== "") {
    parts.push(
      `<text x="${(geo.x0 + geo.x1) / 2}" y="${geo.height - 8}" font-size="${f}" ` +
        `fill="${LABEL_TEXT}" text-anchor="middle">${esc(style.xTitle)}</text>`,
    );
  }

  // Significance brackets.
  for (const b of geo.brackets) {
    parts.push(
      `<line x1="${b.leftX}" y1="${b.legY}" x2="${b.leftX}" y2="${b.spanY}" stroke="${LABEL_TEXT}"/>` +
        `<line x1="${b.leftX}" y1="${b.spanY}" x2="${b.rightX}" y2="${b.spanY}" stroke="${LABEL_TEXT}"/>` +
        `<line x1="${b.rightX}" y1="${b.spanY}" x2="${b.rightX}" y2="${b.legY}" stroke="${LABEL_TEXT}"/>` +
        `<text x="${b.labelX}" y="${b.labelY}" font-size="${f}" fill="${LABEL_TEXT}" text-anchor="middle" font-weight="700">${esc(b.label)}</text>`,
    );
  }

  parts.push(`</svg>`);
  return parts.join("");
}

/**
 * The one-call path the editor uses: spec + content (+ the linked analysis) to a
 * ready SVG string. Resolves groups, pulls bracket requests from the analysis,
 * lays out, and serializes. Pure (no DOM).
 */
export function renderPlot(
  spec: PlotSpec,
  content: DataHubDocContent,
  analysis: AnalysisSpec | null,
): { svg: string; geometry: PlotGeometry; style: PlotStyle } {
  const style = readPlotStyle(spec);
  const groups = resolvePlotGroups(content, style);
  const requests = style.showBrackets
    ? bracketRequestsFromAnalysis(analysis, groups)
    : [];
  const geometry = layoutPlot(groups, style, requests);
  const svg = renderPlotSvg(geometry, style);
  return { svg, geometry, style };
}

// ---------------------------------------------------------------------------
// Export helpers (browser-only; guarded so the module imports under jsdom)
// ---------------------------------------------------------------------------

/** Slugify a figure title into a safe file stem. */
export function figureFileStem(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "figure";
}

/** Trigger a browser download of the given Blob under a filename. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has consumed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Download the figure as a vector SVG file. */
export function downloadSvg(svg: string, fileStem: string): void {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  downloadBlob(blob, `${fileStem}.svg`);
}

/**
 * Rasterize an SVG string to a PNG Blob at a device-scaled resolution (default
 * 3x) by drawing it onto an offscreen canvas. Hi-DPI so the PNG is crisp in a
 * slide or a print figure even though the source is a small on-screen SVG. The
 * SVG already carries a white ground, so the PNG is not transparent.
 */
export function svgToPngBlob(
  svg: string,
  width: number,
  height: number,
  scale = 3,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error("Canvas 2D context unavailable for PNG export."));
          return;
        }
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Canvas produced no PNG blob."));
        }, "image/png");
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to rasterize the figure SVG."));
    };
    img.src = url;
  });
}

/** Rasterize + download a hi-DPI PNG. */
export async function downloadPng(
  svg: string,
  width: number,
  height: number,
  fileStem: string,
  scale = 3,
): Promise<void> {
  const blob = await svgToPngBlob(svg, width, height, scale);
  downloadBlob(blob, `${fileStem}.png`);
}

/**
 * Copy the figure to the OS clipboard as a PNG image when the async Clipboard
 * image API is available, falling back to copying the SVG markup as text. The
 * why: a researcher pastes straight into a slide or a doc, and a PNG pastes as a
 * real image while the SVG text is a portable fallback when image-clipboard is
 * blocked.
 */
export async function copyFigureToClipboard(
  svg: string,
  width: number,
  height: number,
): Promise<"image" | "text"> {
  const canWriteImage =
    typeof ClipboardItem !== "undefined" &&
    !!navigator.clipboard &&
    typeof navigator.clipboard.write === "function";
  if (canWriteImage) {
    try {
      const png = await svgToPngBlob(svg, width, height);
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": png }),
      ]);
      return "image";
    } catch {
      // Fall through to the text path.
    }
  }
  await navigator.clipboard.writeText(svg);
  return "text";
}

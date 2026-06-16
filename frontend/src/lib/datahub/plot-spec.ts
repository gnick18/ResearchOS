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

import { scaleLinear, scaleLog } from "d3-scale";
import { tCritTwoSided } from "@/lib/datahub/engine/dists";
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
import {
  isSummaryFormat,
  readAllGroupSummaries,
  type GroupSummary,
} from "@/lib/datahub/summary-table";
import { xColumn, xyPairs, yColumns } from "@/lib/datahub/xy-table";
import {
  cellMean,
  groupDatasets,
  rowFactorLevels,
} from "@/lib/datahub/grouped-table";
import { survivalGroups } from "@/lib/datahub/survival-table";
import {
  fitModel,
  getModel,
  prepareFitData,
  kaplanMeier,
} from "@/lib/datahub/engine";
import type { BootstrapMethod } from "@/lib/datahub/engine/bootstrap";
import {
  layoutEstimationPlot,
  renderEstimationSvg,
  type EstimationGeometry,
} from "@/lib/datahub/estimation-plot";
import {
  layoutDiagnosticPlot,
  renderDiagnosticSvg,
  type DiagnosticGeometry,
} from "@/lib/datahub/diagnostic-plot";
// Type-only import (the artboard lib imports VALUES from this module, so a value
// import here would create a runtime cycle). The consumer normalizes the raw
// stored value with readArtboardState; PlotStyle just carries it through.
import type { ArtboardState } from "@/lib/figure/artboard";
import {
  layoutPartsOfWhole,
  renderPartsOfWholeSvg,
  type PartsOfWholeGeometry,
} from "@/lib/datahub/parts-of-whole-plot";
import {
  paletteById,
  samplePalette,
  DEFAULT_PALETTE_ID,
  GREY_RAMP_ID,
  type Palette,
} from "@/lib/datahub/palettes";

// ---------------------------------------------------------------------------
// Plot kinds + style / source shapes
// ---------------------------------------------------------------------------

/**
 * The figure kinds this layer can draw. "columnScatter" (individual points over
 * a mean line, the Prism column dot plot, the default) and "columnBar" (a bar to
 * the mean with error bars) are wired. "xyScatter" is declared for the later
 * XY-with-fitted-curve slice so PlotSpec.type does not need a migration.
 */
export type PlotKind =
  | "columnScatter"
  | "columnBar"
  | "xyScatter"
  | "groupedBar"
  | "survivalCurve"
  // E2 estimation plots (the effect-size-with-CI figure, the modern alternative
  // to the bar-with-stars). "estimationGardnerAltman" is the two-group form (raw
  // data left, the bootstrap mean-difference distribution + CI on a second axis
  // right). "estimationCumming" is the multi-group extension sharing one control,
  // one difference panel per non-control group. Both consume the validated E4
  // bootstrap and never recompute a statistic.
  | "estimationGardnerAltman"
  | "estimationCumming"
  // Theme 4 diagnostic plots (the figures a reviewer asks for alongside a fit).
  // "qqPlot" is the normal QQ plot of a sample (a Column group) or a linked
  // regression's residuals. "residualPlot" is residual-vs-fitted for a linked
  // linear / multiple regression. "rocCurve" is the visual for an already-
  // computed + validated rocCurve analysis. All three are analysis-computed
  // plots and render through the same SVG pipeline (see diagnostic-plot.ts).
  | "qqPlot"
  | "residualPlot"
  | "rocCurve"
  // Parts-of-whole figures (the composition of a single whole, no statistic).
  // "pie" draws one wedge per category sized by value, labeled with category +
  // percent. "donut" is the pie with a center hole (donutHoleRatio) and the
  // total in the center. "stackedBar" is a single 100-percent stacked column,
  // one segment per category. All three read the resolved category/value pairs
  // and render through the same SVG pipeline (see parts-of-whole-plot.ts).
  | "pie"
  | "donut"
  | "stackedBar";

/** Which error bar a figure draws, computed from the raw replicates. */
export type ErrorBarKind = "sd" | "sem" | "ci95" | "none";

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
  /**
   * Legacy single-hue color mode. Kept for back-compat (an old spec without a
   * palette maps its colorMode onto a palette id in readPlotStyle); the studio
   * writes `palette` instead.
   */
  colorMode: ColorMode;
  /**
   * The active palette id (see lib/datahub/palettes). Sampled to the figure's
   * series count so one palette recolors the whole figure. Absent on an old
   * spec, where colorMode supplies the color instead.
   */
  palette?: string;
  /**
   * Per-series color overrides (series index -> hex). A direct edit on the plot
   * (double-click / right-click) or the custom-color studio writes here; a
   * series with an override ignores the sampled palette color. Additive and
   * back-compat (absent means no overrides).
   */
  colorOverrides?: Record<number, string>;
  /** Axis tick / label font size in px. */
  fontSize: number;
  /** Figure title (top of the plot). Empty hides it. */
  title: string;
  /** Y axis title (rotated, left). */
  yTitle: string;
  /** X axis title (below the group labels). Empty hides it. */
  xTitle: string;
  /**
   * How x-axis group labels are oriented. "auto" (default) keeps them flat and
   * only angles them when they would overlap; "horizontal" forces flat;
   * "angled" forces the rotated layout. (Wrap / shrink are future modes.)
   */
  xLabelMode?: "auto" | "horizontal" | "angled";
  /**
   * For an XY figure, the curve fitted over the scatter. "none" draws points
   * only; "linear" draws the least-squares line; any other id is a registered
   * nonlinear model (4PL, Michaelis-Menten, exponential, ...). Ignored by the
   * column figures.
   */
  fitModel: FitModelId;
  /**
   * Figure size (additive, all optional, back-compat). When width/height are
   * absent the figure renders at the kind's base FIG size, byte-for-byte the
   * same as before sizing existed. width/height are stored in `sizeUnit`
   * (px / in / cm), converted to design-px (96 per inch) for the geometry box
   * and to physical inches for export. `dpi` is the export rasterization
   * density (a 3.5 in figure at 300 DPI exports a 1050 px wide PNG). `resizeMode`
   * is how a resize changes the figure. "relayout" (the default) recomputes the
   * axes / margins to fill the new box so the figure stays legible at journal
   * dimensions; "scale" keeps the base layout and zooms the whole figure like a
   * slide image. `aspectLocked` keeps the width/height ratio while resizing.
   */
  width?: number;
  height?: number;
  sizeUnit?: SizeUnit;
  dpi?: number;
  resizeMode?: ResizeMode;
  aspectLocked?: boolean;
  /**
   * Estimation-plot fields (E2). All optional and additive, so a figure of any
   * other kind reads back byte-identical and only an estimation figure carries
   * them.
   *
   * `estimationPaired` draws the paired variant (slope lines between the matched
   * points, and a paired mean-difference bootstrap) instead of the unpaired
   * (independent-groups) one. `estimationControlIndex` is which group is the
   * shared reference the differences are taken against (default the first group,
   * index 0); the difference axis is aligned so zero sits at that group's mean.
   * `estimationCi` is the CI level the bootstrap reports (default 0.95).
   * `estimationB` and `estimationSeed` pin the bootstrap resample count and the
   * PRNG seed, so the distribution + CI redraw bit-for-bit (the same seed
   * convention E4 uses). `estimationBootMethod` picks the CI method ("bca" the
   * DABEST default, or "percentile").
   */
  estimationPaired?: boolean;
  estimationControlIndex?: number;
  estimationCi?: number;
  estimationB?: number;
  estimationSeed?: number;
  estimationBootMethod?: BootstrapMethod;
  /**
   * Diagnostic-plot field (Theme 4). Which Column-table group a QQ plot draws
   * when it is NOT sourced from a linked regression's residuals (the index into
   * the table's group columns, default the first group, index 0). Optional and
   * additive, so any non-diagnostic figure reads back byte-identical and only a
   * QQ figure sourced from a table group carries it.
   */
  diagnosticColumnIndex?: number;
  /**
   * Parts-of-whole field. The donut hole radius as a fraction of the pie radius
   * (0 draws a solid pie, 0.6 the default donut ring). Read only by the "donut"
   * figure; clamped to [0, 0.9). Optional and additive, so any non-donut figure
   * reads back byte-identical and only a donut figure carries it.
   */
  donutHoleRatio?: number;
  /**
   * The publication page-frame (artboard) config for this figure. Optional and
   * additive, so a spec written before this feature reads back as absent, which
   * the artboard treats as disabled (the figure renders exactly as before). The
   * raw stored value is normalized with readArtboardState at the consumer.
   */
  artboard?: ArtboardState;
  /**
   * Axis value scale for an XY figure (relationship plots). "log" is base-10 and
   * applies only when the data on that axis is strictly positive (it falls back to
   * linear otherwise). Optional and additive, absent means linear, so every other
   * figure reads back byte-identical. Bars are excluded by nature (a zero baseline
   * has no log position).
   */
  xScaleType?: AxisScaleType;
  yScaleType?: AxisScaleType;
  /**
   * Grouped-bar arrangement (dodge / stack / stack100). Optional and additive,
   * absent means "dodge", so an old grouped figure reads back byte-identical.
   * Read only by the grouped bar; other kinds ignore it.
   */
  barMode?: BarMode;
  /**
   * Manual axis range + tick step overrides (Prism-style). All optional and
   * additive, absent means auto. The value (y) axis of a column / grouped bar uses
   * yAxisMax (its top, the baseline stays 0) and yTickStep. An XY figure uses the
   * full xAxisMin / xAxisMax / yAxisMin / yAxisMax. An override is ignored when it
   * is not a finite number or would invert the range (min >= max).
   */
  xAxisMin?: number;
  xAxisMax?: number;
  yAxisMin?: number;
  yAxisMax?: number;
  yTickStep?: number;
  /**
   * Draw the numeric value above each bar / mean (column + grouped figures).
   * Optional and additive, absent means off. Layout-only label of the same mean
   * the figure already computes.
   */
  showValueLabels?: boolean;
  /**
   * Where the legend sits relative to the plot area (grouped bar). "overlay" (the
   * default, and what absent reads as) keeps the legend top-right INSIDE the data
   * band, byte-identical to before this field existed. "right" reserves a gutter
   * so the bars stop short and the legend sits clear of them. This is the lever the
   * collision advisor's relocate-legend fix applies. Read only by the grouped bar.
   */
  legendPlacement?: "overlay" | "right";
}

/** The unit a figure's width / height is typed in (and stored as). */
export type SizeUnit = "px" | "in" | "cm";

/** An axis value scale. "log" is base-10 (XY figures only, positive data). */
export type AxisScaleType = "linear" | "log";

/**
 * How a grouped bar chart arranges the bars within a row-factor cluster. "dodge"
 * is side-by-side (the default). "stack" stacks them (absolute magnitudes sum).
 * "stack100" stacks and normalizes each cluster to 1 (relative composition, the
 * 100-percent bar). Stacking treats a non-positive cell as zero and draws no
 * per-segment error bar.
 */
export type BarMode = "dodge" | "stack" | "stack100";

/** How a resize changes the figure (re-layout the axes vs zoom the whole image). */
export type ResizeMode = "relayout" | "scale";

/** The fitted-curve choices an XY figure offers (mirrors the engine registry). */
export type FitModelId =
  | "none"
  | "linear"
  | "logistic4pl"
  | "michaelis-menten"
  | "exp-decay-1phase"
  | "exp-association-1phase"
  | "polynomial2"
  | "gaussian";

/** What a figure draws: the source table and (optionally) a linked analysis. */
export interface PlotSource {
  /** The Data Hub document id whose table this figure plots. */
  tableId: string;
  /**
   * The stored ANOVA analysis id whose Tukey comparisons feed the significance
   * brackets, or null when brackets are off / no analysis is linked.
   */
  analysisId: string | null;
  /** For an XY figure, which Y (response) column to plot against X. */
  yColumnId?: string | null;
}

/** The default publication style for a brand-new column figure. */
export function defaultPlotStyle(): PlotStyle {
  return {
    kind: "columnScatter",
    errorBar: "sem",
    showPoints: true,
    showBrackets: true,
    colorMode: "brand",
    palette: DEFAULT_PALETTE_ID,
    colorOverrides: {},
    fontSize: 13,
    title: "",
    yTitle: "Value",
    xTitle: "",
    fitModel: "linear",
    // width / height stay unset so an existing figure renders unchanged; the
    // unit / dpi / mode defaults only apply once the user sets a size.
    sizeUnit: "px",
    dpi: 300,
    resizeMode: "relayout",
    aspectLocked: true,
    // Estimation-plot defaults. They sit unread by every non-estimation figure,
    // and an estimation figure overrides them through buildEstimationSpec.
    estimationPaired: false,
    estimationControlIndex: 0,
    estimationCi: 0.95,
    estimationB: 5000,
    estimationSeed: 12345,
    estimationBootMethod: "bca",
    // Diagnostic-plot default. Unread by every non-diagnostic figure; a QQ figure
    // sourced from a table group overrides it through buildPlotSpec.
    diagnosticColumnIndex: 0,
    // Parts-of-whole default. Unread by every non-donut figure; the donut ring
    // uses it for the center hole radius.
    donutHoleRatio: 0.6,
  };
}

/** The default bootstrap resamples an estimation figure draws its density from. */
export const ESTIMATION_DEFAULT_B = 5000;
/** The default seed, matching the E4 bootstrap default so a figure is reproducible. */
export const ESTIMATION_DEFAULT_SEED = 12345;

// ---------------------------------------------------------------------------
// Figure-size units (px / in / cm) <-> design pixels
// ---------------------------------------------------------------------------
//
// Design units are SVG user units, which are CSS pixels at the standard 96 per
// inch baseline. We convert a typed width / height into design-px for the
// geometry box (so axes lay out against a real pixel box) and into physical
// inches for export (so a PNG rasterizes at inches * DPI and an SVG opens at
// true physical size).

/** CSS pixels per inch at the SVG baseline. */
export const DESIGN_PX_PER_INCH = 96;
/** Centimeters per inch (so cm -> in -> px is exact). */
const CM_PER_INCH = 2.54;

/** Convert a value in the given unit to design pixels (px at 96 / inch). */
export function toDesignPx(value: number, unit: SizeUnit): number {
  if (!Number.isFinite(value)) return 0;
  if (unit === "in") return value * DESIGN_PX_PER_INCH;
  if (unit === "cm") return value * (DESIGN_PX_PER_INCH / CM_PER_INCH);
  return value;
}

/** Convert a value in the given unit to physical inches. */
export function toInches(value: number, unit: SizeUnit): number {
  if (!Number.isFinite(value)) return 0;
  if (unit === "in") return value;
  if (unit === "cm") return value / CM_PER_INCH;
  return value / DESIGN_PX_PER_INCH;
}

/** Convert design pixels back into the given unit (for the UI inputs). */
export function fromDesignPx(px: number, unit: SizeUnit): number {
  if (!Number.isFinite(px)) return 0;
  if (unit === "in") return px / DESIGN_PX_PER_INCH;
  if (unit === "cm") return (px / DESIGN_PX_PER_INCH) * CM_PER_INCH;
  return px;
}

/** Convert a value from one unit to another (for the UI unit dropdown). */
export function convertUnit(
  value: number,
  from: SizeUnit,
  to: SizeUnit,
): number {
  return fromDesignPx(toDesignPx(value, from), to);
}

/**
 * Map a legacy single-hue colorMode onto a palette id, so an old spec that only
 * stored colorMode still resolves to a real palette. "brand" -> the brand trio,
 * "sky" -> the sky ramp, "ink" -> the grey ramp.
 */
function paletteIdForColorMode(mode: ColorMode): string {
  if (mode === "sky") return "sky-ramp";
  if (mode === "ink") return GREY_RAMP_ID;
  return "brand-trio";
}

/**
 * Read a stored colorOverrides record (series index -> hex) back into a typed
 * map, dropping any non-numeric key or non-hex value so a malformed spec cannot
 * corrupt the render. Returns a fresh object (never shared) for safe mutation.
 */
function readColorOverrides(raw: unknown): Record<number, string> {
  const out: Record<number, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const idx = Number(k);
    if (!Number.isInteger(idx) || idx < 0) continue;
    if (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) out[idx] = v;
  }
  return out;
}

/** Valid fitted-curve ids, so a stored string round-trips into the typed union. */
const FIT_MODEL_IDS: FitModelId[] = [
  "none",
  "linear",
  "logistic4pl",
  "michaelis-menten",
  "exp-decay-1phase",
  "exp-association-1phase",
  "polynomial2",
  "gaussian",
];

/** Read a PlotSpec's open style record into the typed PlotStyle, with defaults. */
export function readPlotStyle(spec: PlotSpec): PlotStyle {
  const d = defaultPlotStyle();
  const s = spec.style ?? {};
  const KINDS: PlotKind[] = [
    "columnScatter",
    "columnBar",
    "xyScatter",
    "groupedBar",
    "survivalCurve",
    "estimationGardnerAltman",
    "estimationCumming",
    "qqPlot",
    "residualPlot",
    "rocCurve",
    "pie",
    "donut",
    "stackedBar",
  ];
  const kind = KINDS.includes(s.kind as PlotKind)
    ? (s.kind as PlotKind)
    : // Fall back to the spec.type when style.kind is absent (round-trip the
      // top-level type) so an old spec without a style.kind still draws.
      KINDS.includes(spec.type as PlotKind)
      ? (spec.type as PlotKind)
      : d.kind;
  return {
    kind,
    errorBar:
      s.errorBar === "sd" ||
      s.errorBar === "none" ||
      s.errorBar === "sem" ||
      s.errorBar === "ci95"
        ? (s.errorBar as ErrorBarKind)
        : d.errorBar,
    showPoints: typeof s.showPoints === "boolean" ? s.showPoints : d.showPoints,
    showBrackets:
      typeof s.showBrackets === "boolean" ? s.showBrackets : d.showBrackets,
    colorMode:
      s.colorMode === "sky" || s.colorMode === "ink" || s.colorMode === "brand"
        ? (s.colorMode as ColorMode)
        : d.colorMode,
    palette:
      typeof s.palette === "string" && s.palette
        ? s.palette
        : // No stored palette: derive one from the legacy colorMode so an old
          // figure keeps its intended hue family instead of jumping to the new
          // default.
          paletteIdForColorMode(
            s.colorMode === "sky" || s.colorMode === "ink" || s.colorMode === "brand"
              ? (s.colorMode as ColorMode)
              : d.colorMode,
          ),
    colorOverrides: readColorOverrides(s.colorOverrides),
    fontSize:
      typeof s.fontSize === "number" && Number.isFinite(s.fontSize)
        ? s.fontSize
        : d.fontSize,
    title: typeof s.title === "string" ? s.title : d.title,
    yTitle: typeof s.yTitle === "string" ? s.yTitle : d.yTitle,
    xTitle: typeof s.xTitle === "string" ? s.xTitle : d.xTitle,
    fitModel: FIT_MODEL_IDS.includes(s.fitModel as FitModelId)
      ? (s.fitModel as FitModelId)
      : d.fitModel,
    // Size: width / height are left undefined when absent (so the figure keeps
    // the base FIG size and renders exactly as before). A stored width / height
    // must be a positive finite number to count.
    width:
      typeof s.width === "number" && Number.isFinite(s.width) && s.width > 0
        ? s.width
        : undefined,
    height:
      typeof s.height === "number" && Number.isFinite(s.height) && s.height > 0
        ? s.height
        : undefined,
    sizeUnit:
      s.sizeUnit === "in" || s.sizeUnit === "cm" || s.sizeUnit === "px"
        ? (s.sizeUnit as SizeUnit)
        : d.sizeUnit,
    dpi:
      typeof s.dpi === "number" && Number.isFinite(s.dpi) && s.dpi > 0
        ? s.dpi
        : d.dpi,
    resizeMode:
      s.resizeMode === "scale" || s.resizeMode === "relayout"
        ? (s.resizeMode as ResizeMode)
        : d.resizeMode,
    aspectLocked:
      typeof s.aspectLocked === "boolean" ? s.aspectLocked : d.aspectLocked,
    // Estimation-plot fields. Each falls to its default when absent, so an old
    // spec (or any non-estimation figure) reads back unchanged.
    estimationPaired:
      typeof s.estimationPaired === "boolean"
        ? s.estimationPaired
        : d.estimationPaired,
    estimationControlIndex:
      typeof s.estimationControlIndex === "number" &&
      Number.isInteger(s.estimationControlIndex) &&
      s.estimationControlIndex >= 0
        ? s.estimationControlIndex
        : d.estimationControlIndex,
    estimationCi:
      typeof s.estimationCi === "number" &&
      s.estimationCi > 0 &&
      s.estimationCi < 1
        ? s.estimationCi
        : d.estimationCi,
    estimationB:
      typeof s.estimationB === "number" &&
      Number.isFinite(s.estimationB) &&
      s.estimationB >= 100
        ? Math.round(s.estimationB)
        : d.estimationB,
    estimationSeed:
      typeof s.estimationSeed === "number" && Number.isFinite(s.estimationSeed)
        ? Math.round(s.estimationSeed)
        : d.estimationSeed,
    estimationBootMethod:
      s.estimationBootMethod === "percentile" || s.estimationBootMethod === "bca"
        ? (s.estimationBootMethod as BootstrapMethod)
        : d.estimationBootMethod,
    // Diagnostic-plot field. Falls to its default (0) when absent, so an old spec
    // (or any non-diagnostic figure) reads back unchanged.
    diagnosticColumnIndex:
      typeof s.diagnosticColumnIndex === "number" &&
      Number.isInteger(s.diagnosticColumnIndex) &&
      s.diagnosticColumnIndex >= 0
        ? s.diagnosticColumnIndex
        : d.diagnosticColumnIndex,
    // Parts-of-whole field. The donut hole ratio falls to its default when
    // absent or out of range, so an old spec (or any non-donut figure) reads
    // back unchanged. Clamped to [0, 0.9) so the ring always has a visible band.
    donutHoleRatio:
      typeof s.donutHoleRatio === "number" &&
      Number.isFinite(s.donutHoleRatio) &&
      s.donutHoleRatio >= 0 &&
      s.donutHoleRatio < 0.9
        ? s.donutHoleRatio
        : d.donutHoleRatio,
    // Artboard config. Carried through as the raw stored object (absent => the
    // artboard is disabled); the consumer fully validates it with
    // readArtboardState before use, so a malformed value cannot reach the render.
    artboard:
      s.artboard && typeof s.artboard === "object"
        ? (s.artboard as ArtboardState)
        : undefined,
    // Axis scales for an XY figure. Absent / anything but "log" reads as linear,
    // so an old spec (or any non-XY figure) is byte-identical.
    xScaleType: s.xScaleType === "log" ? "log" : undefined,
    yScaleType: s.yScaleType === "log" ? "log" : undefined,
    // Grouped-bar arrangement. Absent / unknown reads as dodge.
    barMode:
      s.barMode === "stack" || s.barMode === "stack100"
        ? (s.barMode as BarMode)
        : undefined,
    // Manual axis overrides. Each kept only when a positive-or-finite number; the
    // layout functions validate ranges (min < max) before applying.
    xAxisMin: numOrUndef(s.xAxisMin),
    xAxisMax: numOrUndef(s.xAxisMax),
    yAxisMin: numOrUndef(s.yAxisMin),
    yAxisMax: numOrUndef(s.yAxisMax),
    yTickStep: s.yTickStep != null && Number.isFinite(s.yTickStep) && (s.yTickStep as number) > 0
      ? (s.yTickStep as number)
      : undefined,
    showValueLabels: s.showValueLabels === true ? true : undefined,
    // Legend placement (grouped bar). Absent / unknown reads as overlay, so an old
    // grouped figure is byte-identical.
    legendPlacement: s.legendPlacement === "right" ? "right" : undefined,
  };
}

/** A finite number passes through, anything else becomes undefined. */
function numOrUndef(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Read a PlotSpec's open source record into the typed PlotSource. */
export function readPlotSource(spec: PlotSpec): PlotSource {
  const s = spec.source ?? {};
  return {
    tableId: typeof s.tableId === "string" ? s.tableId : "",
    analysisId: typeof s.analysisId === "string" ? s.analysisId : null,
    yColumnId: typeof s.yColumnId === "string" ? s.yColumnId : null,
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
  /** For an XY figure, the Y column to plot against X. */
  yColumnId?: string | null;
  /** For an XY figure, the initial fitted-curve model. */
  fitModel?: FitModelId;
  /** Seed the y-axis title from the table name when the caller has it. */
  yTitle?: string;
  xTitle?: string;
  title?: string;
  /** For an estimation figure, the paired variant and the control group index. */
  estimationPaired?: boolean;
  estimationControlIndex?: number;
  /** For a QQ figure sourced from a table group, which group to plot. */
  diagnosticColumnIndex?: number;
  /** For a donut figure, the center hole radius as a fraction of the pie radius. */
  donutHoleRatio?: number;
}): PlotSpec {
  const style = defaultPlotStyle();
  style.kind = args.kind;
  // Parts-of-whole figures read better led by a color than by Okabe-Ito's
  // leading black (a black first wedge looks off in a pie), so default them to
  // a colorblind-safe color-first palette. Bars and scatter keep Okabe-Ito.
  if (args.kind === "pie" || args.kind === "donut" || args.kind === "stackedBar") {
    style.palette = "tol-bright";
  }
  if (args.yTitle !== undefined) style.yTitle = args.yTitle;
  if (args.xTitle !== undefined) style.xTitle = args.xTitle;
  if (args.title !== undefined) style.title = args.title;
  if (args.fitModel !== undefined) style.fitModel = args.fitModel;
  if (args.estimationPaired !== undefined)
    style.estimationPaired = args.estimationPaired;
  if (args.estimationControlIndex !== undefined)
    style.estimationControlIndex = args.estimationControlIndex;
  if (args.diagnosticColumnIndex !== undefined)
    style.diagnosticColumnIndex = args.diagnosticColumnIndex;
  if (args.donutHoleRatio !== undefined)
    style.donutHoleRatio = args.donutHoleRatio;
  const source: PlotSource = {
    tableId: args.tableId,
    analysisId: args.analysisId ?? null,
    yColumnId: args.yColumnId ?? null,
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

// Series colors come from the active palette (lib/datahub/palettes) sampled to
// the figure's series COUNT, with any per-series override applied on top. The
// palette is sampled to the exact count so picking one palette recolors the
// whole figure consistently (the old single-hue colorMode painted every series
// the same color). Hex (not CSS vars) so a serialized SVG / a rasterized PNG
// carries its own colors with no stylesheet.

/**
 * Resolve the color for group `i` of a `count`-series figure under a style. An
 * explicit per-series override wins; otherwise the active palette is sampled to
 * `count` and the i-th color is taken. The sampled array is memoized per call
 * site via the second-stage helper so a row of groups samples once, not n times
 * (see seriesColors). This single-color entry point is used by the multi-series
 * builders (grouped bar, survival) that color one series at a time.
 */
export function colorForGroup(
  style: PlotStyle,
  index: number,
  count: number,
): string {
  const override = style.colorOverrides?.[index];
  if (override) return override;
  const sampled = samplePalette(paletteById(style.palette), Math.max(1, count));
  return sampled[index] ?? sampled[sampled.length - 1] ?? "#000000";
}

/**
 * Resolve every series color for a `count`-series figure at once (sample the
 * palette a single time, then layer overrides). The hot path for the column
 * builders so the palette is sampled once per figure, not once per group.
 */
export function seriesColors(style: PlotStyle, count: number): string[] {
  const sampled = samplePalette(paletteById(style.palette), Math.max(1, count));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const override = style.colorOverrides?.[i];
    out.push(override ?? sampled[i] ?? sampled[sampled.length - 1] ?? "#000000");
  }
  return out;
}

/** The active palette for a style (folding nothing extra in at render time). */
function activePalette(style: PlotStyle): Palette {
  return paletteById(style.palette);
}

// Fixed axis / text colors (slate scale), shared by every theme so the chrome
// reads the same as the rest of the app and survives rasterization.
export const AXIS_COLOR = "#94a3b8";
export const TICK_TEXT = "#64748b";
export const LABEL_TEXT = "#334155";

// ---------------------------------------------------------------------------
// Geometry (pure, unit-tested)
// ---------------------------------------------------------------------------

/** Base figure box + padding. Matches the approved mockup's proportions. This
 * is the size every figure draws at when the user has not set a custom size, so
 * an old figure with no width / height renders byte-for-byte the same. */
export const FIG = {
  width: 430,
  height: 340,
  padL: 52,
  padR: 18,
  padT: 34,
  padB: 46,
} as const;

/** The padding + base box a laid-out figure uses (the box may be resized). */
export interface FigureBox {
  width: number;
  height: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
}

/**
 * The geometry box a figure lays out against, derived from its style size.
 *
 * In "relayout" mode (the default) the box becomes the user's size in design-px
 * so the axes / margins recompute to fill it and the fonts stay the point size
 * the "Axis text" control sets, which keeps the figure legible at journal
 * dimensions. In "scale" mode the box stays the base FIG size (the viewBox does
 * not change); the whole figure is zoomed by the outer width / height instead,
 * so text and markers grow with the box like a slide image.
 *
 * When the style has no width / height the box is exactly the base FIG, so a
 * figure with no size renders identically to before sizing existed.
 */
export function figureBox(style: PlotStyle): FigureBox {
  const base: FigureBox = { ...FIG };
  const unit: SizeUnit = style.sizeUnit ?? "px";
  const hasSize =
    typeof style.width === "number" &&
    style.width > 0 &&
    typeof style.height === "number" &&
    style.height > 0;
  if (!hasSize) return base;
  if ((style.resizeMode ?? "relayout") === "scale") return base;
  return {
    ...base,
    width: toDesignPx(style.width as number, unit),
    height: toDesignPx(style.height as number, unit),
  };
}

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
  /** The numeric mean (null when the group has none), for an optional value label. */
  mean: number | null;
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
  /** Rotation (deg) applied to the x-axis group labels, 0 when they fit flat. */
  xLabelAngle: number;
}

/** Rough rendered width (px) of a label, for overlap detection in pure layout. */
export function estimateLabelWidth(text: string, fontSize: number): number {
  // 0.58 is an average glyph-width factor for the system sans at this size.
  return text.length * fontSize * 0.58;
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
  if (kind === "ci95") {
    // Half-width of the 95% CI of the mean: t(0.975, n-1) * SEM. Needs n >= 2.
    if (stats.sem === null || !Number.isFinite(stats.sem) || stats.n < 2) {
      return null;
    }
    return tCritTwoSided(0.05, stats.n - 1) * stats.sem;
  }
  const e = kind === "sd" ? stats.sd : stats.sem;
  return e !== null && Number.isFinite(e) ? e : null;
}

/**
 * Build a GroupStats from an ENTERED summary (mean + spread + n). The table
 * stores ONE spread (SD or SEM, fixed by its format), so the other is derived
 * with the stored n (SEM = SD / sqrt(n), SD = SEM * sqrt(n)). This lets a figure
 * draw whichever errorBar kind the user picks regardless of which spread the
 * table holds, the same conversion the from-stats analysis path uses. A missing
 * n leaves the derived spread null, so errorMagnitude falls back to no bar
 * rather than dividing by an unknown count.
 */
function statsFromSummary(s: GroupSummary): GroupStats {
  const n = s.n !== null && Number.isFinite(s.n) && s.n >= 1 ? s.n : null;
  let sd: number | null = null;
  let sem: number | null = null;
  if (s.spread !== null && Number.isFinite(s.spread)) {
    if (s.spreadKind === "sem") {
      sem = s.spread;
      sd = n !== null ? s.spread * Math.sqrt(n) : null;
    } else {
      sd = s.spread;
      sem = n !== null ? s.spread / Math.sqrt(n) : null;
    }
  }
  return { mean: s.mean, sd, sem, n: n ?? 0 };
}

/**
 * Resolve the plotted groups for a column table.
 *
 * In the default replicates format each group column carries its engine-backed
 * stats (computeAllGroupStats) and its raw finite values, in declared column
 * order, colored under the style. This path is byte-identical to before summary
 * tables existed.
 *
 * In a SUMMARY entry format there are no raw replicates: each group's stats come
 * from its ENTERED mean + spread + n (statsFromSummary), and values[] is empty.
 * A columnScatter figure of a summary table therefore draws the mean line and
 * the error bar but no per-replicate dots (there are none to plot), which is the
 * sensible fall-back the brief asks for: the figure stays a bars / mean-with-
 * error plot rather than an empty scatter.
 */
export function resolvePlotGroups(
  content: DataHubDocContent,
  style: PlotStyle,
): PlotGroup[] {
  if (
    content.meta.table_type === "column" &&
    isSummaryFormat(content.meta.entryFormat)
  ) {
    const summaries = readAllGroupSummaries(content);
    const colors = seriesColors(style, summaries.length);
    return summaries.map((s, i) => ({
      id: s.datasetId,
      name: s.name,
      color: colors[i] ?? "#000000",
      stats: statsFromSummary(s),
      // No raw replicates in a summary table, so no jittered points are drawn.
      values: [],
    }));
  }

  const cols = groupColumns(content);
  const allStats = computeAllGroupStats(content);
  // Sample the active palette once to the real group count, then apply any
  // per-series override, so every group's color comes from the same sampling.
  const colors = seriesColors(style, cols.length);
  return cols.map((c, i) => ({
    id: c.id,
    name: c.name,
    color: colors[i] ?? "#000000",
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
  const { width, height, padL, padR, padT, padB } = figureBox(style);
  const x0 = padL;
  const x1 = width - padR;
  const y1 = padT;

  // X-axis group labels: estimate whether they would overlap at the band width
  // and angle them (reserving extra bottom room) so long names never collide.
  // Short labels keep the flat layout, so existing geometry is unchanged.
  const n = Math.max(1, groups.length);
  const bandW = (x1 - x0) / n;
  const maxLabelW = groups.reduce(
    (m, g) => Math.max(m, estimateLabelWidth(g.name, style.fontSize)),
    0,
  );
  const xLabelMode = style.xLabelMode ?? "auto";
  const xLabelAngle =
    xLabelMode === "horizontal"
      ? 0
      : xLabelMode === "angled"
        ? -40
        : maxLabelW > bandW * 0.92
          ? -40
          : 0;
  // Rotated labels drop below the axis by ~width*sin(40deg); reserve that room
  // beyond the one flat-label line the base padding already allows for.
  const extraBottom =
    xLabelAngle !== 0 ? Math.max(0, maxLabelW * Math.sin((40 * Math.PI) / 180) - 14) : 0;
  const y0 = height - padB - extraBottom;

  const auto = pickAxis(groups, style.errorBar);
  // Manual overrides: a column figure keeps a 0 baseline, so only the top (yMax)
  // and the tick step can be set; an out-of-range value is ignored.
  const yMax =
    style.yAxisMax !== undefined && style.yAxisMax > 0
      ? style.yAxisMax
      : auto.yMax;
  const step =
    style.yTickStep !== undefined && style.yTickStep > 0
      ? style.yTickStep
      : auto.step;
  // d3 linear scale: value domain [0, yMax] -> pixel range [y0 (bottom), y1 (top)].
  const yScale = scaleLinear().domain([0, yMax]).range([y0, y1]);
  const Y = (v: number) => yScale(v);

  const ticks: AxisTick[] = [];
  for (let t = 0; t <= yMax + 1e-9; t += step) {
    // Guard floating-point drift on the last tick.
    const value = Math.round(t * 1e6) / 1e6;
    ticks.push({ value, y: Y(value) });
  }

  const meanHalf = Math.min(22, bandW * 0.3);
  // Error-bar caps sit a touch narrower than the mean line (~0.62x) so the
  // top cap, mean line, and bottom cap read as one nested I-beam/bracket: wide
  // enough not to look like a cramped mark in the center of the mean line, but
  // narrow enough not to collapse into three equal parallel lines when SEM is
  // small (the mean line stays the widest, the caps clearly inside it).
  const capHalf = Math.max(6, Math.round(meanHalf * 0.62));

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
      mean,
      meanHalf,
      bar,
      errorBar,
      points,
      labelX: cx,
      labelY: y0 + 18,
    };
  });

  // Significance brackets. Each bracket sits just above the TALLEST element under
  // the groups its span CROSSES (not the global top), and steps one tier higher
  // than any already-placed bracket whose x-range overlaps it. So a narrow
  // adjacent comparison hugs its own pair, while a wide comparison that reaches
  // across taller groups rises above them and over the narrower bars it crosses.
  // Legs are short stubs that mark the endpoints; they do not reach the data.
  const brackets: BracketGeometry[] = [];
  if (style.showBrackets && bracketRequests.length > 0) {
    // The bars that will actually be drawn (both endpoints resolve to a group).
    const drawn = bracketRequests.filter(
      (req) =>
        groupGeo[req.i]?.cx !== undefined && groupGeo[req.j]?.cx !== undefined,
    );
    // Highest drawn element (smallest pixel y) per group: points, error top, mean.
    const groupTop = groupGeo.map((g) => {
      let t = g.meanY ?? y0;
      if (g.errorBar) t = Math.min(t, g.errorBar.topY);
      for (const p of g.points) t = Math.min(t, p.y);
      return t;
    });
    const gap = 16; // air between a bracket and the tallest element it clears
    const tier = 18; // vertical step between two stacked (overlapping) brackets
    const legDrop = 8;
    // Place narrow spans first (then left to right) so a wide span is pushed up
    // OVER the narrow ones it crosses, never the reverse.
    const order = drawn
      .map((req, idx) => ({ req, idx }))
      .sort((a, b) => {
        const wa = Math.abs(a.req.j - a.req.i);
        const wb = Math.abs(b.req.j - b.req.i);
        if (wa !== wb) return wa - wb;
        return Math.min(a.req.i, a.req.j) - Math.min(b.req.i, b.req.j);
      });
    const placed: { lo: number; hi: number; spanY: number }[] = [];
    const spanYByIdx: number[] = new Array(drawn.length);
    for (const { req, idx } of order) {
      const lo = Math.min(req.i, req.j);
      const hi = Math.max(req.i, req.j);
      // Clear the tallest element anywhere under this span.
      let clearY = Infinity;
      for (let k = lo; k <= hi; k++) clearY = Math.min(clearY, groupTop[k]!);
      let spanY = clearY - gap;
      // And sit a tier above any already-placed bracket whose x-range overlaps
      // (touching at a shared endpoint column counts, so legs never collide).
      for (const p of placed) {
        if (p.lo <= hi && lo <= p.hi) spanY = Math.min(spanY, p.spanY - tier);
      }
      placed.push({ lo, hi, spanY });
      spanYByIdx[idx] = spanY;
    }
    // Hold the whole stack below a ceiling (clear of the title / canvas top),
    // shifting every bracket down by the same delta so the tiers are preserved.
    const hasTitle = style.title.trim() !== "";
    const ceiling = hasTitle ? y1 + 6 : 4;
    let topLabelY = Infinity;
    for (const s of spanYByIdx) topLabelY = Math.min(topLabelY, s - 3 - style.fontSize);
    const shiftDown = topLabelY < ceiling ? ceiling - topLabelY : 0;
    drawn.forEach((req, idx) => {
      const a = groupGeo[req.i]!.cx;
      const b = groupGeo[req.j]!.cx;
      const spanY = spanYByIdx[idx]! + shiftDown;
      brackets.push({
        leftX: a,
        rightX: b,
        spanY,
        legY: spanY + legDrop,
        labelX: (a + b) / 2,
        labelY: spanY - 3,
        label: req.label,
      });
    });
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
    xLabelAngle,
  };
}

// ---------------------------------------------------------------------------
// SVG serialization (geometry -> a standalone SVG document string)
// ---------------------------------------------------------------------------

/** Minimal XML-escape for text content (group names, axis titles). */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function fmtTick(value: number): string {
  // Integers print plainly; fractional ticks keep up to two decimals, trimmed.
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

// ---------------------------------------------------------------------------
// Mono pattern fills (B and W hatches for the no-color, print-only figures)
// ---------------------------------------------------------------------------

/** The base gray a mono pattern draws on (matches the mono palette base). */
const MONO_INK = "#1f2937";
const MONO_BG = "#ffffff";

/**
 * The cycle of pattern styles a mono bar plot uses to tell series apart without
 * color (solid, dots, diagonal, crosshatch, horizontal). Index 0 is a solid
 * gray fill so the first series is not a busy hatch.
 */
const MONO_PATTERN_COUNT = 5;

/** The fill value (a url(#id) or a flat color) for series `i` of a mono plot. */
function monoFill(i: number): string {
  return `url(#ros-pat-${i % MONO_PATTERN_COUNT})`;
}

/**
 * The <defs> block of the mono pattern tiles, embedded once at the top of a mono
 * bar figure so the fills are self-contained (the SVG stays a single portable
 * document that downloads and rasterizes with its patterns intact).
 */
function monoPatternDefs(): string {
  const tiles: string[] = [];
  // 0: solid gray.
  tiles.push(
    `<pattern id="ros-pat-0" width="8" height="8" patternUnits="userSpaceOnUse">` +
      `<rect width="8" height="8" fill="#9ca3af"/></pattern>`,
  );
  // 1: dots.
  tiles.push(
    `<pattern id="ros-pat-1" width="7" height="7" patternUnits="userSpaceOnUse">` +
      `<rect width="7" height="7" fill="${MONO_BG}"/>` +
      `<circle cx="3.5" cy="3.5" r="1.6" fill="${MONO_INK}"/></pattern>`,
  );
  // 2: diagonal lines.
  tiles.push(
    `<pattern id="ros-pat-2" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
      `<rect width="6" height="6" fill="${MONO_BG}"/>` +
      `<line x1="0" y1="0" x2="0" y2="6" stroke="${MONO_INK}" stroke-width="2"/></pattern>`,
  );
  // 3: crosshatch.
  tiles.push(
    `<pattern id="ros-pat-3" width="7" height="7" patternUnits="userSpaceOnUse">` +
      `<rect width="7" height="7" fill="${MONO_BG}"/>` +
      `<path d="M0 0 L7 7 M7 0 L0 7" stroke="${MONO_INK}" stroke-width="1.2"/></pattern>`,
  );
  // 4: horizontal lines.
  tiles.push(
    `<pattern id="ros-pat-4" width="6" height="6" patternUnits="userSpaceOnUse">` +
      `<rect width="6" height="6" fill="${MONO_BG}"/>` +
      `<line x1="0" y1="3" x2="6" y2="3" stroke="${MONO_INK}" stroke-width="2"/></pattern>`,
  );
  return `<defs>${tiles.join("")}</defs>`;
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

  // A mono (pattern) palette tells series apart by hatch / dot fill on the bars
  // (no color). Embed the pattern tiles once so the figure stays self-contained.
  // For a non-bar mono plot there is nothing to hatch, so the points / mean
  // lines fall back to distinct grey SHADES instead.
  const pal = activePalette(style);
  const monoBars = !!pal.pattern && style.kind === "columnBar";
  const monoShades =
    !!pal.pattern && style.kind !== "columnBar"
      ? samplePalette(paletteById(GREY_RAMP_ID), geo.groups.length)
      : null;
  if (monoBars) parts.push(monoPatternDefs());

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

  // Groups: bar, mean line, error bar, points, label. EVERY drawn element of a
  // series carries data-series, so a double-click or right-click anywhere on the
  // series (any point, the error bar, the mean line) hit-tests to it rather than
  // only the one primary element.
  geo.groups.forEach((g, i) => {
    // An explicit per-series override always wins, even in mono mode. Otherwise a
    // mono plot uses a hatch pattern (bars) or a grey shade (points / lines).
    const override = style.colorOverrides?.[i];
    const barFill = override ?? (monoBars ? monoFill(i) : g.color);
    const lineColor = override ?? (monoShades ? monoShades[i] ?? g.color : g.color);
    if (g.bar) {
      // A patterned bar reads at full opacity so the hatch is legible.
      const op = monoBars && !override ? "1" : "0.30";
      parts.push(
        `<rect data-series="${i}" x="${g.bar.x}" y="${g.bar.y}" width="${g.bar.width}" height="${g.bar.height}" fill="${barFill}" stroke="${MONO_INK}" stroke-width="${monoBars && !override ? "0.8" : "0"}" opacity="${op}"/>`,
      );
    }
    if (g.meanY !== null) {
      parts.push(
        `<line data-series="${i}" x1="${g.cx - g.meanHalf}" y1="${g.meanY}" x2="${g.cx + g.meanHalf}" y2="${g.meanY}" stroke="${lineColor}" stroke-width="2.4"/>`,
      );
    }
    if (g.errorBar) {
      const eb = g.errorBar;
      parts.push(
        `<line data-series="${i}" x1="${eb.cx}" y1="${eb.bottomY}" x2="${eb.cx}" y2="${eb.topY}" stroke="${lineColor}" stroke-width="1.6"/>` +
          `<line data-series="${i}" x1="${eb.cx - eb.capHalf}" y1="${eb.topY}" x2="${eb.cx + eb.capHalf}" y2="${eb.topY}" stroke="${lineColor}" stroke-width="1.6"/>` +
          `<line data-series="${i}" x1="${eb.cx - eb.capHalf}" y1="${eb.bottomY}" x2="${eb.cx + eb.capHalf}" y2="${eb.bottomY}" stroke="${lineColor}" stroke-width="1.6"/>`,
      );
    }
    g.points.forEach((p) => {
      // Every point is a series hit-target, so a click on any replicate marker
      // (not only the first) opens the color editor for the series.
      parts.push(
        `<circle data-series="${i}" cx="${p.x}" cy="${p.y}" r="3" fill="${lineColor}" opacity="0.9"/>`,
      );
    });
    // Optional value label, above the topmost drawn element (error cap or mean).
    if (style.showValueLabels && g.mean !== null) {
      const topY = g.errorBar ? g.errorBar.topY : (g.meanY ?? geo.y0);
      parts.push(
        `<text x="${g.cx}" y="${topY - 5}" font-size="${tickFont}" fill="${LABEL_TEXT}" text-anchor="middle">${fmtTick(g.mean)}</text>`,
      );
    }
    parts.push(
      geo.xLabelAngle !== 0
        ? // Angled labels: anchor the label's end at the tick and rotate it down-left
          // so long names never overlap.
          `<text transform="translate(${g.labelX}, ${g.labelY - 4}) rotate(${geo.xLabelAngle})" ` +
            `font-size="${f}" fill="${LABEL_TEXT}" text-anchor="end">${esc(g.name)}</text>`
        : `<text x="${g.labelX}" y="${g.labelY}" font-size="${f}" fill="${LABEL_TEXT}" text-anchor="middle">${esc(g.name)}</text>`,
    );
  });

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

// ---------------------------------------------------------------------------
// Figure frame: the outer (on-screen) and export (physical) sizes
// ---------------------------------------------------------------------------

/** The resolved sizes a figure renders + exports at, derived from its style. */
export interface FigureFrame {
  /** The layout box (viewBox) in design-px (the box the axes lay out against). */
  box: FigureBox;
  /** The on-screen outer size in CSS px (what the rendered SVG occupies). */
  screenWidth: number;
  screenHeight: number;
  /** The physical export size in inches (PNG = inches * dpi, SVG = "Nin"). */
  exportInchesW: number;
  exportInchesH: number;
  /** Export rasterization density. */
  dpi: number;
  /** True when the style carries an explicit width / height. */
  hasSize: boolean;
}

/**
 * Resolve every size a figure needs. The layout box (viewBox) comes from
 * figureBox (base when relayout, user-size when relayout, base when scale). The
 * on-screen outer size is always the user's size in design-px (so scale mode
 * zooms the base viewBox up to the requested box). The export size is the same
 * physical dimensions in inches so a PNG rasterizes at inches * dpi and an SVG
 * opens at true physical size. With no stored size everything falls back to the
 * base box, so an old figure renders + exports exactly as before.
 */
export function figureFrame(style: PlotStyle): FigureFrame {
  const box = figureBox(style);
  const unit: SizeUnit = style.sizeUnit ?? "px";
  const dpi = style.dpi && style.dpi > 0 ? style.dpi : 300;
  const hasSize =
    typeof style.width === "number" &&
    style.width > 0 &&
    typeof style.height === "number" &&
    style.height > 0;
  if (!hasSize) {
    // No custom size: outer == base box, export at the base box treated as px
    // (inches = px / 96), so the existing hi-DPI PNG path stays the fallback.
    return {
      box,
      screenWidth: box.width,
      screenHeight: box.height,
      exportInchesW: toInches(FIG.width, "px"),
      exportInchesH: toInches(FIG.height, "px"),
      dpi,
      hasSize: false,
    };
  }
  const screenWidth = toDesignPx(style.width as number, unit);
  const screenHeight = toDesignPx(style.height as number, unit);
  return {
    box,
    screenWidth,
    screenHeight,
    exportInchesW: toInches(style.width as number, unit),
    exportInchesH: toInches(style.height as number, unit),
    dpi,
    hasSize: true,
  };
}

/**
 * Rewrite ONLY the root SVG element's width / height attributes (leaving the
 * viewBox untouched) so the same serialized figure can render at the on-screen
 * size, scale-zoom (viewBox stays base, outer grows), or carry true physical
 * units for export. Operates on the first width= / height= occurrences, which
 * are the root element's (the renderers write them first).
 */
export function withRootSize(
  svg: string,
  width: string,
  height: string,
): string {
  return svg
    .replace(/width="[^"]*"/, `width="${width}"`)
    .replace(/height="[^"]*"/, `height="${height}"`);
}

/** Round a physical inch value to a tidy string for an SVG width / height. */
function inchAttr(inches: number): string {
  // Trim to 4 decimals so 3.5 stays "3.5in" and odd cm conversions stay short.
  return `${Number(inches.toFixed(4))}in`;
}

/**
 * Produce the export-ready SVG markup for a figure. The root width / height are
 * set in true physical inches (so the .svg file opens at journal size in a
 * vector tool) while the viewBox stays the design-px box. With no custom size
 * the markup is returned unchanged, so an old figure exports exactly as before.
 * The SVG stays self-contained (no external CSS), so it remains a valid export.
 */
export function exportSvgMarkup(svg: string, frame: FigureFrame): string {
  if (!frame.hasSize) return svg;
  return withRootSize(
    svg,
    inchAttr(frame.exportInchesW),
    inchAttr(frame.exportInchesH),
  );
}

/**
 * The PNG pixel dimensions a figure exports at. A sized figure rasterizes at
 * physicalInches * dpi (so 3.5 in at 300 DPI is 1050 px wide). A figure with no
 * size keeps the prior hi-DPI behavior (the base box times the 3x device scale),
 * so an old figure's PNG is unchanged.
 */
export function exportPngPixels(frame: FigureFrame): {
  width: number;
  height: number;
} {
  if (!frame.hasSize) {
    const LEGACY_SCALE = 3;
    return {
      width: Math.round(FIG.width * LEGACY_SCALE),
      height: Math.round(FIG.height * LEGACY_SCALE),
    };
  }
  return {
    width: Math.round(frame.exportInchesW * frame.dpi),
    height: Math.round(frame.exportInchesH * frame.dpi),
  };
}

/**
 * The one-call path the editor uses: spec + content (+ the linked analysis) to a
 * ready SVG string. Resolves groups, pulls bracket requests from the analysis,
 * lays out, and serializes. Pure (no DOM).
 */
/**
 * A tree's tip axis, handed in by the phylo Tree Studio so a category-axis figure
 * (grouped bar, v1) lays its category axis out tip-for-tip instead of with its own
 * even spacing. Additive and back-compat: absent, every figure is byte-identical
 * to before this existed. `positions` is the tip center per id (px Y for "rows",
 * angle for "angles"); `band` is the per-tip band thickness. v1 supports "rows"
 * (rectangular) only. See docs/proposals/2026-06-13-phylo-phase4-datahub-linking.md.
 */
export interface AlignedAxis {
  order: string[];
  positions: number[];
  band: number;
  orientation: "rows" | "angles";
  /** Horizontal value-axis length in px (the panel thickness). Defaults to 120. */
  length?: number;
}

/** Optional render inputs that do not belong on the persisted PlotSpec. */
export interface RenderPlotOpts {
  alignedAxis?: AlignedAxis;
}

export function renderPlot(
  spec: PlotSpec,
  content: DataHubDocContent,
  analysis: AnalysisSpec | null,
  opts?: RenderPlotOpts,
): {
  svg: string;
  geometry:
    | PlotGeometry
    | XYPlotGeometry
    | GroupedBarGeometry
    | AlignedGroupedBarGeometry
    | SurvivalCurveGeometry
    | EstimationGeometry
    | DiagnosticGeometry
    | PartsOfWholeGeometry;
  style: PlotStyle;
  frame: FigureFrame;
} {
  const style = readPlotStyle(spec);
  const frame = figureFrame(style);
  // Render the figure, then size the on-screen root. In relayout the layout box
  // already equals the user size so the outer size matches; in scale the layout
  // box is the base FIG, so set the outer width / height to the user's size and
  // the base viewBox zooms up. With no custom size this is a no-op (outer ==
  // box), so the markup is unchanged from before sizing existed.
  const onScreen = (svg: string): string => {
    if (!frame.hasSize) return svg;
    return withRootSize(
      svg,
      String(frame.screenWidth),
      String(frame.screenHeight),
    );
  };
  if (style.kind === "xyScatter") {
    const source = readPlotSource(spec);
    const geometry = layoutXYPlot(content, style, source.yColumnId ?? null);
    const svg = onScreen(renderXYPlotSvg(geometry, style));
    return { svg, geometry, style, frame };
  }
  if (style.kind === "groupedBar") {
    // Tip-aligned path (phylo Tree Studio, Phase 4): lay the category axis out on
    // the tree's tips and draw horizontal bars per tip, value axis running right.
    // The drawer returns a self-contained fragment the panel renderer places; the
    // on-screen size wrapper does not apply (the phylo figure owns the frame).
    if (opts?.alignedAxis && opts.alignedAxis.orientation === "rows") {
      const geometry = layoutAlignedGroupedBar(content, style, opts.alignedAxis);
      const svg = renderAlignedGroupedBarSvg(geometry, style);
      return { svg, geometry, style, frame };
    }
    const geometry = layoutGroupedBar(content, style);
    const svg = onScreen(renderGroupedBarSvg(geometry, style));
    return { svg, geometry, style, frame };
  }
  if (style.kind === "survivalCurve") {
    const geometry = layoutSurvivalCurve(content, style);
    const svg = onScreen(renderSurvivalCurveSvg(geometry, style));
    return { svg, geometry, style, frame };
  }
  if (style.kind === "estimationGardnerAltman" || style.kind === "estimationCumming") {
    const geometry = layoutEstimationPlot(content, style);
    const svg = onScreen(renderEstimationSvg(geometry, style));
    return { svg, geometry, style, frame };
  }
  if (
    style.kind === "qqPlot" ||
    style.kind === "residualPlot" ||
    style.kind === "rocCurve"
  ) {
    const geometry = layoutDiagnosticPlot(content, style, analysis);
    const svg = onScreen(renderDiagnosticSvg(geometry, style));
    return { svg, geometry, style, frame };
  }
  if (
    style.kind === "pie" ||
    style.kind === "donut" ||
    style.kind === "stackedBar"
  ) {
    const geometry = layoutPartsOfWhole(content, style);
    const svg = onScreen(renderPartsOfWholeSvg(geometry, style));
    return { svg, geometry, style, frame };
  }
  const groups = resolvePlotGroups(content, style);
  const requests = style.showBrackets
    ? bracketRequestsFromAnalysis(analysis, groups)
    : [];
  const geometry = layoutPlot(groups, style, requests);
  const svg = onScreen(renderPlotSvg(geometry, style));
  return { svg, geometry, style, frame };
}

// ---------------------------------------------------------------------------
// XY scatter + fitted curve (pure, unit-tested)
// ---------------------------------------------------------------------------

/** A laid-out axis tick for the XY figure (value + its pixel position). */
export interface XYTick {
  value: number;
  /** Pixel x for an x-axis tick, or pixel y for a y-axis tick. */
  px: number;
}

/** The full laid-out XY figure the XY serializer turns into SVG. */
export interface XYPlotGeometry {
  width: number;
  height: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  xTicks: XYTick[];
  yTicks: XYTick[];
  /** The plotted raw observations, in pixels. */
  points: { x: number; y: number }[];
  /** The fitted-curve polyline in pixels, or null when no curve is drawn. */
  fitPath: { x: number; y: number }[] | null;
  color: string;
  /** A short readout for the fit (model + R-squared), or null. */
  fitNote: string | null;
}

/**
 * Standard "nice number" rounding (Heckbert) so an axis frames arbitrary data
 * with round tick values. round=true snaps to the nearest nice number; false
 * rounds up so the axis always covers the range.
 */
function niceNum(range: number, round: boolean): number {
  if (range <= 0 || !Number.isFinite(range)) return 1;
  const exp = Math.floor(Math.log10(range));
  const frac = range / Math.pow(10, exp);
  let nice: number;
  if (round) {
    if (frac < 1.5) nice = 1;
    else if (frac < 3) nice = 2;
    else if (frac < 7) nice = 5;
    else nice = 10;
  } else {
    if (frac <= 1) nice = 1;
    else if (frac <= 2) nice = 2;
    else if (frac <= 5) nice = 5;
    else nice = 10;
  }
  return nice * Math.pow(10, exp);
}

/**
 * Nice axis bounds + evenly spaced tick values covering [min, max]. Handles a
 * degenerate (min === max) range by opening a unit window around the value.
 */
export function niceTicks(
  min: number,
  max: number,
  count = 5,
): { lo: number; hi: number; step: number; values: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { lo: 0, hi: 1, step: 0.5, values: [0, 0.5, 1] };
  }
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.5 : 1;
    min -= pad;
    max += pad;
  }
  const range = niceNum(max - min, false);
  const step = niceNum(range / Math.max(1, count - 1), true);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const values: number[] = [];
  // Guard floating-point drift so the last tick lands exactly.
  for (let v = lo; v <= hi + step * 1e-6; v += step) {
    values.push(Math.round(v * 1e9) / 1e9);
  }
  return { lo, hi, step, values };
}

/**
 * Base-10 log-axis ticks spanning the data: lo / hi snap OUT to the enclosing
 * powers of ten, and the ticks are the powers of ten in that span. Shares the
 * niceTicks return shape (step is the decade count, unused by the renderer). The
 * caller guarantees min is strictly positive before choosing a log axis.
 */
export function logTicks(
  min: number,
  max: number,
): { lo: number; hi: number; step: number; values: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) {
    return { lo: 1, hi: 10, step: 1, values: [1, 10] };
  }
  const loE = Math.floor(Math.log10(min));
  const hiE = Math.max(loE + 1, Math.ceil(Math.log10(max)));
  const values: number[] = [];
  for (let e = loE; e <= hiE; e++) values.push(Math.pow(10, e));
  return { lo: Math.pow(10, loE), hi: Math.pow(10, hiE), step: 1, values };
}

/**
 * Apply manual min / max overrides to an auto axis (from niceTicks / logTicks),
 * keeping its tick values that fall inside the chosen range. An override is taken
 * only when finite, valid for a log axis (positive), and does not invert the range
 * (min < max); otherwise the auto bound stands. Used by the XY figure where both
 * axes have a free range (a column figure only overrides its top).
 */
function resolveAxisRange(
  auto: { lo: number; hi: number; values: number[] },
  min: number | undefined,
  max: number | undefined,
  isLog: boolean,
): { lo: number; hi: number; values: number[] } {
  let lo = auto.lo;
  let hi = auto.hi;
  if (min !== undefined && Number.isFinite(min) && (!isLog || min > 0)) lo = min;
  if (max !== undefined && Number.isFinite(max) && (!isLog || max > 0)) hi = max;
  if (lo >= hi) {
    lo = auto.lo;
    hi = auto.hi;
  }
  const values = auto.values.filter((v) => v >= lo - 1e-9 && v <= hi + 1e-9);
  return { lo, hi, values: values.length ? values : [lo, hi] };
}

/**
 * Resolve a fitted curve for the (x, y) pairs under a chosen model. Returns the
 * predictor function (fitted parameters baked in) plus a short note, or null
 * when no curve is requested / the fit cannot run. The engine does the math
 * (fitModel for nonlinear, the registered "linear" model for the line), so the
 * curve and any stored regression agree.
 */
function resolveXYFit(
  x: number[],
  y: number[],
  modelId: FitModelId,
): { predict: (x: number) => number; note: string } | null {
  if (modelId === "none") return null;
  const model = getModel(modelId);
  if (!model) return null;
  // Dose-response models fit on log10(dose); transform a raw dose column (and drop
  // non-positive doses) so the plotted curve uses the same fit as the analysis.
  const fitData = prepareFitData(modelId, x, y);
  if (fitData.x.length <= model.paramNames.length) return null;
  const result = fitModel(modelId, fitData.x, fitData.y);
  if (!result.ok) return null;
  const params = result.parameters.map((p) => p.value);
  if (!params.every((v) => Number.isFinite(v))) return null;
  const rawPredict = model.fn(params);
  // The curve is sampled at raw x positions; for a log-dose model map each raw
  // dose through log10 first so the drawn curve matches the fitted parameters
  // (and EC50 = 10^logEC50 sits at the visible half-max). Non-positive doses have
  // no point on a log-dose curve.
  const predict = model.logXInput
    ? (xv: number) => (xv > 0 ? rawPredict(Math.log10(xv)) : NaN)
    : rawPredict;
  const r2 = Number.isFinite(result.rSquared)
    ? `R-squared = ${result.rSquared.toFixed(3)}`
    : "";
  const note = `${model.label}${r2 ? `, ${r2}` : ""}`;
  return { predict, note };
}

/**
 * Lay out an XY figure: the scatter of (x, y) pairs for the chosen Y column on
 * numeric X and Y axes, plus an optional fitted curve sampled across the X
 * range. Both axes frame the data (the curve included) with nice round ticks.
 * Pure, so the geometry is asserted in the test suite.
 */
export function layoutXYPlot(
  content: DataHubDocContent,
  style: PlotStyle,
  yColumnId: string | null,
): XYPlotGeometry {
  const { width, height, padL, padR, padT, padB } = figureBox(style);
  const x0 = padL;
  const x1 = width - padR;
  const y0 = height - padB;
  const y1 = padT;

  // Resolve the Y column (the requested one, else the first available).
  const ys = yColumns(content);
  const xCol = xColumn(content);
  const targetY =
    (yColumnId && ys.find((c) => c.id === yColumnId)?.id) || ys[0]?.id || null;
  const pairs =
    xCol && targetY ? xyPairs(content, targetY) : { x: [], y: [] };
  const xs = pairs.x;
  const yvals = pairs.y;

  const color = colorForGroup(style, 0, 1);

  // The fitted curve (sampled later once the X scale exists).
  const fit = resolveXYFit(xs, yvals, style.fitModel);

  // Data extents over the points; widen the Y extent to include the curve.
  let xMinData = xs.length ? Math.min(...xs) : 0;
  let xMaxData = xs.length ? Math.max(...xs) : 1;
  if (xMinData === xMaxData) {
    xMaxData = xMinData + 1;
  }
  let yMinData = yvals.length ? Math.min(...yvals) : 0;
  let yMaxData = yvals.length ? Math.max(...yvals) : 1;

  // Log axes only when requested AND the data on that axis is strictly positive
  // (a log scale has no position for zero / negatives), else fall back to linear.
  const xLog = style.xScaleType === "log" && xMinData > 0;

  // Sample the fitted curve across the X data range to both draw it and let it
  // influence the Y frame (a curve can overshoot the points). On a log X the
  // samples are spaced in log space so the curve stays smooth across decades.
  const SAMPLES = 96;
  const rawFit: { x: number; y: number }[] = [];
  if (fit && xs.length > 0) {
    const lx0 = xLog ? Math.log10(xMinData) : xMinData;
    const lx1 = xLog ? Math.log10(xMaxData) : xMaxData;
    for (let i = 0; i <= SAMPLES; i++) {
      const t = lx0 + ((lx1 - lx0) * i) / SAMPLES;
      const xv = xLog ? Math.pow(10, t) : t;
      const yv = fit.predict(xv);
      if (Number.isFinite(yv)) {
        rawFit.push({ x: xv, y: yv });
        if (yv < yMinData) yMinData = yv;
        if (yv > yMaxData) yMaxData = yv;
      }
    }
  }

  // Y log decided after the fit, since the curve can widen the Y extent below 0.
  const yLog = style.yScaleType === "log" && yMinData > 0;

  const xAuto = xLog ? logTicks(xMinData, xMaxData) : niceTicks(xMinData, xMaxData);
  const yAuto = yLog ? logTicks(yMinData, yMaxData) : niceTicks(yMinData, yMaxData);
  // Manual range overrides (an XY axis has a free range, unlike a 0-based bar).
  const xAxis = resolveAxisRange(xAuto, style.xAxisMin, style.xAxisMax, xLog);
  const yAxis = resolveAxisRange(yAuto, style.yAxisMin, style.yAxisMax, yLog);

  const xScale = (xLog ? scaleLog() : scaleLinear())
    .domain([xAxis.lo, xAxis.hi])
    .range([x0, x1]);
  const yScale = (yLog ? scaleLog() : scaleLinear())
    .domain([yAxis.lo, yAxis.hi])
    .range([y0, y1]);
  const X = (v: number) => xScale(v);
  const Y = (v: number) => yScale(v);

  const xTicks: XYTick[] = xAxis.values.map((v) => ({ value: v, px: X(v) }));
  const yTicks: XYTick[] = yAxis.values.map((v) => ({ value: v, px: Y(v) }));

  const points = xs.map((xv, i) => ({ x: X(xv), y: Y(yvals[i]) }));
  const fitPath =
    rawFit.length > 0 ? rawFit.map((p) => ({ x: X(p.x), y: Y(p.y) })) : null;

  return {
    width,
    height,
    x0,
    x1,
    y0,
    y1,
    xMin: xAxis.lo,
    xMax: xAxis.hi,
    yMin: yAxis.lo,
    yMax: yAxis.hi,
    xTicks,
    yTicks,
    points,
    fitPath,
    color,
    fitNote: fit ? fit.note : null,
  };
}

/**
 * Serialize a laid-out XY figure into a standalone SVG string. Same portability
 * contract as the column serializer: a white ground, inline font stack, and no
 * external CSS, so the string downloads as a valid .svg and rasterizes to PNG.
 */
export function renderXYPlotSvg(geo: XYPlotGeometry, style: PlotStyle): string {
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
      `<text x="${geo.width / 2}" y="${geo.y1 - 14}" font-size="${f + 1}" ` +
        `fill="${LABEL_TEXT}" text-anchor="middle" font-weight="700">${esc(style.title)}</text>`,
    );
  }

  // Y axis + ticks.
  parts.push(
    `<line x1="${geo.x0}" y1="${geo.y1}" x2="${geo.x0}" y2="${geo.y0}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
  );
  for (const t of geo.yTicks) {
    parts.push(
      `<line x1="${geo.x0 - 4}" y1="${t.px}" x2="${geo.x0}" y2="${t.px}" stroke="${AXIS_COLOR}"/>` +
        `<text x="${geo.x0 - 8}" y="${t.px + 4}" font-size="${tickFont}" fill="${TICK_TEXT}" text-anchor="end">${fmtTick(t.value)}</text>`,
    );
  }
  if (style.yTitle.trim() !== "") {
    const midY = (geo.y0 + geo.y1) / 2;
    parts.push(
      `<text transform="translate(${geo.x0 - 38}, ${midY}) rotate(-90)" font-size="${f}" ` +
        `fill="${LABEL_TEXT}" text-anchor="middle">${esc(style.yTitle)}</text>`,
    );
  }

  // X axis + ticks.
  parts.push(
    `<line x1="${geo.x0}" y1="${geo.y0}" x2="${geo.x1}" y2="${geo.y0}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
  );
  for (const t of geo.xTicks) {
    parts.push(
      `<line x1="${t.px}" y1="${geo.y0}" x2="${t.px}" y2="${geo.y0 + 4}" stroke="${AXIS_COLOR}"/>` +
        `<text x="${t.px}" y="${geo.y0 + 16}" font-size="${tickFont}" fill="${TICK_TEXT}" text-anchor="middle">${fmtTick(t.value)}</text>`,
    );
  }
  if (style.xTitle.trim() !== "") {
    parts.push(
      `<text x="${(geo.x0 + geo.x1) / 2}" y="${geo.height - 8}" font-size="${f}" ` +
        `fill="${LABEL_TEXT}" text-anchor="middle">${esc(style.xTitle)}</text>`,
    );
  }

  // Fitted curve under the points.
  if (geo.fitPath && geo.fitPath.length > 1) {
    const d = geo.fitPath
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(" ");
    parts.push(
      `<path d="${d}" fill="none" stroke="${geo.color}" stroke-width="2"/>`,
    );
  }

  // Raw observations. Every marker carries data-series="0" (an XY figure is a
  // single series) so a double-click or right-click on any point recolors it.
  geo.points.forEach((p) => {
    parts.push(
      `<circle data-series="0" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3.2" fill="${geo.color}" opacity="0.9"/>`,
    );
  });

  // Fit readout (model + R-squared), top-left of the plot area.
  if (geo.fitNote) {
    parts.push(
      `<text x="${geo.x0 + 6}" y="${geo.y1 + 12}" font-size="${tickFont}" fill="${LABEL_TEXT}">${esc(geo.fitNote)}</text>`,
    );
  }

  parts.push(`</svg>`);
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Grouped bar chart (pure, unit-tested)
// ---------------------------------------------------------------------------

/** One bar in a grouped bar chart, in pixels. */
export interface GroupedBar {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  /** The error bar over this bar, or null. */
  error: { cx: number; topY: number; bottomY: number; capHalf: number } | null;
}

/** A laid-out cluster (one row-factor level) of grouped bars. */
export interface GroupedCluster {
  label: string;
  labelX: number;
  bars: GroupedBar[];
}

/** A legend entry (one column group). */
export interface GroupedLegendItem {
  name: string;
  color: string;
}

/** The full laid-out grouped bar figure. */
export interface GroupedBarGeometry {
  width: number;
  height: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  yMax: number;
  ticks: AxisTick[];
  clusters: GroupedCluster[];
  legend: GroupedLegendItem[];
}

/**
 * Lay out a grouped bar chart for a Grouped table: the row-factor levels along
 * the X axis, a cluster of bars per level (one bar per column group), bar height
 * the (row level, group) cell mean, and error bars from the cell SD / SEM (the
 * same numbers cellMean returns). Pure, so the geometry is asserted in tests.
 */
export function layoutGroupedBar(
  content: DataHubDocContent,
  style: PlotStyle,
): GroupedBarGeometry {
  const { width, height, padL, padR, padT, padB } = figureBox(style);
  const levels = rowFactorLevels(content);
  const groups = groupDatasets(content);

  // A "right"-placed legend reserves a gutter so the bars stop short and the
  // legend sits clear of them (the collision advisor's relocate-legend fix). The
  // default "overlay" reserves nothing, so x1 is unchanged and an old figure is
  // byte-identical.
  const placement = style.legendPlacement ?? "overlay";
  const legendGutter =
    placement === "right" && groups.length > 0
      ? groupedLegendWidth(
          groups.map((g) => g.name),
          Math.max(8, style.fontSize - 2),
        ) + GROUPED_LEGEND.gutterPad
      : 0;
  const x0 = padL;
  const x1 = width - padR - legendGutter;
  const y0 = height - padB;
  const y1 = padT;

  // Resolve every cell mean + error once.
  const stat = (level: string, datasetId: string) =>
    cellMean(content, level, datasetId);
  const errFor = (s: { sd: number | null; n: number }): number | null => {
    if (style.errorBar === "none") return null;
    if (s.sd === null || !Number.isFinite(s.sd)) return null;
    if (style.errorBar === "sd") return s.sd;
    const sem = s.sd / Math.sqrt(s.n);
    // 95% CI half-width needs n >= 2 for a finite t critical value.
    if (style.errorBar === "ci95") {
      return s.n >= 2 ? tCritTwoSided(0.05, s.n - 1) * sem : null;
    }
    return sem;
  };

  const mode: BarMode = style.barMode ?? "dodge";
  const stacked = mode === "stack" || mode === "stack100";
  // The positive part of a cell mean (stacking treats non-positive as zero).
  const posMean = (level: string, datasetId: string): number => {
    const m = stat(level, datasetId).mean;
    return m !== null && m > 0 ? m : 0;
  };
  const clusterSum = (level: string): number =>
    groups.reduce((acc, g) => acc + posMean(level, g.datasetId), 0);

  // Frame the Y axis. dodge = max(mean + error); stack = max cluster total;
  // stack100 = 1 (each cluster normalized to a full bar).
  let yMax: number;
  let step: number;
  if (mode === "stack100") {
    yMax = 1;
    step = 0.25;
  } else {
    let dataMax = 0;
    let any = false;
    if (mode === "stack") {
      for (const level of levels) {
        const total = clusterSum(level);
        if (total > 0) any = true;
        if (total > dataMax) dataMax = total;
      }
    } else {
      for (const level of levels) {
        for (const g of groups) {
          const s = stat(level, g.datasetId);
          if (s.mean === null) continue;
          any = true;
          const top = s.mean + (errFor(s) ?? 0);
          if (top > dataMax) dataMax = top;
        }
      }
    }
    if (!any || dataMax <= 0) {
      yMax = 1;
      step = 0.5;
    } else {
      const t = niceTicks(0, dataMax * 1.1);
      yMax = t.hi;
      step = t.step;
    }
  }

  // Manual overrides (not for stack100, which is normalized to a full bar).
  if (mode !== "stack100") {
    if (style.yAxisMax !== undefined && style.yAxisMax > 0) yMax = style.yAxisMax;
    if (style.yTickStep !== undefined && style.yTickStep > 0) step = style.yTickStep;
  }

  const yScale = scaleLinear().domain([0, yMax]).range([y0, y1]);
  const Y = (v: number) => yScale(v);

  const ticks: AxisTick[] = [];
  for (let v = 0; v <= yMax + step * 1e-6; v += step) {
    const value = Math.round(v * 1e6) / 1e6;
    ticks.push({ value, y: Y(value) });
  }

  const nLevels = Math.max(1, levels.length);
  const clusterW = (x1 - x0) / nLevels;
  const nGroups = Math.max(1, groups.length);
  // One color per group (sampled from the active palette to the group count, with
  // overrides applied), shared by the bars and the legend.
  const groupColors = seriesColors(style, groups.length);
  // Bars fill 70% of the cluster, split among the groups, with a small gap.
  const bandW = clusterW * 0.7;
  const barW = bandW / nGroups;
  const capHalf = Math.min(6, barW * 0.3);

  const clusters: GroupedCluster[] = levels.map((level, li) => {
    const cx = x0 + clusterW * (li + 0.5);
    if (stacked) {
      // One band per cluster; segments stack from the baseline up. stack100
      // normalizes the segments to the full bar. No per-segment error bar.
      const left = cx - bandW / 2;
      const segW = bandW * 0.86;
      const total = mode === "stack100" ? clusterSum(level) : 0;
      let cum = 0;
      const bars: GroupedBar[] = groups.map((g, gi) => {
        const color = groupColors[gi] ?? "#000000";
        const raw = posMean(level, g.datasetId);
        const val = mode === "stack100" ? (total > 0 ? raw / total : 0) : raw;
        const vBottom = cum;
        const vTop = cum + val;
        cum = vTop;
        const yTop = Y(vTop);
        return {
          x: left,
          y: yTop,
          width: segW,
          height: Y(vBottom) - yTop,
          color,
          error: null,
        };
      });
      return { label: level, labelX: cx, bars };
    }
    const left = cx - bandW / 2;
    const bars: GroupedBar[] = groups.map((g, gi) => {
      const s = stat(level, g.datasetId);
      const color = groupColors[gi] ?? "#000000";
      const bx = left + barW * gi;
      const mean = s.mean;
      if (mean === null) {
        return { x: bx, y: y0, width: barW * 0.86, height: 0, color, error: null };
      }
      const y = Y(mean);
      const e = errFor(s);
      const barCx = bx + (barW * 0.86) / 2;
      const error =
        e !== null && e > 0
          ? { cx: barCx, topY: Y(mean + e), bottomY: Y(mean - e), capHalf }
          : null;
      return { x: bx, y, width: barW * 0.86, height: y0 - y, color, error };
    });
    return { label: level, labelX: cx, bars };
  });

  const legend: GroupedLegendItem[] = groups.map((g, gi) => ({
    name: g.name,
    color: groupColors[gi] ?? "#000000",
  }));

  return { width, height, x0, x1, y0, y1, yMax, ticks, clusters, legend };
}

/**
 * Layout literals for the grouped-bar legend (top-right INSIDE the plot area).
 * Shared by renderGroupedBarSvg (the ink) and the collision advisor's manifest
 * (plot-manifest.ts), so the advisor measures the exact box that is drawn. Per
 * row: a 9px swatch at x1-92 then the series name; rows step down by 13 from
 * y1+4. The legend sitting inside the data band is the "legend over the bars"
 * collision the advisor flags.
 */
export const GROUPED_LEGEND = {
  swatchInsetFromX1: 92, // overlay swatch left x = geo.x1 - 92
  textInsetFromX1: 79, // overlay series-name left x = geo.x1 - 79
  rowH: 13,
  topPad: 4, // first row top y = geo.y1 + 4
  swatch: 9,
  gutterPad: 10, // gap between the plot area and a "right"-placed legend
} as const;

/** The block width a legend needs (swatch + gap + widest series name), matching
 *  the overlay box width (swatchInset - textInset = 13, plus the widest name).
 *  Shared by layoutGroupedBar (to reserve the right gutter), the serializer, and
 *  the collision manifest. */
export function groupedLegendWidth(names: string[], tickFont: number): number {
  const maxNameW = names.reduce(
    (m, n) => Math.max(m, estimateLabelWidth(n, tickFont)),
    0,
  );
  return GROUPED_LEGEND.swatchInsetFromX1 - GROUPED_LEGEND.textInsetFromX1 + maxNameW;
}

/** The legend swatch left-x for a placement. "overlay" draws inside the plot top-
 *  right; "right" draws in the reserved gutter just past the (shrunk) plot edge.
 *  One formula so the ink, the manifest, and the reserved gutter never drift. */
export function groupedLegendSwatchX(
  x1: number,
  placement: "overlay" | "right",
): number {
  return placement === "right"
    ? x1 + GROUPED_LEGEND.gutterPad
    : x1 - GROUPED_LEGEND.swatchInsetFromX1;
}

/** Serialize a grouped bar figure into a standalone SVG string. */
export function renderGroupedBarSvg(
  geo: GroupedBarGeometry,
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
      `<text x="${geo.width / 2}" y="${geo.y1 - 14}" font-size="${f + 1}" ` +
        `fill="${LABEL_TEXT}" text-anchor="middle" font-weight="700">${esc(style.title)}</text>`,
    );
  }

  // Y axis + ticks.
  parts.push(
    `<line x1="${geo.x0}" y1="${geo.y1}" x2="${geo.x0}" y2="${geo.y0}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
  );
  for (const t of geo.ticks) {
    parts.push(
      `<line x1="${geo.x0 - 4}" y1="${t.y}" x2="${geo.x0}" y2="${t.y}" stroke="${AXIS_COLOR}"/>` +
        `<text x="${geo.x0 - 8}" y="${t.y + 4}" font-size="${tickFont}" fill="${TICK_TEXT}" text-anchor="end">${fmtTick(t.value)}</text>`,
    );
  }
  if (style.yTitle.trim() !== "") {
    const midY = (geo.y0 + geo.y1) / 2;
    parts.push(
      `<text transform="translate(${geo.x0 - 38}, ${midY}) rotate(-90)" font-size="${f}" ` +
        `fill="${LABEL_TEXT}" text-anchor="middle">${esc(style.yTitle)}</text>`,
    );
  }
  // X axis.
  parts.push(
    `<line x1="${geo.x0}" y1="${geo.y0}" x2="${geo.x1}" y2="${geo.y0}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
  );

  // Clusters: bars + error bars + the level label.
  for (const cluster of geo.clusters) {
    for (const bar of cluster.bars) {
      if (bar.height > 0) {
        parts.push(
          `<rect x="${bar.x.toFixed(2)}" y="${bar.y.toFixed(2)}" width="${bar.width.toFixed(2)}" height="${bar.height.toFixed(2)}" fill="${bar.color}" opacity="0.85"/>`,
        );
      }
      if (bar.error) {
        const eb = bar.error;
        parts.push(
          `<line x1="${eb.cx.toFixed(2)}" y1="${eb.bottomY.toFixed(2)}" x2="${eb.cx.toFixed(2)}" y2="${eb.topY.toFixed(2)}" stroke="${LABEL_TEXT}" stroke-width="1.3"/>` +
            `<line x1="${(eb.cx - eb.capHalf).toFixed(2)}" y1="${eb.topY.toFixed(2)}" x2="${(eb.cx + eb.capHalf).toFixed(2)}" y2="${eb.topY.toFixed(2)}" stroke="${LABEL_TEXT}" stroke-width="1.3"/>`,
        );
      }
    }
    parts.push(
      `<text x="${cluster.labelX.toFixed(2)}" y="${geo.y0 + 16}" font-size="${tickFont}" fill="${LABEL_TEXT}" text-anchor="middle">${esc(cluster.label)}</text>`,
    );
  }

  // Legend. "overlay" (default) draws it top-right INSIDE the plot area; "right"
  // draws it in the reserved gutter just past the (shrunk) plot edge, clear of the
  // bars. The swatch carries data-series so a direct edit on the plot can recolor a
  // whole group from its legend entry. The x lives in groupedLegendSwatchX so the
  // collision advisor's manifest measures the EXACT box this draws (no drift).
  const legendSwatchX = groupedLegendSwatchX(
    geo.x1,
    style.legendPlacement ?? "overlay",
  );
  const legendTextX =
    legendSwatchX + (GROUPED_LEGEND.swatchInsetFromX1 - GROUPED_LEGEND.textInsetFromX1);
  let ly = geo.y1 + GROUPED_LEGEND.topPad;
  geo.legend.forEach((item, i) => {
    parts.push(
      `<rect data-series="${i}" x="${legendSwatchX}" y="${ly}" width="${GROUPED_LEGEND.swatch}" height="${GROUPED_LEGEND.swatch}" fill="${item.color}" opacity="0.85"/>` +
        `<text x="${legendTextX}" y="${ly + 8}" font-size="${tickFont}" fill="${LABEL_TEXT}">${esc(item.name)}</text>`,
    );
    ly += GROUPED_LEGEND.rowH;
  });

  if (style.xTitle.trim() !== "") {
    parts.push(
      `<text x="${(geo.x0 + geo.x1) / 2}" y="${geo.height - 8}" font-size="${f}" ` +
        `fill="${LABEL_TEXT}" text-anchor="middle">${esc(style.xTitle)}</text>`,
    );
  }

  parts.push(`</svg>`);
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Tip-aligned grouped bar (phylo Tree Studio seam, Phase 4)
//
// The SAME grouped-bar data (row-factor levels = tips, column groups = series),
// drawn HORIZONTALLY against a tree's tip axis: category axis is the tip's vertical
// position (handed in via AlignedAxis), value axis runs to the right. dodge =
// thin bars stacked inside each tip band; stack / stack100 = segments along X.
// Pure geometry, asserted in tests. The renderer returns a fragment (a <g>) in
// tree-space Y + panel-local X (0..length), which the phylo panel renderer
// translates to the column's start X. The numbers are read verbatim from the
// metadata table (no statistic), descriptive and gate-exempt like parts-of-whole.
// ---------------------------------------------------------------------------

/** One horizontal bar (or stacked segment) in a tip-aligned grouped bar. */
export interface AlignedGroupedBar {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

/** One tip row of a tip-aligned grouped bar (bars share the tip's vertical band). */
export interface AlignedGroupedRow {
  id: string;
  cy: number;
  bars: AlignedGroupedBar[];
}

/** The full laid-out tip-aligned grouped bar panel. */
export interface AlignedGroupedBarGeometry {
  /** Value-axis length in px (the panel thickness drawn to the right of the tree). */
  length: number;
  yTop: number;
  yBot: number;
  valueMax: number;
  ticks: { value: number; x: number }[];
  rows: AlignedGroupedRow[];
  legend: GroupedLegendItem[];
}

/**
 * Lay out a grouped bar against a tree's tip axis. `axis.order` lists the tip ids
 * in tip order and `axis.positions[i]` is that tip's vertical center; `axis.band`
 * is the per-tip band thickness. dodge splits the band among the groups; stack /
 * stack100 draw one band of cumulative segments (stack100 normalizes each tip to a
 * full bar). A tip with no finite value keeps its (empty) band slot.
 */
export function layoutAlignedGroupedBar(
  content: DataHubDocContent,
  style: PlotStyle,
  axis: AlignedAxis,
): AlignedGroupedBarGeometry {
  const length = axis.length && axis.length > 0 ? axis.length : 120;
  const groups = groupDatasets(content);
  const groupColors = seriesColors(style, groups.length);
  const nGroups = Math.max(1, groups.length);
  const mode: BarMode = style.barMode ?? "dodge";
  const stacked = mode === "stack" || mode === "stack100";

  const posMean = (level: string, datasetId: string): number => {
    const m = cellMean(content, level, datasetId).mean;
    return m !== null && m > 0 ? m : 0;
  };
  const clusterSum = (level: string): number =>
    groups.reduce((acc, g) => acc + posMean(level, g.datasetId), 0);

  // Value-axis max. dodge = max single mean; stack = max tip total; stack100 = 1.
  let valueMax: number;
  if (mode === "stack100") {
    valueMax = 1;
  } else {
    let dataMax = 0;
    for (const level of axis.order) {
      if (mode === "stack") {
        dataMax = Math.max(dataMax, clusterSum(level));
      } else {
        for (const g of groups) {
          dataMax = Math.max(dataMax, posMean(level, g.datasetId));
        }
      }
    }
    valueMax = dataMax > 0 ? niceTicks(0, dataMax).hi : 1;
  }
  const X = (v: number) => (valueMax > 0 ? (v / valueMax) * length : 0);

  // Bars fill 70% of the band; dodge splits that among the groups.
  const usable = axis.band * 0.7;
  const positions = axis.positions;
  const rows: AlignedGroupedRow[] = axis.order.map((level, i) => {
    const cy = positions[i] ?? 0;
    const bandTop = cy - usable / 2;
    if (stacked) {
      const total = mode === "stack100" ? clusterSum(level) : 0;
      let cum = 0;
      const bars: AlignedGroupedBar[] = groups.map((g, gi) => {
        const raw = posMean(level, g.datasetId);
        const val = mode === "stack100" ? (total > 0 ? raw / total : 0) : raw;
        const x = X(cum);
        cum += val;
        return {
          x,
          y: bandTop,
          width: X(cum) - x,
          height: usable * 0.92,
          color: groupColors[gi] ?? "#000000",
        };
      });
      return { id: level, cy, bars };
    }
    const subH = usable / nGroups;
    const bars: AlignedGroupedBar[] = groups.map((g, gi) => ({
      x: 0,
      y: bandTop + subH * gi,
      width: X(posMean(level, g.datasetId)),
      height: subH * 0.86,
      color: groupColors[gi] ?? "#000000",
    }));
    return { id: level, cy, bars };
  });

  const rawStep = niceTicks(0, valueMax).step;
  // Never advance by a non-positive step (a degenerate niceTicks return would
  // otherwise spin forever); fall back to a single span tick.
  const tickStep = rawStep > 0 ? rawStep : valueMax;
  const ticks: { value: number; x: number }[] = [];
  for (let v = 0; v <= valueMax + tickStep * 1e-6; v += tickStep) {
    const value = Math.round(v * 1e6) / 1e6;
    ticks.push({ value, x: X(value) });
  }

  const ys = positions.length ? positions : [0];
  const yTop = Math.min(...ys) - axis.band / 2;
  const yBot = Math.max(...ys) + axis.band / 2;
  const legend: GroupedLegendItem[] = groups.map((g, gi) => ({
    name: g.name,
    color: groupColors[gi] ?? "#000000",
  }));

  return { length, yTop, yBot, valueMax, ticks, rows, legend };
}

/**
 * Serialize a tip-aligned grouped bar into an SVG FRAGMENT (a <g>, not a full
 * document): bars in panel-local X (0..length) and tree-space Y, plus a value-axis
 * ruler at the bottom. The phylo panel renderer wraps this in a translate to the
 * column's start X; the legend is collected tree-side, so none is drawn here.
 */
export function renderAlignedGroupedBarSvg(
  geo: AlignedGroupedBarGeometry,
  style: PlotStyle,
): string {
  const tickFont = Math.max(8, style.fontSize - 2);
  const parts: string[] = [`<g>`];
  for (const row of geo.rows) {
    for (const bar of row.bars) {
      if (bar.width <= 0) continue;
      parts.push(
        `<rect x="${bar.x.toFixed(2)}" y="${bar.y.toFixed(2)}" width="${bar.width.toFixed(2)}" height="${bar.height.toFixed(2)}" fill="${bar.color}" opacity="0.85"/>`,
      );
    }
  }
  // Value-axis ruler under the panel: baseline + ticks with value labels.
  const axisY = geo.yBot + 6;
  parts.push(
    `<line x1="0" y1="${axisY.toFixed(2)}" x2="${geo.length.toFixed(2)}" y2="${axisY.toFixed(2)}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
  );
  for (const t of geo.ticks) {
    parts.push(
      `<line x1="${t.x.toFixed(2)}" y1="${axisY.toFixed(2)}" x2="${t.x.toFixed(2)}" y2="${(axisY + 4).toFixed(2)}" stroke="${AXIS_COLOR}"/>` +
        `<text x="${t.x.toFixed(2)}" y="${(axisY + 14).toFixed(2)}" font-size="${tickFont}" fill="${TICK_TEXT}" text-anchor="middle">${fmtTick(t.value)}</text>`,
    );
  }
  parts.push(`</g>`);
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Kaplan-Meier survival curve (pure, unit-tested)
// ---------------------------------------------------------------------------

/** One survival arm laid out as a step polyline, in pixels. */
export interface SurvivalCurve {
  name: string;
  color: string;
  /** The step polyline points (a horizontal then vertical drop per event). */
  path: { x: number; y: number }[];
  /** The median survival time, or null when never reached. */
  median: number | null;
}

/** The full laid-out survival figure. */
export interface SurvivalCurveGeometry {
  width: number;
  height: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  tMax: number;
  xTicks: XYTick[];
  yTicks: XYTick[];
  curves: SurvivalCurve[];
  legend: GroupedLegendItem[];
}

/**
 * Lay out a Kaplan-Meier survival figure: time on the X axis, survival 0..1 on
 * the Y axis, one step-down curve per group (starting at survival 1 at time 0
 * and dropping at each event time). Pure, asserted in the test suite.
 */
export function layoutSurvivalCurve(
  content: DataHubDocContent,
  style: PlotStyle,
): SurvivalCurveGeometry {
  const { width, height, padL, padR, padT, padB } = figureBox(style);
  const x0 = padL;
  const x1 = width - padR;
  const y0 = height - padB;
  const y1 = padT;

  const groups = survivalGroups(content).filter(
    (g) => g.observations.length > 0,
  );

  // Time axis runs 0 .. the largest observed time.
  let tMaxData = 0;
  for (const g of groups) {
    for (const o of g.observations) {
      if (o.time > tMaxData) tMaxData = o.time;
    }
  }
  const xAxis = niceTicks(0, tMaxData > 0 ? tMaxData : 1);
  const tMax = xAxis.hi;
  const xScale = scaleLinear().domain([0, tMax]).range([x0, x1]);
  // Survival is a fixed 0..1 fraction axis.
  const yScale = scaleLinear().domain([0, 1]).range([y0, y1]);
  const X = (v: number) => xScale(v);
  const Y = (v: number) => yScale(v);

  const xTicks: XYTick[] = xAxis.values
    .filter((v) => v >= 0 && v <= tMax + 1e-9)
    .map((v) => ({ value: v, px: X(v) }));
  const yTicks: XYTick[] = [0, 0.25, 0.5, 0.75, 1].map((v) => ({
    value: v,
    px: Y(v),
  }));

  // One color per arm, sampled from the active palette to the arm count.
  const armColors = seriesColors(style, groups.length);
  const curves: SurvivalCurve[] = groups.map((g, gi) => {
    const km = kaplanMeier(g.observations);
    const color = armColors[gi] ?? "#000000";
    const path: { x: number; y: number }[] = [{ x: X(0), y: Y(1) }];
    let prevSurvival = 1;
    if (km.ok) {
      for (const step of km.steps) {
        // Horizontal to the event time at the prior survival, then drop.
        path.push({ x: X(step.time), y: Y(prevSurvival) });
        path.push({ x: X(step.time), y: Y(step.survival) });
        prevSurvival = step.survival;
      }
    }
    // Extend the last level out to the end of the axis.
    path.push({ x: X(tMax), y: Y(prevSurvival) });
    return { name: g.name, color, path, median: km.ok ? km.median : null };
  });

  const legend: GroupedLegendItem[] = curves.map((c) => ({
    name: c.name,
    color: c.color,
  }));

  return { width, height, x0, x1, y0, y1, tMax, xTicks, yTicks, curves, legend };
}

/** Serialize a survival figure into a standalone SVG string. */
export function renderSurvivalCurveSvg(
  geo: SurvivalCurveGeometry,
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
      `<text x="${geo.width / 2}" y="${geo.y1 - 14}" font-size="${f + 1}" ` +
        `fill="${LABEL_TEXT}" text-anchor="middle" font-weight="700">${esc(style.title)}</text>`,
    );
  }

  // Y axis + ticks (survival fraction).
  parts.push(
    `<line x1="${geo.x0}" y1="${geo.y1}" x2="${geo.x0}" y2="${geo.y0}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
  );
  for (const t of geo.yTicks) {
    parts.push(
      `<line x1="${geo.x0 - 4}" y1="${t.px}" x2="${geo.x0}" y2="${t.px}" stroke="${AXIS_COLOR}"/>` +
        `<text x="${geo.x0 - 8}" y="${t.px + 4}" font-size="${tickFont}" fill="${TICK_TEXT}" text-anchor="end">${fmtTick(t.value)}</text>`,
    );
  }
  const yTitle = style.yTitle.trim() || "Survival";
  const midY = (geo.y0 + geo.y1) / 2;
  parts.push(
    `<text transform="translate(${geo.x0 - 38}, ${midY}) rotate(-90)" font-size="${f}" ` +
      `fill="${LABEL_TEXT}" text-anchor="middle">${esc(yTitle)}</text>`,
  );

  // X axis + ticks.
  parts.push(
    `<line x1="${geo.x0}" y1="${geo.y0}" x2="${geo.x1}" y2="${geo.y0}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
  );
  for (const t of geo.xTicks) {
    parts.push(
      `<line x1="${t.px}" y1="${geo.y0}" x2="${t.px}" y2="${geo.y0 + 4}" stroke="${AXIS_COLOR}"/>` +
        `<text x="${t.px}" y="${geo.y0 + 16}" font-size="${tickFont}" fill="${TICK_TEXT}" text-anchor="middle">${fmtTick(t.value)}</text>`,
    );
  }
  const xTitle = style.xTitle.trim() || "Time";
  parts.push(
    `<text x="${(geo.x0 + geo.x1) / 2}" y="${geo.height - 8}" font-size="${f}" ` +
      `fill="${LABEL_TEXT}" text-anchor="middle">${esc(xTitle)}</text>`,
  );

  // Step curves.
  for (const curve of geo.curves) {
    if (curve.path.length < 2) continue;
    const d = curve.path
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(" ");
    parts.push(
      `<path d="${d}" fill="none" stroke="${curve.color}" stroke-width="2"/>`,
    );
  }

  // Legend (top-right inside the plot area). The swatch carries data-series so a
  // direct edit on the plot can recolor a whole arm from its legend entry.
  let ly = geo.y1 + 4;
  geo.legend.forEach((item, i) => {
    parts.push(
      `<rect data-series="${i}" x="${geo.x1 - 92}" y="${ly}" width="9" height="9" fill="${item.color}" opacity="0.9"/>` +
        `<text x="${geo.x1 - 79}" y="${ly + 8}" font-size="${tickFont}" fill="${LABEL_TEXT}">${esc(item.name)}</text>`,
    );
    ly += 13;
  });

  parts.push(`</svg>`);
  return parts.join("");
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
 * Rasterize + download a PNG at exact target pixel dimensions (the size-aware
 * export, so a sized figure rasterizes at physicalInches * dpi). Pairs with
 * exportPngPixels, which derives the dimensions from the figure frame.
 */
export async function downloadPngAt(
  svg: string,
  pixelWidth: number,
  pixelHeight: number,
  fileStem: string,
): Promise<void> {
  const blob = await svgToPngBlobAt(svg, pixelWidth, pixelHeight);
  downloadBlob(blob, `${fileStem}.png`);
}

/**
 * Rasterize an SVG to a PNG Blob at exact target pixel dimensions. The source
 * figure's viewBox is the layout box, so drawing it to fill a width x height
 * canvas scales it crisply to the requested resolution. Used by the size-aware
 * export so a 3.5 in figure at 300 DPI rasterizes to a 1050 px wide PNG.
 */
export function svgToPngBlobAt(
  svg: string,
  pixelWidth: number,
  pixelHeight: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(pixelWidth));
        canvas.height = Math.max(1, Math.round(pixelHeight));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error("Canvas 2D context unavailable for PNG export."));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
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

/**
 * Download the figure as a vector SVG sized to its style. The root width /
 * height carry true physical inches (so the file opens at journal size) while
 * the viewBox stays the layout box. A figure with no custom size exports the
 * markup unchanged.
 */
export function downloadFigureSvg(
  svg: string,
  frame: FigureFrame,
  fileStem: string,
): void {
  downloadSvg(exportSvgMarkup(svg, frame), fileStem);
}

/**
 * Download the figure as a PNG rasterized to its export size (physicalInches *
 * dpi for a sized figure, or the prior 3x hi-DPI base for a sizeless one). The
 * SVG carries physical units so the raster matches the intended print size.
 */
export async function downloadFigurePng(
  svg: string,
  frame: FigureFrame,
  fileStem: string,
): Promise<void> {
  const { width, height } = exportPngPixels(frame);
  const markup = exportSvgMarkup(svg, frame);
  const blob = await svgToPngBlobAt(markup, width, height);
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

/**
 * Copy the figure to the clipboard at its export size. Rasterizes a PNG at
 * physicalInches * dpi (so a pasted slide image matches the chosen print size),
 * falling back to the physically-sized SVG text when image-clipboard is blocked.
 */
export async function copyFigure(
  svg: string,
  frame: FigureFrame,
): Promise<"image" | "text"> {
  const markup = exportSvgMarkup(svg, frame);
  const { width, height } = exportPngPixels(frame);
  const canWriteImage =
    typeof ClipboardItem !== "undefined" &&
    !!navigator.clipboard &&
    typeof navigator.clipboard.write === "function";
  if (canWriteImage) {
    try {
      const png = await svgToPngBlobAt(markup, width, height);
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": png }),
      ]);
      return "image";
    } catch {
      // Fall through to the text path.
    }
  }
  await navigator.clipboard.writeText(markup);
  return "text";
}

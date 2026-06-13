"use client";

// datahub/bigtable/dataset-plots.ts
//
// PLOTS on the Data Hub large-dataset lane (DataHub-largetables lane, Phase 3b).
// The dataset-lane mirror of the editable lane's figure path, async over DuckDB,
// with sample-or-aggregate handling for a large N.
//
// THE VALIDATION GATE (the whole point, mirrored from Phase 3a analyses). DuckDB
// ONLY MOVES DATA. It pulls the named columns out of the on-disk Parquet into
// plain number arrays (see ./dataset-columns.ts). It NEVER computes a published
// statistic that lands ON a figure. Every summary number a figure draws (a bar's
// mean, an error bar's SD / SEM, a column-scatter's mean line) is computed by the
// SAME validated path the editable lane uses: this builder wraps the pulled arrays
// into a synthetic editable-lane Column / Grouped / XY content and hands it to the
// SAME plot-spec.ts functions (resolvePlotGroups -> computeAllGroupStats ->
// engineDescribe; layoutGroupedBar -> cellMean; layoutXYPlot). There is ONE code
// path for the figure's numbers, so a dataset bar plot is byte-identical to an
// editable bar plot on the same data (proven in __tests__/dataset-plots.test.ts).
//
// SAMPLE THE DOTS, NEVER THE NUMBERS, AND NEVER SILENTLY. Only the SCATTER kinds
// (columnScatter, xyScatter) sample raw points, because 247k dots cannot be drawn.
// The mean line + error bars overlaid on a sampled column-scatter are still
// computed on the FULL column via the engine; only the plotted dots are a sample.
// A bar / grouped bar renders EXACT from the full column (summary via the engine).
// When a scatter is sampled the caller is handed a DatasetPlotSampleInfo so the UI
// can state "showing N of M points"; this layer never truncates silently.
//
// Client-only: it loads the DuckDB worker through the column readers.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type {
  ColumnDef,
  DataHubDocContent,
  DataHubDocument,
  RowRecord,
  CellValue,
  PlotSpec,
} from "@/lib/datahub/model/types";
import {
  readPlotStyle,
  resolvePlotGroups,
  layoutPlot,
  renderPlotSvg,
  bracketRequestsFromAnalysis,
  layoutGroupedBar,
  renderGroupedBarSvg,
  layoutXYPlot,
  renderXYPlotSvg,
  type PlotGroup,
  type PlotKind,
  type PlotStyle,
} from "@/lib/datahub/plot-spec";
import { computeGroupStats } from "@/lib/datahub/column-table";
import type { DatasetSidecar } from "./types";
import type { OpenDatasetHandle } from "./dataset-view";
import {
  readColumn,
  readColumnAligned,
  readColumnByGroup,
} from "./dataset-columns";

/**
 * The plot kinds Phase 3b draws on a dataset. These are the EXISTING plot-spec.ts
 * kinds whose layout / serialize functions already draw without new geometry:
 *   - columnScatter / columnBar: one numeric column (or one per group) summarized
 *     by the engine; the scatter samples its dots.
 *   - groupedBar: a numeric value column crossed by a row-factor column and a
 *     series column (two categoricals), means via the editable lane's cellMean.
 *   - xyScatter: two numeric columns plotted as points; the points are sampled and
 *     the fitted curve is forced off on the dataset lane (a fit-on-full overlay is
 *     deferred, see the module note), so no published statistic rides a sample.
 * box / histogram are DEFERRED: both need NEW SVG geometry in plot-spec.ts, which
 * the Phase 3b scope fences off.
 */
export const DATASET_PLOT_KINDS: PlotKind[] = [
  "columnScatter",
  "columnBar",
  "groupedBar",
  "xyScatter",
];

/** The default cap on rendered scatter dots. A column of 247k cannot be drawn. */
export const DEFAULT_POINT_SAMPLE = 5000;

/**
 * Which plot kinds are runnable for a dataset's schema. columnScatter / columnBar
 * need at least one numeric column; groupedBar needs a numeric value column plus
 * two categorical columns (the row factor and the series); xyScatter needs at
 * least two numeric columns. A scatter / bar over a single numeric column split by
 * a group is also offered when a categorical column exists (the tidy / long shape).
 */
export function validDatasetPlotKinds(
  numericColumns: number,
  categoricalColumns: number,
): PlotKind[] {
  const out: PlotKind[] = [];
  if (numericColumns >= 1) out.push("columnScatter", "columnBar");
  if (numericColumns >= 2) out.push("xyScatter");
  if (numericColumns >= 1 && categoricalColumns >= 2) out.push("groupedBar");
  return out;
}

/** What a single scatter sampled: how many dots are drawn of how many total. */
export interface DatasetPlotSampleInfo {
  /** How many raw points are actually drawn (the sample size). */
  rendered: number;
  /** How many finite raw points exist in the full column (the population). */
  total: number;
}

/** A ready-to-render dataset figure: the synthetic content + the live SVG. */
export interface DatasetPlotResult {
  /** The standalone SVG string (same portable markup the editable lane renders). */
  svg: string;
  /** Sampling info when a scatter sampled its dots; absent for exact figures. */
  sampleInfo?: DatasetPlotSampleInfo;
}

/** How a dataset figure resolves its columns from the chosen source. */
export interface DatasetPlotOptions {
  /** The numeric value column (columnScatter / columnBar / groupedBar / xyScatter Y). */
  valueColumn?: string;
  /** The X numeric column for an xyScatter. */
  xColumn?: string;
  /**
   * A categorical column whose distinct categories become the comparison groups
   * for a columnScatter / columnBar (the tidy / long shape). When absent the
   * valueColumn is a single group.
   */
  groupByColumn?: string;
  /**
   * The row-factor categorical column for a groupedBar (the x-axis clusters).
   * Required for groupedBar.
   */
  rowFactorColumn?: string;
  /**
   * The series categorical column for a groupedBar (the bars within a cluster).
   * Required for groupedBar.
   */
  seriesColumn?: string;
  /** The cap on rendered scatter dots (default DEFAULT_POINT_SAMPLE). */
  pointSampleCount?: number;
}

// ---------------------------------------------------------------------------
// Synthetic editable-lane content builders (reused from the Phase 3a pattern).
// A synthetic content lets the dataset lane reuse plot-spec.ts VERBATIM, so the
// figure's numbers come from the SAME validated path as an editable figure.
// ---------------------------------------------------------------------------

function synthColumnId(i: number): string {
  return `dpcol-${i}`;
}

function synthMeta(
  name: string,
  tableType: DataHubDocument["table_type"],
): DataHubDocument {
  return {
    id: "__dataset_plot_synthetic__",
    name,
    project_ids: [],
    folder_path: null,
    table_type: tableType,
    created_at: "",
  };
}

/**
 * Wrap per-group finite arrays into a synthetic Column-table content, each array
 * one role-"y" group column, values placed positionally down the rows. Reading a
 * column back via columnValues yields its full finite array (each group
 * independent), the same UNALIGNED semantics the editable column figure reads, so
 * resolvePlotGroups -> computeAllGroupStats computes the figure's numbers the same
 * way it would for an editable Column table.
 */
function columnContent(
  name: string,
  groups: { name: string; values: number[] }[],
): DataHubDocContent {
  const columns: ColumnDef[] = groups.map((g, i) => ({
    id: synthColumnId(i),
    name: g.name,
    role: "y",
    dataType: "number",
  }));
  const maxLen = groups.reduce((m, g) => Math.max(m, g.values.length), 0);
  const rows: RowRecord[] = [];
  for (let r = 0; r < maxLen; r++) {
    const cells: Record<string, CellValue> = {};
    for (let i = 0; i < groups.length; i++) {
      const v = groups[i].values[r];
      cells[synthColumnId(i)] = v === undefined ? null : v;
    }
    rows.push({ id: `dprow-${r}`, cells });
  }
  return {
    meta: synthMeta(name, "column"),
    columns,
    rows,
    analyses: [],
    plots: [],
  };
}

// ---------------------------------------------------------------------------
// Scatter sampling (the ONLY place raw points are sampled, never the numbers)
// ---------------------------------------------------------------------------

/**
 * Uniformly sample at most `cap` items from `values`, preserving relative order.
 * Returns the whole array (a copy) when it already fits. A deterministic stride is
 * used (not Math.random) so a redraw of the same column draws the same dots and a
 * test can assert coverage; the sampled DOTS are cosmetic, the figure's NUMBERS
 * are always computed on the FULL column upstream.
 */
export function sampleColumnPoints(values: number[], cap: number): number[] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (cap <= 0) return [];
  if (finite.length <= cap) return finite.slice();
  const out: number[] = [];
  const stride = finite.length / cap;
  for (let i = 0; i < cap; i++) {
    out.push(finite[Math.floor(i * stride)]);
  }
  return out;
}

/**
 * Sample raw points STRATIFIED across groups so every group keeps a proportional
 * share of the dot budget (a small group is never sampled away to nothing). Each
 * group's stats stay computed on its FULL values upstream; this only thins the
 * drawn dots. Returns the per-group sampled arrays plus the total finite count.
 */
export function sampleGroupedPoints(
  groups: { values: number[] }[],
  cap: number,
): { sampled: number[][]; total: number } {
  const finiteCounts = groups.map(
    (g) => g.values.filter((v) => Number.isFinite(v)).length,
  );
  const total = finiteCounts.reduce((a, b) => a + b, 0);
  if (total <= cap) {
    return { sampled: groups.map((g) => g.values.filter((v) => Number.isFinite(v))), total };
  }
  // Proportional budget per group, with at least one dot for any non-empty group.
  const sampled = groups.map((g, i) => {
    const share = finiteCounts[i] === 0 ? 0 : Math.max(1, Math.round((finiteCounts[i] / total) * cap));
    return sampleColumnPoints(g.values, share);
  });
  return { sampled, total };
}

// ---------------------------------------------------------------------------
// The PlotGroup[] builder layoutPlot consumes (column kinds)
// ---------------------------------------------------------------------------

/**
 * Build the PlotGroup[] for a COLUMN figure (columnScatter / columnBar) from a
 * dataset. The stats of each group are computed on the FULL column via the
 * validated engine (a synthetic Column content -> resolvePlotGroups ->
 * computeAllGroupStats -> engineDescribe), so the bar height / mean line / error
 * bar is byte-identical to an editable figure. For a SCATTER the drawn `values`
 * are a SAMPLE of the full column (the dots cannot exceed the budget); the bar
 * draws no dots so it keeps the full (unused) values out.
 *
 * Returns the groups plus, for a scatter, the sampleInfo the UI surfaces.
 */
export async function buildDatasetPlotGroups(
  handle: OpenDatasetHandle,
  spec: PlotSpec,
  sidecar: DatasetSidecar,
  opts: DatasetPlotOptions = {},
): Promise<{ groups: PlotGroup[]; sampleInfo?: DatasetPlotSampleInfo }> {
  const style = readPlotStyle(spec);
  const recipe = sidecar.recipe;
  const isScatter = style.kind === "columnScatter";
  const cap = opts.pointSampleCount ?? DEFAULT_POINT_SAMPLE;

  // Resolve the raw per-group finite arrays from DuckDB (DuckDB MOVES DATA).
  let raw: { name: string; values: number[] }[];
  if (opts.groupByColumn) {
    const valueColumn = opts.valueColumn ?? "";
    if (!valueColumn) return { groups: [] };
    const grouped = await readColumnByGroup(
      handle,
      valueColumn,
      opts.groupByColumn,
      recipe,
    );
    raw = grouped.map((g) => ({ name: g.label, values: g.values }));
  } else {
    const valueColumn = opts.valueColumn ?? "";
    if (!valueColumn) return { groups: [] };
    const values = await readColumn(handle, valueColumn, recipe);
    raw = [{ name: valueColumn, values }];
  }
  if (raw.length === 0) return { groups: [] };

  // The figure's NUMBERS: build the synthetic Column content from the FULL arrays
  // and resolve through the validated engine path. resolvePlotGroups colors the
  // groups and fills each group's engine-backed stats + (for a scatter) its full
  // values. We keep the engine stats and, for a scatter, swap the drawn values for
  // a stratified sample so the dots stay within budget.
  const content = columnContent(sidecar.name, raw);
  const resolved = resolvePlotGroups(content, style);

  if (!isScatter) {
    // A bar draws no dots; drop the (unused) per-point values to keep the figure
    // light, and keep the engine stats verbatim.
    const groups = resolved.map((g) => ({ ...g, values: [] }));
    return { groups };
  }

  // A scatter samples the dots. Stats already come from the FULL column (engine);
  // only `values` is thinned.
  const { sampled, total } = sampleGroupedPoints(
    raw.map((r) => ({ values: r.values })),
    cap,
  );
  const groups = resolved.map((g, i) => ({ ...g, values: sampled[i] ?? [] }));
  const rendered = sampled.reduce((a, s) => a + s.length, 0);
  const sampleInfo: DatasetPlotSampleInfo | undefined =
    rendered < total ? { rendered, total } : undefined;
  return { groups, sampleInfo };
}

// ---------------------------------------------------------------------------
// The full figure renderer (dispatches every supported kind to an SVG string)
// ---------------------------------------------------------------------------

/**
 * Build a synthetic GROUPED-table content for a groupedBar figure: a row-factor
 * label column (role "x", text) plus one role-"y" replicate column per series,
 * each carrying its series datasetId so groupDatasets / cellMean read the clusters
 * exactly as an editable Grouped table would. The means / error bars are then
 * computed by layoutGroupedBar -> cellMean, the SAME path the editable grouped bar
 * uses, so the figure's numbers match the editable lane.
 *
 * The input is the row-aligned (value, rowFactor, series) triples pulled from
 * DuckDB; the editable lane's cellMean aggregates over all replicate rows of a
 * (rowLevel, series) cell, so each triple becomes one row with the value in its
 * series column and nulls elsewhere. This is exact (no sampling): a grouped bar
 * draws only summary bars, never per-point dots.
 */
function groupedContent(
  name: string,
  triples: { value: number; rowFactor: string; series: string }[],
): DataHubDocContent {
  const ROW_LABEL_ID = "ros-rowlabel";
  // Series in first-seen order, each a distinct datasetId.
  const seriesOrder: string[] = [];
  const seriesId = new Map<string, string>();
  for (const t of triples) {
    if (!seriesId.has(t.series)) {
      const id = `dpseries-${seriesOrder.length}`;
      seriesId.set(t.series, id);
      seriesOrder.push(t.series);
    }
  }
  const columns: ColumnDef[] = [
    { id: ROW_LABEL_ID, name: "Group", role: "x", dataType: "text" },
    ...seriesOrder.map((s) => ({
      id: seriesId.get(s)!,
      name: s,
      role: "y" as const,
      dataType: "number" as const,
      datasetId: seriesId.get(s)!,
    })),
  ];
  const rows: RowRecord[] = triples.map((t, r) => {
    const cells: Record<string, CellValue> = { [ROW_LABEL_ID]: t.rowFactor };
    for (const s of seriesOrder) {
      cells[seriesId.get(s)!] = s === t.series ? t.value : null;
    }
    return { id: `dprow-${r}`, cells };
  });
  return {
    meta: synthMeta(name, "grouped"),
    columns,
    rows,
    analyses: [],
    plots: [],
  };
}

/**
 * Build a synthetic XY-table content for an xyScatter from a SAMPLE of (x, y)
 * pairs. The dataset xyScatter samples its dots (a 247k point cloud cannot be
 * drawn) and forces the fitted curve OFF, so no published statistic rides on the
 * sample (a fit-on-full overlay is deferred). One role-"x" column and one role-"y"
 * column reproduce the editable XY shape xyPairs reads.
 */
function xyContent(
  name: string,
  xName: string,
  yName: string,
  pairs: { x: number; y: number }[],
): DataHubDocContent {
  const X_ID = "dpx";
  const Y_ID = "dpy";
  const columns: ColumnDef[] = [
    { id: X_ID, name: xName, role: "x", dataType: "number" },
    { id: Y_ID, name: yName, role: "y", dataType: "number" },
  ];
  const rows: RowRecord[] = pairs.map((p, r) => ({
    id: `dprow-${r}`,
    cells: { [X_ID]: p.x, [Y_ID]: p.y },
  }));
  return {
    meta: synthMeta(name, "xy"),
    columns,
    rows,
    analyses: [],
    plots: [],
  };
}

/**
 * Render a dataset figure to a standalone SVG string, dispatching by kind. This is
 * the one-call path the dialog drives for the live preview and the saved figure.
 *
 * columnScatter / columnBar go through buildDatasetPlotGroups (engine numbers,
 * sampled dots) then layoutPlot + renderPlotSvg. groupedBar builds a synthetic
 * Grouped content and renders through layoutGroupedBar (cellMean numbers, exact).
 * xyScatter samples (x, y) pairs, forces the fit off, and renders through
 * layoutXYPlot. Every numbers-bearing path is the SAME plot-spec.ts function the
 * editable lane calls, so the figure is byte-identical on the same data.
 */
export async function renderDatasetPlot(
  handle: OpenDatasetHandle,
  spec: PlotSpec,
  sidecar: DatasetSidecar,
  opts: DatasetPlotOptions = {},
): Promise<DatasetPlotResult> {
  const style = readPlotStyle(spec);
  const recipe = sidecar.recipe;
  const cap = opts.pointSampleCount ?? DEFAULT_POINT_SAMPLE;

  if (style.kind === "columnScatter" || style.kind === "columnBar") {
    const { groups, sampleInfo } = await buildDatasetPlotGroups(
      handle,
      spec,
      sidecar,
      opts,
    );
    const requests = style.showBrackets
      ? bracketRequestsFromAnalysis(null, groups)
      : [];
    const geometry = layoutPlot(groups, style, requests);
    return { svg: renderPlotSvg(geometry, style), sampleInfo };
  }

  if (style.kind === "groupedBar") {
    const valueColumn = opts.valueColumn ?? "";
    const rowFactorColumn = opts.rowFactorColumn ?? "";
    const seriesColumn = opts.seriesColumn ?? "";
    if (!valueColumn || !rowFactorColumn || !seriesColumn) {
      // No silent empty figure: render the empty frame the editable lane draws.
      const content = groupedContent(sidecar.name, []);
      const geometry = layoutGroupedBar(content, style);
      return { svg: renderGroupedBarSvg(geometry, style) };
    }
    // Pull (value, rowFactor, series) aligned by row. DuckDB MOVES DATA; the
    // bucketing is plain JS, no SQL aggregate. We read the value numerically and
    // the two factor columns as raw labels via a value+group read per factor would
    // lose alignment, so read all three aligned and coerce here.
    const triples = await readTripleAligned(
      handle,
      valueColumn,
      rowFactorColumn,
      seriesColumn,
      recipe,
    );
    const content = groupedContent(sidecar.name, triples);
    const geometry = layoutGroupedBar(content, style);
    return { svg: renderGroupedBarSvg(geometry, style) };
  }

  if (style.kind === "xyScatter") {
    const xName = opts.xColumn ?? "";
    const yName = opts.valueColumn ?? "";
    if (!xName || !yName) {
      const content = xyContent(sidecar.name, xName, yName, []);
      const geometry = layoutXYPlot(content, style, null);
      return { svg: renderXYPlotSvg(geometry, style) };
    }
    // Pull the (x, y) pairs aligned by row, then sample the dots. The fit is forced
    // off (style.fitModel "none") so no published statistic rides on the sample.
    const aligned = await readColumnAligned(handle, [xName, yName], recipe);
    const total = aligned.length;
    const sampledRows = sampleRows(aligned, cap);
    const pairs = sampledRows.map((r) => ({ x: r[0], y: r[1] }));
    const content = xyContent(sidecar.name, xName, yName, pairs);
    const noFitStyle: PlotStyle = { ...style, fitModel: "none" };
    const geometry = layoutXYPlot(content, noFitStyle, null);
    const svg = renderXYPlotSvg(geometry, noFitStyle);
    const sampleInfo =
      pairs.length < total ? { rendered: pairs.length, total } : undefined;
    return { svg, sampleInfo };
  }

  // An unsupported kind should never reach here (the dialog only offers the
  // DATASET_PLOT_KINDS), but fail loud rather than draw a blank.
  throw new Error(`[dataset-plots] unsupported plot kind: ${style.kind}`);
}

/**
 * Uniformly sample at most `cap` rows from a row-aligned matrix, preserving order
 * (the XY scatter dot sample). Deterministic stride, mirroring sampleColumnPoints.
 */
export function sampleRows(rows: number[][], cap: number): number[][] {
  if (cap <= 0) return [];
  if (rows.length <= cap) return rows.slice();
  const out: number[][] = [];
  const stride = rows.length / cap;
  for (let i = 0; i < cap; i++) out.push(rows[Math.floor(i * stride)]);
  return out;
}

/**
 * Read a numeric VALUE column and TWO categorical factor columns aligned by row
 * into (value, rowFactor, series) triples. A row is dropped when the value is
 * null / non-numeric or either factor label is null / empty, so a partial row
 * never forms a phantom cluster. This only PROJECTS the three columns; the
 * cluster means are computed downstream by the validated cellMean path.
 */
async function readTripleAligned(
  handle: OpenDatasetHandle,
  valueColumn: string,
  rowFactorColumn: string,
  seriesColumn: string,
  recipe?: import("@/lib/datahub/transform/pipeline").TransformOp[],
): Promise<{ value: number; rowFactor: string; series: string }[]> {
  // readColumnByGroup pulls (value, group); we need (value, rowFactor, series), so
  // read each factor paired with the value and re-join by row index. Both reads run
  // the SAME projection over the SAME source ordering, so row index aligns.
  const byRowFactor = await readColumnByGroupRaw(
    handle,
    valueColumn,
    rowFactorColumn,
    recipe,
  );
  const bySeries = await readColumnByGroupRaw(
    handle,
    valueColumn,
    seriesColumn,
    recipe,
  );
  const out: { value: number; rowFactor: string; series: string }[] = [];
  const n = Math.min(byRowFactor.length, bySeries.length);
  for (let i = 0; i < n; i++) {
    const a = byRowFactor[i];
    const b = bySeries[i];
    // Both rows describe the same source row (same value, paged in the same order),
    // so the series label from the second read pairs with the row-factor label from
    // the first. Drop a row missing either label.
    if (a.value === null || a.label === "" || b.label === "") continue;
    out.push({ value: a.value, rowFactor: a.label, series: b.label });
  }
  return out;
}

/**
 * A per-ROW (not bucketed) read of a value column paired with a label column: one
 * entry per source row, in source order, with the finite value or null and the
 * trimmed label or "". Unlike readColumnByGroup this does NOT bucket, so two such
 * reads over different label columns re-join by row index. Only PROJECTS the two
 * columns; no statistic.
 */
async function readColumnByGroupRaw(
  handle: OpenDatasetHandle,
  valueColumn: string,
  labelColumn: string,
  recipe?: import("@/lib/datahub/transform/pipeline").TransformOp[],
): Promise<{ value: number | null; label: string }[]> {
  // Reuse readColumnByGroup's projection by reading the two columns aligned and
  // coercing here, so the SQL stays identical to the rest of the lane.
  const { query } = await import("./duckdb-client");
  const { fromSource, quoteIdent } = await import("./dataset-view");
  const sql = `SELECT ${quoteIdent(valueColumn)} AS v, ${quoteIdent(
    labelColumn,
  )} AS g FROM ${fromSource(handle, recipe)}`;
  const table = await query(sql);
  const out: { value: number | null; label: string }[] = [];
  for (const row of table.toArray()) {
    const r = row as { v: unknown; g: unknown };
    let value: number | null = null;
    if (typeof r.v === "number") value = Number.isFinite(r.v) ? r.v : null;
    else if (typeof r.v === "bigint") {
      const num = Number(r.v);
      value = Number.isFinite(num) ? num : null;
    } else if (typeof r.v === "string") {
      const t = r.v.trim();
      const num = t === "" ? NaN : Number(t);
      value = Number.isFinite(num) ? num : null;
    }
    const label =
      r.g === null || r.g === undefined
        ? ""
        : String(typeof r.g === "bigint" ? r.g.toString() : r.g).trim();
    out.push({ value, label });
  }
  return out;
}

/**
 * Validate a column-stats parity helper for the test suite: pull a column from the
 * dataset and run it through the SAME computeGroupStats the editable lane uses,
 * returning the GroupStats. This exists so the parity test can assert the dataset
 * figure's number equals an editable computeGroupStats on the same array WITHOUT
 * re-deriving the synthetic-content plumbing in the test. Pure-ish (reads DuckDB).
 */
export async function datasetColumnStats(
  handle: OpenDatasetHandle,
  columnName: string,
  sidecar: DatasetSidecar,
) {
  const values = await readColumn(handle, columnName, sidecar.recipe);
  const content = columnContent(sidecar.name, [{ name: columnName, values }]);
  return computeGroupStats(content, synthColumnId(0));
}

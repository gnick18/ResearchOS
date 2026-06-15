"use client";

// datahub/bigtable/dataset-columns.ts
//
// Column EXTRACTION for the Data Hub large-dataset lane (DataHub-largetables
// lane, Phase 3a analyses). This is the ONLY job DuckDB does for an analysis on a
// dataset: pull the named columns out of the on-disk Parquet (optionally through
// the stored transform recipe) into plain JavaScript number arrays. DuckDB MOVES
// DATA. It never computes a published statistic. Every statistic is computed by
// the validated JS engine downstream (see ./dataset-analyses.ts), the SAME engine
// the editable lane uses, pinned against scipy / R / Prism in engine/__tests__.
//
// These readers mirror column-table.ts (the editable lane) EXACTLY:
//   - readColumn      <-> columnValues:    finite numbers in one column, nulls /
//                                          non-numeric skipped.
//   - readColumnAligned <-> rowAlignedValues: listwise / complete-case across
//                                          several columns, dropping any row that
//                                          is null or non-numeric in ANY of them.
//
// The SQL is built from fromSource(handle, recipe) so a derived dataset's recipe
// runs on demand against the source Parquet, exactly like the preview grid. Column
// identifiers are quoted with the same quoteIdent the rest of the lane uses, so a
// header with spaces or punctuation is safe; values never flow through here.
//
// Client-only: it loads the DuckDB worker, so it must never run on the server.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { query } from "./duckdb-client";
import {
  fromSource,
  quoteIdent,
  type OpenDatasetHandle,
} from "./dataset-view";
import type { TransformOp } from "@/lib/datahub/transform/pipeline";

/**
 * Coerce one raw Arrow cell to a finite number, or null when it is not a finite
 * number. Mirrors the editable lane's columnValues coercion EXACTLY: a real
 * number is kept when finite; a numeric string is parsed; anything else (null,
 * empty, non-numeric text, NaN, Infinity) is dropped. BigInt (DuckDB returns
 * 64-bit integer columns as JS BigInt) is converted before the finite check.
 */
function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Read ONE column into the finite numbers it holds, dropping every null and
 * non-numeric cell. The DuckDB equivalent of column-table.ts columnValues: the
 * engine only ever sees real, finite measurements. The recipe (when present) runs
 * on demand against the source Parquet, so a derived dataset reads its transformed
 * column without materializing a copy.
 *
 * SCOPE (validation gate). This query only PROJECTS one column and pages every
 * row out. No aggregate, no statistic. The numbers are handed to the validated JS
 * engine by the caller.
 */
export async function readColumn(
  handle: OpenDatasetHandle,
  columnName: string,
  recipe?: TransformOp[],
): Promise<number[]> {
  const sql = `SELECT ${quoteIdent(columnName)} AS v FROM ${fromSource(
    handle,
    recipe,
  )}`;
  const table = await query(sql);
  const out: number[] = [];
  for (const row of table.toArray()) {
    const n = toFiniteNumber((row as { v: unknown }).v);
    if (n !== null) out.push(n);
  }
  return out;
}

/**
 * Read SEVERAL columns ALIGNED BY ROW, dropping any row that is null or
 * non-numeric in ANY of the requested columns (listwise / complete cases). The
 * DuckDB equivalent of column-table.ts rowAlignedValues: each returned inner array
 * is one surviving row's values across `columnNames` in the given order, so the
 * row pairing a paired / repeated-measures / regression design needs is preserved.
 *
 * The complete-case filter is done in JS (not SQL) so the coercion rule is
 * byte-identical to the editable lane (a numeric STRING counts, a non-numeric
 * string drops the row). SQL is row order preserving here; the engine functions
 * that read these arrays are order independent within a row group, and the paired
 * tests pair by array index across the returned rows exactly as the editable lane
 * pairs by table-row order.
 *
 * SCOPE (validation gate). This query only PROJECTS the chosen columns. No
 * statistic is computed in SQL.
 */
export async function readColumnAligned(
  handle: OpenDatasetHandle,
  columnNames: string[],
  recipe?: TransformOp[],
): Promise<number[][]> {
  if (columnNames.length === 0) return [];
  const projection = columnNames
    .map((name, i) => `${quoteIdent(name)} AS c${i}`)
    .join(", ");
  const sql = `SELECT ${projection} FROM ${fromSource(handle, recipe)}`;
  const table = await query(sql);
  const out: number[][] = [];
  for (const row of table.toArray()) {
    const r = row as Record<string, unknown>;
    const cells: number[] = [];
    let complete = true;
    for (let i = 0; i < columnNames.length; i++) {
      const n = toFiniteNumber(r[`c${i}`]);
      if (n === null) {
        complete = false;
        break;
      }
      cells.push(n);
    }
    if (complete) out.push(cells);
  }
  return out;
}

/**
 * Read the DISTINCT non-empty labels of a (usually categorical) column, in
 * FIRST-SEEN order, capped. This drives the group-pair picker on the dataset
 * analysis dialog: when a two-group test (unpaired t, Mann-Whitney) runs on a
 * grouping column with three or more levels, the user must choose WHICH two
 * levels to compare instead of the runner silently taking the first two. The cap
 * keeps a high-cardinality column from flooding the dropdown (the picker is for a
 * handful of levels, not an id column). Labels are stringified the same way
 * readColumnByGroup stringifies a group label, so the chosen pair matches the
 * partition labels exactly.
 *
 * SCOPE (validation gate). This query only PROJECTS the column and pages it; the
 * distinct + first-seen bucketing is plain JS, no SQL aggregate, no statistic.
 */
export async function readDistinctLabels(
  handle: OpenDatasetHandle,
  columnName: string,
  recipe?: TransformOp[],
  cap = 200,
): Promise<string[]> {
  const sql = `SELECT ${quoteIdent(columnName)} AS g FROM ${fromSource(
    handle,
    recipe,
  )}`;
  const table = await query(sql);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const row of table.toArray()) {
    const g = (row as { g: unknown }).g;
    if (g === null || g === undefined) continue;
    const label = String(typeof g === "bigint" ? g.toString() : g).trim();
    if (label === "" || seen.has(label)) continue;
    seen.add(label);
    order.push(label);
    if (order.length >= cap) break;
  }
  return order;
}

/**
 * Stringify a raw Arrow cell to a group / category LABEL the same way
 * readColumnByGroup does (BigInt to its base-10 string, everything else String(),
 * trimmed). Empty / null become "" so the caller can drop the row.
 */
function labelStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(typeof v === "bigint" ? v.toString() : v).trim();
}

/** One row of a value column plus two category labels (two-way ANOVA / nested). */
export interface ValueTwoLabelRow {
  value: number;
  labelA: string;
  labelB: string;
}

/**
 * Read a numeric VALUE column plus TWO categorical label columns, aligned by row,
 * dropping a row whose value is non-finite or EITHER label is empty. Drives the
 * dataset-lane two-way ANOVA (value + row factor + column factor) and the nested
 * tests (value + group + subgroup). Coercion mirrors the other readers exactly
 * (toFiniteNumber for the value, labelStr for the labels). Row order is preserved.
 *
 * SCOPE (validation gate). This query only PROJECTS the three columns. The
 * bucketing into the synthetic grouped / nested table happens in JS downstream; no
 * SQL aggregate, no statistic.
 */
export async function readValueAndTwoLabels(
  handle: OpenDatasetHandle,
  valueColumn: string,
  labelAColumn: string,
  labelBColumn: string,
  recipe?: TransformOp[],
): Promise<ValueTwoLabelRow[]> {
  const sql = `SELECT ${quoteIdent(valueColumn)} AS dv, ${quoteIdent(
    labelAColumn,
  )} AS la, ${quoteIdent(labelBColumn)} AS lb FROM ${fromSource(handle, recipe)}`;
  const table = await query(sql);
  const out: ValueTwoLabelRow[] = [];
  for (const row of table.toArray()) {
    const r = row as { dv: unknown; la: unknown; lb: unknown };
    const n = toFiniteNumber(r.dv);
    if (n === null) continue;
    const la = labelStr(r.la);
    const lb = labelStr(r.lb);
    if (la === "" || lb === "") continue;
    out.push({ value: n, labelA: la, labelB: lb });
  }
  return out;
}

/** A cross-tabulated count grid, the shape contingencyMatrix consumes. */
export interface ContingencyCounts {
  rowLabels: string[];
  colLabels: string[];
  matrix: number[][];
}

/**
 * Read TWO categorical columns and cross-tabulate them into an R x C count grid
 * (row factor by column factor), in FIRST-SEEN order on both axes. A row with
 * either label empty is dropped. Drives the dataset-lane contingency / chi-square
 * + Fisher analysis.
 *
 * SCOPE (validation gate). This query only PROJECTS the two columns; the counting
 * is plain JS bucketing, NOT a SQL GROUP BY aggregate, so no statistic is computed
 * off the validated path. The counts go to the validated engine via a synthetic
 * contingency table.
 */
export async function readContingencyCounts(
  handle: OpenDatasetHandle,
  rowFactorColumn: string,
  colFactorColumn: string,
  recipe?: TransformOp[],
): Promise<ContingencyCounts> {
  const sql = `SELECT ${quoteIdent(rowFactorColumn)} AS la, ${quoteIdent(
    colFactorColumn,
  )} AS lb FROM ${fromSource(handle, recipe)}`;
  const table = await query(sql);
  const rowLabels: string[] = [];
  const colLabels: string[] = [];
  const cells = new Map<string, Map<string, number>>();
  for (const row of table.toArray()) {
    const r = row as { la: unknown; lb: unknown };
    const la = labelStr(r.la);
    const lb = labelStr(r.lb);
    if (la === "" || lb === "") continue;
    if (!cells.has(la)) {
      cells.set(la, new Map());
      rowLabels.push(la);
    }
    if (!colLabels.includes(lb)) colLabels.push(lb);
    const m = cells.get(la)!;
    m.set(lb, (m.get(lb) ?? 0) + 1);
  }
  const matrix = rowLabels.map((rl) =>
    colLabels.map((cl) => cells.get(rl)!.get(cl) ?? 0),
  );
  return { rowLabels, colLabels, matrix };
}

/** One subject for a survival analysis (time, 0/1 event, group label). */
export interface SurvivalRow {
  time: number;
  event: 0 | 1;
  group: string;
}

/**
 * Read survival rows: a finite TIME column, an EVENT column coerced to exactly 0
 * (censored) or 1 (event), and an optional GROUP column. A row is kept only when
 * time is finite and event is 0 or 1 (mirroring survival-table.ts survivalGroups);
 * an absent or empty group folds to "All subjects", exactly as the editable lane.
 *
 * SCOPE (validation gate). This query only PROJECTS the columns; partitioning into
 * arms + every survival statistic happen on the validated engine downstream.
 */
export async function readSurvivalRows(
  handle: OpenDatasetHandle,
  timeColumn: string,
  eventColumn: string,
  groupColumn: string | null,
  recipe?: TransformOp[],
): Promise<SurvivalRow[]> {
  const groupSel = groupColumn ? `, ${quoteIdent(groupColumn)} AS sg` : "";
  const sql = `SELECT ${quoteIdent(timeColumn)} AS st, ${quoteIdent(
    eventColumn,
  )} AS se${groupSel} FROM ${fromSource(handle, recipe)}`;
  const table = await query(sql);
  const out: SurvivalRow[] = [];
  for (const row of table.toArray()) {
    const r = row as { st: unknown; se: unknown; sg?: unknown };
    const t = toFiniteNumber(r.st);
    if (t === null) continue;
    const ev = toFiniteNumber(r.se);
    if (ev !== 0 && ev !== 1) continue;
    const group = groupColumn ? labelStr(r.sg) || "All subjects" : "All subjects";
    out.push({ time: t, event: ev as 0 | 1, group });
  }
  return out;
}

/** One partition of a value column, keyed by a grouping column's category. */
export interface GroupedColumnValues {
  /** The grouping-column category label (stringified), in first-seen order. */
  label: string;
  /** The finite values of the value column for the rows in this category. */
  values: number[];
}

/**
 * Read a numeric VALUE column partitioned by a categorical GROUP-BY column. This
 * supports a group comparison (unpaired t, one-way ANOVA, Kruskal-Wallis) over a
 * long / tidy dataset where one column holds the measurement and another holds the
 * group label, the common shape for a large imported table. Both columns are
 * pulled aligned by row; a row is dropped when the value is null / non-numeric OR
 * the group label is null / empty (so a missing group never forms a phantom
 * partition). Partitions are returned in FIRST-SEEN order so the group ordering is
 * stable and reproducible across runs.
 *
 * SCOPE (validation gate). This query only PROJECTS the two columns. The
 * partitioning is plain JS bucketing, NOT a SQL GROUP BY aggregate, so no
 * statistic is computed in the engine-bypassing path. Each partition's numbers go
 * to the validated JS engine.
 */
export async function readColumnByGroup(
  handle: OpenDatasetHandle,
  valueColumn: string,
  groupColumn: string,
  recipe?: TransformOp[],
): Promise<GroupedColumnValues[]> {
  const sql = `SELECT ${quoteIdent(valueColumn)} AS v, ${quoteIdent(
    groupColumn,
  )} AS g FROM ${fromSource(handle, recipe)}`;
  const table = await query(sql);
  const order: string[] = [];
  const buckets = new Map<string, number[]>();
  for (const row of table.toArray()) {
    const r = row as { v: unknown; g: unknown };
    const n = toFiniteNumber(r.v);
    if (n === null) continue;
    if (r.g === null || r.g === undefined) continue;
    const label = String(typeof r.g === "bigint" ? r.g.toString() : r.g).trim();
    if (label === "") continue;
    let bucket = buckets.get(label);
    if (!bucket) {
      bucket = [];
      buckets.set(label, bucket);
      order.push(label);
    }
    bucket.push(n);
  }
  return order.map((label) => ({ label, values: buckets.get(label)! }));
}

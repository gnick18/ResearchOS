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

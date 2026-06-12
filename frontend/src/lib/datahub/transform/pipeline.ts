/**
 * datahub/transform/pipeline.ts
 *
 * Typed pipeline spec for the Data Hub transform engine. A pipeline is an
 * ordered list of TransformOp values that the engine executes sequentially.
 * The primary input table is threaded through each op; ops that reference
 * a second table (join, union) look it up from the sources map by id.
 *
 * DEFERRED to foundation 1b (DO NOT build here, but the union is left open):
 *   - derive: computed column via the Custom Calculator Builder expr-eval fork
 *     (engine resides at frontend/src/lib/calculators). Keep the "derive" kind
 *     in this comment as a reserved slot so foundation 1b can add it without
 *     touching the discriminant exhaustiveness checks already written.
 *   - pivot:   long -> wide (spread a key column's values into columns).
 *   - unpivot: wide -> long (gather columns into a key-value pair).
 *
 * House voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import type {
  TransformParams,
  NormalizeParams,
  TransposeParams,
  RemoveBaselineParams,
  FractionOfTotalParams,
} from "@/lib/datahub/transforms";

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

/** A single filter condition on one column. */
export interface FilterCondition {
  column: string;
  op:
    | "eq"        // equal (==)
    | "ne"        // not equal (!=)
    | "lt"        // strictly less than (<)
    | "le"        // less than or equal (<=)
    | "gt"        // strictly greater than (>)
    | "ge"        // greater than or equal (>=)
    | "contains"  // substring membership (case-sensitive)
    | "regex"     // ECMAScript regex match
    | "in"        // value is a member of a set
    | "is_empty"; // cell is null / empty string / NaN
  value?: string | number | (string | number)[];
}

/** A composable filter node: a leaf condition, a negation, or a conjunction. */
export type FilterNode =
  | { type: "condition"; condition: FilterCondition }
  | { type: "not"; child: FilterNode }
  | { type: "and"; children: FilterNode[] }
  | { type: "or"; children: FilterNode[] };

/** Aggregate function names for groupby. */
export type AggFunc =
  | "mean"
  | "sum"
  | "count"
  | "min"
  | "max"
  | "median"
  | "sd"         // sample standard deviation (ddof=1, matches pandas default)
  | "first"
  | "nunique"    // n-unique values
  | "concat";    // join string values with separator (default: ", ")

/** One column-level aggregation specification for groupby. */
export interface AggSpec {
  column: string;
  func: AggFunc;
  /** Separator for "concat" aggregation; defaults to ", ". */
  separator?: string;
  /** Output column name; defaults to "<column>_<func>". */
  outputName?: string;
}

/** Sort direction for one column. */
export interface SortKey {
  column: string;
  direction: "asc" | "desc";
  /** Null placement: "first" puts nulls at the start, "last" at the end.
   *  Defaults to "last" for asc and "first" for desc, matching pandas. */
  nulls?: "first" | "last";
}

// ---------------------------------------------------------------------------
// TransformOp discriminated union
// ---------------------------------------------------------------------------

/** Join two tables on shared key columns. Behavior mirrors pandas.merge. */
export interface JoinOp {
  kind: "join";
  /** Id of the right-hand source table in the sources map. */
  rightRef: string;
  /** Key column names to join on. Both tables must have these columns. */
  on: string[];
  /** Join strategy. Defaults to "inner". */
  how: "inner" | "left" | "right" | "outer";
  /**
   * Suffix appended to conflicting non-key column names from the left table.
   * Defaults to "_x" (matches pandas default).
   */
  suffixLeft?: string;
  /**
   * Suffix appended to conflicting non-key column names from the right table.
   * Defaults to "_y" (matches pandas default).
   */
  suffixRight?: string;
}

/** Keep rows that satisfy a filter expression. Behavior mirrors pandas query. */
export interface FilterOp {
  kind: "filter";
  node: FilterNode;
}

/**
 * Group by one or more columns and aggregate the rest.
 * Ungrouped, un-aggregated columns are dropped from the result, matching
 * pandas groupby behavior (no implicit passthrough).
 */
export interface GroupByOp {
  kind: "groupby";
  by: string[];
  aggregations: AggSpec[];
}

/** Keep only the named columns, in the given order. */
export interface SelectOp {
  kind: "select";
  columns: string[];
}

/** Remove the named columns. All other columns are kept. */
export interface DropOp {
  kind: "drop";
  columns: string[];
}

/** Rename columns. Only listed columns are renamed; others are unchanged. */
export interface RenameOp {
  kind: "rename";
  /** Map of {oldName: newName}. */
  mapping: Record<string, string>;
}

/** Sort rows by one or more columns. */
export interface SortOp {
  kind: "sort";
  by: SortKey[];
  /**
   * Whether to reset the row-id sequence after sorting.
   * Defaults to true (matches pandas reset_index behavior for the result).
   */
  resetIndex?: boolean;
}

/**
 * Drop duplicate rows. By default deduplicates on ALL columns ("all");
 * provide a subset of column names to deduplicate on those only (matching
 * pandas DataFrame.drop_duplicates(subset=...)).
 * "keep" mirrors pandas: "first" keeps the first occurrence (default),
 * "last" keeps the last occurrence.
 */
export interface DedupeOp {
  kind: "dedupe";
  /** Columns to consider for duplicate detection. Absent or empty means all. */
  subset?: string[];
  keep?: "first" | "last";
}

/**
 * Stack a second table on top of the current table (pandas concat / union).
 * Columns are aligned by NAME. Columns present in one table but not the other
 * are included with null values (matching pandas concat(axis=0) behavior).
 */
export interface UnionOp {
  kind: "union";
  /** Id of the second source table in the sources map. */
  otherRef: string;
  /**
   * Whether to reset row ids after stacking.
   * Defaults to true (matches pandas ignore_index=True).
   */
  resetIndex?: boolean;
}

/**
 * Compute a NEW column from a formula over existing columns and append it.
 *
 * The formula is written in the Custom Calculator Builder's expression language
 * (the expr-eval-fork parser at frontend/src/lib/calculators/custom.ts). It is
 * reused verbatim so ResearchOS ships ONE expression language, not two. Column
 * names are bound as variables, so a formula like "a + b" or "a * 2 - c" sees
 * the row's "a", "b", "c" cell values.
 *
 * Each row is evaluated independently. A row whose referenced cells are missing
 * or non-numeric (so the formula cannot produce a finite number) yields null in
 * the new column rather than crashing the pipeline. This mirrors how the rest of
 * the engine treats bad cells as null instead of throwing.
 */
export interface DeriveOp {
  kind: "derive";
  /** Name of the new column to append. */
  outputName: string;
  /** Formula in the calc builder's expression language, over column names. */
  formula: string;
}

/**
 * Reshape long -> wide (pandas pivot_table).
 *
 * index columns are kept as the row identity. The distinct values of the
 * `columns` key column each become a new output column, filled with the
 * `values` column's cell for the matching (index, key) pair.
 *
 * COLLISION POLICY (stated, not pandas pivot's "raise"):
 *   When more than one input row shares the same (index, key) pair, this engine
 *   AGGREGATES them with mean, matching pandas pivot_table default aggfunc.
 *   pandas DataFrame.pivot raises on duplicate pairs; pivot_table aggregates.
 *   We pick pivot_table's aggregate-by-mean so the op is total (never errors on
 *   real data) and so it composes after a groupby. Non-numeric value cells in a
 *   collided cell are ignored for the mean; an all-non-numeric collision yields
 *   null. A single (non-collided) value passes through unchanged (numeric or
 *   text), so text values survive when there is no duplication.
 *
 * COLUMN ORDER (deterministic): index columns in their given order, then the
 * distinct key values SORTED ascending (numbers numerically, otherwise as
 * strings), matching pandas pivot_table's sorted-columns default.
 */
export interface PivotOp {
  kind: "pivot";
  /** Columns kept as the row identity (the wide table's left-hand columns). */
  index: string[];
  /** The key column whose distinct values become new columns. */
  columns: string;
  /** The value column spread into the new columns. */
  values: string;
}

/**
 * Reshape wide -> long (pandas melt).
 *
 * idVars are kept on every output row. Each valueVars column is gathered into
 * two new columns: varName holds the source column's name, valueName holds its
 * cell. The result has one row per (input row, valueVar) pair.
 *
 * Row order matches pandas melt: for each value variable in order, emit every
 * input row in order (so the result is grouped by variable, then by input row).
 *
 * valueVars defaults to ALL columns not listed in idVars, in their table order
 * (pandas melt default). varName defaults to "variable", valueName to "value".
 */
export interface UnpivotOp {
  kind: "unpivot";
  /** Columns kept on every output row. */
  idVars: string[];
  /** Columns gathered into the key/value pair. Defaults to all non-id columns. */
  valueVars?: string[];
  /** Name of the column holding the gathered column names. Defaults to "variable". */
  varName?: string;
  /** Name of the column holding the gathered cell values. Defaults to "value". */
  valueName?: string;
}

// ---------------------------------------------------------------------------
// Column transforms folded into the pipeline (Prism "Data Processing")
// ---------------------------------------------------------------------------
//
// The five single-op column transforms (transform / normalize / transpose /
// remove-baseline / fraction-of-total) shipped first as standalone pure
// functions in datahub/transforms.ts and a single-op derived-table link. We fold
// them in as TransformOp variants here so the engine has ONE verb set covering
// both the relational verbs above and the column transforms. The engine
// DELEGATES each of these to the existing pure function in transforms.ts (it does
// NOT reimplement the math), so the folded op and the direct transforms.ts call
// produce identical results.
//
// Each op carries the matching transforms.ts param shape verbatim, reused so the
// stored recipe and the standalone function share one params contract.

/** Apply a per-cell function (log / sqrt / square / reciprocal / linear) to every
 *  data value. Delegates to transformValues in transforms.ts. */
export interface ColumnTransformOp {
  kind: "column-transform";
  params: TransformParams;
}

/** Rescale each column to a percent of a baseline (max / sum / first / minMax).
 *  Delegates to normalize in transforms.ts. */
export interface NormalizeColumnOp {
  kind: "normalize";
  params: NormalizeParams;
}

/** Swap rows and columns. Delegates to transpose in transforms.ts. */
export interface TransposeColumnOp {
  kind: "transpose";
  params: TransposeParams;
}

/** Subtract a baseline (a column / each column's first row / a constant) from
 *  every data value. Delegates to removeBaseline in transforms.ts. */
export interface RemoveBaselineColumnOp {
  kind: "remove-baseline";
  params: RemoveBaselineParams;
}

/** Express each value as a fraction or percent of a column / row / grand total.
 *  Delegates to fractionOfTotal in transforms.ts. */
export interface FractionOfTotalColumnOp {
  kind: "fraction-of-total";
  params: FractionOfTotalParams;
}

/**
 * The full set of supported transform operations.
 */
export type TransformOp =
  | JoinOp
  | FilterOp
  | GroupByOp
  | SelectOp
  | DropOp
  | RenameOp
  | SortOp
  | DedupeOp
  | UnionOp
  | DeriveOp
  | PivotOp
  | UnpivotOp
  | ColumnTransformOp
  | NormalizeColumnOp
  | TransposeColumnOp
  | RemoveBaselineColumnOp
  | FractionOfTotalColumnOp;

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * An ordered list of transform operations that the engine applies sequentially
 * to a primary DataHubDocContent table. Source tables referenced by join/union
 * ops are looked up from the sources map by id.
 *
 * The pipeline is intended to be stored on the result table as a recipe (Phase
 * 2 of the data-transform build), making the derivation inspectable, re-runnable,
 * and version-controlled.
 */
export interface TransformPipeline {
  ops: TransformOp[];
}

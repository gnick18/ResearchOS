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
 * The full set of supported transform operations.
 *
 * RESERVED (foundation 1b, NOT implemented here):
 *   | { kind: "derive"; ... }     computed column via expr-eval
 *   | { kind: "pivot"; ... }      long -> wide
 *   | { kind: "unpivot"; ... }    wide -> long
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
  | UnionOp;

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

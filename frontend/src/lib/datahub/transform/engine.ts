/**
 * datahub/transform/engine.ts
 *
 * The deterministic, pure transform engine for Data Hub. Executes a
 * TransformPipeline over DataHubDocContent and returns a new DataHubDocContent
 * (never mutates sources).
 *
 * ORDERING AND TYPE-COERCION RULES (documented to match pandas):
 *
 *   Ordering:
 *     - sort() is the only op that explicitly reorders rows. All other ops
 *       (filter, groupby, join, union, dedupe) preserve the current row order
 *       of the left/primary table, then append right-table rows (join outer,
 *       union) in the order they appear in the right table. This matches
 *       pandas default behavior (merge preserves left order; concat preserves
 *       input order).
 *     - sort() uses a stable sort (Array.prototype.sort is stable in V8 >=70
 *       and in the spec since ES2019). Equal keys preserve prior order.
 *     - Null placement in sort: asc defaults to nulls-last; desc defaults to
 *       nulls-first. This matches pandas sort_values(na_position=...) defaults.
 *
 *   Type coercion on join keys:
 *     - If one table has a numeric value and the other has a string
 *       representation of the same number (e.g. 1 vs "1"), the engine coerces
 *       BOTH to string for key comparison, matching pandas merge behavior with
 *       mixed-dtype keys. This is documented in the join implementation.
 *     - null and "" are treated as distinct from any non-null value. Two nulls
 *       match each other (pandas inner join drops null-key rows; this engine
 *       ALSO drops null-key rows for inner/left/right joins and only emits them
 *       as unmatched rows in outer joins, matching pandas merge(how="outer")).
 *
 *   Groupby aggregation types:
 *     - sd uses sample standard deviation (ddof=1), matching pandas default.
 *     - mean / median of an empty group returns null (pandas returns NaN,
 *       which the engine normalizes to null for storage).
 *     - count counts non-null values (matching pandas GroupBy.count).
 *     - nunique counts distinct non-null values.
 *     - concat joins string representations with ", " (default separator).
 *     - first returns the first non-null value, or null if all are null.
 *
 *   Union column alignment:
 *     - Columns are aligned by name. Columns present in only one table get
 *       null values in the other table's rows. Column order in the result is:
 *       (1) all columns from the primary table in their declared order, then
 *       (2) any additional columns from the second table not already present,
 *       in their declared order. This matches pandas concat(axis=0) behavior.
 *
 * House voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import type { DataHubDocContent, ColumnDef, RowRecord, CellValue } from "@/lib/datahub/model/types";
import { evaluateExpression } from "@/lib/calculators/custom";
import {
  transformValues,
  normalize,
  transpose,
  removeBaseline,
  fractionOfTotal,
} from "@/lib/datahub/transforms";
import type {
  TransformPipeline,
  TransformOp,
  JoinOp,
  FilterOp,
  GroupByOp,
  SelectOp,
  DropOp,
  RenameOp,
  SortOp,
  DedupeOp,
  UnionOp,
  DeriveOp,
  PivotOp,
  UnpivotOp,
  ColumnTransformOp,
  NormalizeColumnOp,
  TransposeColumnOp,
  RemoveBaselineColumnOp,
  FractionOfTotalColumnOp,
  FilterNode,
  FilterCondition,
  AggFunc,
  AggSpec,
  SortKey,
  FillNaOp,
  InterpolateOp,
  DropNaOp,
  SetWhereOp,
  StrOp,
  AsTypeOp,
  ToDateOp,
  DatePartsOp,
  ClipOp,
  RoundOp,
  BinOp,
  MapOp,
  RankOp,
  CumulativeOp,
  LagOp,
  RollingOp,
  IsInOp,
  BetweenOp,
  TopNOp,
  SampleOp,
  ValueCountsOp,
  DescribeOp,
  CrosstabOp,
  PivotTableOp,
} from "./pipeline";

// ---------------------------------------------------------------------------
// Internal table representation
// ---------------------------------------------------------------------------

/**
 * The engine works on an internal flat table: an ordered list of columns
 * (by name) and an ordered list of row objects (each a plain Record).
 * Conversion to/from DataHubDocContent happens only at the entry and exit
 * of executePipeline, keeping the internal logic simple.
 *
 * `content` carries the ROLE-AWARE DataHubDocContent this flat table came from,
 * but ONLY while the table still corresponds 1:1 to that content (column ids,
 * roles, and row ids intact). contentToInternal sets it; the folded column
 * transforms (which delegate to transforms.ts and need the column roles to match
 * the standalone single-op result byte-for-byte) read it. Every RELATIONAL op
 * (join / filter / groupby / select / drop / rename / sort / dedupe / union /
 * derive / pivot / unpivot) builds a fresh flat table WITHOUT `content`, because
 * it has restructured the rows/columns away from any original content. When
 * `content` is absent a column transform synthesizes a generic role-"y" content
 * from the flat table instead, so it still runs, just without the original roles.
 */
interface InternalTable {
  columns: string[];
  rows: Record<string, CellValue>[];
  content?: DataHubDocContent;
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

function contentToInternal(content: DataHubDocContent): InternalTable {
  const columns = content.columns.map((c) => c.name);
  const rows = content.rows.map((row) => {
    const r: Record<string, CellValue> = {};
    for (const col of content.columns) {
      const v = row.cells[col.id];
      r[col.name] = v !== undefined ? v : null;
    }
    return r;
  });
  // Keep the role-aware content so a folded column transform can delegate to the
  // standalone transforms.ts function byte-for-byte while the table is still an
  // unreshaped 1:1 view of this content.
  return { columns, rows, content };
}

/**
 * Convert back to DataHubDocContent. Column types are inferred from the
 * observed values: if all non-null values are numeric the column is "number",
 * otherwise "text". The result table always has table_type "column" (the
 * generic flat-table archetype) and empty analyses/plots (those belong to the
 * source; the transform result is a new document).
 */
function internalToContent(
  table: InternalTable,
  name: string,
): DataHubDocContent {
  const columns: ColumnDef[] = table.columns.map((colName, i) => {
    const values = table.rows.map((r) => r[colName]);
    const isNumeric = values.every(
      (v) =>
        v === null ||
        v === undefined ||
        (typeof v === "number" && !Number.isNaN(v)) ||
        (typeof v === "string" && v !== "" && Number.isFinite(Number(v))),
    );
    return {
      id: `col-${i + 1}`,
      name: colName,
      role: "y" as const,
      dataType: isNumeric ? ("number" as const) : ("text" as const),
    };
  });

  const colNameToId = new Map(columns.map((c) => [c.name, c.id]));

  const rows: RowRecord[] = table.rows.map((row, i) => {
    const cells: Record<string, CellValue> = {};
    for (const col of columns) {
      const v = row[col.name];
      cells[col.id] = v !== undefined ? v : null;
    }
    return { id: `row-${i + 1}`, cells };
  });

  return {
    meta: {
      id: `transform-result-${Date.now()}`,
      name,
      project_ids: [],
      folder_path: null,
      table_type: "column",
      created_at: new Date().toISOString(),
    },
    columns,
    rows,
    analyses: [],
    plots: [],
  };
}

// ---------------------------------------------------------------------------
// Filter evaluation
// ---------------------------------------------------------------------------

function coerceToNumber(v: CellValue): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function isEmpty(v: CellValue): boolean {
  return v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));
}

function evalCondition(row: Record<string, CellValue>, cond: FilterCondition): boolean {
  const cell = row[cond.column];
  const { op, value } = cond;

  switch (op) {
    case "is_empty":
      return isEmpty(cell);
    case "eq":
      if (isEmpty(cell) && isEmpty(value as CellValue)) return true;
      if (isEmpty(cell) || isEmpty(value as CellValue)) return false;
      if (typeof value === "number") return coerceToNumber(cell) === value;
      return String(cell) === String(value);
    case "ne":
      return !evalCondition(row, { ...cond, op: "eq" });
    case "lt":
      return coerceToNumber(cell) < coerceToNumber(value as CellValue);
    case "le":
      return coerceToNumber(cell) <= coerceToNumber(value as CellValue);
    case "gt":
      return coerceToNumber(cell) > coerceToNumber(value as CellValue);
    case "ge":
      return coerceToNumber(cell) >= coerceToNumber(value as CellValue);
    case "contains":
      return !isEmpty(cell) && String(cell).includes(String(value));
    case "regex":
      if (isEmpty(cell)) return false;
      try {
        return new RegExp(String(value)).test(String(cell));
      } catch {
        return false;
      }
    case "in": {
      const set = Array.isArray(value) ? value : [value];
      return set.some((v) => evalCondition(row, { column: cond.column, op: "eq", value: v as string | number }));
    }
    default:
      return false;
  }
}

function evalFilterNode(row: Record<string, CellValue>, node: FilterNode): boolean {
  switch (node.type) {
    case "condition":
      return evalCondition(row, node.condition);
    case "not":
      return !evalFilterNode(row, node.child);
    case "and":
      return node.children.every((child) => evalFilterNode(row, child));
    case "or":
      return node.children.some((child) => evalFilterNode(row, child));
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

function sampleSd(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function aggregate(
  cells: CellValue[],
  spec: AggSpec,
): CellValue {
  const separator = spec.separator ?? ", ";

  switch (spec.func) {
    case "count":
      return cells.filter((v) => !isEmpty(v)).length;

    case "nunique": {
      const nonNull = cells.filter((v) => !isEmpty(v));
      return new Set(nonNull.map((v) => String(v))).size;
    }

    case "first": {
      const nonNull = cells.filter((v) => !isEmpty(v));
      return nonNull.length > 0 ? nonNull[0] : null;
    }

    case "concat": {
      return cells
        .filter((v) => !isEmpty(v))
        .map((v) => {
          // Match pandas float str() formatting: whole-number floats get ".0"
          // (e.g. 4.0 -> "4.0", not "4"). This mirrors how pandas object/float64
          // columns serialize in concat aggregation.
          if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v)) {
            return `${v}.0`;
          }
          return String(v);
        })
        .join(separator);
    }

    default: {
      // Numeric aggregations: mean, sum, min, max, median, sd
      const nums = cells
        .filter((v) => !isEmpty(v))
        .map((v) => (typeof v === "number" ? v : Number(v)))
        .filter((n) => Number.isFinite(n));

      if (nums.length === 0) return null;

      switch (spec.func) {
        case "sum":
          return nums.reduce((a, b) => a + b, 0);
        case "mean":
          return nums.reduce((a, b) => a + b, 0) / nums.length;
        case "min":
          return Math.min(...nums);
        case "max":
          return Math.max(...nums);
        case "median":
          return median(nums);
        case "sd":
          return sampleSd(nums);
        default:
          return null;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Join key helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a join key value to a string for comparison. Mixed numeric/string
 * keys are both stringified so that 1 and "1" compare equal, matching pandas
 * merge behavior with object-dtype keys.
 */
function keyToString(v: CellValue): string {
  if (v === null || v === undefined) return "\0NULL\0";
  return String(v);
}

function rowKey(row: Record<string, CellValue>, on: string[]): string {
  return on.map((col) => keyToString(row[col])).join("\0SEP\0");
}

const NULL_KEY_SENTINEL = on_keys_sentinel();
function on_keys_sentinel() {
  // A sentinel that represents "at least one key column is null".
  return "\0NULL\0";
}

function hasNullKey(row: Record<string, CellValue>, on: string[]): boolean {
  return on.some((col) => {
    const v = row[col];
    return v === null || v === undefined;
  });
}

// ---------------------------------------------------------------------------
// Op implementations
// ---------------------------------------------------------------------------

function applyJoin(table: InternalTable, right: InternalTable, op: JoinOp): InternalTable | string {
  const { on, how, suffixLeft = "_x", suffixRight = "_y" } = op;

  // Validate key columns exist.
  for (const key of on) {
    if (!table.columns.includes(key))
      return `join: key column "${key}" not found in left table`;
    if (!right.columns.includes(key))
      return `join: key column "${key}" not found in right table`;
  }

  // Determine non-key columns.
  const leftNonKey = table.columns.filter((c) => !on.includes(c));
  const rightNonKey = right.columns.filter((c) => !on.includes(c));

  // Detect name collisions and build suffix mapping.
  const leftNonKeySet = new Set(leftNonKey);
  const rightNonKeySet = new Set(rightNonKey);
  const collisions = new Set([...leftNonKey].filter((c) => rightNonKeySet.has(c)));

  function leftColName(c: string) {
    return collisions.has(c) ? `${c}${suffixLeft}` : c;
  }
  function rightColName(c: string) {
    return collisions.has(c) ? `${c}${suffixRight}` : c;
  }

  // Build result column list: keys, then left non-keys (possibly suffixed),
  // then right non-keys (possibly suffixed). Matches pandas merge column order.
  const resultCols: string[] = [
    ...on,
    ...leftNonKey.map(leftColName),
    ...rightNonKey.map(rightColName),
  ];

  // Index the right table by key.
  const rightIndex = new Map<string, Record<string, CellValue>[]>();
  for (const row of right.rows) {
    const k = rowKey(row, on);
    if (!rightIndex.has(k)) rightIndex.set(k, []);
    rightIndex.get(k)!.push(row);
  }

  const resultRows: Record<string, CellValue>[] = [];
  const matchedRightKeys = new Set<string>();

  // For outer join: track which right rows were matched.
  const rightRowMatched = new Set<number>();

  for (const leftRow of table.rows) {
    const k = rowKey(leftRow, on);
    const isNullKey = hasNullKey(leftRow, on);

    // pandas merge drops null-key rows for inner/left/right; for outer they
    // become unmatched rows (no right match possible).
    const matches =
      !isNullKey && rightIndex.has(k) ? rightIndex.get(k)! : [];

    if (matches.length > 0) {
      for (let ri = 0; ri < matches.length; ri++) {
        const rightRow = matches[ri];
        // Mark right row index as matched.
        const globalIdx = right.rows.indexOf(rightRow);
        rightRowMatched.add(globalIdx);

        const merged: Record<string, CellValue> = {};
        for (const col of on) merged[col] = leftRow[col];
        for (const col of leftNonKey) merged[leftColName(col)] = leftRow[col] ?? null;
        for (const col of rightNonKey) merged[rightColName(col)] = rightRow[col] ?? null;
        resultRows.push(merged);
      }
    } else if (how === "left" || how === "outer") {
      // Unmatched left row: fill right columns with null.
      const merged: Record<string, CellValue> = {};
      for (const col of on) merged[col] = leftRow[col];
      for (const col of leftNonKey) merged[leftColName(col)] = leftRow[col] ?? null;
      for (const col of rightNonKey) merged[rightColName(col)] = null;
      resultRows.push(merged);
    }
    // inner / right: unmatched left rows are dropped.
  }

  // For right / outer join: add unmatched right rows.
  if (how === "right" || how === "outer") {
    for (let ri = 0; ri < right.rows.length; ri++) {
      if (rightRowMatched.has(ri)) continue;
      const rightRow = right.rows[ri];
      const merged: Record<string, CellValue> = {};
      for (const col of on) merged[col] = rightRow[col];
      for (const col of leftNonKey) merged[leftColName(col)] = null;
      for (const col of rightNonKey) merged[rightColName(col)] = rightRow[col] ?? null;
      resultRows.push(merged);
    }
  }

  // pandas outer and right joins sort the result by key columns (nulls last).
  // Left and inner joins preserve the left table's row order.
  if (how === "outer" || how === "right") {
    resultRows.sort((a, b) => {
      for (const col of on) {
        const av = a[col] ?? null;
        const bv = b[col] ?? null;
        const aNull = av === null;
        const bNull = bv === null;
        if (aNull && bNull) continue;
        if (aNull) return 1;  // nulls last
        if (bNull) return -1;
        const cmp =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
  }

  return { columns: resultCols, rows: resultRows };
}

function applyFilter(table: InternalTable, op: FilterOp): InternalTable | string {
  const rows = table.rows.filter((row) => evalFilterNode(row, op.node));
  return { columns: table.columns, rows };
}

function applyGroupBy(table: InternalTable, op: GroupByOp): InternalTable | string {
  const { by, aggregations } = op;

  for (const col of by) {
    if (!table.columns.includes(col))
      return `groupby: group column "${col}" not found`;
  }
  for (const agg of aggregations) {
    if (!table.columns.includes(agg.column))
      return `groupby: aggregate column "${agg.column}" not found`;
  }

  // Group rows by the key tuple.
  const groups = new Map<string, Record<string, CellValue>[]>();
  const keyOrder: string[] = []; // preserve first-seen order of groups
  for (const row of table.rows) {
    const k = rowKey(row, by);
    if (!groups.has(k)) {
      groups.set(k, []);
      keyOrder.push(k);
    }
    groups.get(k)!.push(row);
  }

  // Build output column list.
  const outputCols: string[] = [
    ...by,
    ...aggregations.map((a) => a.outputName ?? `${a.column}_${a.func}`),
  ];

  const resultRows: Record<string, CellValue>[] = [];
  for (const k of keyOrder) {
    const groupRows = groups.get(k)!;
    const resultRow: Record<string, CellValue> = {};

    // Copy group key values from the first row.
    for (const col of by) resultRow[col] = groupRows[0][col];

    // Compute each aggregation.
    for (const agg of aggregations) {
      const cells = groupRows.map((r) => r[agg.column]);
      const outName = agg.outputName ?? `${agg.column}_${agg.func}`;
      resultRow[outName] = aggregate(cells, agg);
    }

    resultRows.push(resultRow);
  }

  return { columns: outputCols, rows: resultRows };
}

function applySelect(table: InternalTable, op: SelectOp): InternalTable | string {
  for (const col of op.columns) {
    if (!table.columns.includes(col))
      return `select: column "${col}" not found`;
  }
  const rows = table.rows.map((row) => {
    const r: Record<string, CellValue> = {};
    for (const col of op.columns) r[col] = row[col] ?? null;
    return r;
  });
  return { columns: op.columns, rows };
}

function applyDrop(table: InternalTable, op: DropOp): InternalTable | string {
  for (const col of op.columns) {
    if (!table.columns.includes(col))
      return `drop: column "${col}" not found`;
  }
  const dropSet = new Set(op.columns);
  const columns = table.columns.filter((c) => !dropSet.has(c));
  const rows = table.rows.map((row) => {
    const r: Record<string, CellValue> = {};
    for (const col of columns) r[col] = row[col] ?? null;
    return r;
  });
  return { columns, rows };
}

function applyRename(table: InternalTable, op: RenameOp): InternalTable | string {
  for (const oldName of Object.keys(op.mapping)) {
    if (!table.columns.includes(oldName))
      return `rename: column "${oldName}" not found`;
  }
  const columns = table.columns.map((c) => op.mapping[c] ?? c);
  const rows = table.rows.map((row) => {
    const r: Record<string, CellValue> = {};
    for (const col of table.columns) {
      const newName = op.mapping[col] ?? col;
      r[newName] = row[col] ?? null;
    }
    return r;
  });
  return { columns, rows };
}

function compareValues(a: CellValue, b: CellValue): number {
  // Both null: equal.
  if (a === null && b === null) return 0;
  // null vs non-null: caller determines placement via nulls option.
  if (a === null) return 1; // nulls last by default (overridden below)
  if (b === null) return -1;
  // Both numeric: numeric comparison.
  if (typeof a === "number" && typeof b === "number") return a - b;
  // Mixed or both string: lexicographic.
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function applySort(table: InternalTable, op: SortOp): InternalTable | string {
  for (const key of op.by) {
    if (!table.columns.includes(key.column))
      return `sort: column "${key.column}" not found`;
  }

  const rows = [...table.rows].sort((a, b) => {
    for (const key of op.by) {
      const av = a[key.column] ?? null;
      const bv = b[key.column] ?? null;
      const aNull = av === null;
      const bNull = bv === null;

      // Determine null placement.
      const dir = key.direction === "desc" ? -1 : 1;
      // asc defaults to nulls-last; desc defaults to nulls-first.
      const nullsPos = key.nulls ?? (key.direction === "desc" ? "first" : "last");

      if (aNull && bNull) continue;
      // Null placement is direction-independent: "last" always means the end
      // of the sorted array; "first" always means the start. This matches
      // pandas na_position behavior.
      if (aNull) return nullsPos === "last" ? 1 : -1;
      if (bNull) return nullsPos === "last" ? -1 : 1;

      const cmp = compareValues(av, bv);
      if (cmp !== 0) return dir * cmp;
    }
    return 0;
  });

  return { columns: table.columns, rows };
}

function applyDedupe(table: InternalTable, op: DedupeOp): InternalTable | string {
  const subset = op.subset && op.subset.length > 0 ? op.subset : table.columns;
  for (const col of subset) {
    if (!table.columns.includes(col))
      return `dedupe: column "${col}" not found`;
  }
  const keep = op.keep ?? "first";
  const rows = keep === "first"
    ? dedupeFirst(table.rows, subset)
    : dedupeLast(table.rows, subset);
  return { columns: table.columns, rows };
}

function dedupeFirst(rows: Record<string, CellValue>[], subset: string[]): Record<string, CellValue>[] {
  const seen = new Set<string>();
  const result: Record<string, CellValue>[] = [];
  for (const row of rows) {
    const k = rowKey(row, subset);
    if (!seen.has(k)) {
      seen.add(k);
      result.push(row);
    }
  }
  return result;
}

function dedupeLast(rows: Record<string, CellValue>[], subset: string[]): Record<string, CellValue>[] {
  // Keep last occurrence: reverse, dedupe-first, reverse back.
  return dedupeFirst([...rows].reverse(), subset).reverse();
}

function applyUnion(table: InternalTable, other: InternalTable, _op: UnionOp): InternalTable | string {
  // Column order: primary table columns first, then any new columns from other.
  const primarySet = new Set(table.columns);
  const extraCols = other.columns.filter((c) => !primarySet.has(c));
  const columns = [...table.columns, ...extraCols];

  const resultRows: Record<string, CellValue>[] = [];

  for (const row of table.rows) {
    const r: Record<string, CellValue> = {};
    for (const col of columns) r[col] = row[col] ?? null;
    resultRows.push(r);
  }
  for (const row of other.rows) {
    const r: Record<string, CellValue> = {};
    for (const col of columns) r[col] = row[col] ?? null;
    resultRows.push(r);
  }

  return { columns, rows: resultRows };
}

// ---------------------------------------------------------------------------
// Derive (computed column via the calc builder expression engine)
// ---------------------------------------------------------------------------

/**
 * Build the per-row evaluation scope. Every column name maps to that row's cell
 * value. Numeric strings are coerced to numbers so a formula like "a + b" does
 * arithmetic even when the source cell is a string "2" (matching how the calc
 * builder binds numeric inputs). Empty / null cells are left as NaN so any
 * formula touching them produces a non-finite result, which the caller maps to
 * null. Non-numeric text cells are passed through as-is so string-aware formulas
 * (for example the calc builder's "if" returning a label) still see the text.
 */
function deriveScope(row: Record<string, CellValue>): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(row)) {
    if (value === null || value === undefined || value === "") {
      scope[name] = NaN;
    } else if (typeof value === "number") {
      scope[name] = value;
    } else {
      const n = Number(value);
      scope[name] = Number.isFinite(n) ? n : value;
    }
  }
  return scope;
}

function applyDerive(table: InternalTable, op: DeriveOp): InternalTable | string {
  if (!op.outputName || op.outputName.trim() === "")
    return `derive: outputName must be a non-empty column name`;
  if (!op.formula || op.formula.trim() === "")
    return `derive: formula must be a non-empty expression`;

  // The new column overwrites an existing same-named column in place (keeps the
  // column order stable) or is appended when the name is new.
  const exists = table.columns.includes(op.outputName);
  const columns = exists ? table.columns : [...table.columns, op.outputName];

  const rows = table.rows.map((row) => {
    const scope = deriveScope(row);
    const result = evaluateExpression(op.formula, scope);
    // Missing / non-numeric inputs, a parse error, or a non-finite number all
    // collapse to null instead of crashing the pipeline. A finite number is
    // stored as a number; a non-empty string result is stored as text.
    let cell: CellValue;
    if (typeof result === "number") {
      cell = Number.isFinite(result) ? result : null;
    } else if (typeof result === "string") {
      cell = result === "" ? null : result;
    } else {
      cell = null;
    }
    return { ...row, [op.outputName]: cell };
  });

  return { columns, rows };
}

// ---------------------------------------------------------------------------
// Pivot (long -> wide, pandas pivot_table with aggfunc=mean)
// ---------------------------------------------------------------------------

/** Mean of the numeric members of a collided (index, key) cell, or a single
 *  passthrough value when there is no collision. Returns null when nothing is
 *  numeric and there is no single non-numeric value to pass through. */
function pivotCellValue(cells: CellValue[]): CellValue {
  if (cells.length === 1) return cells[0] ?? null;
  const nums = cells
    .filter((v) => !isEmpty(v))
    .map((v) => (typeof v === "number" ? v : Number(v)))
    .filter((n) => Number.isFinite(n));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Deterministic ascending comparison of distinct key values. Numbers sort
 *  numerically, anything else sorts as strings, matching pandas sorted columns. */
function compareKeyValues(a: string, b: string): number {
  const an = Number(a);
  const bn = Number(b);
  if (a !== "" && b !== "" && Number.isFinite(an) && Number.isFinite(bn)) {
    return an - bn;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function applyPivot(table: InternalTable, op: PivotOp): InternalTable | string {
  const { index, columns: keyCol, values: valCol } = op;
  if (index.length === 0) return `pivot: index must list at least one column`;
  for (const col of index) {
    if (!table.columns.includes(col))
      return `pivot: index column "${col}" not found`;
  }
  if (!table.columns.includes(keyCol))
    return `pivot: columns key "${keyCol}" not found`;
  if (!table.columns.includes(valCol))
    return `pivot: values column "${valCol}" not found`;

  // Distinct key values become new columns, sorted ascending.
  const keySet = new Set<string>();
  for (const row of table.rows) {
    const k = row[keyCol];
    if (k !== null && k !== undefined) keySet.add(String(k));
  }
  const keyColumns = [...keySet].sort(compareKeyValues);

  // Bucket value cells by (index tuple, key value). Preserve first-seen order
  // of the index tuples for deterministic output rows. pandas pivot_table sorts
  // its index, so we sort the index rows by their tuple at the end to match.
  const groups = new Map<string, { idx: Record<string, CellValue>; cells: Map<string, CellValue[]> }>();
  const order: string[] = [];
  for (const row of table.rows) {
    const idxKey = rowKey(row, index);
    if (!groups.has(idxKey)) {
      const idx: Record<string, CellValue> = {};
      for (const col of index) idx[col] = row[col] ?? null;
      groups.set(idxKey, { idx, cells: new Map() });
      order.push(idxKey);
    }
    const k = row[keyCol];
    if (k === null || k === undefined) continue; // null keys drop, like pandas
    const kStr = String(k);
    const bucket = groups.get(idxKey)!.cells;
    if (!bucket.has(kStr)) bucket.set(kStr, []);
    bucket.get(kStr)!.push(row[valCol] ?? null);
  }

  const outputCols = [...index, ...keyColumns];
  const resultRows: Record<string, CellValue>[] = order.map((idxKey) => {
    const { idx, cells } = groups.get(idxKey)!;
    const r: Record<string, CellValue> = {};
    for (const col of index) r[col] = idx[col];
    for (const kCol of keyColumns) {
      const bucket = cells.get(kCol);
      r[kCol] = bucket ? pivotCellValue(bucket) : null;
    }
    return r;
  });

  // pandas pivot_table sorts the resulting index ascending.
  resultRows.sort((a, b) => {
    for (const col of index) {
      const av = a[col] ?? null;
      const bv = b[col] ?? null;
      const aNull = av === null;
      const bNull = bv === null;
      if (aNull && bNull) continue;
      if (aNull) return 1;
      if (bNull) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
      if (cmp !== 0) return cmp;
    }
    return 0;
  });

  return { columns: outputCols, rows: resultRows };
}

// ---------------------------------------------------------------------------
// Unpivot (wide -> long, pandas melt)
// ---------------------------------------------------------------------------

function applyUnpivot(table: InternalTable, op: UnpivotOp): InternalTable | string {
  const idVars = op.idVars ?? [];
  for (const col of idVars) {
    if (!table.columns.includes(col))
      return `unpivot: id column "${col}" not found`;
  }

  const idSet = new Set(idVars);
  // valueVars defaults to all non-id columns in table order (pandas melt).
  const valueVars =
    op.valueVars && op.valueVars.length > 0
      ? op.valueVars
      : table.columns.filter((c) => !idSet.has(c));
  for (const col of valueVars) {
    if (!table.columns.includes(col))
      return `unpivot: value column "${col}" not found`;
  }

  const varName = op.varName ?? "variable";
  const valueName = op.valueName ?? "value";

  const columns = [...idVars, varName, valueName];
  const resultRows: Record<string, CellValue>[] = [];
  // pandas melt order: for each value variable, emit every input row in order.
  for (const vVar of valueVars) {
    for (const row of table.rows) {
      const r: Record<string, CellValue> = {};
      for (const col of idVars) r[col] = row[col] ?? null;
      r[varName] = vVar;
      r[valueName] = row[vVar] ?? null;
      resultRows.push(r);
    }
  }

  return { columns, rows: resultRows };
}

// ---------------------------------------------------------------------------
// Folded column transforms (delegate to transforms.ts, never reimplement math)
// ---------------------------------------------------------------------------

/**
 * Synthesize a role-aware DataHubDocContent from a flat InternalTable that no
 * longer carries its original content (a relational op reshaped it). Columns are
 * generic role "y" data columns with stable col-N ids and row-N ids, matching the
 * shape internalToContent produces, so a delegated column transform still has a
 * valid content to run against.
 */
function internalToBareContent(table: InternalTable): DataHubDocContent {
  const columns: ColumnDef[] = table.columns.map((colName, i) => ({
    id: `col-${i + 1}`,
    name: colName,
    role: "y" as const,
    dataType: "number" as const,
  }));
  const rows: RowRecord[] = table.rows.map((row, i) => {
    const cells: Record<string, CellValue> = {};
    for (const col of columns) {
      const v = row[col.name];
      cells[col.id] = v !== undefined ? v : null;
    }
    return { id: `row-${i + 1}`, cells };
  });
  return {
    meta: {
      id: `transform-step-${Date.now()}`,
      name: "",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      created_at: new Date().toISOString(),
    },
    columns,
    rows,
    analyses: [],
    plots: [],
  };
}

/** Re-flatten a transforms.ts result content into an InternalTable, carrying the
 *  result content forward so a SUBSEQUENT column transform can also delegate
 *  role-aware. */
function contentResultToInternal(content: DataHubDocContent): InternalTable {
  const columns = content.columns.map((c) => c.name);
  const rows = content.rows.map((row) => {
    const r: Record<string, CellValue> = {};
    for (const col of content.columns) {
      const v = row.cells[col.id];
      r[col.name] = v !== undefined ? v : null;
    }
    return r;
  });
  return { columns, rows, content };
}

/**
 * Run one folded column transform by delegating to its pure function in
 * transforms.ts. When the table still carries its original role-aware content the
 * delegation is byte-identical to calling transforms.ts directly (so a legacy
 * single-op derived table recomputes unchanged). Otherwise a generic role-"y"
 * content is synthesized from the reshaped flat table first.
 */
function applyColumnTransform(
  table: InternalTable,
  run: (content: DataHubDocContent) => DataHubDocContent,
): InternalTable {
  const source = table.content ?? internalToBareContent(table);
  const result = run(source);
  return contentResultToInternal(result);
}

// ---------------------------------------------------------------------------
// Phase 2b-1 data-cleaning ops (the everyday "edit with code" set)
// ---------------------------------------------------------------------------

/** A cell as a string, or "" for an empty cell. Whole-number floats keep no
 *  decimal (5 not "5.0") so string slicing on a numeric-typed column reads as the
 *  user sees it. */
function cellToStr(v: CellValue): string {
  if (isEmpty(v)) return "";
  return String(v);
}

function applyFillNa(table: InternalTable, op: FillNaOp): InternalTable | string {
  if (!table.columns.includes(op.column))
    return `fillna: column "${op.column}" not found`;

  let fillConst: CellValue = op.value ?? null;
  // Precompute mean / median over the whole column once.
  if (op.method === "mean" || op.method === "median") {
    const nums = table.rows
      .map((r) => r[op.column])
      .filter((v) => !isEmpty(v))
      .map((v) => (typeof v === "number" ? v : Number(v)))
      .filter((n) => Number.isFinite(n));
    if (nums.length === 0) {
      fillConst = null;
    } else if (op.method === "mean") {
      fillConst = nums.reduce((a, b) => a + b, 0) / nums.length;
    } else {
      fillConst = median(nums);
    }
  }

  const rows = table.rows.map((r) => ({ ...r }));
  if (op.method === "ffill") {
    let last: CellValue = null;
    for (const r of rows) {
      if (isEmpty(r[op.column])) {
        if (!isEmpty(last)) r[op.column] = last;
      } else {
        last = r[op.column];
      }
    }
  } else if (op.method === "bfill") {
    let next: CellValue = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (isEmpty(rows[i][op.column])) {
        if (!isEmpty(next)) rows[i][op.column] = next;
      } else {
        next = rows[i][op.column];
      }
    }
  } else {
    // constant / mean / median: fill every empty cell with fillConst.
    for (const r of rows) {
      if (isEmpty(r[op.column])) r[op.column] = fillConst;
    }
  }
  return { columns: table.columns, rows };
}

function applyDropNa(table: InternalTable, op: DropNaOp): InternalTable | string {
  const cols = op.columns && op.columns.length > 0 ? op.columns : table.columns;
  for (const c of cols) {
    if (!table.columns.includes(c)) return `dropna: column "${c}" not found`;
  }
  const rows = table.rows.filter((r) => {
    const empties = cols.map((c) => isEmpty(r[c]));
    // how "any": drop if any selected column is empty; "all": drop only if all are.
    return op.how === "all" ? !empties.every(Boolean) : !empties.some(Boolean);
  });
  return { columns: table.columns, rows };
}

function applySetWhere(table: InternalTable, op: SetWhereOp): InternalTable | string {
  if (!table.columns.includes(op.column))
    return `set-where: column "${op.column}" not found`;
  const rows = table.rows.map((r) => {
    if (!evalFilterNode(r, op.where)) return r;
    const next = { ...r };
    if (op.valueKind === "formula") {
      const formula = op.formula ?? "";
      if (formula.trim() === "") {
        next[op.column] = null;
        return next;
      }
      const result = evaluateExpression(formula, deriveScope(r));
      if (typeof result === "number") next[op.column] = Number.isFinite(result) ? result : null;
      else if (typeof result === "string") next[op.column] = result === "" ? null : result;
      else next[op.column] = null;
    } else {
      next[op.column] = op.value ?? null;
    }
    return next;
  });
  return { columns: table.columns, rows };
}

function titleCase(s: string): string {
  // Capitalize the first letter of each run of letters, matching pandas .str.title.
  return s.replace(/[A-Za-z]+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

function applyStrOp(table: InternalTable, op: StrOp): InternalTable | string {
  // Validate the source column(s) exist.
  if (op.mode === "cat") {
    for (const c of op.columns) {
      if (!table.columns.includes(c)) return `str cat: column "${c}" not found`;
    }
  } else if (!table.columns.includes(op.column)) {
    return `str ${op.mode}: column "${op.column}" not found`;
  }

  // Modes that ADD new columns.
  if (op.mode === "extract") {
    const out = op.outputName;
    const group = op.group ?? 1;
    let re: RegExp;
    try {
      re = new RegExp(op.pattern);
    } catch {
      return `str extract: invalid regex "${op.pattern}"`;
    }
    const columns = table.columns.includes(out) ? table.columns : [...table.columns, out];
    const rows = table.rows.map((r) => {
      const m = re.exec(cellToStr(r[op.column]));
      return { ...r, [out]: m && m[group] !== undefined ? m[group] : null };
    });
    return { columns, rows };
  }

  if (op.mode === "split") {
    const prefix = op.outputPrefix ?? `${op.column}_part`;
    const parts = Math.max(1, op.parts);
    const newCols = Array.from({ length: parts }, (_, i) => `${prefix}_${i + 1}`);
    const columns = [...table.columns];
    for (const c of newCols) if (!columns.includes(c)) columns.push(c);
    const rows = table.rows.map((r) => {
      const pieces = cellToStr(r[op.column]).split(op.separator);
      const next = { ...r };
      for (let i = 0; i < parts; i++) {
        next[newCols[i]] = pieces[i] !== undefined ? pieces[i] : null;
      }
      return next;
    });
    return { columns, rows };
  }

  if (op.mode === "cat") {
    const out = op.outputName;
    const columns = table.columns.includes(out) ? table.columns : [...table.columns, out];
    const rows = table.rows.map((r) => {
      // concat_ws semantics: skip empty cells, join the rest with the separator.
      const parts = op.columns.map((c) => r[c]).filter((v) => !isEmpty(v)).map(cellToStr);
      return { ...r, [out]: parts.join(op.separator) };
    });
    return { columns, rows };
  }

  // In-place modes: slice, replace, case, strip. Empty cells stay empty (null).
  const transform = (raw: CellValue): CellValue => {
    if (isEmpty(raw)) return raw;
    const s = cellToStr(raw);
    switch (op.mode) {
      case "slice": {
        if (op.sliceMode === "replaceFirst") {
          const n = op.n ?? 0;
          return (op.replacement ?? "") + s.slice(n);
        }
        const start = op.start ?? 0;
        return op.end !== undefined ? s.slice(start, op.end) : s.slice(start);
      }
      case "replace": {
        if (op.regex) {
          try {
            return s.replace(new RegExp(op.pattern, "g"), op.replacement);
          } catch {
            return s;
          }
        }
        return s.split(op.pattern).join(op.replacement);
      }
      case "case":
        return op.caseMode === "upper"
          ? s.toUpperCase()
          : op.caseMode === "lower"
            ? s.toLowerCase()
            : titleCase(s);
      case "strip":
        return op.stripMode === "left"
          ? s.replace(/^\s+/, "")
          : op.stripMode === "right"
            ? s.replace(/\s+$/, "")
            : s.trim();
      default:
        return s;
    }
  };
  const col = op.column;
  const rows = table.rows.map((r) => ({ ...r, [col]: transform(r[col]) }));
  return { columns: table.columns, rows };
}

/** Parse a cell to a boolean, matching the SQL TRY_CAST(... AS BOOLEAN) plus the
 *  common yes/no string spellings. */
function toBoolean(v: CellValue): CellValue {
  if (isEmpty(v)) return null;
  if (typeof v === "number") return v !== 0 ? "true" : "false";
  const s = String(v).trim().toLowerCase();
  if (["true", "t", "1", "yes", "y"].includes(s)) return "true";
  if (["false", "f", "0", "no", "n"].includes(s)) return "false";
  return null;
}

function applyAsType(table: InternalTable, op: AsTypeOp): InternalTable | string {
  if (!table.columns.includes(op.column))
    return `astype: column "${op.column}" not found`;
  const col = op.column;
  const rows = table.rows.map((r) => {
    const v = r[col];
    let next: CellValue;
    if (op.to === "number") {
      const n = coerceToNumber(v);
      next = Number.isFinite(n) ? n : null;
    } else if (op.to === "text") {
      next = isEmpty(v) ? null : cellToStr(v);
    } else if (op.to === "boolean") {
      next = toBoolean(v);
    } else {
      // date: parse to an ISO YYYY-MM-DD string using the default parser.
      if (isEmpty(v)) next = null;
      else {
        const d = new Date(cellToStr(v));
        next = Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
      }
    }
    return { ...r, [col]: next };
  });
  return { columns: table.columns, rows };
}

/** Parse a string by an explicit strptime-style format into a Date, or null. Only
 *  the common tokens %Y %m %d %H %M %S are honored, the shared subset of pandas
 *  and DuckDB strptime. */
function parseByFormat(s: string, format: string): Date | null {
  const tokens: { token: string; key: string; len: number }[] = [];
  // Build a regex from the format, capturing each token's digits.
  let regexStr = "";
  for (let i = 0; i < format.length; i++) {
    if (format[i] === "%" && i + 1 < format.length) {
      const t = format[i + 1];
      const map: Record<string, { key: string; len: number }> = {
        Y: { key: "Y", len: 4 },
        m: { key: "m", len: 2 },
        d: { key: "d", len: 2 },
        H: { key: "H", len: 2 },
        M: { key: "M", len: 2 },
        S: { key: "S", len: 2 },
      };
      if (map[t]) {
        tokens.push({ token: t, key: map[t].key, len: map[t].len });
        regexStr += "(\\d{1," + map[t].len + "})";
        i++;
        continue;
      }
    }
    regexStr += format[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  const m = new RegExp("^" + regexStr + "$").exec(s.trim());
  if (!m) return null;
  const parts: Record<string, number> = {};
  tokens.forEach((tk, i) => {
    parts[tk.key] = Number(m[i + 1]);
  });
  if (parts.Y === undefined) return null;
  const d = new Date(
    Date.UTC(
      parts.Y,
      (parts.m ?? 1) - 1,
      parts.d ?? 1,
      parts.H ?? 0,
      parts.M ?? 0,
      parts.S ?? 0,
    ),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

function applyToDate(table: InternalTable, op: ToDateOp): InternalTable | string {
  if (!table.columns.includes(op.column))
    return `to-date: column "${op.column}" not found`;
  const col = op.column;
  const rows = table.rows.map((r) => {
    const v = r[col];
    if (isEmpty(v)) return { ...r, [col]: null };
    const d = parseByFormat(cellToStr(v), op.format);
    return { ...r, [col]: d ? d.toISOString().slice(0, 10) : null };
  });
  return { columns: table.columns, rows };
}

function applyDateParts(table: InternalTable, op: DatePartsOp): InternalTable | string {
  if (!table.columns.includes(op.column))
    return `date-parts: column "${op.column}" not found`;
  const newCols = op.parts.map((p) => `${op.column}_${p}`);
  const columns = [...table.columns];
  for (const c of newCols) if (!columns.includes(c)) columns.push(c);
  const rows = table.rows.map((r) => {
    const v = r[op.column];
    const d = isEmpty(v) ? null : new Date(cellToStr(v));
    const valid = d && !Number.isNaN(d.getTime());
    const next = { ...r };
    op.parts.forEach((p, i) => {
      if (!valid) {
        next[newCols[i]] = null;
        return;
      }
      switch (p) {
        case "year":
          next[newCols[i]] = d!.getUTCFullYear();
          break;
        case "month":
          next[newCols[i]] = d!.getUTCMonth() + 1;
          break;
        case "day":
          next[newCols[i]] = d!.getUTCDate();
          break;
        case "weekday":
          // ISO weekday: Monday=1 .. Sunday=7, matching DuckDB isodow.
          next[newCols[i]] = ((d!.getUTCDay() + 6) % 7) + 1;
          break;
        case "hour":
          next[newCols[i]] = d!.getUTCHours();
          break;
      }
    });
    return next;
  });
  return { columns, rows };
}

// ---------------------------------------------------------------------------
// Phase 2b-2 numeric / window / filter-helper / summarize ops
// ---------------------------------------------------------------------------

/** Linear-interpolated quantile (q in 0..1) over a numeric array, matching the
 *  default pandas / numpy method so describe and qcut line up with the codegen. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function numericColumn(table: InternalTable, col: string): number[] {
  return table.rows
    .map((r) => r[col])
    .filter((v) => !isEmpty(v))
    .map(coerceToNumber)
    .filter((n) => Number.isFinite(n));
}

function applyClip(table: InternalTable, op: ClipOp): InternalTable | string {
  if (!table.columns.includes(op.column)) return `clip: column "${op.column}" not found`;
  const col = op.column;
  const rows = table.rows.map((r) => {
    const v = r[col];
    if (isEmpty(v)) return r;
    const n = coerceToNumber(v);
    if (!Number.isFinite(n)) return r;
    let out = n;
    if (op.lower !== undefined && out < op.lower) out = op.lower;
    if (op.upper !== undefined && out > op.upper) out = op.upper;
    return { ...r, [col]: out };
  });
  return { columns: table.columns, rows };
}

function applyRound(table: InternalTable, op: RoundOp): InternalTable | string {
  if (!table.columns.includes(op.column)) return `round: column "${op.column}" not found`;
  const col = op.column;
  const d = op.decimals ?? 0;
  const factor = Math.pow(10, d);
  const rows = table.rows.map((r) => {
    const v = r[col];
    if (isEmpty(v)) return r;
    const n = coerceToNumber(v);
    if (!Number.isFinite(n)) return r;
    return { ...r, [col]: Math.round(n * factor) / factor };
  });
  return { columns: table.columns, rows };
}

function applyBin(table: InternalTable, op: BinOp): InternalTable | string {
  if (!table.columns.includes(op.column)) return `bin: column "${op.column}" not found`;
  const out = op.outputName;
  const columns = table.columns.includes(out) ? table.columns : [...table.columns, out];

  let edges: number[];
  if (op.mode === "quantiles") {
    const n = Math.max(1, op.quantiles ?? 4);
    const sorted = [...numericColumn(table, op.column)].sort((a, b) => a - b);
    edges = Array.from({ length: n + 1 }, (_, i) => quantile(sorted, i / n));
  } else {
    edges = [...(op.edges ?? [])].slice().sort((a, b) => a - b);
  }
  if (edges.length < 2) return `bin: need at least two edges`;

  const binCount = edges.length - 1;
  const labelFor = (i: number): string => {
    if (op.labels && op.labels[i] !== undefined) return op.labels[i];
    if (op.mode === "quantiles") return `Q${i + 1}`;
    return `${edges[i]}-${edges[i + 1]}`;
  };

  const rows = table.rows.map((r) => {
    const v = r[op.column];
    if (isEmpty(v)) return { ...r, [out]: null };
    const n = coerceToNumber(v);
    if (!Number.isFinite(n) || n < edges[0] || n > edges[binCount]) return { ...r, [out]: null };
    // Right-closed only on the very last bin, matching pandas cut default.
    let idx = -1;
    for (let i = 0; i < binCount; i++) {
      const upperClosed = i === binCount - 1;
      if (n >= edges[i] && (upperClosed ? n <= edges[i + 1] : n < edges[i + 1])) {
        idx = i;
        break;
      }
    }
    return { ...r, [out]: idx >= 0 ? labelFor(idx) : null };
  });
  return { columns, rows };
}

function applyMap(table: InternalTable, op: MapOp): InternalTable | string {
  if (!table.columns.includes(op.column)) return `map: column "${op.column}" not found`;
  const col = op.column;
  const lookup = new Map(op.mapping.map((m) => [m.from, m.to]));
  const rows = table.rows.map((r) => {
    const v = r[col];
    const key = isEmpty(v) ? "" : String(v);
    if (lookup.has(key)) return { ...r, [col]: lookup.get(key)! };
    if (op.fallback !== undefined) return { ...r, [col]: op.fallback };
    return r;
  });
  return { columns: table.columns, rows };
}

function applyRank(table: InternalTable, op: RankOp): InternalTable | string {
  if (!table.columns.includes(op.column)) return `rank: column "${op.column}" not found`;
  const out = op.outputName;
  const columns = table.columns.includes(out) ? table.columns : [...table.columns, out];
  // Build a sorted list of distinct non-empty numeric values to assign ranks.
  const vals = table.rows.map((r) => {
    const v = r[op.column];
    return isEmpty(v) ? NaN : coerceToNumber(v);
  });
  const finite = [...new Set(vals.filter((n) => Number.isFinite(n)))].sort((a, b) =>
    op.ascending ? a - b : b - a,
  );
  // "min": the rank a value would get is 1 + count of strictly-better values.
  // "dense": the value's position in the ordered distinct list, 1-based.
  const denseRank = new Map<number, number>();
  finite.forEach((v, i) => denseRank.set(v, i + 1));
  const minRank = new Map<number, number>();
  {
    let seen = 0;
    // Sort all finite (with duplicates) to compute min ranks.
    const all = vals.filter((n) => Number.isFinite(n)).sort((a, b) => (op.ascending ? a - b : b - a));
    for (let i = 0; i < all.length; i++) {
      if (!minRank.has(all[i])) minRank.set(all[i], seen + 1);
      seen++;
    }
  }
  const rows = table.rows.map((r, i) => {
    const n = vals[i];
    if (!Number.isFinite(n)) return { ...r, [out]: null };
    const rank = op.method === "dense" ? denseRank.get(n)! : minRank.get(n)!;
    return { ...r, [out]: rank };
  });
  return { columns, rows };
}

function applyCumulative(table: InternalTable, op: CumulativeOp): InternalTable | string {
  if (!table.columns.includes(op.column)) return `cumulative: column "${op.column}" not found`;
  const out = op.outputName;
  const columns = table.columns.includes(out) ? table.columns : [...table.columns, out];
  let acc: number | null = null;
  const rows = table.rows.map((r) => {
    const v = r[op.column];
    if (isEmpty(v)) return { ...r, [out]: null };
    const n = coerceToNumber(v);
    if (!Number.isFinite(n)) return { ...r, [out]: null };
    if (acc === null) {
      acc = n;
    } else {
      switch (op.func) {
        case "sum":
          acc = acc + n;
          break;
        case "prod":
          acc = acc * n;
          break;
        case "max":
          acc = Math.max(acc, n);
          break;
        case "min":
          acc = Math.min(acc, n);
          break;
      }
    }
    return { ...r, [out]: acc };
  });
  return { columns, rows };
}

function applyLag(table: InternalTable, op: LagOp): InternalTable | string {
  if (!table.columns.includes(op.column)) return `lag: column "${op.column}" not found`;
  const out = op.outputName;
  const columns = table.columns.includes(out) ? table.columns : [...table.columns, out];
  const periods = op.periods ?? 1;
  const nums = table.rows.map((r) => {
    const v = r[op.column];
    return isEmpty(v) ? null : Number.isFinite(coerceToNumber(v)) ? coerceToNumber(v) : null;
  });
  const rows = table.rows.map((r, i) => {
    const prevIdx = i - periods;
    const prev = prevIdx >= 0 && prevIdx < nums.length ? nums[prevIdx] : null;
    const cur = nums[i];
    let result: CellValue;
    if (op.mode === "shift") {
      result = prev;
    } else if (op.mode === "diff") {
      result = prev !== null && cur !== null ? cur - prev : null;
    } else {
      result = prev !== null && prev !== 0 && cur !== null ? (cur - prev) / prev : null;
    }
    return { ...r, [out]: result };
  });
  return { columns, rows };
}

function applyRolling(table: InternalTable, op: RollingOp): InternalTable | string {
  if (!table.columns.includes(op.column)) return `rolling: column "${op.column}" not found`;
  const out = op.outputName;
  const columns = table.columns.includes(out) ? table.columns : [...table.columns, out];
  const size = Math.max(1, op.size);
  const nums = table.rows.map((r) => {
    const v = r[op.column];
    return isEmpty(v) ? null : Number.isFinite(coerceToNumber(v)) ? coerceToNumber(v) : null;
  });
  const rows = table.rows.map((r, i) => {
    if (i < size - 1) return { ...r, [out]: null };
    const window = nums.slice(i - size + 1, i + 1);
    if (window.some((n) => n === null)) return { ...r, [out]: null };
    const w = window as number[];
    let val: number;
    switch (op.func) {
      case "sum":
        val = w.reduce((a, b) => a + b, 0);
        break;
      case "mean":
        val = w.reduce((a, b) => a + b, 0) / w.length;
        break;
      case "min":
        val = Math.min(...w);
        break;
      case "max":
        val = Math.max(...w);
        break;
    }
    return { ...r, [out]: val };
  });
  return { columns, rows };
}

function applyInterpolate(
  table: InternalTable,
  op: InterpolateOp,
): InternalTable | string {
  if (!table.columns.includes(op.column))
    return `interpolate: column "${op.column}" not found`;
  if (op.orderBy && !table.columns.includes(op.orderBy))
    return `interpolate: order column "${op.orderBy}" not found`;
  const col = op.column;
  // Numeric value (or null) per row, in the original row order.
  const num = table.rows.map((r) => {
    const v = r[col];
    if (isEmpty(v)) return null;
    const n = coerceToNumber(v);
    return Number.isFinite(n) ? n : null;
  });
  // The order to interpolate along. Default is row order. With orderBy, walk the
  // rows sorted by that column, then write results back to original positions.
  const order = table.rows.map((_, i) => i);
  if (op.orderBy) {
    const ob = op.orderBy;
    const key = (i: number): number | string => {
      const v = table.rows[i][ob];
      const n = coerceToNumber(v);
      return Number.isFinite(n) ? n : String(v ?? "");
    };
    order.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (typeof ka === "number" && typeof kb === "number") return ka - kb;
      return String(ka).localeCompare(String(kb));
    });
  }
  // Interpolated value per original index, or null to leave the cell empty (a
  // one-sided gap is not extrapolated, matching the pandas linear default).
  const fill: (number | null)[] = table.rows.map(() => null);
  for (let pos = 0; pos < order.length; pos++) {
    if (num[order[pos]] !== null) continue;
    let p = pos - 1;
    while (p >= 0 && num[order[p]] === null) p--;
    let n = pos + 1;
    while (n < order.length && num[order[n]] === null) n++;
    if (p >= 0 && n < order.length) {
      const pv = num[order[p]] as number;
      const nv = num[order[n]] as number;
      fill[order[pos]] = pv + ((nv - pv) * (pos - p)) / (n - p);
    }
  }
  const rows = table.rows.map((r, i) =>
    fill[i] === null ? r : { ...r, [col]: fill[i] },
  );
  return { columns: table.columns, rows };
}

function applyIsIn(table: InternalTable, op: IsInOp): InternalTable | string {
  if (!table.columns.includes(op.column)) return `isin: column "${op.column}" not found`;
  const set = new Set(op.values.map(String));
  const rows = table.rows.filter((r) => {
    const v = r[op.column];
    const inSet = !isEmpty(v) && set.has(String(v));
    return op.negate ? !inSet : inSet;
  });
  return { columns: table.columns, rows };
}

function applyBetween(table: InternalTable, op: BetweenOp): InternalTable | string {
  if (!table.columns.includes(op.column)) return `between: column "${op.column}" not found`;
  const rows = table.rows.filter((r) => {
    const v = r[op.column];
    if (isEmpty(v)) return false;
    const n = coerceToNumber(v);
    return Number.isFinite(n) && n >= op.lower && n <= op.upper;
  });
  return { columns: table.columns, rows };
}

function applyTopN(table: InternalTable, op: TopNOp): InternalTable | string {
  if (!table.columns.includes(op.column)) return `topn: column "${op.column}" not found`;
  const withNum = table.rows
    .map((r) => ({ r, n: isEmpty(r[op.column]) ? NaN : coerceToNumber(r[op.column]) }))
    .filter((x) => Number.isFinite(x.n));
  withNum.sort((a, b) => (op.which === "largest" ? b.n - a.n : a.n - b.n));
  const rows = withNum.slice(0, Math.max(0, op.n)).map((x) => x.r);
  return { columns: table.columns, rows };
}

/** A small seeded LCG so a seeded sample is reproducible in the JS engine. */
function seededRandom(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function applySample(table: InternalTable, op: SampleOp): InternalTable | string {
  const total = table.rows.length;
  let count: number;
  if (op.mode === "fraction") {
    const frac = Math.max(0, Math.min(1, op.fraction ?? 0));
    count = Math.round(total * frac);
  } else {
    count = Math.min(total, Math.max(0, op.n ?? 0));
  }
  const rand = op.seed !== undefined ? seededRandom(op.seed) : Math.random;
  // Fisher-Yates over the index list, take the first `count`.
  const idx = table.rows.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const keep = idx.slice(0, count).sort((a, b) => a - b);
  return { columns: table.columns, rows: keep.map((i) => table.rows[i]) };
}

function applyValueCounts(table: InternalTable, op: ValueCountsOp): InternalTable | string {
  if (!table.columns.includes(op.column)) return `value_counts: column "${op.column}" not found`;
  const counts = new Map<string, number>();
  for (const r of table.rows) {
    const v = r[op.column];
    if (isEmpty(v)) continue;
    const key = String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return {
    columns: ["value", "count"],
    rows: entries.map((e) => ({ value: e[0], count: e[1] })),
  };
}

function applyDescribe(table: InternalTable, op: DescribeOp): InternalTable | string {
  const cols =
    op.columns && op.columns.length > 0
      ? op.columns
      : table.columns.filter((c) => numericColumn(table, c).length > 0);
  for (const c of cols) {
    if (!table.columns.includes(c)) return `describe: column "${c}" not found`;
  }
  const stats = ["count", "mean", "std", "min", "25%", "50%", "75%", "max"];
  const rows = stats.map((stat) => {
    const row: Record<string, CellValue> = { statistic: stat };
    for (const c of cols) {
      const nums = numericColumn(table, c);
      const sorted = [...nums].sort((a, b) => a - b);
      let v: CellValue = null;
      if (nums.length > 0) {
        switch (stat) {
          case "count":
            v = nums.length;
            break;
          case "mean":
            v = nums.reduce((a, b) => a + b, 0) / nums.length;
            break;
          case "std":
            v = sampleSd(nums);
            break;
          case "min":
            v = sorted[0];
            break;
          case "25%":
            v = quantile(sorted, 0.25);
            break;
          case "50%":
            v = quantile(sorted, 0.5);
            break;
          case "75%":
            v = quantile(sorted, 0.75);
            break;
          case "max":
            v = sorted[sorted.length - 1];
            break;
        }
      }
      row[c] = v;
    }
    return row;
  });
  return { columns: ["statistic", ...cols], rows };
}

function applyCrosstab(table: InternalTable, op: CrosstabOp): InternalTable | string {
  if (!table.columns.includes(op.row)) return `crosstab: column "${op.row}" not found`;
  if (!table.columns.includes(op.column)) return `crosstab: column "${op.column}" not found`;
  const rowVals: string[] = [];
  const colVals: string[] = [];
  const counts = new Map<string, number>();
  for (const r of table.rows) {
    const rv = r[op.row];
    const cv = r[op.column];
    if (isEmpty(rv) || isEmpty(cv)) continue;
    const rs = String(rv);
    const cs = String(cv);
    if (!rowVals.includes(rs)) rowVals.push(rs);
    if (!colVals.includes(cs)) colVals.push(cs);
    const key = `${rs} ${cs}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rows = rowVals.map((rs) => {
    const row: Record<string, CellValue> = { [op.row]: rs };
    for (const cs of colVals) row[cs] = counts.get(`${rs} ${cs}`) ?? 0;
    return row;
  });
  return { columns: [op.row, ...colVals], rows };
}

function applyPivotTable(table: InternalTable, op: PivotTableOp): InternalTable | string {
  for (const c of [op.index, op.columns, op.value]) {
    if (!table.columns.includes(c)) return `pivot_table: column "${c}" not found`;
  }
  const indexVals: string[] = [];
  const colVals: string[] = [];
  const buckets = new Map<string, number[]>();
  for (const r of table.rows) {
    const iv = r[op.index];
    const cv = r[op.columns];
    if (isEmpty(iv) || isEmpty(cv)) continue;
    const is = String(iv);
    const cs = String(cv);
    if (!indexVals.includes(is)) indexVals.push(is);
    if (!colVals.includes(cs)) colVals.push(cs);
    const key = `${is} ${cs}`;
    if (!buckets.has(key)) buckets.set(key, []);
    const n = coerceToNumber(r[op.value]);
    if (Number.isFinite(n)) buckets.get(key)!.push(n);
  }
  const aggregate = (vals: number[]): CellValue => {
    if (vals.length === 0) return null;
    switch (op.agg) {
      case "sum":
        return vals.reduce((a, b) => a + b, 0);
      case "count":
        return vals.length;
      case "min":
        return Math.min(...vals);
      case "max":
        return Math.max(...vals);
      case "mean":
      default:
        return vals.reduce((a, b) => a + b, 0) / vals.length;
    }
  };
  const rows = indexVals.map((is) => {
    const row: Record<string, CellValue> = { [op.index]: is };
    for (const cs of colVals) row[cs] = aggregate(buckets.get(`${is} ${cs}`) ?? []);
    return row;
  });
  return { columns: [op.index, ...colVals], rows };
}

// ---------------------------------------------------------------------------
// Pipeline executor
// ---------------------------------------------------------------------------

/**
 * Execute a TransformPipeline over a primary DataHubDocContent. Returns a
 * new DataHubDocContent on success, or an error string on any failure.
 *
 * When the final step is a folded column transform whose input still carried the
 * original role-aware content (a pipeline made only of column transforms, the
 * legacy single-op shape), the result body (columns / rows / table_type) is taken
 * from that role-aware content so it is byte-identical to calling the standalone
 * transforms.ts function. Otherwise (any relational op ran, so roles were lost)
 * the result is the flattened generic role-"y" table_type "column" table. Either
 * way the result name follows the engine contract and analyses/plots are empty.
 */
export function executePipeline(
  primary: DataHubDocContent,
  pipeline: TransformPipeline,
  sources: Map<string, DataHubDocContent>,
): { content: DataHubDocContent } | { error: string } {
  let table = contentToInternal(primary);

  for (let i = 0; i < pipeline.ops.length; i++) {
    const op = pipeline.ops[i];
    const result = executeOp(table, op, sources, i);
    if (typeof result === "string") {
      return { error: `op[${i}] (${op.kind}): ${result}` };
    }
    table = result;
  }

  const name = primary.meta.name + " (transformed)";

  // A role-aware content survives only when every op was a folded column
  // transform (relational ops drop it). In that case take its columns/rows/
  // table_type verbatim so the engine output equals the standalone transforms.ts
  // call. The meta id/name still follow the engine contract.
  if (table.content) {
    const body = table.content;
    return {
      content: {
        meta: {
          id: `transform-result-${Date.now()}`,
          name,
          project_ids: [],
          folder_path: null,
          table_type: body.meta.table_type,
          created_at: new Date().toISOString(),
        },
        columns: body.columns.map((c) => ({ ...c })),
        rows: body.rows.map((r) => ({ id: r.id, cells: { ...r.cells } })),
        analyses: [],
        plots: [],
      },
    };
  }

  return { content: internalToContent(table, name) };
}

function executeOp(
  table: InternalTable,
  op: TransformOp,
  sources: Map<string, DataHubDocContent>,
  idx: number,
): InternalTable | string {
  switch (op.kind) {
    case "join": {
      const rightContent = sources.get(op.rightRef);
      if (!rightContent)
        return `join: source table "${op.rightRef}" not found in sources map`;
      const right = contentToInternal(rightContent);
      return applyJoin(table, right, op);
    }
    case "filter":
      return applyFilter(table, op);
    case "groupby":
      return applyGroupBy(table, op);
    case "select":
      return applySelect(table, op);
    case "drop":
      return applyDrop(table, op);
    case "rename":
      return applyRename(table, op);
    case "sort":
      return applySort(table, op);
    case "dedupe":
      return applyDedupe(table, op);
    case "union": {
      const otherContent = sources.get(op.otherRef);
      if (!otherContent)
        return `union: source table "${op.otherRef}" not found in sources map`;
      const other = contentToInternal(otherContent);
      return applyUnion(table, other, op);
    }
    case "derive":
      return applyDerive(table, op);
    case "pivot":
      return applyPivot(table, op);
    case "unpivot":
      return applyUnpivot(table, op);
    case "column-transform":
      return applyColumnTransform(table, (c) => transformValues(c, op.params));
    case "normalize":
      return applyColumnTransform(table, (c) => normalize(c, op.params));
    case "transpose":
      return applyColumnTransform(table, (c) => transpose(c, op.params));
    case "remove-baseline":
      return applyColumnTransform(table, (c) => removeBaseline(c, op.params));
    case "fraction-of-total":
      return applyColumnTransform(table, (c) => fractionOfTotal(c, op.params));
    case "fillna":
      return applyFillNa(table, op);
    case "interpolate":
      return applyInterpolate(table, op);
    case "dropna":
      return applyDropNa(table, op);
    case "set-where":
      return applySetWhere(table, op);
    case "str-op":
      return applyStrOp(table, op);
    case "astype":
      return applyAsType(table, op);
    case "to-date":
      return applyToDate(table, op);
    case "date-parts":
      return applyDateParts(table, op);
    case "clip":
      return applyClip(table, op);
    case "round":
      return applyRound(table, op);
    case "bin":
      return applyBin(table, op);
    case "map":
      return applyMap(table, op);
    case "rank":
      return applyRank(table, op);
    case "cumulative":
      return applyCumulative(table, op);
    case "lag":
      return applyLag(table, op);
    case "rolling":
      return applyRolling(table, op);
    case "isin":
      return applyIsIn(table, op);
    case "between":
      return applyBetween(table, op);
    case "topn":
      return applyTopN(table, op);
    case "sample":
      return applySample(table, op);
    case "value_counts":
      return applyValueCounts(table, op);
    case "describe":
      return applyDescribe(table, op);
    case "crosstab":
      return applyCrosstab(table, op);
    case "pivot_table":
      return applyPivotTable(table, op);
    default: {
      // TypeScript exhaustiveness guard. If a new op kind is added to
      // TransformOp without a case here, this will be a type error.
      const _exhaustive: never = op;
      return `unknown op kind "${(op as TransformOp).kind}"`;
    }
  }
}

/**
 * datahub/transforms.ts
 *
 * The Prism-style Data Processing transform engine. Each TransformKind has one
 * PURE function (sourceContent, params) -> derivedContent. A derived table's
 * columns/rows are produced by running the matching function against the SOURCE
 * table's current content (see DerivedFrom / the recompute path in
 * datahub/derived.ts). These functions never read disk, never mutate the source,
 * and are deterministic, so the same source plus the same params always produce
 * the same derived content.
 *
 * Conventions shared by every transform:
 *   - Only DATA columns (role "y", and for an XY table the "x" column is carried
 *     through unchanged as a label axis) are transformed; structural metadata
 *     (column ids, names, dataType) is preserved so plots/analyses built on the
 *     derived table keep referencing stable column ids.
 *   - A cell that is not a finite number passes through as null. We never throw on
 *     a bad cell; a domain error (log of a non-positive value, divide by zero)
 *     yields null for that cell so one bad value cannot crash a whole table.
 *   - "number" here means a finite JS number. NaN / Infinity / non-numeric cells
 *     are treated as missing (null), matching how Prism skips blank/invalid cells.
 *
 * Scope note: transforms are ARITHMETIC, not statistics, so the scipy validation
 * gate does not apply. Correctness is covered by transforms.test.ts with small
 * worked examples (including the domain guards and the percent-vs-fraction
 * options).
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import type {
  CellValue,
  ColumnDef,
  DataHubDocContent,
  RowRecord,
  TransformKind,
} from "@/lib/datahub/model/types";

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

/** A finite number, or null for any missing / non-numeric / non-finite cell. */
function num(v: CellValue): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

/** Wrap a computed number, demoting a non-finite result (NaN / Infinity) to null. */
function finiteOrNull(v: number): CellValue {
  return Number.isFinite(v) ? v : null;
}

/** Which columns hold transformable data. Y columns always; for XY the X column
 *  is a label axis that is carried through unchanged (not transformed). */
function isDataColumn(col: ColumnDef): boolean {
  return col.role === "y" || col.role === "subcolumn";
}

/** Read one column's cells down the rows as raw CellValues, row order preserved. */
function columnCells(content: DataHubDocContent, columnId: string): CellValue[] {
  return content.rows.map((r) =>
    Object.prototype.hasOwnProperty.call(r.cells, columnId)
      ? r.cells[columnId]
      : null,
  );
}

/** The finite numbers of a column (drops nulls), used by column-wide reductions. */
function finiteColumnValues(
  content: DataHubDocContent,
  columnId: string,
): number[] {
  const out: number[] = [];
  for (const c of columnCells(content, columnId)) {
    const n = num(c);
    if (n !== null) out.push(n);
  }
  return out;
}

/** Sum of an array, or 0 for an empty array. */
function sum(values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

/**
 * Map every data cell of the content through a per-cell function, preserving the
 * column/row structure (ids, names, ordering) and passing non-data columns and
 * null cells through unchanged. The mapper receives the finite number; a null /
 * non-numeric cell short-circuits to null and the mapper is not called.
 */
function mapDataCells(
  content: DataHubDocContent,
  fn: (value: number, columnId: string, rowIndex: number) => CellValue,
): DataHubDocContent {
  const dataColumnIds = new Set(
    content.columns.filter(isDataColumn).map((c) => c.id),
  );
  const rows: RowRecord[] = content.rows.map((row, rowIndex) => {
    const cells: Record<string, CellValue> = {};
    for (const col of content.columns) {
      const raw = Object.prototype.hasOwnProperty.call(row.cells, col.id)
        ? row.cells[col.id]
        : null;
      if (!dataColumnIds.has(col.id)) {
        cells[col.id] = raw;
        continue;
      }
      const n = num(raw);
      cells[col.id] = n === null ? null : fn(n, col.id, rowIndex);
    }
    return { id: row.id, cells };
  });
  return { ...content, columns: content.columns.map((c) => ({ ...c })), rows };
}

// ---------------------------------------------------------------------------
// transform: apply a function to each Y value (Prism "Transform")
// ---------------------------------------------------------------------------

/**
 * The per-cell function options. log10 / ln / log2 take the log in that base and
 * yield null for a value <= 0 (a domain error, not a crash). sqrt yields null for
 * a negative value. reciprocal (1/Y) yields null for 0. "linear" applies the
 * generic Y*k + b (k defaults to 1, b defaults to 0), so it covers "Y times k"
 * and "Y plus k" as the same affine form.
 */
export type TransformFunction =
  | "log10"
  | "ln"
  | "log2"
  | "sqrt"
  | "square"
  | "reciprocal"
  | "linear";

export interface TransformParams {
  func: TransformFunction;
  /** Multiplier for the "linear" function (Y*k + b). Default 1. */
  k?: number;
  /** Offset for the "linear" function (Y*k + b). Default 0. */
  b?: number;
}

function applyFunction(value: number, params: TransformParams): CellValue {
  switch (params.func) {
    case "log10":
      return value > 0 ? finiteOrNull(Math.log10(value)) : null;
    case "ln":
      return value > 0 ? finiteOrNull(Math.log(value)) : null;
    case "log2":
      return value > 0 ? finiteOrNull(Math.log2(value)) : null;
    case "sqrt":
      return value >= 0 ? finiteOrNull(Math.sqrt(value)) : null;
    case "square":
      return finiteOrNull(value * value);
    case "reciprocal":
      return value !== 0 ? finiteOrNull(1 / value) : null;
    case "linear": {
      const k = typeof params.k === "number" ? params.k : 1;
      const b = typeof params.b === "number" ? params.b : 0;
      return finiteOrNull(value * k + b);
    }
    default:
      return null;
  }
}

/**
 * transform: apply a function to every Y/data value. Domain errors (log of a
 * non-positive value, sqrt of a negative, reciprocal of 0) yield a null cell
 * rather than throwing. The table shape is unchanged.
 */
export function transformValues(
  content: DataHubDocContent,
  params: TransformParams,
): DataHubDocContent {
  return mapDataCells(content, (value) => applyFunction(value, params));
}

// ---------------------------------------------------------------------------
// normalize: express each value relative to a per-column baseline
// ---------------------------------------------------------------------------

/**
 * The baseline each value is expressed against, per column.
 *   - "max"       percent of the column max (the max becomes 100).
 *   - "sum"       percent of the column sum (the column then sums to 100).
 *   - "first"     percent of the column's first finite value (it becomes 100).
 *   - "minMax"    scaled 0..100 between the column min and max (Prism's
 *                 "smallest value 0%, largest 100%").
 * Default is "max" (the Prism default for Normalize).
 */
export type NormalizeMode = "max" | "sum" | "first" | "minMax";

export interface NormalizeParams {
  mode?: NormalizeMode;
}

/**
 * normalize: rescale each column so its values read as a percent of a baseline.
 * The result is in PERCENT (0..100 for max/minMax, summing to 100 for sum) to
 * match Prism's Normalize output. A degenerate baseline (a zero max/sum, or a
 * flat column where min === max) yields null for that column's cells rather than
 * dividing by zero.
 */
export function normalize(
  content: DataHubDocContent,
  params: NormalizeParams = {},
): DataHubDocContent {
  const mode: NormalizeMode = params.mode ?? "max";
  // Precompute the per-column baseline so each cell divides by a column constant.
  const baseline = new Map<string, { kind: NormalizeMode; a: number; b: number }>();
  for (const col of content.columns) {
    if (col.role !== "y" && col.role !== "subcolumn") continue;
    const values = finiteColumnValues(content, col.id);
    if (mode === "max") {
      baseline.set(col.id, { kind: mode, a: values.length ? Math.max(...values) : 0, b: 0 });
    } else if (mode === "sum") {
      baseline.set(col.id, { kind: mode, a: sum(values), b: 0 });
    } else if (mode === "first") {
      const first = columnFirstFinite(content, col.id);
      baseline.set(col.id, { kind: mode, a: first ?? 0, b: 0 });
    } else {
      const min = values.length ? Math.min(...values) : 0;
      const max = values.length ? Math.max(...values) : 0;
      baseline.set(col.id, { kind: mode, a: min, b: max });
    }
  }
  return mapDataCells(content, (value, columnId) => {
    const base = baseline.get(columnId);
    if (!base) return null;
    if (base.kind === "minMax") {
      const span = base.b - base.a;
      if (span === 0) return null;
      return finiteOrNull(((value - base.a) / span) * 100);
    }
    if (base.a === 0) return null;
    return finiteOrNull((value / base.a) * 100);
  });
}

/** The first finite value down a column, or null when the column has none. */
function columnFirstFinite(
  content: DataHubDocContent,
  columnId: string,
): number | null {
  for (const c of columnCells(content, columnId)) {
    const n = num(c);
    if (n !== null) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// transpose: swap rows and columns (Prism "Transpose X and Y")
// ---------------------------------------------------------------------------

export interface TransposeParams {
  /**
   * The column whose cell values become the NEW column headers (the new table's
   * column names). When omitted, the new columns are named generically by their
   * source row index. This is Prism's "use this column as the new title row".
   */
  headerColumnId?: string;
}

/**
 * transpose: swap the table so each old row becomes a new column and each old
 * data column becomes a new row. The first new column is a label column holding
 * the OLD column names (so the old headers survive as row labels). The remaining
 * new columns are one per old row.
 *
 * The result is always a Column-style table (role "y" data columns plus a single
 * leading "x" label column), which is a valid archetype for the derived table
 * regardless of the source archetype.
 */
export function transpose(
  content: DataHubDocContent,
  params: TransposeParams = {},
): DataHubDocContent {
  // Old data columns become new rows; the label column becomes the first cell of
  // each new row. We keep all columns (including any X column) as transposed rows
  // so no source data is silently dropped.
  const oldColumns = content.columns;
  const oldRows = content.rows;

  // New column 0 is the label axis (old column names down the rows).
  const labelColId = "t_label";
  const newColumns: ColumnDef[] = [
    { id: labelColId, name: "", role: "x", dataType: "text" },
  ];

  // One new column per old row. Its header is the old row's value in
  // headerColumnId when given and present, else a generic 1-based label.
  const headerColId = params.headerColumnId;
  for (let r = 0; r < oldRows.length; r++) {
    let header = `Row ${r + 1}`;
    if (headerColId) {
      const raw = oldRows[r].cells[headerColId];
      if (typeof raw === "string" && raw !== "") header = raw;
      else if (typeof raw === "number") header = String(raw);
    }
    newColumns.push({
      id: `t_col_${r}`,
      name: header,
      role: "y",
      dataType: "number",
    });
  }

  // One new row per old column (skipping the column used as the header source, so
  // it is not duplicated as both headers and a data row).
  const sourceColumns = headerColId
    ? oldColumns.filter((c) => c.id !== headerColId)
    : oldColumns;
  const newRows: RowRecord[] = sourceColumns.map((col, i) => {
    const cells: Record<string, CellValue> = { [labelColId]: col.name ?? "" };
    for (let r = 0; r < oldRows.length; r++) {
      const raw = Object.prototype.hasOwnProperty.call(oldRows[r].cells, col.id)
        ? oldRows[r].cells[col.id]
        : null;
      cells[`t_col_${r}`] = raw ?? null;
    }
    return { id: `t_row_${i}`, cells };
  });

  return {
    ...content,
    meta: { ...content.meta, table_type: "column" },
    columns: newColumns,
    rows: newRows,
  };
}

// ---------------------------------------------------------------------------
// removeBaseline: subtract a baseline from each value
// ---------------------------------------------------------------------------

/**
 * Where the subtracted baseline comes from.
 *   - "column"  subtract the value in baselineColumnId from every OTHER data
 *               column, row by row (the Prism "subtract a baseline column"). The
 *               baseline column itself is dropped from the result.
 *   - "firstRow" subtract each column's own first-row value from that column.
 *   - "value"   subtract a fixed constant from every data cell.
 * Default is "column" when a baselineColumnId is given, else "firstRow".
 */
export type RemoveBaselineMode = "column" | "firstRow" | "value";

export interface RemoveBaselineParams {
  mode?: RemoveBaselineMode;
  /** The baseline column id (required for mode "column"). */
  baselineColumnId?: string;
  /** The fixed constant to subtract (mode "value"). Default 0. */
  value?: number;
}

/**
 * removeBaseline: subtract a baseline from each data value. Cells where either
 * operand is missing yield null. For mode "column" the chosen baseline column is
 * removed from the output (its job was to define the baseline), and a row with a
 * missing baseline value yields null across that row's data cells.
 */
export function removeBaseline(
  content: DataHubDocContent,
  params: RemoveBaselineParams = {},
): DataHubDocContent {
  const mode: RemoveBaselineMode =
    params.mode ?? (params.baselineColumnId ? "column" : "firstRow");

  if (mode === "value") {
    const k = typeof params.value === "number" ? params.value : 0;
    return mapDataCells(content, (value) => finiteOrNull(value - k));
  }

  if (mode === "firstRow") {
    const firstByColumn = new Map<string, number | null>();
    for (const col of content.columns) {
      if (col.role !== "y" && col.role !== "subcolumn") continue;
      const raw = content.rows.length ? content.rows[0].cells[col.id] : null;
      firstByColumn.set(col.id, num(raw ?? null));
    }
    return mapDataCells(content, (value, columnId) => {
      const base = firstByColumn.get(columnId);
      if (base === null || base === undefined) return null;
      return finiteOrNull(value - base);
    });
  }

  // mode "column": subtract the baseline column's per-row value from the others,
  // then drop the baseline column from the result.
  const baseId = params.baselineColumnId;
  if (!baseId) {
    // No column chosen, nothing to subtract; return the content unchanged in
    // shape (a deliberate no-op rather than a crash).
    return { ...content, columns: content.columns.map((c) => ({ ...c })) };
  }
  const baselinePerRow = new Map<string, number | null>();
  for (const row of content.rows) {
    baselinePerRow.set(row.id, num(row.cells[baseId] ?? null));
  }
  const keptColumns = content.columns.filter((c) => c.id !== baseId);
  const dataIds = new Set(keptColumns.filter(isDataColumn).map((c) => c.id));
  const rows: RowRecord[] = content.rows.map((row) => {
    const cells: Record<string, CellValue> = {};
    const base = baselinePerRow.get(row.id) ?? null;
    for (const col of keptColumns) {
      const raw = Object.prototype.hasOwnProperty.call(row.cells, col.id)
        ? row.cells[col.id]
        : null;
      if (!dataIds.has(col.id)) {
        cells[col.id] = raw;
        continue;
      }
      const n = num(raw);
      cells[col.id] = n === null || base === null ? null : finiteOrNull(n - base);
    }
    return { id: row.id, cells };
  });
  return { ...content, columns: keptColumns.map((c) => ({ ...c })), rows };
}

// ---------------------------------------------------------------------------
// fractionOfTotal: each value as a fraction / percent of a total
// ---------------------------------------------------------------------------

/**
 * Which total each value is divided by.
 *   - "column" the value's own column total (the column then sums to 1 / 100%).
 *   - "row"    the value's own row total across data columns.
 *   - "grand"  the grand total of every data cell.
 * Default "column" (the Prism default for Fraction of total).
 */
export type FractionScope = "column" | "row" | "grand";

export interface FractionOfTotalParams {
  scope?: FractionScope;
  /** Output as a percent (value/total * 100) instead of a 0..1 fraction. */
  asPercent?: boolean;
}

/**
 * fractionOfTotal: express each data value as a fraction (or percent) of its
 * column total, row total, or the grand total. A zero total yields null for the
 * affected cells rather than dividing by zero.
 */
export function fractionOfTotal(
  content: DataHubDocContent,
  params: FractionOfTotalParams = {},
): DataHubDocContent {
  const scope: FractionScope = params.scope ?? "column";
  const factor = params.asPercent ? 100 : 1;
  const dataColumns = content.columns.filter(isDataColumn);
  const dataIds = dataColumns.map((c) => c.id);

  // Column totals (used by "column" scope).
  const columnTotal = new Map<string, number>();
  for (const id of dataIds) columnTotal.set(id, sum(finiteColumnValues(content, id)));

  // Grand total (used by "grand" scope).
  let grand = 0;
  for (const id of dataIds) grand += columnTotal.get(id) ?? 0;

  // Row totals (used by "row" scope), keyed by row id.
  const rowTotal = new Map<string, number>();
  for (const row of content.rows) {
    let t = 0;
    for (const id of dataIds) {
      const n = num(row.cells[id] ?? null);
      if (n !== null) t += n;
    }
    rowTotal.set(row.id, t);
  }

  return mapDataCells(content, (value, columnId, rowIndex) => {
    let total = 0;
    if (scope === "column") total = columnTotal.get(columnId) ?? 0;
    else if (scope === "grand") total = grand;
    else total = rowTotal.get(content.rows[rowIndex].id) ?? 0;
    if (total === 0) return null;
    return finiteOrNull((value / total) * factor);
  });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Run a transform by kind against a source content, returning the derived
 * content. This is the single entry point the recompute path calls; it routes to
 * the matching pure function and casts the stored params (Record<string, unknown>)
 * to the function's param shape. An unknown kind returns the source unchanged in
 * structure (a defensive no-op rather than a throw), so a future / corrupt kind
 * never crashes a load.
 */
export function runTransform(
  kind: TransformKind,
  source: DataHubDocContent,
  params: Record<string, unknown>,
): DataHubDocContent {
  // The stored params are an open record; cast through unknown to the matching
  // function's param shape (a transform may declare a required field that the
  // open record does not structurally guarantee).
  switch (kind) {
    case "transform":
      return transformValues(source, params as unknown as TransformParams);
    case "normalize":
      return normalize(source, params as unknown as NormalizeParams);
    case "transpose":
      return transpose(source, params as unknown as TransposeParams);
    case "removeBaseline":
      return removeBaseline(source, params as unknown as RemoveBaselineParams);
    case "fractionOfTotal":
      return fractionOfTotal(source, params as unknown as FractionOfTotalParams);
    default:
      return { ...source, columns: source.columns.map((c) => ({ ...c })) };
  }
}

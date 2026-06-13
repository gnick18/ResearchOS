/**
 * datahub/transform/sql-codegen.ts
 *
 * Compile a transform recipe (TransformOp[]) into a single DuckDB SQL query over
 * a named source relation. This is the SQL twin of codegen.ts (the pandas
 * generator), so the transform builder offers show-the-code in BOTH languages and
 * the large-dataset lane can run the same recipe as one engine query (spec
 * section 6). The pandas path stays the editable lane's engine; this path is the
 * DuckDB execution + SQL show-the-code added beside it.
 *
 * THE SHAPE. Each op is a SELECT over the previous step. recipeToSql threads them
 * as a CTE chain (step0 = the source, step1 = SELECT ... FROM step0, ...) and
 * returns the final SELECT, so dataset-view.ts can wrap it as a sub-query and page
 * with LIMIT / OFFSET against the on-disk source. Nothing is materialized; the
 * recipe is the stored query (spec section 9).
 *
 * COLUMN NAMES are the join between the recipe and the data, exactly as in the
 * pandas generator. Names come from a user's imported header, so every identifier
 * is double-quote-escaped. Values in filter / set-where predicates are emitted as
 * SQL literals (numbers bare, strings single-quote-escaped); a recipe is authored
 * in the builder UI, not from untrusted text, but we escape regardless.
 *
 * DERIVE FORMULA. translateDeriveFormulaToSql is the SQL sibling of
 * translateDeriveFormula. The shared expr-eval-fork language's plain-arithmetic
 * subset (identifiers, numbers, + - * / ^, parens) maps directly to a SQL scalar
 * expression, with ^ translated to DuckDB's ** power operator. Anything richer
 * (a function call, comparison, conditional) is beyond a one-line SQL twin, so we
 * emit NULL with an inline note rather than guess, mirroring the pandas fallback.
 *
 * SCOPE (Phase 2a). Mirrors the ops the JS engine already runs (codegen.ts):
 * filter, select, drop, rename, sort, dedupe, union, join, derive, groupby,
 * pivot, unpivot, and the folded column transforms. The Phase 2b gap ops (string
 * accessors, fillna, conditional-set, cast, bin, ...) are NOT here yet.
 *
 * Pure string building. No engine call, no I/O. Unit-tested in __tests__.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import type {
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
  AggSpec,
} from "./pipeline";
import type {
  TransformParams,
  NormalizeParams,
  RemoveBaselineParams,
  FractionOfTotalParams,
} from "@/lib/datahub/transforms";

// ---------------------------------------------------------------------------
// SQL literal + identifier helpers
// ---------------------------------------------------------------------------

/** Quote a SQL identifier (column / relation name) by doubling embedded double
 *  quotes, the standard SQL escape. */
export function sqlIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** A single-quoted SQL string literal (doubling embedded single quotes). */
function sqlStr(s: string): string {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/** A numeric literal, finite-guarded (NULL for a non-finite value). */
function sqlNum(v: number): string {
  if (!Number.isFinite(v)) return "NULL";
  return String(v);
}

/** A scalar value literal for a filter / set comparison. A number stays bare; a
 *  string is quoted. undefined becomes NULL. */
function sqlScalar(value: string | number | undefined): string {
  if (value === undefined) return "NULL";
  if (typeof value === "number") return sqlNum(value);
  return sqlStr(value);
}

// ---------------------------------------------------------------------------
// Filter node -> a SQL boolean predicate
// ---------------------------------------------------------------------------

/** One leaf condition as a SQL boolean predicate. Numeric inequalities cast the
 *  column to DOUBLE (TRY_CAST, NULL on a non-numeric cell) so a text-typed import
 *  column still compares numerically, matching the pandas pd.to_numeric path. */
function conditionSql(cond: FilterCondition): string {
  const ref = sqlIdent(cond.column);
  const numRef = `TRY_CAST(${ref} AS DOUBLE)`;
  switch (cond.op) {
    case "eq":
      return `${ref} = ${sqlScalar(cond.value as string | number)}`;
    case "ne":
      return `${ref} <> ${sqlScalar(cond.value as string | number)}`;
    case "lt":
      return `${numRef} < ${sqlScalar(cond.value as number)}`;
    case "le":
      return `${numRef} <= ${sqlScalar(cond.value as number)}`;
    case "gt":
      return `${numRef} > ${sqlScalar(cond.value as number)}`;
    case "ge":
      return `${numRef} >= ${sqlScalar(cond.value as number)}`;
    case "contains":
      return `${ref} LIKE ${sqlStr("%" + String(cond.value ?? "") + "%")}`;
    case "regex":
      return `regexp_matches(CAST(${ref} AS VARCHAR), ${sqlStr(String(cond.value ?? ""))})`;
    case "in": {
      const set = Array.isArray(cond.value) ? cond.value : [];
      if (set.length === 0) return "FALSE";
      const lits = set.map((v) =>
        typeof v === "number" ? sqlNum(v) : sqlStr(String(v)),
      );
      return `${ref} IN (${lits.join(", ")})`;
    }
    case "is_empty":
      return `(${ref} IS NULL OR CAST(${ref} AS VARCHAR) = '')`;
    default:
      return "TRUE";
  }
}

/** A FilterNode tree as a SQL boolean predicate. */
function predicateSql(node: FilterNode): string {
  switch (node.type) {
    case "condition":
      return `(${conditionSql(node.condition)})`;
    case "not":
      return `(NOT ${predicateSql(node.child)})`;
    case "and":
      return node.children.length
        ? `(${node.children.map(predicateSql).join(" AND ")})`
        : "TRUE";
    case "or":
      return node.children.length
        ? `(${node.children.map(predicateSql).join(" OR ")})`
        : "FALSE";
    default:
      return "TRUE";
  }
}

// ---------------------------------------------------------------------------
// derive: translate the calc-builder formula to a SQL scalar expression
// ---------------------------------------------------------------------------

/**
 * Translate a derive formula (the calc-builder expr-eval language) to a DuckDB
 * scalar SQL expression where it is plain arithmetic, else NULL with a note. This
 * is the SQL sibling of translateDeriveFormula (codegen.ts). It uses the SAME
 * plain-arithmetic detection so the two generators agree on which formulas they
 * can express directly. expr-eval's `^` is exponentiation, translated to DuckDB's
 * `**` power operator. Column identifiers are replaced with quoted references,
 * longest names first so a name that is a prefix of another is not partially
 * matched.
 */
export function translateDeriveFormulaToSql(
  op: DeriveOp,
  columnNames: string[],
): { expr: string; plain: boolean } {
  const formula = op.formula ?? "";

  // Plain arithmetic only: identifiers, numbers, ws, parens, + - * / ^.
  const plainArith = /^[\sA-Za-z0-9_.()+\-*/^]*$/.test(formula);
  if (plainArith && formula.trim() !== "") {
    const sorted = [...columnNames].sort((a, b) => b.length - a.length);
    let expr = formula.replace(/\^/g, "**");
    for (const name of sorted) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
      const re = new RegExp(
        `\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "g",
      );
      expr = expr.replace(re, sqlIdent(name));
    }
    // Cast the column references to DOUBLE so a text-typed import column does
    // arithmetic rather than concatenating, matching the engine's numeric coerce.
    // We wrap each quoted ident in TRY_CAST in a second pass.
    expr = expr.replace(/"((?:[^"]|"")+)"/g, (_m, inner) => {
      const ident = `"${inner}"`;
      return `TRY_CAST(${ident} AS DOUBLE)`;
    });
    return { expr, plain: true };
  }

  // Beyond plain arithmetic: emit NULL with an inline note, mirroring the pandas
  // generator's placeholder. The builder marks the step as needing adaptation.
  return {
    expr: `NULL /* ${formula.replace(/\*\//g, "* /")} : adapt, not plain arithmetic */`,
    plain: false,
  };
}

// ---------------------------------------------------------------------------
// Aggregation spec -> a SQL aggregate expression
// ---------------------------------------------------------------------------

/** One named aggregation as a SQL `<agg>(<col>) AS <out>` select item. Numeric
 *  aggregates cast the column to DOUBLE so a text-typed numeric column still
 *  aggregates, matching the engine. */
function aggSql(agg: AggSpec): string {
  const col = sqlIdent(agg.column);
  const num = `TRY_CAST(${col} AS DOUBLE)`;
  const out = sqlIdent(agg.outputName ?? `${agg.column}_${agg.func}`);
  let expr: string;
  switch (agg.func) {
    case "mean":
      expr = `avg(${num})`;
      break;
    case "sum":
      expr = `sum(${num})`;
      break;
    case "count":
      expr = `count(${col})`;
      break;
    case "min":
      expr = `min(${num})`;
      break;
    case "max":
      expr = `max(${num})`;
      break;
    case "median":
      expr = `median(${num})`;
      break;
    case "sd":
      // Sample SD (ddof=1) is the engine + pandas default; DuckDB stddev_samp.
      expr = `stddev_samp(${num})`;
      break;
    case "nunique":
      expr = `count(DISTINCT ${col})`;
      break;
    case "concat": {
      const sep = agg.separator ?? ", ";
      expr = `string_agg(CAST(${col} AS VARCHAR), ${sqlStr(sep)})`;
      break;
    }
    case "first":
    default:
      expr = `first(${col})`;
      break;
  }
  return `${expr} AS ${out}`;
}

// ---------------------------------------------------------------------------
// One op -> the SELECT body over a previous relation
// ---------------------------------------------------------------------------

/**
 * Context an op may need beyond the op itself: the relation name to read from
 * (the previous step), the relation holding a referenced right / other source
 * (join / union), and the current column-name list (derive translation, and the
 * `*`-expansion for ops that add a column).
 */
export interface SqlCodegenContext {
  /** The relation (CTE name or sub-query alias) the op reads from. */
  from: string;
  /** The relation holding the right-hand source for a join. */
  rightRel?: string;
  /** The relation holding the other source for a union. */
  otherRel?: string;
  /** The current column names, used to translate a derive formula and expand `*`. */
  columnNames?: string[];
}

/**
 * Emit the SQL SELECT statement for ONE TransformOp, reading FROM ctx.from. The
 * result is a complete `SELECT ... FROM <from> ...` that the recipe walker wraps
 * as the next CTE. A standalone unit test can pass ctx directly.
 */
export function transformOpToSql(op: TransformOp, ctx: SqlCodegenContext): string {
  const from = ctx.from;
  const cols = ctx.columnNames ?? [];
  switch (op.kind) {
    case "filter":
      return `SELECT * FROM ${from} WHERE ${predicateSql(op.node)}`;

    case "select":
      return `SELECT ${op.columns.map(sqlIdent).join(", ")} FROM ${from}`;

    case "drop": {
      const dropSet = new Set(op.columns);
      const kept = cols.filter((c) => !dropSet.has(c));
      // EXCLUDE keeps it robust when the running column list is unknown.
      if (kept.length === 0 || cols.length === 0) {
        return `SELECT * EXCLUDE (${op.columns.map(sqlIdent).join(", ")}) FROM ${from}`;
      }
      return `SELECT ${kept.map(sqlIdent).join(", ")} FROM ${from}`;
    }

    case "rename": {
      const entries = Object.entries(op.mapping);
      if (cols.length > 0) {
        const items = cols.map((c) =>
          op.mapping[c]
            ? `${sqlIdent(c)} AS ${sqlIdent(op.mapping[c])}`
            : sqlIdent(c),
        );
        return `SELECT ${items.join(", ")} FROM ${from}`;
      }
      // Unknown column list: RENAME keeps the rest with *.
      const renames = entries
        .map(([f, t]) => `${sqlIdent(f)} AS ${sqlIdent(t)}`)
        .join(", ");
      return `SELECT * RENAME (${renames}) FROM ${from}`;
    }

    case "sort": {
      const order = op.by
        .map((k) => {
          const dir = k.direction === "desc" ? "DESC" : "ASC";
          const def = k.direction === "desc" ? "FIRST" : "LAST";
          const nulls = (k.nulls ?? def).toUpperCase() === "FIRST" ? "FIRST" : "LAST";
          return `${sqlIdent(k.column)} ${dir} NULLS ${nulls}`;
        })
        .join(", ");
      return `SELECT * FROM ${from} ORDER BY ${order}`;
    }

    case "dedupe": {
      if (op.subset && op.subset.length > 0) {
        // Keep one row per subset combination. ROW_NUMBER over the subset, keep
        // the first (or last). The order key is the subset itself, deterministic
        // enough for a preview; the engine's first / last is row-order based.
        const part = op.subset.map(sqlIdent).join(", ");
        const ordCol = sqlIdent(op.subset[0]);
        const ord = op.keep === "last" ? `${ordCol} DESC` : `${ordCol} ASC`;
        return (
          `SELECT * EXCLUDE (__dedupe_rn) FROM (` +
          `SELECT *, ROW_NUMBER() OVER (PARTITION BY ${part} ORDER BY ${ord}) AS __dedupe_rn FROM ${from}` +
          `) WHERE __dedupe_rn = 1`
        );
      }
      return `SELECT DISTINCT * FROM ${from}`;
    }

    case "union": {
      const other = ctx.otherRel ?? "__union_other";
      // UNION ALL BY NAME aligns by column name and keeps duplicate rows (pandas
      // concat semantics: stack, no dedupe).
      return `SELECT * FROM ${from} UNION ALL BY NAME SELECT * FROM ${other}`;
    }

    case "join": {
      const right = ctx.rightRel ?? "__join_right";
      const how = (op.how ?? "inner").toUpperCase();
      const joinWord =
        how === "OUTER" ? "FULL OUTER" : how === "INNER" ? "INNER" : how;
      const using = op.on.map(sqlIdent).join(", ");
      // USING merges the key columns, matching merge(on=...). Non-key collisions
      // are left to DuckDB's default disambiguation.
      return `SELECT * FROM ${from} ${joinWord} JOIN ${right} USING (${using})`;
    }

    case "derive": {
      const t = translateDeriveFormulaToSql(op, cols);
      return `SELECT *, (${t.expr}) AS ${sqlIdent(op.outputName)} FROM ${from}`;
    }

    case "groupby": {
      const by = op.by.map(sqlIdent).join(", ");
      const aggs = op.aggregations.map(aggSql).join(", ");
      return `SELECT ${by}${aggs ? ", " + aggs : ""} FROM ${from} GROUP BY ${by}`;
    }

    case "pivot": {
      // DuckDB PIVOT spreads the key column's distinct values into columns,
      // aggregating the value column by mean (matching the engine's pivot_table
      // mean collision policy). index columns become the GROUP BY.
      const idx = op.index.map(sqlIdent).join(", ");
      return (
        `PIVOT ${from} ON ${sqlIdent(op.columns)} ` +
        `USING avg(TRY_CAST(${sqlIdent(op.values)} AS DOUBLE)) ` +
        `GROUP BY ${idx}`
      );
    }

    case "unpivot": {
      // UNPIVOT gathers the value columns into a (name, value) pair. When the
      // value columns are not listed, gather every column not in idVars.
      const idSet = new Set(op.idVars);
      const valueVars =
        op.valueVars && op.valueVars.length > 0
          ? op.valueVars
          : cols.filter((c) => !idSet.has(c));
      const nameCol = sqlIdent(op.varName ?? "variable");
      const valCol = sqlIdent(op.valueName ?? "value");
      const onCols = valueVars.map(sqlIdent).join(", ");
      if (valueVars.length === 0) {
        // Nothing to gather: pass through.
        return `SELECT * FROM ${from}`;
      }
      return (
        `UNPIVOT ${from} ON ${onCols} INTO NAME ${nameCol} VALUE ${valCol}`
      );
    }

    case "column-transform":
      return columnTransformSql(from, op, cols);
    case "normalize":
      return normalizeSql(from, op, cols);
    case "transpose":
      return transposeSql(from, op);
    case "remove-baseline":
      return removeBaselineSql(from, op, cols);
    case "fraction-of-total":
      return fractionOfTotalSql(from, op, cols);

    default: {
      const _exhaustive: never = op;
      void _exhaustive;
      return `SELECT * FROM ${from}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Folded column transforms -> SQL
//
// These operate on the table's NUMERIC data columns. Unlike pandas
// select_dtypes, SQL has no run-time dtype scan in a static query, so we apply
// the per-cell transforms over the columns the recipe walker tells us are numeric
// (passed in columnNames as the running list). When that list is unknown we fall
// back to a pass-through with a note, since a blind `*` cannot know which columns
// are numeric. The aggregate-shaped ones (normalize, fraction-of-total over a
// column / grand total) need a window or a CTE; we emit window-function SQL.
// ---------------------------------------------------------------------------

/** The running numeric columns are not typed here, so the folded transforms
 *  treat EVERY running column as a candidate and TRY_CAST it to DOUBLE (a
 *  non-numeric column yields NULL, which is the honest result of "transform every
 *  numeric value"). Pass-through any column the recipe does not know about. */
function numericCols(cols: string[]): string[] {
  return cols;
}

function columnTransformSql(
  from: string,
  op: ColumnTransformOp,
  cols: string[],
): string {
  if (cols.length === 0) return `SELECT * FROM ${from}`;
  const p: TransformParams = op.params ?? ({ func: "linear" } as TransformParams);
  const items = numericCols(cols).map((name) => {
    const ref = `TRY_CAST(${sqlIdent(name)} AS DOUBLE)`;
    let expr: string;
    switch (p.func) {
      case "log10":
        expr = `CASE WHEN ${ref} > 0 THEN log10(${ref}) END`;
        break;
      case "ln":
        expr = `CASE WHEN ${ref} > 0 THEN ln(${ref}) END`;
        break;
      case "log2":
        expr = `CASE WHEN ${ref} > 0 THEN log2(${ref}) END`;
        break;
      case "sqrt":
        expr = `CASE WHEN ${ref} >= 0 THEN sqrt(${ref}) END`;
        break;
      case "square":
        expr = `(${ref}) ** 2`;
        break;
      case "reciprocal":
        expr = `CASE WHEN ${ref} <> 0 THEN 1.0 / ${ref} END`;
        break;
      case "linear":
      default: {
        const k = typeof p.k === "number" ? p.k : 1;
        const b = typeof p.b === "number" ? p.b : 0;
        expr = `${ref} * ${sqlNum(k)} + ${sqlNum(b)}`;
        break;
      }
    }
    return `${expr} AS ${sqlIdent(name)}`;
  });
  return `SELECT ${items.join(", ")} FROM ${from}`;
}

function normalizeSql(
  from: string,
  op: NormalizeColumnOp,
  cols: string[],
): string {
  if (cols.length === 0) return `SELECT * FROM ${from}`;
  const mode = (op.params as NormalizeParams)?.mode ?? "max";
  const items = numericCols(cols).map((name) => {
    const ref = `TRY_CAST(${sqlIdent(name)} AS DOUBLE)`;
    let expr: string;
    if (mode === "sum") {
      expr = `${ref} / sum(${ref}) OVER () * 100`;
    } else if (mode === "first") {
      expr = `${ref} / first(${ref}) OVER () * 100`;
    } else if (mode === "minMax") {
      expr = `(${ref} - min(${ref}) OVER ()) / (max(${ref}) OVER () - min(${ref}) OVER ()) * 100`;
    } else {
      expr = `${ref} / max(${ref}) OVER () * 100`;
    }
    return `${expr} AS ${sqlIdent(name)}`;
  });
  return `SELECT ${items.join(", ")} FROM ${from}`;
}

function transposeSql(from: string, _op: TransposeColumnOp): string {
  // A true transpose changes the column count to the row count, which is not a
  // static SQL query (the result shape is data-dependent). The spec flags
  // transpose as hard-at-scale and prompts before running. For the SQL preview we
  // pass through and lean on the pandas code + the engine's JS path for the real
  // transpose; the builder marks this op as not-engine-runnable.
  void _op;
  return `SELECT * FROM ${from} /* transpose runs on the JS engine, not as a SQL query */`;
}

function removeBaselineSql(
  from: string,
  op: RemoveBaselineColumnOp,
  cols: string[],
): string {
  if (cols.length === 0) return `SELECT * FROM ${from}`;
  const p = op.params as RemoveBaselineParams;
  const mode = p?.mode ?? (p?.baselineColumnId ? "column" : "firstRow");
  const items = numericCols(cols).map((name) => {
    const ref = `TRY_CAST(${sqlIdent(name)} AS DOUBLE)`;
    let expr: string;
    if (mode === "value") {
      const k = typeof p?.value === "number" ? p.value : 0;
      expr = `${ref} - ${sqlNum(k)}`;
    } else {
      // firstRow (and the column mode, which needs a named baseline we cannot
      // resolve from an id here): subtract each column's first value.
      expr = `${ref} - first(${ref}) OVER ()`;
    }
    return `${expr} AS ${sqlIdent(name)}`;
  });
  return `SELECT ${items.join(", ")} FROM ${from}`;
}

function fractionOfTotalSql(
  from: string,
  op: FractionOfTotalColumnOp,
  cols: string[],
): string {
  if (cols.length === 0) return `SELECT * FROM ${from}`;
  const p = op.params as FractionOfTotalParams;
  const scope = p?.scope ?? "column";
  const factor = p?.asPercent ? 100 : 1;
  const numeric = numericCols(cols).map((c) => `TRY_CAST(${sqlIdent(c)} AS DOUBLE)`);
  const items = numericCols(cols).map((name, i) => {
    const ref = numeric[i];
    let expr: string;
    if (scope === "row") {
      const rowTotal = numeric.join(" + ");
      expr = `${ref} / (${rowTotal}) * ${factor}`;
    } else if (scope === "grand") {
      const grand = numeric.map((n) => `sum(${n}) OVER ()`).join(" + ");
      expr = `${ref} / (${grand}) * ${factor}`;
    } else {
      expr = `${ref} / sum(${ref}) OVER () * ${factor}`;
    }
    return `${expr} AS ${sqlIdent(name)}`;
  });
  return `SELECT ${items.join(", ")} FROM ${from}`;
}

// ---------------------------------------------------------------------------
// A whole recipe -> one DuckDB query over a source relation
// ---------------------------------------------------------------------------

export interface RecipeToSqlOptions {
  /** Relation names for non-primary sources a join / union references, keyed by
   *  the op's rightRef / otherRef. The caller (dataset-view) registers these as
   *  read_parquet sub-queries. */
  sourceRelations?: Record<string, string>;
  /** The primary source's column names, threaded for derive translation and the
   *  drop / rename `*`-expansion. */
  columnNames?: string[];
}

/**
 * Compile a recipe to one DuckDB SQL query that reads FROM the given source
 * relation. An empty recipe is `SELECT * FROM <source>`. Each op becomes a CTE
 * over the previous step, and the final SELECT reads the last step, so the whole
 * thing is one query the caller can wrap as `SELECT ... FROM (<this>) LIMIT n`.
 *
 * `sourceRelation` is whatever the caller can read (a quoted relation name, or a
 * `read_parquet('...')` call wrapped in parens). It is inlined verbatim as the
 * first step's FROM target, so the caller controls how the source is resolved.
 */
export function recipeToSql(
  recipe: TransformOp[],
  sourceRelation: string,
  options: RecipeToSqlOptions = {},
): string {
  if (recipe.length === 0) {
    return `SELECT * FROM ${sourceRelation}`;
  }

  const sourceRels = options.sourceRelations ?? {};
  let columnNames = options.columnNames ? [...options.columnNames] : [];

  const ctes: string[] = [];
  let prevRel = "__step0";
  ctes.push(`__step0 AS (SELECT * FROM ${sourceRelation})`);

  recipe.forEach((op, i) => {
    const stepRel = `__step${i + 1}`;
    let rightRel: string | undefined;
    let otherRel: string | undefined;
    if (op.kind === "join") rightRel = sourceRels[op.rightRef] ?? "__join_right";
    if (op.kind === "union") otherRel = sourceRels[op.otherRef] ?? "__union_other";

    const body = transformOpToSql(op, {
      from: prevRel,
      rightRel,
      otherRel,
      columnNames,
    });
    ctes.push(`${stepRel} AS (${body})`);
    columnNames = nextColumnNames(columnNames, op, sourceRels);
    prevRel = stepRel;
  });

  return `WITH ${ctes.join(", ")} SELECT * FROM ${prevRel}`;
}

/**
 * The best-effort column-name list after an op, mirroring codegen.ts
 * nextColumnNames. Used to expand drop / rename / select and to translate a later
 * derive formula. For ops whose result shape is data-dependent (pivot) or whose
 * source columns we cannot resolve here (join / union over an unknown relation),
 * it widens conservatively.
 */
function nextColumnNames(
  current: string[],
  op: TransformOp,
  sourceRels: Record<string, string>,
): string[] {
  void sourceRels;
  switch (op.kind) {
    case "select":
      return [...op.columns];
    case "drop":
      return current.filter((c) => !op.columns.includes(c));
    case "rename":
      return current.map((c) => op.mapping[c] ?? c);
    case "groupby":
      return [
        ...op.by,
        ...op.aggregations.map((a) => a.outputName ?? `${a.column}_${a.func}`),
      ];
    case "derive":
      return current.includes(op.outputName)
        ? current
        : [...current, op.outputName];
    case "unpivot":
      return [
        ...op.idVars,
        op.varName ?? "variable",
        op.valueName ?? "value",
      ];
    // join / union add columns we cannot name from here; pivot's spread columns
    // are data-dependent; sort / filter / dedupe / transpose / the folded column
    // transforms do not rename. Keep the current list.
    default:
      return current;
  }
}

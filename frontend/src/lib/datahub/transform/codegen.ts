/**
 * datahub/transform/codegen.ts
 *
 * Turn a transform recipe (TransformOp[]) into the equivalent pandas code, so a
 * derived table's Code export reads as the SAME data-prep steps the engine ran.
 * The engine (transform/engine.ts) is pandas-matched by design (its header
 * documents the merge / concat / groupby / sort semantics it mirrors), so each
 * op maps to a short pandas expression and a plain-language comment. The emitted
 * Python uses normal Python comments (#); the house no-em-dash / no-emoji /
 * no-mid-sentence-colon rule applies to the comments we author.
 *
 * Pure string building. No engine call, no I/O. The base data is inlined the
 * same way show-code.ts / plot-code.ts inline group values, so the script and
 * the on-screen derived table are built from one source.
 *
 * COLUMN NAMES are the join between the recipe and the data. The engine threads
 * a flat table keyed by COLUMN NAME (contentToInternal maps cells by name), and
 * every op references columns by name, so the emitted DataFrame is keyed by the
 * source columns' names and the ops read those same names.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import type {
  CellValue,
  DataHubDocContent,
} from "@/lib/datahub/model/types";
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
import type {
  TransformParams,
  NormalizeParams,
  TransposeParams,
  RemoveBaselineParams,
  FractionOfTotalParams,
} from "@/lib/datahub/transforms";

// ---------------------------------------------------------------------------
// Python literal helpers (shared style with show-code.ts / plot-code.ts)
// ---------------------------------------------------------------------------

/** A Python string literal (double-quoted, escaped). */
export function pyStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** A tidy numeric literal (integers plain, long decimals trimmed, NaN safe). */
function pyNum(v: number): string {
  if (!Number.isFinite(v)) return "float('nan')";
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(12)));
}

/** A Python literal for one cell value (number, string, or null -> None). */
function pyCell(v: CellValue): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "number") return pyNum(v);
  return pyStr(v);
}

/** A Python list of strings. */
function pyStrList(values: string[]): string {
  return `[${values.map(pyStr).join(", ")}]`;
}

/** A valid Python identifier from a table name (lowercase, non-word -> _). */
export function pyTableVar(name: string, fallback: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (base === "" || /^[0-9]/.test(base)) return fallback;
  return base;
}

// ---------------------------------------------------------------------------
// Inline a table's data as a pandas DataFrame literal
// ---------------------------------------------------------------------------

/**
 * Emit `var = pd.DataFrame({ "col": [...], ... })` for a table's content, keyed
 * by COLUMN NAME (the key the recipe ops reference). One column per ColumnDef in
 * declared order, each a list of that column's cells down the rows. This is the
 * base-data load the recipe runs over.
 *
 * Duplicate column names are disambiguated with a numeric suffix so the dict has
 * unique keys; this matches how pandas would read a CSV with duplicate headers,
 * and a well-formed Data Hub table does not have duplicate names anyway.
 */
export function tableToDataFrame(
  content: DataHubDocContent,
  varName: string,
): string {
  const usedNames = new Set<string>();
  const colKeys = content.columns.map((c) => {
    let key = c.name ?? "";
    if (key === "") key = "column";
    let unique = key;
    let n = 2;
    while (usedNames.has(unique)) unique = `${key}.${n++}`;
    usedNames.add(unique);
    return { col: c, key: unique };
  });

  if (colKeys.length === 0) {
    return `${varName} = pd.DataFrame()`;
  }

  const lines: string[] = [`${varName} = pd.DataFrame({`];
  for (const { col, key } of colKeys) {
    const cells = content.rows.map((r) => {
      const v = Object.prototype.hasOwnProperty.call(r.cells, col.id)
        ? r.cells[col.id]
        : null;
      return pyCell(v ?? null);
    });
    lines.push(`    ${pyStr(key)}: [${cells.join(", ")}],`);
  }
  lines.push("})");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Filter node -> a pandas boolean mask expression
// ---------------------------------------------------------------------------

/** A column reference for a boolean mask. Bracket form handles names with
 *  spaces or punctuation that df.query / attribute access cannot. */
function colRef(df: string, column: string): string {
  return `${df}[${pyStr(column)}]`;
}

/** A scalar value literal for a filter comparison. */
function filterScalar(value: string | number | undefined): string {
  if (value === undefined) return "None";
  if (typeof value === "number") return pyNum(value);
  // A numeric-looking string still compares as a string here, matching the
  // engine which compares the raw cell unless the op is a numeric inequality.
  return pyStr(value);
}

/** One leaf condition as a pandas boolean Series expression. */
function conditionExpr(df: string, cond: FilterCondition): string {
  const ref = colRef(df, cond.column);
  switch (cond.op) {
    case "eq":
      return `(${ref} == ${filterScalar(cond.value as string | number)})`;
    case "ne":
      return `(${ref} != ${filterScalar(cond.value as string | number)})`;
    case "lt":
      return `(pd.to_numeric(${ref}, errors="coerce") < ${filterScalar(cond.value as number)})`;
    case "le":
      return `(pd.to_numeric(${ref}, errors="coerce") <= ${filterScalar(cond.value as number)})`;
    case "gt":
      return `(pd.to_numeric(${ref}, errors="coerce") > ${filterScalar(cond.value as number)})`;
    case "ge":
      return `(pd.to_numeric(${ref}, errors="coerce") >= ${filterScalar(cond.value as number)})`;
    case "contains":
      return `${ref}.astype("string").str.contains(${pyStr(String(cond.value ?? ""))}, regex=False, na=False)`;
    case "regex":
      return `${ref}.astype("string").str.contains(${pyStr(String(cond.value ?? ""))}, regex=True, na=False)`;
    case "in": {
      const set = Array.isArray(cond.value) ? cond.value : [];
      const lits = set.map((v) =>
        typeof v === "number" ? pyNum(v) : pyStr(String(v)),
      );
      return `${ref}.isin([${lits.join(", ")}])`;
    }
    case "is_empty":
      return `(${ref}.isna() | (${ref}.astype("string") == ""))`;
    default:
      return "True";
  }
}

/** A FilterNode tree as a pandas boolean mask expression. */
function maskExpr(df: string, node: FilterNode): string {
  switch (node.type) {
    case "condition":
      return conditionExpr(df, node.condition);
    case "not":
      return `(~${maskExpr(df, node.child)})`;
    case "and":
      return node.children.length
        ? `(${node.children.map((c) => maskExpr(df, c)).join(" & ")})`
        : "True";
    case "or":
      return node.children.length
        ? `(${node.children.map((c) => maskExpr(df, c)).join(" | ")})`
        : "False";
    default:
      return "True";
  }
}

/** A plain-language description of a filter node, for the step comment. */
function describeNode(node: FilterNode): string {
  switch (node.type) {
    case "condition": {
      const c = node.condition;
      const opWord: Record<FilterCondition["op"], string> = {
        eq: "equals",
        ne: "is not",
        lt: "is less than",
        le: "is at most",
        gt: "is greater than",
        ge: "is at least",
        contains: "contains",
        regex: "matches",
        in: "is one of",
        is_empty: "is empty",
      };
      if (c.op === "is_empty") return `${c.column} ${opWord[c.op]}`;
      const val = Array.isArray(c.value) ? c.value.join(", ") : c.value;
      return `${c.column} ${opWord[c.op]} ${val}`;
    }
    case "not":
      return `not (${describeNode(node.child)})`;
    case "and":
      return node.children.map(describeNode).join(" and ");
    case "or":
      return node.children.map(describeNode).join(" or ");
    default:
      return "the condition";
  }
}

// ---------------------------------------------------------------------------
// Aggregation spec -> the pandas .agg(...) named-aggregation entries
// ---------------------------------------------------------------------------

/** The pandas function token for one AggFunc. */
function aggFuncToken(agg: AggSpec): string {
  switch (agg.func) {
    case "mean":
      return '"mean"';
    case "sum":
      return '"sum"';
    case "count":
      return '"count"';
    case "min":
      return '"min"';
    case "max":
      return '"max"';
    case "median":
      return '"median"';
    case "sd":
      // Sample SD (ddof=1) is the pandas default and the engine default.
      return '"std"';
    case "first":
      return '"first"';
    case "nunique":
      return '"nunique"';
    case "concat": {
      const sep = agg.separator ?? ", ";
      return `lambda s: ${pyStr(sep)}.join(s.dropna().astype("string"))`;
    }
    default:
      return '"first"';
  }
}

// ---------------------------------------------------------------------------
// derive: translate the calc-builder formula to a pandas assignment
// ---------------------------------------------------------------------------

/**
 * Translate a derive formula (the calc-builder expr-eval language) to a pandas
 * vectorized expression where it is plain arithmetic, else fall back to a clear
 * comment plus a best-effort assignment the researcher can adapt.
 *
 * PLAIN-ARITHMETIC detection: the formula contains only column-name identifiers,
 * numbers, whitespace, parentheses, and the operators + - * / ^. expr-eval's `^`
 * is exponentiation, so we translate it to Python `**`. Such a formula maps
 * directly to a per-row pandas expression over the named Series. Anything with a
 * function call, comparison, conditional, or other token is beyond plain
 * arithmetic, so we do NOT guess a vectorized form (the calc-builder helpers like
 * mean() / col() do not have a one-line pandas twin), we emit the formula in a
 * comment and a placeholder the researcher adapts.
 */
export function translateDeriveFormula(
  df: string,
  op: DeriveOp,
  columnNames: string[],
): { code: string; plain: boolean } {
  const formula = op.formula ?? "";
  const out = op.outputName;

  // Plain arithmetic only: identifiers, numbers, ws, parens, + - * / ^.
  const plainArith = /^[\sA-Za-z0-9_.()+\-*/^]*$/.test(formula);
  if (plainArith && formula.trim() !== "") {
    // Replace each known column identifier with df["name"], longest names first
    // so a name that is a prefix of another is not partially matched. Translate
    // ^ to ** for Python power semantics.
    const sorted = [...columnNames].sort((a, b) => b.length - a.length);
    let expr = formula.replace(/\^/g, "**");
    for (const name of sorted) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      expr = expr.replace(re, colRef(df, name));
    }
    return {
      code: `${df}[${pyStr(out)}] = ${expr}`,
      plain: true,
    };
  }

  // Beyond plain arithmetic: state the formula verbatim, emit a placeholder.
  const lines = [
    `# Derived column ${pyStr(out)} = ${formula}`,
    `# This uses the calculator-builder expression language; adapt the line below`,
    `# if the expression is more than plain arithmetic over columns.`,
    `${df}[${pyStr(out)}] = ${df}.apply(lambda row: None, axis=1)  # TODO adapt: ${formula}`,
  ];
  return { code: lines.join("\n"), plain: false };
}

// ---------------------------------------------------------------------------
// Folded column transforms -> pandas
// ---------------------------------------------------------------------------

/** The folded column transforms operate on the table's DATA columns. Since the
 *  emitted DataFrame carries every column, we operate on the numeric columns,
 *  which is the closest pandas twin of the engine's "data column" notion. */
function columnTransformPandas(
  df: string,
  op: ColumnTransformOp,
): { code: string; comment: string } {
  const p: TransformParams = op.params ?? ({ func: "linear" } as TransformParams);
  const numeric = `${df}.select_dtypes(include="number").columns`;
  let expr: string;
  let label: string;
  switch (p.func) {
    case "log10":
      expr = `np.log10(${df}[cols].where(${df}[cols] > 0))`;
      label = "log base 10 of each value (non-positive values become NaN)";
      break;
    case "ln":
      expr = `np.log(${df}[cols].where(${df}[cols] > 0))`;
      label = "natural log of each value (non-positive values become NaN)";
      break;
    case "log2":
      expr = `np.log2(${df}[cols].where(${df}[cols] > 0))`;
      label = "log base 2 of each value (non-positive values become NaN)";
      break;
    case "sqrt":
      expr = `np.sqrt(${df}[cols].where(${df}[cols] >= 0))`;
      label = "square root of each value (negatives become NaN)";
      break;
    case "square":
      expr = `${df}[cols] ** 2`;
      label = "square of each value";
      break;
    case "reciprocal":
      expr = `1 / ${df}[cols].where(${df}[cols] != 0)`;
      label = "reciprocal (1 / value) of each value";
      break;
    case "linear":
    default: {
      const k = typeof p.k === "number" ? p.k : 1;
      const b = typeof p.b === "number" ? p.b : 0;
      expr = `${df}[cols] * ${pyNum(k)} + ${pyNum(b)}`;
      label = `the linear transform value * ${pyNum(k)} + ${pyNum(b)}`;
      break;
    }
  }
  const code = [
    `cols = ${numeric}`,
    `${df}[cols] = ${expr}`,
  ].join("\n");
  return { code, comment: `Transform every numeric value with ${label}.` };
}

function normalizePandas(
  df: string,
  op: NormalizeColumnOp,
): { code: string; comment: string } {
  const mode = (op.params as NormalizeParams)?.mode ?? "max";
  const numeric = `${df}.select_dtypes(include="number").columns`;
  let expr: string;
  let label: string;
  if (mode === "sum") {
    expr = `${df}[cols] / ${df}[cols].sum() * 100`;
    label = "a percent of each column sum (the column then sums to 100)";
  } else if (mode === "first") {
    expr = `${df}[cols] / ${df}[cols].apply(lambda s: s.dropna().iloc[0] if s.notna().any() else float("nan")) * 100`;
    label = "a percent of each column's first value (it becomes 100)";
  } else if (mode === "minMax") {
    expr = `(${df}[cols] - ${df}[cols].min()) / (${df}[cols].max() - ${df}[cols].min()) * 100`;
    label = "0 to 100 between each column's min and max";
  } else {
    expr = `${df}[cols] / ${df}[cols].max() * 100`;
    label = "a percent of each column max (the max becomes 100)";
  }
  const code = [
    `cols = ${numeric}`,
    `${df}[cols] = ${expr}`,
  ].join("\n");
  return { code, comment: `Normalize each column to ${label}.` };
}

function transposePandas(
  df: string,
  op: TransposeColumnOp,
): { code: string; comment: string } {
  const params = op.params as TransposeParams;
  const lines: string[] = [];
  if (params?.headerColumnId) {
    // The engine uses a header column's values as the new column names. We cannot
    // resolve a column id to a name here without the source meta, so leave the
    // default transpose and note the header option in the comment.
    lines.push("# A header column was chosen in the app; set the new column names");
    lines.push("# from that column's values if you need the exact same headers.");
  }
  lines.push(`${df} = ${df}.set_index(${df}.columns[0]).T.reset_index()`);
  return {
    code: lines.join("\n"),
    comment: "Transpose the table so rows become columns and columns become rows.",
  };
}

function removeBaselinePandas(
  df: string,
  op: RemoveBaselineColumnOp,
): { code: string; comment: string } {
  const p = op.params as RemoveBaselineParams;
  const mode = p?.mode ?? (p?.baselineColumnId ? "column" : "firstRow");
  const numeric = `${df}.select_dtypes(include="number").columns`;
  if (mode === "value") {
    const k = typeof p?.value === "number" ? p.value : 0;
    return {
      code: [
        `cols = ${numeric}`,
        `${df}[cols] = ${df}[cols] - ${pyNum(k)}`,
      ].join("\n"),
      comment: `Subtract the constant ${pyNum(k)} from every numeric value.`,
    };
  }
  if (mode === "firstRow") {
    return {
      code: [
        `cols = ${numeric}`,
        `${df}[cols] = ${df}[cols] - ${df}[cols].iloc[0]`,
      ].join("\n"),
      comment: "Subtract each column's first-row value from that column.",
    };
  }
  // mode "column": subtract a baseline column from the others, then drop it. The
  // engine references the baseline by column id; without the source meta here we
  // emit the row-wise subtract over numeric columns and note the column choice.
  return {
    code: [
      "# A baseline column was chosen in the app. Replace BASELINE with its name",
      "# to subtract it row by row, then drop it from the result.",
      `cols = [c for c in ${df}.select_dtypes(include="number").columns if c != "BASELINE"]`,
      `# ${df}[cols] = ${df}[cols].sub(${df}["BASELINE"], axis=0)`,
      `# ${df} = ${df}.drop(columns=["BASELINE"])`,
    ].join("\n"),
    comment: "Subtract the chosen baseline column from the other columns.",
  };
}

function fractionOfTotalPandas(
  df: string,
  op: FractionOfTotalColumnOp,
): { code: string; comment: string } {
  const p = op.params as FractionOfTotalParams;
  const scope = p?.scope ?? "column";
  const factor = p?.asPercent ? 100 : 1;
  const numeric = `${df}.select_dtypes(include="number").columns`;
  let expr: string;
  let label: string;
  if (scope === "row") {
    expr = `${df}[cols].div(${df}[cols].sum(axis=1), axis=0) * ${factor}`;
    label = "its row total";
  } else if (scope === "grand") {
    expr = `${df}[cols] / ${df}[cols].to_numpy().sum() * ${factor}`;
    label = "the grand total of every value";
  } else {
    expr = `${df}[cols] / ${df}[cols].sum() * ${factor}`;
    label = "its column total";
  }
  const asWhat = p?.asPercent ? "percent" : "fraction";
  return {
    code: [
      `cols = ${numeric}`,
      `${df}[cols] = ${expr}`,
    ].join("\n"),
    comment: `Express each value as a ${asWhat} of ${label}.`,
  };
}

// ---------------------------------------------------------------------------
// Relational ops -> pandas
// ---------------------------------------------------------------------------

function joinPandas(
  df: string,
  rightVar: string,
  op: JoinOp,
): { code: string; comment: string } {
  const how = op.how ?? "inner";
  const on = pyStrList(op.on);
  const suffixL = op.suffixLeft ?? "_x";
  const suffixR = op.suffixRight ?? "_y";
  const code = `${df} = pd.merge(${df}, ${rightVar}, on=${on}, how=${pyStr(how)}, suffixes=(${pyStr(suffixL)}, ${pyStr(suffixR)}))`;
  return {
    code,
    comment: `Join with ${rightVar} on ${op.on.join(", ")} (${how} join).`,
  };
}

function filterPandas(df: string, op: FilterOp): { code: string; comment: string } {
  const mask = maskExpr(df, op.node);
  return {
    code: `${df} = ${df}[${mask}].reset_index(drop=True)`,
    comment: `Keep rows where ${describeNode(op.node)}.`,
  };
}

function groupByPandas(df: string, op: GroupByOp): { code: string; comment: string } {
  const by = pyStrList(op.by);
  const namedAggs = op.aggregations
    .map((a) => {
      const outName = a.outputName ?? `${a.column}_${a.func}`;
      return `    ${pyStr(outName)}: (${pyStr(a.column)}, ${aggFuncToken(a)}),`;
    })
    .join("\n");
  const code = [
    `${df} = ${df}.groupby(${by}, sort=False, as_index=False).agg(**{`,
    namedAggs,
    "})",
  ].join("\n");
  const aggWords = op.aggregations
    .map((a) => `${a.func} of ${a.column}`)
    .join(", ");
  return {
    code,
    comment: `Group by ${op.by.join(", ")} and compute ${aggWords}.`,
  };
}

function selectPandas(df: string, op: SelectOp): { code: string; comment: string } {
  return {
    code: `${df} = ${df}[${pyStrList(op.columns)}]`,
    comment: `Keep only the columns ${op.columns.join(", ")}.`,
  };
}

function dropPandas(df: string, op: DropOp): { code: string; comment: string } {
  return {
    code: `${df} = ${df}.drop(columns=${pyStrList(op.columns)})`,
    comment: `Drop the columns ${op.columns.join(", ")}.`,
  };
}

function renamePandas(df: string, op: RenameOp): { code: string; comment: string } {
  const entries = Object.entries(op.mapping)
    .map(([from, to]) => `${pyStr(from)}: ${pyStr(to)}`)
    .join(", ");
  const words = Object.entries(op.mapping)
    .map(([from, to]) => `${from} to ${to}`)
    .join(", ");
  return {
    code: `${df} = ${df}.rename(columns={${entries}})`,
    comment: `Rename ${words}.`,
  };
}

function sortPandas(df: string, op: SortOp): { code: string; comment: string } {
  const cols = op.by.map((k) => k.column);
  const ascending = op.by.map((k) => (k.direction === "desc" ? "False" : "True"));
  const naPos = op.by.map((k: SortKey) => {
    const def = k.direction === "desc" ? "first" : "last";
    return pyStr(k.nulls ?? def);
  });
  // pandas sort_values takes a single na_position; when the keys disagree we use
  // the first key's placement (the common case is one sort key).
  const reset = op.resetIndex === false ? "" : ".reset_index(drop=True)";
  const code = `${df} = ${df}.sort_values(by=${pyStrList(cols)}, ascending=[${ascending.join(", ")}], na_position=${naPos[0] ?? '"last"'}, kind="stable")${reset}`;
  const words = op.by
    .map((k) => `${k.column} ${k.direction === "desc" ? "descending" : "ascending"}`)
    .join(", ");
  return { code, comment: `Sort rows by ${words}.` };
}

function dedupePandas(df: string, op: DedupeOp): { code: string; comment: string } {
  const subset =
    op.subset && op.subset.length > 0 ? `subset=${pyStrList(op.subset)}, ` : "";
  const keep = pyStr(op.keep ?? "first");
  const on = op.subset && op.subset.length > 0 ? op.subset.join(", ") : "all columns";
  return {
    code: `${df} = ${df}.drop_duplicates(${subset}keep=${keep}).reset_index(drop=True)`,
    comment: `Drop duplicate rows (on ${on}).`,
  };
}

function unionPandas(
  df: string,
  otherVar: string,
  op: UnionOp,
): { code: string; comment: string } {
  const ignore = op.resetIndex === false ? "False" : "True";
  return {
    code: `${df} = pd.concat([${df}, ${otherVar}], ignore_index=${ignore})`,
    comment: `Stack ${otherVar} below the current table (union, aligned by column name).`,
  };
}

function pivotPandas(df: string, op: PivotOp): { code: string; comment: string } {
  const index = pyStrList(op.index);
  const code = `${df} = ${df}.pivot_table(index=${index}, columns=${pyStr(op.columns)}, values=${pyStr(op.values)}, aggfunc="mean").reset_index()
${df}.columns.name = None`;
  return {
    code,
    comment: `Pivot long to wide, spreading ${op.columns} into columns of ${op.values}.`,
  };
}

function unpivotPandas(df: string, op: UnpivotOp): { code: string; comment: string } {
  const idVars = pyStrList(op.idVars);
  const valueVars =
    op.valueVars && op.valueVars.length > 0
      ? `, value_vars=${pyStrList(op.valueVars)}`
      : "";
  const varName = `, var_name=${pyStr(op.varName ?? "variable")}`;
  const valueName = `, value_name=${pyStr(op.valueName ?? "value")}`;
  return {
    code: `${df} = ${df}.melt(id_vars=${idVars}${valueVars}${varName}${valueName})`,
    comment: `Unpivot wide to long, gathering value columns into a key-value pair.`,
  };
}

// ---------------------------------------------------------------------------
// Phase 2b-1 data-cleaning ops -> pandas
// ---------------------------------------------------------------------------

/** Translate a plain-arithmetic formula (the shared expr-eval subset) to a pandas
 *  vectorized expression over the df, or null when it is beyond plain arithmetic.
 *  Shared by derive and set-where so both read the formula identically. */
function plainArithToPandas(
  df: string,
  formula: string,
  columnNames: string[],
): string | null {
  const plainArith = /^[\sA-Za-z0-9_.()+\-*/^]*$/.test(formula);
  if (!plainArith || formula.trim() === "") return null;
  const sorted = [...columnNames].sort((a, b) => b.length - a.length);
  let expr = formula.replace(/\^/g, "**");
  for (const name of sorted) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    expr = expr.replace(re, colRef(df, name));
  }
  return expr;
}

function fillnaPandas(df: string, op: FillNaOp): { code: string; comment: string } {
  const col = colRef(df, op.column);
  let rhs: string;
  let label: string;
  switch (op.method) {
    case "ffill":
      rhs = `${col}.ffill()`;
      label = "carrying the previous value forward";
      break;
    case "bfill":
      rhs = `${col}.bfill()`;
      label = "carrying the next value backward";
      break;
    case "mean":
      rhs = `${col}.fillna(pd.to_numeric(${col}, errors="coerce").mean())`;
      label = "the column mean";
      break;
    case "median":
      rhs = `${col}.fillna(pd.to_numeric(${col}, errors="coerce").median())`;
      label = "the column median";
      break;
    case "constant":
    default:
      rhs = `${col}.fillna(${pyCell((op.value ?? null) as CellValue)})`;
      label = `the value ${op.value ?? "(none)"}`;
      break;
  }
  return {
    code: `${col} = ${rhs}`,
    comment: `Fill empty cells in ${op.column} with ${label}.`,
  };
}

function interpolatePandas(
  df: string,
  op: InterpolateOp,
): { code: string; comment: string } {
  const col = colRef(df, op.column);
  const interp = `${col} = pd.to_numeric(${col}, errors="coerce").interpolate(method="linear")`;
  return {
    code: op.orderBy
      ? `${df} = ${df}.sort_values(${pyStr(op.orderBy)})\n${interp}`
      : interp,
    comment: op.orderBy
      ? `Linearly interpolate empty cells in ${op.column}, ordered by ${op.orderBy}.`
      : `Linearly interpolate empty cells in ${op.column} from the nearest filled neighbours.`,
  };
}

function dropnaPandas(df: string, op: DropNaOp): { code: string; comment: string } {
  const subset =
    op.columns && op.columns.length > 0 ? `subset=${pyStrList(op.columns)}, ` : "";
  const how = pyStr(op.how);
  const on = op.columns && op.columns.length > 0 ? op.columns.join(", ") : "any column";
  return {
    code: `${df} = ${df}.dropna(${subset}how=${how}).reset_index(drop=True)`,
    comment: `Drop rows empty in ${op.how === "all" ? "all of" : "any of"} ${on}.`,
  };
}

function setWherePandas(
  df: string,
  op: SetWhereOp,
  columnNames: string[],
): { code: string; comment: string } {
  const mask = maskExpr(df, op.where);
  let rhs: string;
  if (op.valueKind === "formula") {
    const expr = plainArithToPandas(df, op.formula ?? "", columnNames);
    rhs = expr ? `(${expr})[mask]` : `None  # TODO adapt: ${op.formula ?? ""}`;
  } else {
    rhs = pyCell((op.value ?? null) as CellValue);
  }
  const col = colRef(df, op.column);
  const code = [`mask = ${mask}`, `${df}.loc[mask, ${pyStr(op.column)}] = ${rhs}`].join("\n");
  void col;
  return {
    code,
    comment: `Set ${op.column} where ${describeNode(op.where)}.`,
  };
}

function strOpPandas(
  df: string,
  op: StrOp,
): { code: string; comment: string } {
  switch (op.mode) {
    case "slice": {
      const s = `${colRef(df, op.column)}.astype("string")`;
      if (op.sliceMode === "replaceFirst") {
        const n = op.n ?? 0;
        return {
          code: `${colRef(df, op.column)} = ${s}.str.slice_replace(0, ${n}, ${pyStr(op.replacement ?? "")})`,
          comment: `Replace the first ${n} characters of ${op.column} with ${pyStr(op.replacement ?? "")}.`,
        };
      }
      const start = op.start ?? 0;
      const end = op.end !== undefined ? String(op.end) : "None";
      return {
        code: `${colRef(df, op.column)} = ${s}.str.slice(${start}, ${end})`,
        comment: `Take the substring of ${op.column}.`,
      };
    }
    case "replace": {
      const s = `${colRef(df, op.column)}.astype("string")`;
      return {
        code: `${colRef(df, op.column)} = ${s}.str.replace(${pyStr(op.pattern)}, ${pyStr(op.replacement)}, regex=${op.regex ? "True" : "False"})`,
        comment: `Replace ${op.regex ? "the pattern" : "the text"} ${pyStr(op.pattern)} in ${op.column}.`,
      };
    }
    case "extract": {
      const s = `${colRef(df, op.column)}.astype("string")`;
      const group = (op.group ?? 1) - 1;
      return {
        code: `${colRef(df, op.outputName)} = ${s}.str.extract(${pyStr("(" + op.pattern + ")")})[${group}]`,
        comment: `Extract a regex group from ${op.column} into ${op.outputName}.`,
      };
    }
    case "split": {
      const s = `${colRef(df, op.column)}.astype("string")`;
      const prefix = op.outputPrefix ?? `${op.column}_part`;
      const names = Array.from({ length: op.parts }, (_, i) => `${prefix}_${i + 1}`);
      const code = [
        `__parts = ${s}.str.split(${pyStr(op.separator)}, n=${op.parts - 1}, expand=True)`,
        `${df}[${pyStrList(names)}] = __parts.reindex(columns=range(${op.parts}))`,
      ].join("\n");
      return {
        code,
        comment: `Split ${op.column} on ${pyStr(op.separator)} into ${op.parts} columns.`,
      };
    }
    case "case": {
      const s = `${colRef(df, op.column)}.astype("string")`;
      const fn = op.caseMode === "upper" ? "upper" : op.caseMode === "lower" ? "lower" : "title";
      return {
        code: `${colRef(df, op.column)} = ${s}.str.${fn}()`,
        comment: `Convert ${op.column} to ${op.caseMode} case.`,
      };
    }
    case "strip": {
      const s = `${colRef(df, op.column)}.astype("string")`;
      const fn = op.stripMode === "left" ? "lstrip" : op.stripMode === "right" ? "rstrip" : "strip";
      return {
        code: `${colRef(df, op.column)} = ${s}.str.${fn}()`,
        comment: `Trim whitespace from ${op.column}.`,
      };
    }
    case "cat": {
      const parts = op.columns
        .map((c) => `${colRef(df, c)}.astype("string")`)
        .join(`.str.cat(`);
      // pandas str.cat with sep, skipping NA. Build a clean concat over the columns.
      const others = op.columns
        .slice(1)
        .map((c) => `${colRef(df, c)}.astype("string")`)
        .join(", ");
      void parts;
      const code = `${colRef(df, op.outputName)} = ${colRef(df, op.columns[0])}.astype("string").str.cat([${others}], sep=${pyStr(op.separator)}, na_rep="")`;
      return {
        code,
        comment: `Concatenate ${op.columns.join(", ")} into ${op.outputName}.`,
      };
    }
    default:
      return { code: "# (unrecognized string op)", comment: "" };
  }
}

function asTypePandas(df: string, op: AsTypeOp): { code: string; comment: string } {
  const col = colRef(df, op.column);
  let code: string;
  switch (op.to) {
    case "number":
      code = `${col} = pd.to_numeric(${col}, errors="coerce")`;
      break;
    case "text":
      code = `${col} = ${col}.astype("string")`;
      break;
    case "boolean":
      code = `${col} = ${col}.astype("boolean")`;
      break;
    case "date":
    default:
      code = `${col} = pd.to_datetime(${col}, errors="coerce")`;
      break;
  }
  return { code, comment: `Cast ${op.column} to ${op.to}.` };
}

function toDatePandas(df: string, op: ToDateOp): { code: string; comment: string } {
  const col = colRef(df, op.column);
  return {
    code: `${col} = pd.to_datetime(${col}, format=${pyStr(op.format)}, errors="coerce")`,
    comment: `Parse ${op.column} to a date with format ${op.format}.`,
  };
}

function datePartsPandas(df: string, op: DatePartsOp): { code: string; comment: string } {
  const src = `pd.to_datetime(${colRef(df, op.column)}, errors="coerce")`;
  const dtAttr: Record<string, string> = {
    year: "year",
    month: "month",
    day: "day",
    weekday: "isocalendar().day",
    hour: "hour",
  };
  const lines = op.parts.map((p) => {
    const out = `${op.column}_${p}`;
    return `${colRef(df, out)} = ${src}.dt.${dtAttr[p]}`;
  });
  return {
    code: lines.join("\n"),
    comment: `Extract ${op.parts.join(", ")} from ${op.column}.`,
  };
}

// ---------------------------------------------------------------------------
// Phase 2b-2 numeric / window / filter-helper / summarize ops -> pandas
// ---------------------------------------------------------------------------

function clipPandas(df: string, op: ClipOp): { code: string; comment: string } {
  const col = colRef(df, op.column);
  const args: string[] = [];
  if (op.lower !== undefined) args.push(`lower=${pyNum(op.lower)}`);
  if (op.upper !== undefined) args.push(`upper=${pyNum(op.upper)}`);
  return {
    code: `${col} = pd.to_numeric(${col}, errors="coerce").clip(${args.join(", ")})`,
    comment: `Clamp ${op.column} to the given range.`,
  };
}

function roundPandas(df: string, op: RoundOp): { code: string; comment: string } {
  const col = colRef(df, op.column);
  const d = op.decimals ?? 0;
  return {
    code: `${col} = pd.to_numeric(${col}, errors="coerce").round(${d})`,
    comment: `Round ${op.column} to ${d} decimal place${d === 1 ? "" : "s"}.`,
  };
}

function binPandas(df: string, op: BinOp): { code: string; comment: string } {
  const src = `pd.to_numeric(${colRef(df, op.column)}, errors="coerce")`;
  const labels = op.labels ? pyStrList(op.labels) : "False";
  if (op.mode === "quantiles") {
    const q = op.quantiles ?? 4;
    return {
      code: `${colRef(df, op.outputName)} = pd.qcut(${src}, q=${q}, labels=${op.labels ? labels : "None"})`,
      comment: `Bin ${op.column} into ${q} equal-frequency buckets.`,
    };
  }
  const edges = `[${(op.edges ?? []).map(pyNum).join(", ")}]`;
  return {
    code: `${colRef(df, op.outputName)} = pd.cut(${src}, bins=${edges}, labels=${op.labels ? labels : "None"}, include_lowest=True)`,
    comment: `Bin ${op.column} into ranges.`,
  };
}

function mapPandas(df: string, op: MapOp): { code: string; comment: string } {
  const col = colRef(df, op.column);
  const entries = op.mapping.map((m) => `${pyStr(m.from)}: ${pyStr(m.to)}`).join(", ");
  if (op.fallback !== undefined) {
    return {
      code: `${col} = ${col}.astype("string").map({${entries}}).fillna(${pyStr(op.fallback)})`,
      comment: `Map ${op.column} via the lookup, unmatched cells become ${pyStr(op.fallback)}.`,
    };
  }
  return {
    code: `${col} = ${col}.replace({${entries}})`,
    comment: `Replace values in ${op.column} via the lookup.`,
  };
}

function rankPandas(df: string, op: RankOp): { code: string; comment: string } {
  const src = `pd.to_numeric(${colRef(df, op.column)}, errors="coerce")`;
  return {
    code: `${colRef(df, op.outputName)} = ${src}.rank(ascending=${op.ascending ? "True" : "False"}, method=${pyStr(op.method)})`,
    comment: `Rank ${op.column} ${op.ascending ? "ascending" : "descending"}.`,
  };
}

function cumulativePandas(df: string, op: CumulativeOp): { code: string; comment: string } {
  const src = `pd.to_numeric(${colRef(df, op.column)}, errors="coerce")`;
  const fn = { sum: "cumsum", prod: "cumprod", max: "cummax", min: "cummin" }[op.func];
  return {
    code: `${colRef(df, op.outputName)} = ${src}.${fn}()`,
    comment: `Running ${op.func} of ${op.column}.`,
  };
}

function lagPandas(df: string, op: LagOp): { code: string; comment: string } {
  const src = `pd.to_numeric(${colRef(df, op.column)}, errors="coerce")`;
  const n = op.periods ?? 1;
  const out = colRef(df, op.outputName);
  if (op.mode === "shift") {
    return { code: `${out} = ${src}.shift(${n})`, comment: `Shift ${op.column} by ${n} rows.` };
  }
  if (op.mode === "diff") {
    return { code: `${out} = ${src}.diff(${n})`, comment: `Row-to-row difference of ${op.column}.` };
  }
  return {
    code: `${out} = ${src}.pct_change(periods=${n})`,
    comment: `Percent change of ${op.column}.`,
  };
}

function rollingPandas(df: string, op: RollingOp): { code: string; comment: string } {
  const src = `pd.to_numeric(${colRef(df, op.column)}, errors="coerce")`;
  return {
    code: `${colRef(df, op.outputName)} = ${src}.rolling(${op.size}).${op.func}()`,
    comment: `Rolling ${op.func} of ${op.column} over a ${op.size}-row window.`,
  };
}

function isinPandas(df: string, op: IsInOp): { code: string; comment: string } {
  const mask = `${colRef(df, op.column)}.astype("string").isin(${pyStrList(op.values)})`;
  const expr = op.negate ? `~(${mask})` : mask;
  return {
    code: `${df} = ${df}[${expr}].reset_index(drop=True)`,
    comment: `Keep rows where ${op.column} is ${op.negate ? "not " : ""}in the set.`,
  };
}

function betweenPandas(df: string, op: BetweenOp): { code: string; comment: string } {
  const num = `pd.to_numeric(${colRef(df, op.column)}, errors="coerce")`;
  return {
    code: `${df} = ${df}[${num}.between(${pyNum(op.lower)}, ${pyNum(op.upper)})].reset_index(drop=True)`,
    comment: `Keep rows where ${op.column} is between ${op.lower} and ${op.upper}.`,
  };
}

function topnPandas(df: string, op: TopNOp): { code: string; comment: string } {
  const fn = op.which === "largest" ? "nlargest" : "nsmallest";
  return {
    code: `${df} = ${df}.${fn}(${op.n}, ${pyStr(op.column)}).reset_index(drop=True)`,
    comment: `Keep the ${op.n} ${op.which} rows by ${op.column}.`,
  };
}

function samplePandas(df: string, op: SampleOp): { code: string; comment: string } {
  const seed = op.seed !== undefined ? `, random_state=${op.seed}` : "";
  const arg = op.mode === "fraction" ? `frac=${pyNum(op.fraction ?? 0)}` : `n=${op.n ?? 0}`;
  return {
    code: `${df} = ${df}.sample(${arg}${seed}).reset_index(drop=True)`,
    comment: `Take a random sample of rows.`,
  };
}

function valueCountsPandas(df: string, op: ValueCountsOp): { code: string; comment: string } {
  return {
    code: `${df} = ${colRef(df, op.column)}.value_counts().rename_axis("value").reset_index(name="count")`,
    comment: `Count occurrences of each value in ${op.column}.`,
  };
}

function describePandas(df: string, op: DescribeOp): { code: string; comment: string } {
  const subset = op.columns && op.columns.length > 0 ? `[${pyStrList(op.columns)}]` : "";
  return {
    code: `${df} = ${df}${subset}.describe().rename_axis("statistic").reset_index()`,
    comment: `Summary statistics for ${op.columns && op.columns.length ? op.columns.join(", ") : "the numeric columns"}.`,
  };
}

function crosstabPandas(df: string, op: CrosstabOp): { code: string; comment: string } {
  return {
    code: `${df} = pd.crosstab(${colRef(df, op.row)}, ${colRef(df, op.column)}).reset_index()`,
    comment: `Cross-tabulate ${op.row} against ${op.column}.`,
  };
}

function pivotTablePandas(df: string, op: PivotTableOp): { code: string; comment: string } {
  return {
    code: `${df} = pd.pivot_table(${df}, index=${pyStr(op.index)}, columns=${pyStr(op.columns)}, values=${pyStr(op.value)}, aggfunc=${pyStr(op.agg)}).reset_index()`,
    comment: `Pivot ${op.value} by ${op.index} and ${op.columns} (${op.agg}).`,
  };
}

// ---------------------------------------------------------------------------
// One op -> pandas (the public per-op entry point)
// ---------------------------------------------------------------------------

/**
 * Context an op may need beyond the op itself: the dataframe variable to mutate,
 * the variable holding a referenced right / other source (join / union), and the
 * current column-name list (derive formula translation). The recipe walker
 * supplies these; a standalone unit test can pass them directly.
 */
export interface OpCodegenContext {
  /** The dataframe variable name the op mutates (defaults to "df"). */
  df?: string;
  /** The variable holding the right-hand source for a join, keyed by rightRef. */
  rightVar?: string;
  /** The variable holding the other source for a union, keyed by otherRef. */
  otherVar?: string;
  /** The current column names, used to translate a derive formula. */
  columnNames?: string[];
}

/**
 * Emit the pandas code and a plain-language comment for ONE TransformOp. The
 * code mutates the dataframe variable in place (df = df...) so ops chain.
 */
export function transformOpToPandas(
  op: TransformOp,
  ctx: OpCodegenContext = {},
): { code: string; comment: string } {
  const df = ctx.df ?? "df";
  switch (op.kind) {
    case "join":
      return joinPandas(df, ctx.rightVar ?? "df_right", op);
    case "filter":
      return filterPandas(df, op);
    case "groupby":
      return groupByPandas(df, op);
    case "select":
      return selectPandas(df, op);
    case "drop":
      return dropPandas(df, op);
    case "rename":
      return renamePandas(df, op);
    case "sort":
      return sortPandas(df, op);
    case "dedupe":
      return dedupePandas(df, op);
    case "union":
      return unionPandas(df, ctx.otherVar ?? "df_other", op);
    case "derive": {
      const t = translateDeriveFormula(df, op, ctx.columnNames ?? []);
      return {
        code: t.code,
        comment: `Add the derived column ${op.outputName}.`,
      };
    }
    case "pivot":
      return pivotPandas(df, op);
    case "unpivot":
      return unpivotPandas(df, op);
    case "column-transform":
      return columnTransformPandas(df, op);
    case "normalize":
      return normalizePandas(df, op);
    case "transpose":
      return transposePandas(df, op);
    case "remove-baseline":
      return removeBaselinePandas(df, op);
    case "fraction-of-total":
      return fractionOfTotalPandas(df, op);
    case "fillna":
      return fillnaPandas(df, op);
    case "interpolate":
      return interpolatePandas(df, op);
    case "dropna":
      return dropnaPandas(df, op);
    case "set-where":
      return setWherePandas(df, op, ctx.columnNames ?? []);
    case "str-op":
      return strOpPandas(df, op);
    case "astype":
      return asTypePandas(df, op);
    case "to-date":
      return toDatePandas(df, op);
    case "date-parts":
      return datePartsPandas(df, op);
    case "clip":
      return clipPandas(df, op);
    case "round":
      return roundPandas(df, op);
    case "bin":
      return binPandas(df, op);
    case "map":
      return mapPandas(df, op);
    case "rank":
      return rankPandas(df, op);
    case "cumulative":
      return cumulativePandas(df, op);
    case "lag":
      return lagPandas(df, op);
    case "rolling":
      return rollingPandas(df, op);
    case "isin":
      return isinPandas(df, op);
    case "between":
      return betweenPandas(df, op);
    case "topn":
      return topnPandas(df, op);
    case "sample":
      return samplePandas(df, op);
    case "value_counts":
      return valueCountsPandas(df, op);
    case "describe":
      return describePandas(df, op);
    case "crosstab":
      return crosstabPandas(df, op);
    case "pivot_table":
      return pivotTablePandas(df, op);
    default: {
      // Exhaustiveness guard. A new op kind without a case here is a type error;
      // at runtime it emits a clear no-op comment instead of crashing the export.
      const _exhaustive: never = op;
      void _exhaustive;
      return { code: "# (unrecognized transform step, left unchanged)", comment: "" };
    }
  }
}

// ---------------------------------------------------------------------------
// A whole recipe -> the commented pandas data-prep block
// ---------------------------------------------------------------------------

/** The shape the recipe walker needs to inline each base source. */
export interface RecipeSource {
  /** The source table id (matches a recipe rightRef / otherRef). */
  id: string;
  /** The source's current content (its columns / rows / names). */
  content: DataHubDocContent;
}

export interface RecipeToPandasResult {
  /** The commented pandas block (data load + each transform step). */
  code: string;
  /** The dataframe variable that holds the final derived table. */
  resultVar: string;
  /** The import lines this block needs (pandas, and numpy when a folded op uses it). */
  imports: string[];
}

/**
 * Emit the full data-prep block for a recipe: inline the PRIMARY source as a
 * DataFrame, inline each referenced right / other source once, then thread the
 * pipeline op by op with a numbered, plain-language comment before each step.
 *
 * The walker tracks the current column names through structural ops (groupby /
 * select / drop / rename / pivot / unpivot / derive) so a later derive formula
 * translation sees the right names. Where it cannot know the exact post-op names
 * (a join's suffixes, a pivot's spread columns) it widens conservatively rather
 * than guess wrong, which only affects derive-formula identifier matching.
 *
 * `startStep` lets the chain assembler continue the step numbering from the
 * base-data load (so the script reads Step 1 load, Step 2 transform, ...).
 */
export function recipeToPandas(
  sources: RecipeSource[],
  recipe: TransformOp[],
  options: {
    df?: string;
    startStep?: number;
    /** When true, emit the inline base-data load. When false, assume df already
     *  holds the primary source (the chain assembler loaded it). */
    loadPrimary?: boolean;
  } = {},
): RecipeToPandasResult {
  const df = options.df ?? "df";
  const loadPrimary = options.loadPrimary ?? true;
  let step = options.startStep ?? 1;
  const lines: string[] = [];
  const imports = new Set<string>(["import pandas as pd"]);

  const byId = new Map(sources.map((s) => [s.id, s.content]));
  const primary = sources[0]?.content;

  // Inline the primary source as the starting dataframe.
  if (loadPrimary && primary) {
    lines.push(`# Step ${step}, load the base data`);
    lines.push(tableToDataFrame(primary, df));
    lines.push("");
    step += 1;
  }

  // Track the running column names for derive translation.
  let columnNames = primary ? primary.columns.map((c) => c.name) : [];

  // Assign a stable variable to each non-primary source the recipe references.
  const sourceVar = new Map<string, string>();
  const usedVars = new Set<string>([df]);
  function varForSource(id: string): string {
    const existing = sourceVar.get(id);
    if (existing) return existing;
    const content = byId.get(id);
    const base = content
      ? `df_${pyTableVar(content.meta.name, "src")}`
      : "df_src";
    let v = base;
    let n = 2;
    while (usedVars.has(v)) v = `${base}_${n++}`;
    usedVars.add(v);
    sourceVar.set(id, v);
    return v;
  }

  for (const op of recipe) {
    // Inline any second source this op references, once, just before its step.
    let rightVar: string | undefined;
    let otherVar: string | undefined;
    if (op.kind === "join") {
      const content = byId.get(op.rightRef);
      rightVar = varForSource(op.rightRef);
      if (content && !lines.some((l) => l.startsWith(`${rightVar} = `))) {
        lines.push(`# Load the joined-in table ${content.meta.name}`);
        lines.push(tableToDataFrame(content, rightVar));
        lines.push("");
      }
    } else if (op.kind === "union") {
      const content = byId.get(op.otherRef);
      otherVar = varForSource(op.otherRef);
      if (content && !lines.some((l) => l.startsWith(`${otherVar} = `))) {
        lines.push(`# Load the stacked-on table ${content.meta.name}`);
        lines.push(tableToDataFrame(content, otherVar));
        lines.push("");
      }
    }

    const { code, comment } = transformOpToPandas(op, {
      df,
      rightVar,
      otherVar,
      columnNames,
    });
    if (comment) lines.push(`# Step ${step}, ${lowerFirst(comment)}`);
    lines.push(code);
    lines.push("");
    step += 1;

    // A folded op or transpose uses numpy.
    if (
      op.kind === "column-transform" ||
      op.kind === "normalize" ||
      op.kind === "remove-baseline" ||
      op.kind === "fraction-of-total"
    ) {
      imports.add("import numpy as np");
    }

    // Update the running column names for ops with a knowable result shape.
    columnNames = nextColumnNames(columnNames, op, byId);
  }

  // Trim a trailing blank line.
  while (lines.length && lines[lines.length - 1] === "") lines.pop();

  return {
    code: lines.join("\n"),
    resultVar: df,
    imports: [...imports],
  };
}

/** Lowercase the first letter of a comment so "# Step N, join ..." reads well. */
function lowerFirst(s: string): string {
  return s.length ? s[0].toLowerCase() + s.slice(1) : s;
}

/**
 * The best-effort column-name list after an op, for derive-formula translation
 * only. Structural ops whose output names are knowable update the list exactly;
 * ops that can introduce names we cannot fully predict here (join suffixes,
 * pivot spread columns) widen to the union of inputs so a later derive still
 * matches the names it can.
 */
function nextColumnNames(
  current: string[],
  op: TransformOp,
  byId: Map<string, DataHubDocContent>,
): string[] {
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
    case "join": {
      const right = byId.get(op.rightRef);
      const rightNames = right ? right.columns.map((c) => c.name) : [];
      return Array.from(new Set([...current, ...rightNames]));
    }
    case "union": {
      const other = byId.get(op.otherRef);
      const otherNames = other ? other.columns.map((c) => c.name) : [];
      return Array.from(new Set([...current, ...otherNames]));
    }
    case "unpivot":
      return [
        ...op.idVars,
        op.varName ?? "variable",
        op.valueName ?? "value",
      ];
    case "str-op": {
      if (op.mode === "extract" || op.mode === "cat") {
        return current.includes(op.outputName) ? current : [...current, op.outputName];
      }
      if (op.mode === "split") {
        const prefix = op.outputPrefix ?? `${op.column}_part`;
        const names = Array.from({ length: op.parts }, (_, i) => `${prefix}_${i + 1}`);
        const add = names.filter((n) => !current.includes(n));
        return [...current, ...add];
      }
      return current;
    }
    case "date-parts": {
      const names = op.parts.map((p) => `${op.column}_${p}`);
      const add = names.filter((n) => !current.includes(n));
      return [...current, ...add];
    }
    // The Phase 2b-2 ops that write a NEW column add their output name.
    case "bin":
    case "rank":
    case "cumulative":
    case "lag":
    case "rolling":
      return current.includes(op.outputName) ? current : [...current, op.outputName];
    case "value_counts":
      return ["value", "count"];
    case "describe": {
      const cols = op.columns && op.columns.length > 0 ? op.columns : current;
      return ["statistic", ...cols];
    }
    case "crosstab":
      // The spread column names are data-dependent; keep the row key visible.
      return [op.row];
    case "pivot_table":
      // The spread column names are data-dependent; keep the index visible.
      return [op.index];
    // pivot, sort, filter, dedupe, transpose, the folded column transforms,
    // fillna, dropna, set-where, astype, to-date, clip, round, map, isin,
    // between, topn, sample do not add or rename a column a later derive formula
    // relies on, so we keep the current list.
    default:
      return current;
  }
}

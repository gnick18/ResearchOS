"use client";

// TransformBuilder (DataHub-largetables lane, Phase 2a).
//
// The "edit by rule" builder for the large-dataset lane (mockup surface 1, spec
// section 6). It is the Data Hub's EXISTING pandas-matched transform engine
// (lib/datahub/transform) given a full operation menu and a live code preview,
// running in the background DuckDB engine on the whole dataset. A recipe is a
// pipeline of ops, each one verb plus params, previewed live on the dataset with
// an affected-row estimate, and reflected in both the pandas and SQL code. The
// same recipe runs in JS for a small editable table or compiles to one DuckDB
// query for a huge one, so a rule reads identically at any size (spec section 6).
//
// PHASE 2a SCOPE. Only the ops the engine already runs are wired with editable
// params here (filter, derive, sort, select, drop, rename, dedupe, groupby). The
// Phase 2b gap ops (string accessors, fillna, conditional-set, cast, bin, ...)
// appear in the palette as a clearly-marked "coming soon" seam, disabled, so the
// vocabulary is visible but only the supported half is buildable. Pivot / unpivot
// compile but are left off the palette here (they reshape the result, handled
// with the wide-column tooling later).
//
// Until the user Saves as a new dataset, the recipe is an EPHEMERAL live query:
// nothing is cached, the preview runs the recipe on demand against the source
// Parquet and materializes only the visible window (spec section 9).
//
// House style: <Icon> only, Tooltip component, no emojis / em-dashes /
// mid-sentence colons.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import type { DatasetSidecar } from "@/lib/datahub/bigtable";
import type { TransformOp } from "@/lib/datahub/transform/pipeline";
import { transformOpToPandas } from "@/lib/datahub/transform/codegen";
import { transformOpToSql, recipeToSql } from "@/lib/datahub/transform/sql-codegen";
import {
  openDataset,
  closeDataset,
  readRowWindow,
  countRows,
  recipeResultColumns,
  saveRecipeAsDataset,
  type OpenDatasetHandle,
} from "@/lib/datahub/bigtable/dataset-view";

const PREVIEW_ROWS = 25;

// ---------------------------------------------------------------------------
// Op palette. Grouped by the spec's operation surface (section 6). `ready` marks
// the Phase 2a wired ops; the rest are the Phase 2b seam (visible, disabled).
// ---------------------------------------------------------------------------

interface PaletteEntry {
  kind: string;
  label: string;
  ready: boolean;
}

const PALETTE: { group: string; ops: PaletteEntry[] }[] = [
  {
    group: "Filter & select",
    ops: [
      { kind: "filter", label: "keep rows where", ready: true },
      { kind: "select", label: "keep columns", ready: true },
      { kind: "drop", label: "drop columns", ready: true },
      { kind: "isin", label: "keep rows in set", ready: true },
      { kind: "between", label: "keep rows between", ready: true },
      { kind: "topn", label: "top N by column", ready: true },
      { kind: "sample", label: "random sample", ready: true },
    ],
  },
  {
    group: "Edit values",
    ops: [
      { kind: "setwhere", label: "set value where", ready: true },
      { kind: "clip", label: "clip to range", ready: true },
      { kind: "round", label: "round", ready: true },
      { kind: "map", label: "map via lookup", ready: true },
    ],
  },
  {
    group: "Missing data",
    ops: [
      { kind: "fillna", label: "fill empty with", ready: true },
      { kind: "dropna", label: "drop empty rows", ready: true },
      { kind: "interpolate", label: "interpolate", ready: false },
    ],
  },
  {
    group: "Strings",
    ops: [
      { kind: "str_slice", label: "slice characters", ready: true },
      { kind: "str_replace", label: "replace text / regex", ready: true },
      { kind: "str_extract", label: "extract regex group", ready: true },
      { kind: "str_split", label: "split into columns", ready: true },
      { kind: "str_case", label: "upper / lower / title", ready: true },
      { kind: "str_strip", label: "trim whitespace", ready: true },
      { kind: "str_cat", label: "concatenate columns", ready: true },
    ],
  },
  {
    group: "Compute",
    ops: [
      { kind: "derive", label: "new column from formula", ready: true },
      { kind: "bin", label: "bin into categories", ready: true },
      { kind: "rank", label: "rank", ready: true },
      { kind: "cumulative", label: "running total", ready: true },
      { kind: "lag", label: "shift / diff / pct change", ready: true },
      { kind: "rolling", label: "rolling window", ready: true },
    ],
  },
  {
    group: "Type & schema",
    ops: [
      { kind: "rename", label: "rename column", ready: true },
      { kind: "astype", label: "cast type", ready: true },
      { kind: "todate", label: "parse date", ready: true },
      { kind: "dateparts", label: "extract date parts", ready: true },
    ],
  },
  {
    group: "Reshape & summarize",
    ops: [
      { kind: "sort", label: "sort", ready: true },
      { kind: "dedupe", label: "drop duplicates", ready: true },
      { kind: "groupby", label: "group + aggregate", ready: true },
      { kind: "valuecounts", label: "value counts", ready: true },
      { kind: "describe", label: "describe", ready: true },
      { kind: "crosstab", label: "cross-tabulate", ready: true },
      { kind: "pivottable", label: "pivot table", ready: true },
    ],
  },
];

// Category -> registry glyph. The icon lives ONLY on the category card header
// (per the Option C review, do not stamp it on every op row). The category
// glyphs were signed off 2026-06-13 (Strings = text/Aa, Missing data = empty
// set, Reshape = pivot arrows, all new registry glyphs).
const GROUP_ICON: Record<string, IconName> = {
  "Filter & select": "filter",
  "Edit values": "pencil",
  "Missing data": "emptySet",
  Strings: "text",
  Compute: "calculator",
  "Type & schema": "database",
  "Reshape & summarize": "pivot",
};

const VERB: Record<string, string> = {
  filter: "Filter",
  select: "Keep cols",
  drop: "Drop cols",
  derive: "Derive",
  rename: "Rename",
  sort: "Sort",
  dedupe: "Dedupe",
  groupby: "Group + agg",
  fillna: "Fill empty",
  dropna: "Drop empty rows",
  "set-where": "Set where",
  "str-op": "Text",
  astype: "Cast type",
  "to-date": "Parse date",
  "date-parts": "Date parts",
  clip: "Clip",
  round: "Round",
  bin: "Bin",
  map: "Map",
  rank: "Rank",
  cumulative: "Running total",
  lag: "Shift / diff",
  rolling: "Rolling",
  isin: "Keep in set",
  between: "Keep between",
  topn: "Top N",
  sample: "Sample",
  value_counts: "Value counts",
  describe: "Describe",
  crosstab: "Cross-tab",
  pivot_table: "Pivot table",
};

// ---------------------------------------------------------------------------
// Op factory: a sensible default op of each wired kind, seeded with the first
// suitable column from the dataset schema.
// ---------------------------------------------------------------------------

/** A column name usable as a bare identifier in the shared formula language (the
 *  derive expr-eval parser binds simple identifiers, so a name with spaces /
 *  punctuation cannot be referenced directly). */
function isFormulaSafe(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function defaultOp(kind: string, cols: string[], numericCols: string[]): TransformOp | null {
  const firstNum = numericCols[0] ?? cols[0] ?? "column";
  const first = cols[0] ?? "column";
  // A derive formula references columns by bare identifier; seed with the first
  // identifier-safe numeric column so the default never produces a name the
  // formula language cannot bind. When none qualifies, seed a constant.
  const formulaCol = numericCols.find(isFormulaSafe);
  switch (kind) {
    case "filter":
      return {
        kind: "filter",
        node: { type: "condition", condition: { column: firstNum, op: "lt", value: 0.05 } },
      };
    case "select":
      return { kind: "select", columns: cols.slice(0, Math.min(3, cols.length)) };
    case "drop":
      return { kind: "drop", columns: [cols[cols.length - 1] ?? first] };
    case "derive":
      return {
        kind: "derive",
        outputName: "new_column",
        formula: formulaCol ? `${formulaCol} * 1` : "1",
      };
    case "rename":
      return { kind: "rename", mapping: { [first]: `${first}_renamed` } };
    case "sort":
      return { kind: "sort", by: [{ column: firstNum, direction: "desc" }] };
    case "dedupe":
      return { kind: "dedupe" };
    case "groupby":
      return {
        kind: "groupby",
        by: [first],
        aggregations: [{ column: firstNum, func: "mean", outputName: `${firstNum}_mean` }],
      };
    case "fillna":
      return { kind: "fillna", column: firstNum, method: "constant", value: 0 };
    case "dropna":
      return { kind: "dropna", columns: [first], how: "any" };
    case "setwhere":
      return {
        kind: "set-where",
        column: firstNum,
        where: { type: "condition", condition: { column: firstNum, op: "is_empty" } },
        valueKind: "constant",
        value: 1,
      };
    case "str_slice":
      return {
        kind: "str-op",
        mode: "slice",
        column: first,
        sliceMode: "replaceFirst",
        n: 3,
        replacement: "dog",
      };
    case "str_replace":
      return { kind: "str-op", mode: "replace", column: first, pattern: "", replacement: "", regex: false };
    case "str_extract":
      return {
        kind: "str-op",
        mode: "extract",
        column: first,
        pattern: "(\\d+)",
        group: 1,
        outputName: `${first}_extract`,
      };
    case "str_split":
      return {
        kind: "str-op",
        mode: "split",
        column: first,
        separator: "_",
        parts: 2,
        outputPrefix: `${first}_part`,
      };
    case "str_case":
      return { kind: "str-op", mode: "case", column: first, caseMode: "upper" };
    case "str_strip":
      return { kind: "str-op", mode: "strip", column: first, stripMode: "both" };
    case "str_cat":
      return {
        kind: "str-op",
        mode: "cat",
        columns: cols.slice(0, Math.min(2, cols.length)),
        separator: "_",
        outputName: "combined",
      };
    case "astype":
      return { kind: "astype", column: first, to: "number" };
    case "todate":
      return { kind: "to-date", column: first, format: "%Y-%m-%d" };
    case "dateparts":
      return { kind: "date-parts", column: first, parts: ["year", "month"] };
    case "clip":
      return { kind: "clip", column: firstNum, lower: 0, upper: 1 };
    case "round":
      return { kind: "round", column: firstNum, decimals: 2 };
    case "bin":
      return {
        kind: "bin",
        column: firstNum,
        mode: "quantiles",
        quantiles: 4,
        outputName: `${firstNum}_bin`,
      };
    case "map":
      return { kind: "map", column: first, mapping: [{ from: "", to: "" }] };
    case "rank":
      return {
        kind: "rank",
        column: firstNum,
        ascending: false,
        method: "min",
        outputName: `${firstNum}_rank`,
      };
    case "cumulative":
      return {
        kind: "cumulative",
        column: firstNum,
        func: "sum",
        outputName: `${firstNum}_cumsum`,
      };
    case "lag":
      return {
        kind: "lag",
        column: firstNum,
        mode: "shift",
        periods: 1,
        outputName: `${firstNum}_lag`,
      };
    case "rolling":
      return {
        kind: "rolling",
        column: firstNum,
        size: 3,
        func: "mean",
        outputName: `${firstNum}_rolling`,
      };
    case "isin":
      return { kind: "isin", column: first, values: [], negate: false };
    case "between":
      return { kind: "between", column: firstNum, lower: 0, upper: 1 };
    case "topn":
      return { kind: "topn", column: firstNum, n: 10, which: "largest" };
    case "sample":
      return { kind: "sample", mode: "count", n: 100 };
    case "valuecounts":
      return { kind: "value_counts", column: first };
    case "describe":
      return { kind: "describe", columns: [] };
    case "crosstab":
      return { kind: "crosstab", row: first, column: cols[1] ?? first };
    case "pivottable":
      return {
        kind: "pivot_table",
        index: first,
        columns: cols[1] ?? first,
        value: firstNum,
        agg: "mean",
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Per-op param editors. Inline, mirroring the mockup. Only the wired ops.
// ---------------------------------------------------------------------------

const PRED_OPTIONS: { value: string; label: string }[] = [
  { value: "lt", label: "<" },
  { value: "gt", label: ">" },
  { value: "le", label: "<=" },
  { value: "ge", label: ">=" },
  { value: "eq", label: "=" },
  { value: "ne", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "is_empty", label: "is empty" },
];

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="text-meta font-medium text-foreground-muted">{children}</span>;
}

function selectCls() {
  return "rounded-md border border-border bg-surface px-2 py-1 text-meta text-foreground focus:border-sky-400 focus:outline-none";
}
function inputCls() {
  return "rounded-md border border-border bg-surface px-2 py-1 text-meta text-foreground focus:border-sky-400 focus:outline-none";
}

function OpParams({
  op,
  cols,
  onChange,
}: {
  op: TransformOp;
  cols: string[];
  onChange: (next: TransformOp) => void;
}) {
  const colOptions = cols.map((c) => (
    <option key={c} value={c}>
      {c}
    </option>
  ));

  if (op.kind === "filter" && op.node.type === "condition") {
    const c = op.node.condition;
    const setCond = (patch: Partial<typeof c>) =>
      onChange({ ...op, node: { type: "condition", condition: { ...c, ...patch } } });
    return (
      <>
        <Pill>in</Pill>
        <select
          className={selectCls()}
          value={c.column}
          onChange={(e) => setCond({ column: e.target.value })}
        >
          {colOptions}
        </select>
        <Pill>where</Pill>
        <select
          className={selectCls()}
          value={c.op}
          onChange={(e) => setCond({ op: e.target.value as typeof c.op })}
        >
          {PRED_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {c.op !== "is_empty" && (
          <input
            className={`${inputCls()} w-24`}
            value={String(c.value ?? "")}
            onChange={(e) => {
              const raw = e.target.value;
              const n = Number(raw);
              setCond({ value: raw !== "" && Number.isFinite(n) ? n : raw });
            }}
          />
        )}
      </>
    );
  }

  if (op.kind === "select") {
    return (
      <>
        <Pill>keep</Pill>
        <input
          className={`${inputCls()} w-64`}
          value={op.columns.join(", ")}
          onChange={(e) =>
            onChange({
              ...op,
              columns: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            })
          }
        />
      </>
    );
  }

  if (op.kind === "drop") {
    return (
      <>
        <Pill>drop</Pill>
        <input
          className={`${inputCls()} w-64`}
          value={op.columns.join(", ")}
          onChange={(e) =>
            onChange({
              ...op,
              columns: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            })
          }
        />
      </>
    );
  }

  if (op.kind === "derive") {
    return (
      <>
        <Pill>new column</Pill>
        <input
          className={`${inputCls()} w-32`}
          value={op.outputName}
          onChange={(e) => onChange({ ...op, outputName: e.target.value })}
        />
        <Pill>=</Pill>
        <input
          className={`${inputCls()} w-48 font-mono`}
          value={op.formula}
          onChange={(e) => onChange({ ...op, formula: e.target.value })}
        />
      </>
    );
  }

  if (op.kind === "rename") {
    const [from, to] = Object.entries(op.mapping)[0] ?? ["", ""];
    return (
      <>
        <Pill>rename</Pill>
        <select
          className={selectCls()}
          value={from}
          onChange={(e) => onChange({ ...op, mapping: { [e.target.value]: to } })}
        >
          {colOptions}
        </select>
        <Pill>to</Pill>
        <input
          className={`${inputCls()} w-36`}
          value={to}
          onChange={(e) => onChange({ ...op, mapping: { [from]: e.target.value } })}
        />
      </>
    );
  }

  if (op.kind === "sort") {
    const key = op.by[0] ?? { column: cols[0] ?? "", direction: "desc" as const };
    return (
      <>
        <Pill>by</Pill>
        <select
          className={selectCls()}
          value={key.column}
          onChange={(e) => onChange({ ...op, by: [{ ...key, column: e.target.value }] })}
        >
          {colOptions}
        </select>
        <select
          className={selectCls()}
          value={key.direction}
          onChange={(e) =>
            onChange({ ...op, by: [{ ...key, direction: e.target.value as "asc" | "desc" }] })
          }
        >
          <option value="desc">descending</option>
          <option value="asc">ascending</option>
        </select>
      </>
    );
  }

  if (op.kind === "dedupe") {
    return (
      <>
        <Pill>on</Pill>
        <input
          className={`${inputCls()} w-64`}
          placeholder="all columns"
          value={(op.subset ?? []).join(", ")}
          onChange={(e) => {
            const subset = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
            onChange({ ...op, subset: subset.length ? subset : undefined });
          }}
        />
      </>
    );
  }

  if (op.kind === "groupby") {
    const agg = op.aggregations[0] ?? { column: cols[0] ?? "", func: "mean" as const };
    const by = op.by[0] ?? cols[0] ?? "";
    return (
      <>
        <Pill>by</Pill>
        <select
          className={selectCls()}
          value={by}
          onChange={(e) => onChange({ ...op, by: [e.target.value] })}
        >
          {colOptions}
        </select>
        <select
          className={selectCls()}
          value={agg.func}
          onChange={(e) =>
            onChange({
              ...op,
              aggregations: [
                {
                  ...agg,
                  func: e.target.value as typeof agg.func,
                  outputName: `${agg.column}_${e.target.value}`,
                },
              ],
            })
          }
        >
          {["mean", "sum", "count", "median", "min", "max"].map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <Pill>of</Pill>
        <select
          className={selectCls()}
          value={agg.column}
          onChange={(e) =>
            onChange({
              ...op,
              aggregations: [
                { ...agg, column: e.target.value, outputName: `${e.target.value}_${agg.func}` },
              ],
            })
          }
        >
          {colOptions}
        </select>
      </>
    );
  }

  if (op.kind === "fillna") {
    return (
      <>
        <Pill>in</Pill>
        <select
          className={selectCls()}
          value={op.column}
          onChange={(e) => onChange({ ...op, column: e.target.value })}
        >
          {colOptions}
        </select>
        <Pill>fill empties with</Pill>
        <select
          className={selectCls()}
          value={op.method}
          onChange={(e) => onChange({ ...op, method: e.target.value as typeof op.method })}
        >
          <option value="constant">a value</option>
          <option value="ffill">previous value</option>
          <option value="bfill">next value</option>
          <option value="mean">column mean</option>
          <option value="median">column median</option>
        </select>
        {op.method === "constant" && (
          <input
            className={`${inputCls()} w-24`}
            value={String(op.value ?? "")}
            onChange={(e) => {
              const raw = e.target.value;
              const n = Number(raw);
              onChange({ ...op, value: raw !== "" && Number.isFinite(n) ? n : raw });
            }}
          />
        )}
      </>
    );
  }

  if (op.kind === "dropna") {
    return (
      <>
        <Pill>drop rows empty in</Pill>
        <select
          className={selectCls()}
          value={op.how}
          onChange={(e) => onChange({ ...op, how: e.target.value as "any" | "all" })}
        >
          <option value="any">any of</option>
          <option value="all">all of</option>
        </select>
        <input
          className={`${inputCls()} w-56`}
          placeholder="all columns"
          value={(op.columns ?? []).join(", ")}
          onChange={(e) => {
            const c = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
            onChange({ ...op, columns: c.length ? c : undefined });
          }}
        />
      </>
    );
  }

  if (op.kind === "set-where") {
    const w = op.where.type === "condition" ? op.where.condition : null;
    return (
      <>
        <Pill>set</Pill>
        <select
          className={selectCls()}
          value={op.column}
          onChange={(e) => onChange({ ...op, column: e.target.value })}
        >
          {colOptions}
        </select>
        <Pill>where</Pill>
        {w && (
          <>
            <select
              className={selectCls()}
              value={w.column}
              onChange={(e) =>
                onChange({ ...op, where: { type: "condition", condition: { ...w, column: e.target.value } } })
              }
            >
              {colOptions}
            </select>
            <select
              className={selectCls()}
              value={w.op}
              onChange={(e) =>
                onChange({
                  ...op,
                  where: { type: "condition", condition: { ...w, op: e.target.value as typeof w.op } },
                })
              }
            >
              {PRED_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            {w.op !== "is_empty" && (
              <input
                className={`${inputCls()} w-20`}
                value={String(w.value ?? "")}
                onChange={(e) => {
                  const raw = e.target.value;
                  const n = Number(raw);
                  onChange({
                    ...op,
                    where: {
                      type: "condition",
                      condition: { ...w, value: raw !== "" && Number.isFinite(n) ? n : raw },
                    },
                  });
                }}
              />
            )}
          </>
        )}
        <Pill>to</Pill>
        <select
          className={selectCls()}
          value={op.valueKind}
          onChange={(e) => onChange({ ...op, valueKind: e.target.value as "constant" | "formula" })}
        >
          <option value="constant">a value</option>
          <option value="formula">a formula</option>
        </select>
        {op.valueKind === "formula" ? (
          <input
            className={`${inputCls()} w-40 font-mono`}
            placeholder="e.g. a + b"
            value={op.formula ?? ""}
            onChange={(e) => onChange({ ...op, formula: e.target.value })}
          />
        ) : (
          <input
            className={`${inputCls()} w-24`}
            value={String(op.value ?? "")}
            onChange={(e) => {
              const raw = e.target.value;
              const n = Number(raw);
              onChange({ ...op, value: raw !== "" && Number.isFinite(n) ? n : raw });
            }}
          />
        )}
      </>
    );
  }

  if (op.kind === "str-op") {
    const colSelect = (value: string, onCol: (c: string) => void) => (
      <select className={selectCls()} value={value} onChange={(e) => onCol(e.target.value)}>
        {colOptions}
      </select>
    );
    if (op.mode === "slice") {
      return (
        <>
          <Pill>in</Pill>
          {colSelect(op.column, (c) => onChange({ ...op, column: c }))}
          <select
            className={selectCls()}
            value={op.sliceMode}
            onChange={(e) => onChange({ ...op, sliceMode: e.target.value as "replaceFirst" | "substring" })}
          >
            <option value="replaceFirst">replace first N chars</option>
            <option value="substring">keep substring</option>
          </select>
          {op.sliceMode === "replaceFirst" ? (
            <>
              <Pill>N</Pill>
              <input
                className={`${inputCls()} w-14`}
                value={String(op.n ?? 0)}
                onChange={(e) => onChange({ ...op, n: Number(e.target.value) || 0 })}
              />
              <Pill>with</Pill>
              <input
                className={`${inputCls()} w-24`}
                value={op.replacement ?? ""}
                onChange={(e) => onChange({ ...op, replacement: e.target.value })}
              />
            </>
          ) : (
            <>
              <Pill>from</Pill>
              <input
                className={`${inputCls()} w-14`}
                value={String(op.start ?? 0)}
                onChange={(e) => onChange({ ...op, start: Number(e.target.value) || 0 })}
              />
              <Pill>to</Pill>
              <input
                className={`${inputCls()} w-14`}
                value={op.end === undefined ? "" : String(op.end)}
                placeholder="end"
                onChange={(e) => {
                  const v = e.target.value.trim();
                  onChange({ ...op, end: v === "" ? undefined : Number(v) });
                }}
              />
            </>
          )}
        </>
      );
    }
    if (op.mode === "replace") {
      return (
        <>
          <Pill>in</Pill>
          {colSelect(op.column, (c) => onChange({ ...op, column: c }))}
          <Pill>replace</Pill>
          <input
            className={`${inputCls()} w-28`}
            value={op.pattern}
            onChange={(e) => onChange({ ...op, pattern: e.target.value })}
          />
          <Pill>with</Pill>
          <input
            className={`${inputCls()} w-28`}
            value={op.replacement}
            onChange={(e) => onChange({ ...op, replacement: e.target.value })}
          />
          <label className="inline-flex items-center gap-1 text-meta text-foreground-muted">
            <input
              type="checkbox"
              checked={!!op.regex}
              onChange={(e) => onChange({ ...op, regex: e.target.checked })}
            />
            regex
          </label>
        </>
      );
    }
    if (op.mode === "extract") {
      return (
        <>
          <Pill>from</Pill>
          {colSelect(op.column, (c) => onChange({ ...op, column: c }))}
          <Pill>regex</Pill>
          <input
            className={`${inputCls()} w-32 font-mono`}
            value={op.pattern}
            onChange={(e) => onChange({ ...op, pattern: e.target.value })}
          />
          <Pill>group</Pill>
          <input
            className={`${inputCls()} w-12`}
            value={String(op.group ?? 1)}
            onChange={(e) => onChange({ ...op, group: Number(e.target.value) || 1 })}
          />
          <Pill>into</Pill>
          <input
            className={`${inputCls()} w-32`}
            value={op.outputName}
            onChange={(e) => onChange({ ...op, outputName: e.target.value })}
          />
        </>
      );
    }
    if (op.mode === "split") {
      return (
        <>
          <Pill>split</Pill>
          {colSelect(op.column, (c) => onChange({ ...op, column: c }))}
          <Pill>on</Pill>
          <input
            className={`${inputCls()} w-16`}
            value={op.separator}
            onChange={(e) => onChange({ ...op, separator: e.target.value })}
          />
          <Pill>into</Pill>
          <input
            className={`${inputCls()} w-12`}
            value={String(op.parts)}
            onChange={(e) => onChange({ ...op, parts: Math.max(1, Number(e.target.value) || 1) })}
          />
          <Pill>columns</Pill>
        </>
      );
    }
    if (op.mode === "case") {
      return (
        <>
          <Pill>set</Pill>
          {colSelect(op.column, (c) => onChange({ ...op, column: c }))}
          <Pill>to</Pill>
          <select
            className={selectCls()}
            value={op.caseMode}
            onChange={(e) => onChange({ ...op, caseMode: e.target.value as "upper" | "lower" | "title" })}
          >
            <option value="upper">UPPER</option>
            <option value="lower">lower</option>
            <option value="title">Title</option>
          </select>
        </>
      );
    }
    if (op.mode === "strip") {
      return (
        <>
          <Pill>trim</Pill>
          {colSelect(op.column, (c) => onChange({ ...op, column: c }))}
          <select
            className={selectCls()}
            value={op.stripMode}
            onChange={(e) => onChange({ ...op, stripMode: e.target.value as "both" | "left" | "right" })}
          >
            <option value="both">both sides</option>
            <option value="left">left</option>
            <option value="right">right</option>
          </select>
        </>
      );
    }
    if (op.mode === "cat") {
      return (
        <>
          <Pill>join</Pill>
          <input
            className={`${inputCls()} w-48`}
            value={op.columns.join(", ")}
            onChange={(e) =>
              onChange({
                ...op,
                columns: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
              })
            }
          />
          <Pill>with</Pill>
          <input
            className={`${inputCls()} w-16`}
            value={op.separator}
            onChange={(e) => onChange({ ...op, separator: e.target.value })}
          />
          <Pill>into</Pill>
          <input
            className={`${inputCls()} w-32`}
            value={op.outputName}
            onChange={(e) => onChange({ ...op, outputName: e.target.value })}
          />
        </>
      );
    }
  }

  if (op.kind === "astype") {
    return (
      <>
        <Pill>cast</Pill>
        <select
          className={selectCls()}
          value={op.column}
          onChange={(e) => onChange({ ...op, column: e.target.value })}
        >
          {colOptions}
        </select>
        <Pill>to</Pill>
        <select
          className={selectCls()}
          value={op.to}
          onChange={(e) => onChange({ ...op, to: e.target.value as typeof op.to })}
        >
          <option value="number">number</option>
          <option value="text">text</option>
          <option value="boolean">boolean</option>
          <option value="date">date</option>
        </select>
      </>
    );
  }

  if (op.kind === "to-date") {
    return (
      <>
        <Pill>parse</Pill>
        <select
          className={selectCls()}
          value={op.column}
          onChange={(e) => onChange({ ...op, column: e.target.value })}
        >
          {colOptions}
        </select>
        <Pill>format</Pill>
        <input
          className={`${inputCls()} w-32 font-mono`}
          value={op.format}
          onChange={(e) => onChange({ ...op, format: e.target.value })}
        />
      </>
    );
  }

  if (op.kind === "date-parts") {
    const PARTS: Array<"year" | "month" | "day" | "weekday" | "hour"> = [
      "year",
      "month",
      "day",
      "weekday",
      "hour",
    ];
    const toggle = (p: (typeof PARTS)[number]) =>
      onChange({
        ...op,
        parts: op.parts.includes(p) ? op.parts.filter((x) => x !== p) : [...op.parts, p],
      });
    return (
      <>
        <Pill>from</Pill>
        <select
          className={selectCls()}
          value={op.column}
          onChange={(e) => onChange({ ...op, column: e.target.value })}
        >
          {colOptions}
        </select>
        <Pill>extract</Pill>
        {PARTS.map((p) => (
          <label key={p} className="inline-flex items-center gap-1 text-meta text-foreground-muted">
            <input type="checkbox" checked={op.parts.includes(p)} onChange={() => toggle(p)} />
            {p}
          </label>
        ))}
      </>
    );
  }

  if (op.kind === "clip") {
    return (
      <>
        <Pill>clamp</Pill>
        <select
          className={selectCls()}
          value={op.column}
          onChange={(e) => onChange({ ...op, column: e.target.value })}
        >
          {colOptions}
        </select>
        <Pill>between</Pill>
        <input
          className={`${inputCls()} w-20`}
          placeholder="min"
          value={op.lower ?? ""}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange({ ...op, lower: e.target.value === "" ? undefined : n });
          }}
        />
        <Pill>and</Pill>
        <input
          className={`${inputCls()} w-20`}
          placeholder="max"
          value={op.upper ?? ""}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange({ ...op, upper: e.target.value === "" ? undefined : n });
          }}
        />
      </>
    );
  }

  if (op.kind === "round") {
    return (
      <>
        <Pill>round</Pill>
        <select
          className={selectCls()}
          value={op.column}
          onChange={(e) => onChange({ ...op, column: e.target.value })}
        >
          {colOptions}
        </select>
        <Pill>to</Pill>
        <input
          className={`${inputCls()} w-16`}
          type="number"
          value={op.decimals ?? 0}
          onChange={(e) => onChange({ ...op, decimals: Math.max(0, Number(e.target.value) || 0) })}
        />
        <Pill>decimals</Pill>
      </>
    );
  }

  if (op.kind === "bin") {
    return (
      <>
        <Pill>bin</Pill>
        <select
          className={selectCls()}
          value={op.column}
          onChange={(e) => onChange({ ...op, column: e.target.value })}
        >
          {colOptions}
        </select>
        <Pill>by</Pill>
        <select
          className={selectCls()}
          value={op.mode}
          onChange={(e) => onChange({ ...op, mode: e.target.value as typeof op.mode })}
        >
          <option value="quantiles">quantiles</option>
          <option value="ranges">ranges</option>
        </select>
        {op.mode === "quantiles" ? (
          <>
            <input
              className={`${inputCls()} w-16`}
              type="number"
              value={op.quantiles ?? 4}
              onChange={(e) => onChange({ ...op, quantiles: Math.max(1, Number(e.target.value) || 1) })}
            />
            <Pill>buckets</Pill>
          </>
        ) : (
          <input
            className={`${inputCls()} w-44`}
            placeholder="edges e.g. 0, 10, 20"
            value={(op.edges ?? []).join(", ")}
            onChange={(e) => {
              const edges = e.target.value
                .split(",")
                .map((s) => Number(s.trim()))
                .filter((n) => Number.isFinite(n));
              onChange({ ...op, edges });
            }}
          />
        )}
        <Pill>into</Pill>
        <input
          className={`${inputCls()} w-32`}
          value={op.outputName}
          onChange={(e) => onChange({ ...op, outputName: e.target.value })}
        />
      </>
    );
  }

  if (op.kind === "map") {
    const setPair = (i: number, key: "from" | "to", value: string) => {
      const mapping = op.mapping.map((m, j) => (j === i ? { ...m, [key]: value } : m));
      onChange({ ...op, mapping });
    };
    return (
      <>
        <Pill>map</Pill>
        <select
          className={selectCls()}
          value={op.column}
          onChange={(e) => onChange({ ...op, column: e.target.value })}
        >
          {colOptions}
        </select>
        {op.mapping.map((m, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <input
              className={`${inputCls()} w-20`}
              placeholder="from"
              value={m.from}
              onChange={(e) => setPair(i, "from", e.target.value)}
            />
            <Pill>to</Pill>
            <input
              className={`${inputCls()} w-20`}
              placeholder="to"
              value={m.to}
              onChange={(e) => setPair(i, "to", e.target.value)}
            />
          </span>
        ))}
        <Tooltip label="Add a mapping">
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 text-meta text-foreground-muted"
            onClick={() => onChange({ ...op, mapping: [...op.mapping, { from: "", to: "" }] })}
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </>
    );
  }

  if (op.kind === "rank") {
    return (
      <>
        <Pill>rank</Pill>
        <select
          className={selectCls()}
          value={op.column}
          onChange={(e) => onChange({ ...op, column: e.target.value })}
        >
          {colOptions}
        </select>
        <select
          className={selectCls()}
          value={op.ascending ? "asc" : "desc"}
          onChange={(e) => onChange({ ...op, ascending: e.target.value === "asc" })}
        >
          <option value="desc">largest first</option>
          <option value="asc">smallest first</option>
        </select>
        <select
          className={selectCls()}
          value={op.method}
          onChange={(e) => onChange({ ...op, method: e.target.value as typeof op.method })}
        >
          <option value="min">ties share the lower rank</option>
          <option value="dense">dense (no gaps)</option>
        </select>
        <Pill>into</Pill>
        <input
          className={`${inputCls()} w-32`}
          value={op.outputName}
          onChange={(e) => onChange({ ...op, outputName: e.target.value })}
        />
      </>
    );
  }

  if (op.kind === "cumulative") {
    return (
      <>
        <Pill>running</Pill>
        <select
          className={selectCls()}
          value={op.func}
          onChange={(e) => onChange({ ...op, func: e.target.value as typeof op.func })}
        >
          <option value="sum">sum</option>
          <option value="prod">product</option>
          <option value="max">max</option>
          <option value="min">min</option>
        </select>
        <Pill>of</Pill>
        <select
          className={selectCls()}
          value={op.column}
          onChange={(e) => onChange({ ...op, column: e.target.value })}
        >
          {colOptions}
        </select>
        <Pill>into</Pill>
        <input
          className={`${inputCls()} w-32`}
          value={op.outputName}
          onChange={(e) => onChange({ ...op, outputName: e.target.value })}
        />
      </>
    );
  }

  if (op.kind === "lag") {
    return (
      <>
        <select
          className={selectCls()}
          value={op.mode}
          onChange={(e) => onChange({ ...op, mode: e.target.value as typeof op.mode })}
        >
          <option value="shift">shift</option>
          <option value="diff">difference</option>
          <option value="pct_change">percent change</option>
        </select>
        <Pill>of</Pill>
        <select
          className={selectCls()}
          value={op.column}
          onChange={(e) => onChange({ ...op, column: e.target.value })}
        >
          {colOptions}
        </select>
        <Pill>by</Pill>
        <input
          className={`${inputCls()} w-16`}
          type="number"
          value={op.periods ?? 1}
          onChange={(e) => onChange({ ...op, periods: Number(e.target.value) || 1 })}
        />
        <Pill>rows into</Pill>
        <input
          className={`${inputCls()} w-32`}
          value={op.outputName}
          onChange={(e) => onChange({ ...op, outputName: e.target.value })}
        />
      </>
    );
  }

  if (op.kind === "rolling") {
    return (
      <>
        <Pill>rolling</Pill>
        <select
          className={selectCls()}
          value={op.func}
          onChange={(e) => onChange({ ...op, func: e.target.value as typeof op.func })}
        >
          <option value="mean">mean</option>
          <option value="sum">sum</option>
          <option value="min">min</option>
          <option value="max">max</option>
        </select>
        <Pill>of</Pill>
        <select
          className={selectCls()}
          value={op.column}
          onChange={(e) => onChange({ ...op, column: e.target.value })}
        >
          {colOptions}
        </select>
        <Pill>over</Pill>
        <input
          className={`${inputCls()} w-16`}
          type="number"
          value={op.size}
          onChange={(e) => onChange({ ...op, size: Math.max(1, Number(e.target.value) || 1) })}
        />
        <Pill>rows into</Pill>
        <input
          className={`${inputCls()} w-32`}
          value={op.outputName}
          onChange={(e) => onChange({ ...op, outputName: e.target.value })}
        />
      </>
    );
  }

  if (op.kind === "isin") {
    return (
      <>
        <Pill>keep rows where</Pill>
        <select
          className={selectCls()}
          value={op.column}
          onChange={(e) => onChange({ ...op, column: e.target.value })}
        >
          {colOptions}
        </select>
        <select
          className={selectCls()}
          value={op.negate ? "not" : "in"}
          onChange={(e) => onChange({ ...op, negate: e.target.value === "not" })}
        >
          <option value="in">is in</option>
          <option value="not">is not in</option>
        </select>
        <input
          className={`${inputCls()} w-56`}
          placeholder="values, comma separated"
          value={op.values.join(", ")}
          onChange={(e) =>
            onChange({
              ...op,
              values: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            })
          }
        />
      </>
    );
  }

  if (op.kind === "between") {
    return (
      <>
        <Pill>keep rows where</Pill>
        <select
          className={selectCls()}
          value={op.column}
          onChange={(e) => onChange({ ...op, column: e.target.value })}
        >
          {colOptions}
        </select>
        <Pill>is between</Pill>
        <input
          className={`${inputCls()} w-20`}
          value={op.lower}
          onChange={(e) => onChange({ ...op, lower: Number(e.target.value) || 0 })}
        />
        <Pill>and</Pill>
        <input
          className={`${inputCls()} w-20`}
          value={op.upper}
          onChange={(e) => onChange({ ...op, upper: Number(e.target.value) || 0 })}
        />
      </>
    );
  }

  if (op.kind === "topn") {
    return (
      <>
        <Pill>keep the</Pill>
        <input
          className={`${inputCls()} w-16`}
          type="number"
          value={op.n}
          onChange={(e) => onChange({ ...op, n: Math.max(0, Number(e.target.value) || 0) })}
        />
        <select
          className={selectCls()}
          value={op.which}
          onChange={(e) => onChange({ ...op, which: e.target.value as typeof op.which })}
        >
          <option value="largest">largest</option>
          <option value="smallest">smallest</option>
        </select>
        <Pill>by</Pill>
        <select
          className={selectCls()}
          value={op.column}
          onChange={(e) => onChange({ ...op, column: e.target.value })}
        >
          {colOptions}
        </select>
      </>
    );
  }

  if (op.kind === "sample") {
    return (
      <>
        <Pill>sample</Pill>
        <select
          className={selectCls()}
          value={op.mode}
          onChange={(e) => onChange({ ...op, mode: e.target.value as typeof op.mode })}
        >
          <option value="count">a number of rows</option>
          <option value="fraction">a fraction of rows</option>
        </select>
        {op.mode === "count" ? (
          <input
            className={`${inputCls()} w-20`}
            type="number"
            value={op.n ?? 0}
            onChange={(e) => onChange({ ...op, n: Math.max(0, Number(e.target.value) || 0) })}
          />
        ) : (
          <input
            className={`${inputCls()} w-20`}
            type="number"
            step="0.01"
            value={op.fraction ?? 0}
            onChange={(e) => onChange({ ...op, fraction: Number(e.target.value) || 0 })}
          />
        )}
        <Pill>seed</Pill>
        <input
          className={`${inputCls()} w-20`}
          placeholder="optional"
          value={op.seed ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange({ ...op, seed: v === "" ? undefined : Number(v) });
          }}
        />
      </>
    );
  }

  if (op.kind === "value_counts") {
    return (
      <>
        <Pill>count values in</Pill>
        <select
          className={selectCls()}
          value={op.column}
          onChange={(e) => onChange({ ...op, column: e.target.value })}
        >
          {colOptions}
        </select>
      </>
    );
  }

  if (op.kind === "describe") {
    return (
      <>
        <Pill>describe</Pill>
        <input
          className={`${inputCls()} w-56`}
          placeholder="all numeric columns"
          value={(op.columns ?? []).join(", ")}
          onChange={(e) => {
            const c = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
            onChange({ ...op, columns: c });
          }}
        />
      </>
    );
  }

  if (op.kind === "crosstab") {
    return (
      <>
        <Pill>rows</Pill>
        <select
          className={selectCls()}
          value={op.row}
          onChange={(e) => onChange({ ...op, row: e.target.value })}
        >
          {colOptions}
        </select>
        <Pill>columns</Pill>
        <select
          className={selectCls()}
          value={op.column}
          onChange={(e) => onChange({ ...op, column: e.target.value })}
        >
          {colOptions}
        </select>
      </>
    );
  }

  if (op.kind === "pivot_table") {
    return (
      <>
        <Pill>index</Pill>
        <select
          className={selectCls()}
          value={op.index}
          onChange={(e) => onChange({ ...op, index: e.target.value })}
        >
          {colOptions}
        </select>
        <Pill>spread</Pill>
        <select
          className={selectCls()}
          value={op.columns}
          onChange={(e) => onChange({ ...op, columns: e.target.value })}
        >
          {colOptions}
        </select>
        <Pill>of</Pill>
        <select
          className={selectCls()}
          value={op.value}
          onChange={(e) => onChange({ ...op, value: e.target.value })}
        >
          {colOptions}
        </select>
        <select
          className={selectCls()}
          value={op.agg}
          onChange={(e) => onChange({ ...op, agg: e.target.value as typeof op.agg })}
        >
          <option value="mean">mean</option>
          <option value="sum">sum</option>
          <option value="count">count</option>
          <option value="min">min</option>
          <option value="max">max</option>
        </select>
      </>
    );
  }

  return <Pill>parameters for {VERB[op.kind] ?? op.kind}</Pill>;
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export default function TransformBuilder({
  owner,
  sidecar,
  onClose,
  onSaved,
  mintId,
}: {
  owner: string;
  sidecar: DatasetSidecar;
  onClose: () => void;
  /** Called with the new derived sidecar after Save as new dataset. */
  onSaved: (saved: DatasetSidecar) => void;
  /** Mint a fresh dataset id (shares the datahub counter). */
  mintId: () => Promise<string>;
}) {
  const allCols = useMemo(() => sidecar.schema.map((c) => c.name), [sidecar.schema]);
  const numericCols = useMemo(
    () => sidecar.schema.filter((c) => c.type === "number").map((c) => c.name),
    [sidecar.schema],
  );

  const [pipe, setPipe] = useState<TransformOp[]>(sidecar.recipe ?? []);
  const [codeTab, setCodeTab] = useState<"pandas" | "sql">("sql");
  const [handle, setHandle] = useState<OpenDatasetHandle | null>(null);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [previewCols, setPreviewCols] = useState<string[]>(allCols);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [stepCounts, setStepCounts] = useState<(number | null)[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState(`${sidecar.name} (transformed)`);
  const [showSave, setShowSave] = useState(false);
  const [opQuery, setOpQuery] = useState("");

  const runSeqRef = useRef(0);

  // Open the source dataset into DuckDB once.
  useEffect(() => {
    let cancelled = false;
    let opened: OpenDatasetHandle | null = null;
    void (async () => {
      try {
        const h = await openDataset(owner, sidecar);
        if (cancelled) {
          await closeDataset(h);
          return;
        }
        opened = h;
        setHandle(h);
      } catch (e) {
        if (!cancelled) {
          setPreviewError(e instanceof Error ? e.message : "Could not open the dataset.");
        }
      }
    })();
    return () => {
      cancelled = true;
      if (opened) void closeDataset(opened);
    };
  }, [owner, sidecar]);

  // Recompute the live preview + per-step affected-row estimates whenever the
  // pipeline or the handle changes. The recipe runs on demand against the source
  // Parquet, materializing only the preview window (spec section 9).
  const recompute = useCallback(
    async (currentPipe: TransformOp[]) => {
      if (!handle) return;
      const seq = ++runSeqRef.current;
      setBusy(true);
      setPreviewError(null);
      try {
        // Result column list (a derive adds a column, a select narrows).
        const resultColumns = await recipeResultColumns(handle, currentPipe);
        const rows = await readRowWindow(handle, 0, PREVIEW_ROWS, [], currentPipe);
        const total = await countRows(handle, currentPipe);
        // Per-step affected counts: count rows after each prefix of the pipeline.
        const counts: (number | null)[] = [];
        for (let i = 0; i < currentPipe.length; i++) {
          try {
            const c = await countRows(handle, currentPipe.slice(0, i + 1));
            counts.push(c);
          } catch {
            counts.push(null);
          }
        }
        if (seq !== runSeqRef.current) return;
        setPreviewCols(resultColumns);
        setPreviewRows(rows);
        setResultCount(total);
        setStepCounts(counts);
      } catch (e) {
        if (seq !== runSeqRef.current) return;
        setPreviewError(
          e instanceof Error ? e.message : "Could not run this recipe on the engine.",
        );
      } finally {
        if (seq === runSeqRef.current) setBusy(false);
      }
    },
    [handle],
  );

  useEffect(() => {
    void recompute(pipe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, pipe]);

  const addOp = (kind: string) => {
    const op = defaultOp(kind, allCols, numericCols);
    if (!op) return;
    setPipe((p) => [...p, op]);
  };
  const updateOp = (i: number, next: TransformOp) =>
    setPipe((p) => p.map((o, idx) => (idx === i ? next : o)));
  const removeOp = (i: number) => setPipe((p) => p.filter((_, idx) => idx !== i));

  // The code panel. pandas via transformOpToPandas (the editable lane's
  // generator), SQL via transformOpToSql, both per op so the panel reads as the
  // ordered recipe (data-load inlining is omitted here, this is the rule list).
  const codeText = useMemo(() => {
    if (pipe.length === 0) {
      return codeTab === "pandas"
        ? "# add operations to see the pandas equivalent"
        : "-- add operations to see the SQL equivalent";
    }
    if (codeTab === "pandas") {
      let names = [...allCols];
      return pipe
        .map((op) => {
          const { code } = transformOpToPandas(op, { columnNames: names });
          names = nextNames(names, op);
          return code;
        })
        .join("\n");
    }
    // SQL: show the full compiled query, the one the engine actually runs.
    return recipeToSql(pipe, "read_parquet('<this dataset>')", { columnNames: allCols });
  }, [pipe, codeTab, allCols]);

  const handleSave = async () => {
    if (!handle || pipe.length === 0) return;
    setSaving(true);
    try {
      const id = await mintId();
      const saved = await saveRecipeAsDataset(handle, id, saveName.trim() || sidecar.name, pipe, {
        project_ids: sidecar.project_ids,
        folder_path: sidecar.folder_path,
      });
      onSaved(saved);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Could not save the derived dataset.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4" data-testid="bigtable-transform-builder">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="transform" className="h-4 w-4 text-brand-action" />
        <h2 className="text-heading font-semibold text-foreground">Transform builder</h2>
        <span className="text-meta text-foreground-muted">{sidecar.name}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSave((s) => !s)}
            disabled={pipe.length === 0}
            className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-meta font-semibold disabled:opacity-50"
            data-testid="bigtable-builder-save-open"
          >
            <Icon name="save" className="h-3.5 w-3.5" />
            Save as new dataset
          </button>
          <Tooltip label="Close the builder and return to the dataset preview.">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
              data-testid="bigtable-builder-close"
            >
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {showSave && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-raised p-3">
          <span className="text-meta text-foreground-muted">
            Materialize this recipe to a new dataset on disk. The recipe stays the lineage.
          </span>
          <input
            className={`${inputCls()} ml-auto w-64`}
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            data-testid="bigtable-builder-save-name"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || pipe.length === 0}
            className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-md px-3 py-1.5 text-meta font-semibold disabled:opacity-60"
            data-testid="bigtable-builder-save-confirm"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[200px_1fr] gap-3">
        {/* Palette */}
        <div
          className="overflow-auto rounded-lg border border-border bg-surface-raised p-2"
          data-testid="bigtable-builder-palette"
        >
          {/* Search-first: filter ops by label as you type. */}
          <div className="sticky top-0 z-10 mb-2 bg-surface-raised pb-1">
            <div className="relative">
              <Icon
                name="search"
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-muted"
              />
              <input
                type="text"
                value={opQuery}
                onChange={(e) => setOpQuery(e.target.value)}
                placeholder="Search operations..."
                className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-2 text-meta text-foreground placeholder:text-foreground-muted focus:border-brand-action focus:outline-none"
                data-testid="bigtable-builder-op-search"
              />
            </div>
          </div>
          {PALETTE.map((g) => {
            const q = opQuery.trim().toLowerCase();
            const ops = q
              ? g.ops.filter((o) => o.label.toLowerCase().includes(q))
              : g.ops;
            if (ops.length === 0) return null;
            return (
              <div
                key={g.group}
                className="mb-2 overflow-hidden rounded-lg border border-border bg-surface last:mb-0"
              >
                {/* Tinted card header. The category glyph lives here only, never on each row. */}
                <div className="flex items-center gap-1.5 border-b border-border bg-brand-action/[0.08] px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-brand-action">
                  <Icon name={GROUP_ICON[g.group]} className="h-3 w-3 flex-none" />
                  {g.group}
                </div>
                <div className="p-1">
                  {ops.map((o) =>
                    o.ready ? (
                      <button
                        key={o.kind}
                        type="button"
                        onClick={() => addOp(o.kind)}
                        className="block w-full rounded-md px-2 py-1 text-left text-meta text-foreground transition-colors hover:bg-brand-action/10 hover:text-brand-action"
                        data-testid={`bigtable-builder-op-${o.kind}`}
                      >
                        {o.label}
                      </button>
                    ) : (
                      <Tooltip key={o.kind} label="More operations are coming in the next phase.">
                        <span className="block w-full cursor-not-allowed px-2 py-1 text-left text-meta text-foreground-muted/50">
                          {o.label}
                        </span>
                      </Tooltip>
                    ),
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Stage */}
        <div className="flex min-h-0 flex-col gap-3 overflow-auto">
          {/* Pipeline */}
          <div>
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-foreground-muted">
              Pipeline
            </div>
            <div className="flex flex-col gap-2">
              {pipe.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-meta text-foreground-muted">
                  No operations yet. Pick from the menu on the left. Try Filter, then
                  Derive, then Sort.
                </div>
              ) : (
                pipe.map((op, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-border bg-surface p-2.5"
                    data-testid={`bigtable-builder-step-${i}`}
                  >
                    <div className="flex items-center gap-2 text-meta font-semibold">
                      <span className="text-brand-action">{VERB[op.kind] ?? op.kind}</span>
                      <button
                        type="button"
                        onClick={() => removeOp(i)}
                        className="ml-auto rounded p-0.5 text-foreground-muted transition-colors hover:text-foreground"
                        aria-label="Remove step"
                      >
                        <Icon name="x" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <OpParams op={op} cols={allCols} onChange={(next) => updateOp(i, next)} />
                    </div>
                    <div className="mt-1.5 text-meta text-foreground-muted">
                      {stepCounts[i] != null ? (
                        <>
                          result after this step{" "}
                          <b className="text-brand-action">
                            {stepCounts[i]!.toLocaleString()}
                          </b>{" "}
                          rows
                        </>
                      ) : (
                        <span className="opacity-60">estimating...</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Live preview */}
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center gap-2 border-b border-border-soft bg-surface-raised px-3 py-1.5 text-meta font-semibold text-foreground">
              Live preview, first rows of {sidecar.rowCount.toLocaleString()}
              {resultCount != null && pipe.length > 0 && (
                <span className="text-foreground-muted">
                  result {resultCount.toLocaleString()} rows
                </span>
              )}
              {busy && (
                <span className="ml-auto inline-flex items-center gap-1 text-foreground-muted">
                  <Icon name="refresh" className="h-3 w-3 animate-spin" />
                  running on the engine
                </span>
              )}
            </div>
            {previewError ? (
              <div className="p-3 text-meta text-foreground">
                This recipe could not run. {previewError}
              </div>
            ) : (
              <div className="max-h-64 overflow-auto">
                <table className="w-full border-collapse text-meta tabular-nums">
                  <thead>
                    <tr>
                      {previewCols.map((c) => (
                        <th
                          key={c}
                          className="sticky top-0 border-b border-r border-border-soft bg-surface-raised px-2 py-1 text-right font-semibold"
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, ri) => (
                      <tr key={ri}>
                        {previewCols.map((c) => {
                          const v = r[c];
                          return (
                            <td
                              key={c}
                              className="border-b border-r border-border-soft px-2 py-1 text-right text-foreground"
                            >
                              {v === null || v === undefined ? "" : String(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Code panel */}
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center gap-0 border-b border-border-soft bg-surface-raised">
              {(["pandas", "sql"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setCodeTab(m)}
                  className={`px-3.5 py-1.5 text-meta font-bold transition-colors ${
                    codeTab === m
                      ? "text-brand-action shadow-[inset_0_-2px_0_var(--color-brand-action,#1283C9)]"
                      : "text-foreground-muted"
                  }`}
                  data-testid={`bigtable-builder-code-${m}`}
                >
                  {m === "pandas" ? "pandas" : "SQL"}
                </button>
              ))}
              <span className="ml-auto px-3 text-meta text-foreground-muted">
                show-the-code parity, both export
              </span>
            </div>
            <pre className="max-h-48 overflow-auto bg-[#0d1830] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-[#cfe6ff]">
              {codeText}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mirror codegen.ts nextColumnNames for the pandas-tab running column list, so a
 *  later derive formula resolves the right names in the displayed code. */
function nextNames(current: string[], op: TransformOp): string[] {
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
      return current.includes(op.outputName) ? current : [...current, op.outputName];
    case "str-op": {
      if (op.mode === "extract" || op.mode === "cat") {
        return current.includes(op.outputName) ? current : [...current, op.outputName];
      }
      if (op.mode === "split") {
        const prefix = op.outputPrefix ?? `${op.column}_part`;
        const names = Array.from({ length: op.parts }, (_, i) => `${prefix}_${i + 1}`);
        return [...current, ...names.filter((n) => !current.includes(n))];
      }
      return current;
    }
    case "date-parts": {
      const names = op.parts.map((p) => `${op.column}_${p}`);
      return [...current, ...names.filter((n) => !current.includes(n))];
    }
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
      return [op.row];
    case "pivot_table":
      return [op.index];
    default:
      return current;
  }
}

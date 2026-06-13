"use client";

// datahub/bigtable/dataset-analyses.ts
//
// Statistical ANALYSES on the Data Hub large-dataset lane (DataHub-largetables
// lane, Phase 3a). This is the dataset-lane mirror of the editable lane's
// run-analysis.ts dispatcher, async over DuckDB.
//
// THE VALIDATION GATE (the whole point of this phase). DuckDB ONLY MOVES DATA.
// It pulls the named columns out of the on-disk Parquet into plain number arrays
// (see ./dataset-columns.ts). It NEVER computes a published statistic. EVERY
// statistic is computed by the EXISTING validated JS engine, because this runner
// builds a SYNTHETIC editable-lane DataHubDocContent from the extracted arrays and
// calls the SAME runAnalysis(spec, content) the editable lane calls. There is ONE
// code path for the statistic. A t-test on 247,000 rows is a DuckDB query that
// pulls two columns into arrays, wrapped into a synthetic Column table, handed to
// the same runAnalysis -> unpairedTTest the editable lane uses. No statistic moves
// to an unvalidated path, and the dataset-lane result is NUMBERS-IDENTICAL to the
// editable-lane result on the same data (proven in __tests__/dataset-analyses.test.ts).
//
// WHY a synthetic content instead of factoring runAnalysis. runAnalysis already
// IS array-in / result-out: it reads the finite values out of named columns via
// column-table.ts (columnValues / rowAlignedValues) and dispatches to the engine.
// Re-expressing the dataset's extracted arrays AS a tiny Column table lets the
// dataset lane reuse runAnalysis (and ResultsSheet, which calls runAnalysis on the
// content it is handed) VERBATIM, with zero duplication of any per-type logic and
// zero change to the editable lane. The synthetic content is small (one column per
// resolved input, one row per value), never the 247k-row table; only the engine
// inputs cross from DuckDB.
//
// Client-only: it loads the DuckDB worker through the column readers.
//
// No em-dashes, no emojis, no mid-sentence colons.

import type {
  AnalysisSpec,
  ColumnDef,
  DataHubDocContent,
  DataHubDocument,
  RowRecord,
  CellValue,
} from "@/lib/datahub/model/types";
import {
  runAnalysis,
  specColumnIds,
  type AnalysisType,
  type RunOutcome,
} from "@/lib/datahub/run-analysis";
import type { DatasetSidecar } from "./types";
import type { OpenDatasetHandle } from "./dataset-view";
import {
  readColumn,
  readColumnAligned,
  readColumnByGroup,
} from "./dataset-columns";

/**
 * The analyses Phase 3a runs on a dataset. These are the Column-table family the
 * editable lane drives off resolveGroups / rowAlignedValues, so a synthetic Column
 * table reproduces them exactly. The whole-table archetypes (XY, grouped,
 * survival, contingency, nested) need their own table shapes and are deferred to a
 * later phase, so they are not offered for a dataset.
 */
export const DATASET_ANALYSIS_TYPES: AnalysisType[] = [
  "grubbsOutlier",
  "unpairedTTest",
  "pairedTTest",
  "mannWhitneyU",
  "wilcoxonSignedRank",
  "oneWayAnova",
  "kruskalWallis",
  "repeatedMeasuresAnova",
  "linearMixedModel",
  "multipleRegression",
];

/**
 * Which dataset analyses are runnable for a given number of NUMERIC columns and
 * whether a categorical group-by column exists, mirroring the editable lane's
 * validAnalysisTypes group-count gates. In WIDE mode the chosen numeric columns
 * are the groups (2 for a two-group test, 3+ for ANOVA / RM-ANOVA / mixed model /
 * regression, 1+ for Grubbs). In GROUP-BY mode a single value column split by a
 * categorical column gives the independent-group comparisons (the group count is
 * not known until the column is read, so those are offered whenever at least one
 * categorical column exists, gated at run time by the engine's group-count check).
 */
export function validDatasetAnalysisTypes(
  numericColumns: number,
  hasCategorical: boolean,
): { wide: AnalysisType[]; groupBy: AnalysisType[] } {
  const wide: AnalysisType[] = [];
  if (numericColumns >= 1) wide.push("grubbsOutlier");
  if (numericColumns >= 2) {
    wide.push("unpairedTTest", "pairedTTest", "mannWhitneyU", "wilcoxonSignedRank");
  }
  if (numericColumns >= 3) {
    wide.push(
      "oneWayAnova",
      "kruskalWallis",
      "repeatedMeasuresAnova",
      "linearMixedModel",
      "multipleRegression",
    );
  }
  const groupBy: AnalysisType[] =
    numericColumns >= 1 && hasCategorical
      ? ["unpairedTTest", "mannWhitneyU", "oneWayAnova", "kruskalWallis", "grubbsOutlier"]
      : [];
  return { wide, groupBy };
}

/**
 * True when the analysis reads its columns LISTWISE (a row dropped when ANY chosen
 * column is null in it), so the dataset lane must extract the columns aligned by
 * row. This EXACTLY mirrors which run-analysis branches call rowAlignedValues /
 * the listwise loop: repeated-measures ANOVA and the linear mixed model read
 * rowAlignedValues, and multiple regression drops a row with any missing Y or
 * predictor. Every OTHER type (including the paired t-test and Wilcoxon
 * signed-rank) reads each column INDEPENDENTLY through columnValues / resolveGroups
 * and pairs by array position, so the dataset lane must read those columns
 * independently too, or the paired ordering would differ from the editable lane.
 */
export function analysisIsRowAligned(type: AnalysisType): boolean {
  return (
    type === "repeatedMeasuresAnova" ||
    type === "linearMixedModel" ||
    type === "multipleRegression"
  );
}

/** Stable synthetic ids so the synthetic content is deterministic. */
function synthColumnId(i: number): string {
  return `dscol-${i}`;
}

/**
 * Build the synthetic editable-lane meta for a one-shot Column table. table_type
 * "column" with the default (absent) entryFormat is the raw-replicates path
 * runAnalysis reads, so resolveGroups / rowAlignedValues see the columns as group
 * columns exactly as a hand-entered Column table would.
 */
function synthMeta(name: string): DataHubDocument {
  return {
    id: `__dataset_synthetic__`,
    name,
    project_ids: [],
    folder_path: null,
    table_type: "column",
    created_at: "",
  };
}

/**
 * Wrap per-column finite arrays into a synthetic Column-table content. Each array
 * becomes one role-"y" group column; values are placed positionally down the rows
 * with null padding for shorter columns, so reading a column back via columnValues
 * yields its full finite array (each column independent), exactly the UNALIGNED
 * editable-lane semantics the unpaired / ANOVA / Grubbs branches use.
 */
function contentFromColumns(
  name: string,
  columns: { name: string; values: number[] }[],
): DataHubDocContent {
  const colDefs: ColumnDef[] = columns.map((c, i) => ({
    id: synthColumnId(i),
    name: c.name,
    role: "y",
    dataType: "number",
  }));
  const maxLen = columns.reduce((m, c) => Math.max(m, c.values.length), 0);
  const rows: RowRecord[] = [];
  for (let r = 0; r < maxLen; r++) {
    const cells: Record<string, CellValue> = {};
    for (let i = 0; i < columns.length; i++) {
      const v = columns[i].values[r];
      cells[synthColumnId(i)] = v === undefined ? null : v;
    }
    rows.push({ id: `dsrow-${r}`, cells });
  }
  return { meta: synthMeta(name), columns: colDefs, rows, analyses: [], plots: [] };
}

/**
 * Wrap a row-ALIGNED matrix (every inner array a complete case across the columns)
 * into a synthetic Column-table content. Every row is complete, so columnValues
 * AND rowAlignedValues both read the same rows, which is the listwise / complete
 * case input the paired / repeated-measures / regression branches require.
 */
function contentFromAligned(
  name: string,
  columnNames: string[],
  rowsMatrix: number[][],
): DataHubDocContent {
  const colDefs: ColumnDef[] = columnNames.map((n, i) => ({
    id: synthColumnId(i),
    name: n,
    role: "y",
    dataType: "number",
  }));
  const rows: RowRecord[] = rowsMatrix.map((vals, r) => {
    const cells: Record<string, CellValue> = {};
    for (let i = 0; i < columnNames.length; i++) cells[synthColumnId(i)] = vals[i];
    return { id: `dsrow-${r}`, cells };
  });
  return { meta: synthMeta(name), columns: colDefs, rows, analyses: [], plots: [] };
}

/**
 * Re-point a spec's input column ids onto the synthetic column ids, preserving
 * order (multiple regression reads inputs[0] as Y, the rest as predictors, so
 * order MUST be preserved). The synthetic content's columns are built in the same
 * order, so the nth input id maps to synthColumnId(n).
 */
function specForSynthetic(
  spec: AnalysisSpec,
  inputCount: number,
): AnalysisSpec {
  const columnIds = Array.from({ length: inputCount }, (_, i) => synthColumnId(i));
  return { ...spec, inputs: { ...spec.inputs, columnIds } };
}

/** How the dataset analysis resolves its columns from the spec + sidecar. */
export interface DatasetAnalysisOptions {
  /**
   * A categorical group-by column NAME for the tidy / long path: the spec's first
   * input is the numeric VALUE column, and this column's distinct categories
   * become the comparison groups (unpaired t, one-way ANOVA, Kruskal-Wallis). When
   * absent, the spec's input columns ARE the groups (the wide path), matching the
   * editable lane where each chosen column is a group.
   */
  groupByColumn?: string;
}

/**
 * Resolve the spec's input column ids to dataset SCHEMA column names. The dataset
 * lane stores analysis inputs as schema column names directly (a dataset has no
 * synthetic column-id space of its own), so this is identity-plus-validation: it
 * keeps only ids that name a real column in the sidecar schema, in spec order.
 */
function resolveDatasetColumnNames(
  spec: AnalysisSpec,
  sidecar: DatasetSidecar,
): string[] {
  const known = new Set(sidecar.schema.map((c) => c.name));
  return specColumnIds(spec).filter((id) => known.has(id));
}

/**
 * Run a statistical analysis on a DATASET (the DuckDB / large-table lane).
 *
 * Pulls the spec's columns out of DuckDB into number arrays (DuckDB MOVES DATA),
 * wraps them into a synthetic editable-lane Column table, and runs the SAME
 * runAnalysis the editable lane runs. The returned RunOutcome is the identical
 * normalized shape ResultsSheet renders, so the dataset lane reuses the editable
 * presentation layer verbatim.
 *
 * Two column modes:
 *   - WIDE  (default): the spec's input columns ARE the comparison groups, one
 *            group per column, exactly like a hand-entered Column table. Row
 *            aligned types (paired t, RM-ANOVA, mixed model, multiple regression)
 *            read the columns listwise; the rest read each column independently.
 *   - GROUP-BY (opts.groupByColumn): the spec's first input is the numeric value
 *            column and the group-by column's categories become the groups, the
 *            tidy / long shape a big imported table usually has. Only the
 *            independent-group comparisons (unpaired t, one-way ANOVA,
 *            Kruskal-Wallis) and Grubbs use this mode.
 */
export async function runAnalysisOnDataset(
  handle: OpenDatasetHandle,
  spec: AnalysisSpec,
  sidecar: DatasetSidecar,
  opts: DatasetAnalysisOptions = {},
): Promise<RunOutcome> {
  const type = spec.type as AnalysisType;
  const recipe = sidecar.recipe;

  // GROUP-BY (tidy / long): one value column split into per-category groups.
  if (opts.groupByColumn) {
    const valueColumn = resolveDatasetColumnNames(spec, sidecar)[0];
    if (!valueColumn) {
      return { ok: false, error: "Pick a numeric value column to analyze." };
    }
    if (analysisIsRowAligned(type)) {
      return {
        ok: false,
        error:
          "A row-paired analysis cannot run on a single value column split by a group. Pick the wide column mode.",
      };
    }
    const groups = await readColumnByGroup(
      handle,
      valueColumn,
      opts.groupByColumn,
      recipe,
    );
    if (groups.length === 0) {
      return { ok: false, error: "The group-by column produced no groups." };
    }
    const content = contentFromColumns(
      sidecar.name,
      groups.map((g) => ({ name: g.label, values: g.values })),
    );
    const synthSpec = specForSynthetic(spec, groups.length);
    return runAnalysis(synthSpec, content);
  }

  // WIDE: the chosen columns are the groups.
  const names = resolveDatasetColumnNames(spec, sidecar);
  if (names.length === 0) {
    return { ok: false, error: "Pick at least one column to analyze." };
  }

  if (analysisIsRowAligned(type)) {
    const rowsMatrix = await readColumnAligned(handle, names, recipe);
    const content = contentFromAligned(sidecar.name, names, rowsMatrix);
    const synthSpec = specForSynthetic(spec, names.length);
    return runAnalysis(synthSpec, content);
  }

  const columns = await Promise.all(
    names.map(async (n) => ({ name: n, values: await readColumn(handle, n, recipe) })),
  );
  const content = contentFromColumns(sidecar.name, columns);
  const synthSpec = specForSynthetic(spec, names.length);
  return runAnalysis(synthSpec, content);
}

/**
 * Build the synthetic editable-lane content for a dataset analysis WITHOUT running
 * it, so a UI surface (ResultsSheet) that recomputes runAnalysis(spec, content) on
 * its own render can be handed a content that reproduces the dataset result. This
 * pulls the SAME arrays runAnalysisOnDataset pulls and returns the spec re-pointed
 * onto the synthetic columns, so ResultsSheet's internal recompute matches the run.
 */
export async function buildDatasetAnalysisContent(
  handle: OpenDatasetHandle,
  spec: AnalysisSpec,
  sidecar: DatasetSidecar,
  opts: DatasetAnalysisOptions = {},
): Promise<{ content: DataHubDocContent; spec: AnalysisSpec } | null> {
  const type = spec.type as AnalysisType;
  const recipe = sidecar.recipe;

  if (opts.groupByColumn) {
    const valueColumn = resolveDatasetColumnNames(spec, sidecar)[0];
    if (!valueColumn || analysisIsRowAligned(type)) return null;
    const groups = await readColumnByGroup(
      handle,
      valueColumn,
      opts.groupByColumn,
      recipe,
    );
    if (groups.length === 0) return null;
    const content = contentFromColumns(
      sidecar.name,
      groups.map((g) => ({ name: g.label, values: g.values })),
    );
    return { content, spec: specForSynthetic(spec, groups.length) };
  }

  const names = resolveDatasetColumnNames(spec, sidecar);
  if (names.length === 0) return null;

  if (analysisIsRowAligned(type)) {
    const rowsMatrix = await readColumnAligned(handle, names, recipe);
    const content = contentFromAligned(sidecar.name, names, rowsMatrix);
    return { content, spec: specForSynthetic(spec, names.length) };
  }

  const columns = await Promise.all(
    names.map(async (n) => ({ name: n, values: await readColumn(handle, n, recipe) })),
  );
  const content = contentFromColumns(sidecar.name, columns);
  return { content, spec: specForSynthetic(spec, names.length) };
}

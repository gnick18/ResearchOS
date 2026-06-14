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
  readValueAndTwoLabels,
  readContingencyCounts,
  readSurvivalRows,
  type ValueTwoLabelRow,
  type ContingencyCounts,
  type SurvivalRow,
} from "./dataset-columns";
import { ROW_LABEL_COLUMN_ID } from "@/lib/datahub/grouped-table";
import {
  TIME_COLUMN_ID,
  EVENT_COLUMN_ID,
  GROUP_COLUMN_ID,
} from "@/lib/datahub/survival-table";

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
  // Single-Y XY family (synthetic XY table path).
  "correlationPearson",
  "correlationSpearman",
  "linearRegression",
  "doseResponse",
  "logisticRegression",
  "rocCurve",
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
    // Correlation is a two-column, row-aligned (complete-case) analysis, exactly
    // like the editable lane's XY correlation (one X column, one Y column). The
    // editable lane offers it once an XY pairing exists (validAnalysisTypes), so
    // the dataset lane offers it once two numeric columns are chosen, the first
    // as X and the second as Y.
    wide.push("correlationPearson", "correlationSpearman");
    // The rest of the single-Y XY family routes through the SAME synthetic XY path
    // (first chosen column X, second Y): linear / logistic regression, dose-response
    // (engine defaults to a 4PL), and the ROC curve (X score, Y a 0/1 label).
    wide.push(
      "linearRegression",
      "doseResponse",
      "logisticRegression",
      "rocCurve",
    );
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

/**
 * True when the analysis is a two-column correlation. Correlation reads an XY
 * table in the editable lane (xColumn + one Y column) and pairs the two columns
 * by ROW, complete-case (xyPairs drops a row whose X or Y is not finite). It is
 * GENUINELY row-aligned, but it builds a different synthetic shape (an XY table,
 * not a Column table) than the repeated-measures / mixed-model / regression
 * row-aligned types, so it is handled on its own branch rather than folded into
 * analysisIsRowAligned. The dataset lane extracts the two chosen columns aligned
 * by row (readColumnAligned) so the dataset r equals the editable r on the same
 * data.
 */
export function analysisIsCorrelation(type: AnalysisType): boolean {
  return type === "correlationPearson" || type === "correlationSpearman";
}

/**
 * True when the analysis reads a SINGLE-Y XY table in the editable lane (one
 * role-"x" column, one role-"y" column, paired by row complete-case). This is the
 * whole XY family the dataset lane can express by extracting two row-aligned
 * columns into a synthetic XY table: correlation (Pearson / Spearman), linear
 * regression, dose-response (the engine defaults to a 4PL when no model param is
 * set), logistic regression, and the ROC curve (X = score, Y = a 0/1 label the
 * engine itself filters to). They all dispatch through runXYAnalysis off the same
 * xColumn + columnIds[0] resolution, so ONE synthetic XY path (contentFromAlignedXY
 * + specForSyntheticXY) serves every one. globalFit is excluded (it needs several
 * Y columns) and is handled in a later wave.
 */
export function analysisIsXY(type: AnalysisType): boolean {
  return (
    analysisIsCorrelation(type) ||
    type === "linearRegression" ||
    type === "doseResponse" ||
    type === "logisticRegression" ||
    type === "rocCurve"
  );
}

/**
 * True when the analysis reads a WHOLE editable table that the dataset lane builds
 * from value + label column(s): two-way ANOVA (grouped), contingency, survival
 * (Kaplan-Meier / Cox), and the nested tests. These do not fit the wide / groupBy /
 * XY paths; the runner reads their columns in a documented columnIds order and
 * builds the matching synthetic table. The engine reads the whole table (no
 * columnIds), so spec.params (postHocFactor, yates, referenceGroup) flow through.
 */
export function analysisIsWholeTableMultiCol(type: AnalysisType): boolean {
  return (
    type === "twoWayAnova" ||
    type === "contingency" ||
    type === "kaplanMeier" ||
    type === "coxRegression" ||
    type === "nestedTTest" ||
    type === "nestedOneWayAnova"
  );
}

/** Stable synthetic ids so the synthetic content is deterministic. */
function synthColumnId(i: number): string {
  return `dscol-${i}`;
}

/**
 * Restrict read partitions to a chosen [Group A, Group B] pair, in that order,
 * for a two-group test on a 3+ level grouping column. Returns the two matching
 * partitions or null when the pair is malformed (not two distinct labels, or a
 * label that is not present in the read partitions), so the caller can surface an
 * honest error instead of silently comparing the wrong levels.
 */
function selectGroupPair<T extends { label: string }>(
  groups: T[],
  pair: [string, string],
): [T, T] | null {
  const [a, b] = pair;
  if (a === b) return null;
  const ga = groups.find((g) => g.label === a);
  const gb = groups.find((g) => g.label === b);
  if (!ga || !gb) return null;
  return [ga, gb];
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
 * Wrap two row-ALIGNED columns into a synthetic XY-table content for correlation.
 * The editable lane's correlation reads an XY table (one role-"x" column, one
 * role-"y" column) and pairs them by row complete-case. Here the first chosen
 * column becomes the X column and the second becomes the Y column, and every row
 * is already complete (readColumnAligned dropped any row missing either value),
 * so xyPairs reads exactly these pairs. resolveXY reads inputs.columnIds[0] as the
 * Y column id, so the spec must point at the synthetic Y id (synthColumnId(1)).
 */
function contentFromAlignedXY(
  name: string,
  xName: string,
  yName: string,
  rowsMatrix: number[][],
): DataHubDocContent {
  const colDefs: ColumnDef[] = [
    { id: synthColumnId(0), name: xName, role: "x", dataType: "number" },
    { id: synthColumnId(1), name: yName, role: "y", dataType: "number" },
  ];
  const rows: RowRecord[] = rowsMatrix.map((vals, r) => ({
    id: `dsrow-${r}`,
    cells: { [synthColumnId(0)]: vals[0], [synthColumnId(1)]: vals[1] },
  }));
  return {
    meta: { ...synthMeta(name), table_type: "xy" },
    columns: colDefs,
    rows,
    analyses: [],
    plots: [],
  };
}

/**
 * The spec for a synthetic XY correlation. resolveXY resolves the X column live
 * (the single role-"x" column) and reads inputs.columnIds[0] as the Y column id,
 * so the spec must carry the synthetic Y id (synthColumnId(1)) as its single
 * input.
 */
function specForSyntheticXY(spec: AnalysisSpec): AnalysisSpec {
  return { ...spec, inputs: { ...spec.inputs, columnIds: [synthColumnId(1)] } };
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

/**
 * Wrap value + row-factor + column-factor rows into a synthetic GROUPED table for
 * two-way ANOVA. Factor A is the row-label column (one row per A level); factor B
 * is a datasetId-keyed family of replicate columns (one family per B level, the
 * level name repeated on every replicate column). twoWayObservations re-flattens
 * this into the same {factorA, factorB, value} cells the editable lane produces.
 */
function contentFromGrouped(
  name: string,
  rows: ValueTwoLabelRow[],
): DataHubDocContent {
  const aLevels: string[] = [];
  const bLevels: string[] = [];
  // cell[a][b] = the replicate values for that (rowLevel, group) cell.
  const cells = new Map<string, Map<string, number[]>>();
  for (const r of rows) {
    if (!cells.has(r.labelA)) {
      cells.set(r.labelA, new Map());
      aLevels.push(r.labelA);
    }
    if (!bLevels.includes(r.labelB)) bLevels.push(r.labelB);
    const m = cells.get(r.labelA)!;
    const arr = m.get(r.labelB) ?? [];
    arr.push(r.value);
    m.set(r.labelB, arr);
  }
  // Each group gets as many replicate columns as its largest cell.
  const repsPerB = bLevels.map((b) => {
    let max = 0;
    for (const a of aLevels) max = Math.max(max, cells.get(a)?.get(b)?.length ?? 0);
    return Math.max(1, max);
  });
  const colDefs: ColumnDef[] = [
    { id: ROW_LABEL_COLUMN_ID, name: "Factor A", role: "x", dataType: "text" },
  ];
  bLevels.forEach((b, bi) => {
    for (let k = 0; k < repsPerB[bi]; k++) {
      colDefs.push({
        id: `g${bi}-r${k}`,
        name: b,
        role: "y",
        dataType: "number",
        datasetId: `grp-${bi}`,
        subcolumnKind: "replicate",
      });
    }
  });
  const dataRows: RowRecord[] = aLevels.map((a, ai) => {
    const c: Record<string, CellValue> = { [ROW_LABEL_COLUMN_ID]: a };
    bLevels.forEach((b, bi) => {
      const vals = cells.get(a)?.get(b) ?? [];
      for (let k = 0; k < repsPerB[bi]; k++) {
        c[`g${bi}-r${k}`] = vals[k] === undefined ? null : vals[k];
      }
    });
    return { id: `dsrow-${ai}`, cells: c };
  });
  return {
    meta: { ...synthMeta(name), table_type: "grouped" },
    columns: colDefs,
    rows: dataRows,
    analyses: [],
    plots: [],
  };
}

/**
 * Wrap a cross-tabulated count grid into a synthetic CONTINGENCY table. The row
 * factor is the role-"x" row-label column; each column factor level is a role-"y"
 * count column. contingencyMatrix re-reads the identical R x C matrix.
 */
function contentFromContingency(
  name: string,
  counts: ContingencyCounts,
): DataHubDocContent {
  const colDefs: ColumnDef[] = [
    { id: ROW_LABEL_COLUMN_ID, name: "Row factor", role: "x", dataType: "text" },
    ...counts.colLabels.map((cl, i) => ({
      id: `col-${i}`,
      name: cl,
      role: "y" as const,
      dataType: "number" as const,
    })),
  ];
  const dataRows: RowRecord[] = counts.rowLabels.map((rl, r) => {
    const c: Record<string, CellValue> = { [ROW_LABEL_COLUMN_ID]: rl };
    counts.colLabels.forEach((_cl, i) => {
      c[`col-${i}`] = counts.matrix[r][i];
    });
    return { id: `dsrow-${r}`, cells: c };
  });
  return {
    meta: { ...synthMeta(name), table_type: "contingency" },
    columns: colDefs,
    rows: dataRows,
    analyses: [],
    plots: [],
  };
}

/**
 * Wrap survival rows into a synthetic SURVIVAL table (one role-"x" time column, one
 * role-"y" event column, one role-"group" column), one row per subject, using the
 * constant ids survivalGroups looks for. survivalGroups re-partitions the rows into
 * the same arms.
 */
function contentFromSurvival(name: string, rows: SurvivalRow[]): DataHubDocContent {
  const colDefs: ColumnDef[] = [
    { id: TIME_COLUMN_ID, name: "Time", role: "x", dataType: "number" },
    { id: EVENT_COLUMN_ID, name: "Event", role: "y", dataType: "number" },
    { id: GROUP_COLUMN_ID, name: "Group", role: "group", dataType: "text" },
  ];
  const dataRows: RowRecord[] = rows.map((r, i) => ({
    id: `dsrow-${i}`,
    cells: {
      [TIME_COLUMN_ID]: r.time,
      [EVENT_COLUMN_ID]: r.event,
      [GROUP_COLUMN_ID]: r.group,
    },
  }));
  return {
    meta: { ...synthMeta(name), table_type: "survival" },
    columns: colDefs,
    rows: dataRows,
    analyses: [],
    plots: [],
  };
}

/**
 * Wrap value + group + subgroup rows into a synthetic NESTED table. Each top-level
 * group is a datasetId-keyed family of SUBGROUP columns (subgroup label on the
 * column name, the group display name repeated on groupName); replicates run down
 * the rows. nestedGroups re-reads the same {group -> subgroups -> values}.
 */
function contentFromNested(
  name: string,
  rows: ValueTwoLabelRow[],
): DataHubDocContent {
  const groups: string[] = [];
  // group -> subgroup -> values
  const data = new Map<string, Map<string, number[]>>();
  for (const r of rows) {
    if (!data.has(r.labelA)) {
      data.set(r.labelA, new Map());
      groups.push(r.labelA);
    }
    const subs = data.get(r.labelA)!;
    const arr = subs.get(r.labelB) ?? [];
    arr.push(r.value);
    subs.set(r.labelB, arr);
  }
  const colDefs: ColumnDef[] = [];
  let maxReps = 0;
  groups.forEach((g, gi) => {
    const subs = data.get(g)!;
    let si = 0;
    for (const [subLabel, vals] of subs) {
      maxReps = Math.max(maxReps, vals.length);
      colDefs.push({
        id: `g${gi}-s${si}`,
        name: subLabel,
        role: "y",
        dataType: "number",
        datasetId: `grp-${gi}`,
        subcolumnKind: "replicate",
        groupName: g,
      });
      si++;
    }
  });
  const dataRows: RowRecord[] = [];
  for (let k = 0; k < Math.max(1, maxReps); k++) {
    const c: Record<string, CellValue> = {};
    groups.forEach((g, gi) => {
      const subs = data.get(g)!;
      let si = 0;
      for (const [, vals] of subs) {
        c[`g${gi}-s${si}`] = vals[k] === undefined ? null : vals[k];
        si++;
      }
    });
    dataRows.push({ id: `dsrow-${k}`, cells: c });
  }
  return {
    meta: { ...synthMeta(name), table_type: "nested" },
    columns: colDefs,
    rows: dataRows,
    analyses: [],
    plots: [],
  };
}

/**
 * Build the synthetic editable-lane content for a whole-table multi-column analysis
 * from its chosen schema columns (in the documented columnIds order), or return an
 * error string when the columns are insufficient. The column order per type:
 *   twoWayAnova        [value, rowFactor, colFactor]
 *   nestedTTest/Anova  [value, group, subgroup]
 *   contingency        [rowFactor, colFactor]
 *   kaplanMeier/cox    [time, event, group?]  (group optional)
 */
async function buildMultiColContent(
  type: AnalysisType,
  names: string[],
  handle: OpenDatasetHandle,
  datasetName: string,
  recipe: DatasetSidecar["recipe"],
): Promise<DataHubDocContent | string> {
  if (type === "twoWayAnova") {
    if (names.length < 3)
      return "Pick a value column, a row factor, and a column factor.";
    const rows = await readValueAndTwoLabels(
      handle,
      names[0],
      names[1],
      names[2],
      recipe,
    );
    return contentFromGrouped(datasetName, rows);
  }
  if (type === "nestedTTest" || type === "nestedOneWayAnova") {
    if (names.length < 3)
      return "Pick a value column, a group column, and a subgroup column.";
    const rows = await readValueAndTwoLabels(
      handle,
      names[0],
      names[1],
      names[2],
      recipe,
    );
    return contentFromNested(datasetName, rows);
  }
  if (type === "contingency") {
    if (names.length < 2)
      return "Pick two categorical columns to cross-tabulate.";
    const counts = await readContingencyCounts(handle, names[0], names[1], recipe);
    return contentFromContingency(datasetName, counts);
  }
  if (type === "kaplanMeier" || type === "coxRegression") {
    if (names.length < 2) return "Pick a time column and a 0/1 event column.";
    const survRows = await readSurvivalRows(
      handle,
      names[0],
      names[1],
      names[2] ?? null,
      recipe,
    );
    return contentFromSurvival(datasetName, survRows);
  }
  return "This analysis is not supported on a dataset yet.";
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
  /**
   * For a TWO-GROUP test (unpaired t, Mann-Whitney) in group-by mode on a column
   * with three or more levels, the exact two labels to compare, in [Group A,
   * Group B] order. When set, the runner keeps ONLY these two partitions (in this
   * order) before building the two arrays, so the test compares the levels the
   * user chose rather than the first two seen. Ignored for three-or-more-group
   * tests (ANOVA, Kruskal-Wallis), which always use every level. Each label must
   * match a readColumnByGroup partition label exactly (same stringification).
   */
  groupPair?: [string, string];
}

/** A two-group test compares exactly two partitions (unpaired t, Mann-Whitney). */
function analysisIsTwoGroup(type: AnalysisType): boolean {
  return type === "unpairedTTest" || type === "mannWhitneyU";
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

  // WHOLE-TABLE multi-column (two-way ANOVA, contingency, survival, nested): read
  // the chosen columns in their documented order and build the matching synthetic
  // table, then run the SAME validated engine on the whole table.
  if (analysisIsWholeTableMultiCol(type)) {
    const names = resolveDatasetColumnNames(spec, sidecar);
    const built = await buildMultiColContent(type, names, handle, sidecar.name, recipe);
    if (typeof built === "string") return { ok: false, error: built };
    return runAnalysis(spec, built);
  }

  // GROUP-BY (tidy / long): one value column split into per-category groups.
  if (opts.groupByColumn) {
    const valueColumn = resolveDatasetColumnNames(spec, sidecar)[0];
    if (!valueColumn) {
      return { ok: false, error: "Pick a numeric value column to analyze." };
    }
    if (analysisIsRowAligned(type) || analysisIsXY(type)) {
      return {
        ok: false,
        error:
          "This analysis pairs two columns by row and cannot run on a single value column split by a group. Pick the wide column mode.",
      };
    }
    const allGroups = await readColumnByGroup(
      handle,
      valueColumn,
      opts.groupByColumn,
      recipe,
    );
    if (allGroups.length === 0) {
      return { ok: false, error: "The group-by column produced no groups." };
    }
    // A two-group test on a 3+ level column compares the chosen pair, not the
    // first two levels. When no pair is given (back-compat, or a 2-level column),
    // every level is passed and the engine's group-count check applies.
    let groups = allGroups;
    if (opts.groupPair && analysisIsTwoGroup(type) && allGroups.length > 2) {
      const picked = selectGroupPair(allGroups, opts.groupPair);
      if (!picked) {
        return {
          ok: false,
          error: "Pick two different existing groups to compare.",
        };
      }
      groups = picked;
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

  // XY: two columns paired by row, complete-case, into a synthetic XY table (first
  // column X, second column Y). Serves correlation, linear / logistic regression,
  // dose-response, and ROC. Row-aligned extraction guarantees the dataset result
  // equals the editable XY result on the same data.
  if (analysisIsXY(type)) {
    if (names.length < 2) {
      return { ok: false, error: "Pick an X column and a Y column." };
    }
    const pair = names.slice(0, 2);
    const rowsMatrix = await readColumnAligned(handle, pair, recipe);
    const content = contentFromAlignedXY(sidecar.name, pair[0], pair[1], rowsMatrix);
    return runAnalysis(specForSyntheticXY(spec), content);
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

  if (analysisIsWholeTableMultiCol(type)) {
    const names = resolveDatasetColumnNames(spec, sidecar);
    const built = await buildMultiColContent(type, names, handle, sidecar.name, recipe);
    if (typeof built === "string") return null;
    return { content: built, spec };
  }

  if (opts.groupByColumn) {
    const valueColumn = resolveDatasetColumnNames(spec, sidecar)[0];
    if (!valueColumn || analysisIsRowAligned(type) || analysisIsXY(type))
      return null;
    const allGroups = await readColumnByGroup(
      handle,
      valueColumn,
      opts.groupByColumn,
      recipe,
    );
    if (allGroups.length === 0) return null;
    let groups = allGroups;
    if (opts.groupPair && analysisIsTwoGroup(type) && allGroups.length > 2) {
      const picked = selectGroupPair(allGroups, opts.groupPair);
      if (!picked) return null;
      groups = picked;
    }
    const content = contentFromColumns(
      sidecar.name,
      groups.map((g) => ({ name: g.label, values: g.values })),
    );
    return { content, spec: specForSynthetic(spec, groups.length) };
  }

  const names = resolveDatasetColumnNames(spec, sidecar);
  if (names.length === 0) return null;

  if (analysisIsXY(type)) {
    if (names.length < 2) return null;
    const pair = names.slice(0, 2);
    const rowsMatrix = await readColumnAligned(handle, pair, recipe);
    const content = contentFromAlignedXY(sidecar.name, pair[0], pair[1], rowsMatrix);
    return { content, spec: specForSyntheticXY(spec) };
  }

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

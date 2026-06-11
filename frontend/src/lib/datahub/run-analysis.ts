// run-analysis.ts
//
// The compute layer for Data Hub Column-table analyses (slice 2). Given an
// AnalysisSpec (the analysis type plus the input column ids) and the current
// table content, this dispatches to the already-validated engine and returns a
// NORMALIZED result the presentation layer (plain-language.ts, show-code.ts,
// ResultsSheet) can render without re-touching the engine result shapes.
//
// We do NOT reimplement any statistics here. We read the finite values out of
// the named columns (via column-table.ts), call the engine, and tag the result
// with the resolved group names + raw value arrays so the Show-the-code snippet
// and the plain-language verdict can reproduce themselves.
//
// Supported this slice (Column tables only):
//   - "unpairedTTest"      two groups, Welch by default
//   - "pairedTTest"        two groups, row-paired
//   - "oneWayAnova"        three or more groups, Tukey post-hoc
//   - "mannWhitneyU"       two independent groups, nonparametric (Welch's fallback)
//   - "wilcoxonSignedRank" two paired groups, nonparametric (paired t fallback)
//   - "kruskalWallis"      three or more groups, nonparametric (ANOVA fallback)
// The three nonparametric kinds are the assumption-failure fallbacks the guided
// wizard recommends, but they are also valid analyses to run directly. Two-way
// ANOVA needs the Grouped table type and is deferred.
//
// No em-dashes, no emojis, no mid-sentence colons.

import {
  oneWayAnova,
  unpairedTTest,
  pairedTTest,
  mannWhitneyU,
  wilcoxonSignedRank,
  kruskalWallis,
} from "@/lib/datahub/engine";
import type {
  AnovaResult,
  TTestResult,
} from "@/lib/datahub/engine/types";
import type {
  AnalysisSpec,
  DataHubDocContent,
} from "@/lib/datahub/model/types";
import { columnValues, groupColumns } from "@/lib/datahub/column-table";

/** The analysis types this slice can run. */
export type AnalysisType =
  | "unpairedTTest"
  | "pairedTTest"
  | "oneWayAnova"
  | "mannWhitneyU"
  | "wilcoxonSignedRank"
  | "kruskalWallis";

/** A resolved input group: the column id, its display name, and its values. */
export interface RunGroup {
  columnId: string;
  name: string;
  values: number[];
}

/**
 * A normalized two-group result. Covers the parametric t-tests (unpaired Welch,
 * paired) AND their nonparametric rank-based counterparts (Mann-Whitney U for
 * independent groups, Wilcoxon signed-rank for paired), which the engine returns
 * in the same TTestResult shape. A rank test has no df and no CI of the
 * difference, so those carry NaN / null and the sheet renders a dash.
 */
export interface NormalizedTTest {
  kind: "ttest";
  type:
    | "unpairedTTest"
    | "pairedTTest"
    | "mannWhitneyU"
    | "wilcoxonSignedRank";
  /** Engine label, e.g. "Welch's t-test" or "Mann-Whitney U (rank-sum)". */
  test: string;
  /** True for the rank-based nonparametric tests (no df, no CI of difference). */
  nonparametric: boolean;
  groups: [RunGroup, RunGroup];
  statistic: number;
  df: number;
  pValue: number;
  effectSize: number;
  effectSizeLabel: string;
  ci95: [number, number] | null;
  meanA: number;
  meanB: number;
  meanDiff: number;
}

/**
 * A normalized multi-group result. Covers one-way ANOVA (with Tukey comparisons)
 * AND the nonparametric Kruskal-Wallis (with Dunn comparisons), which the engine
 * returns in the same AnovaResult shape. For Kruskal-Wallis the F column carries
 * the H statistic and SS / MS are NaN (a rank test has no sums of squares).
 */
export interface NormalizedAnova {
  kind: "anova";
  type: "oneWayAnova" | "kruskalWallis";
  test: string;
  /** True for Kruskal-Wallis (rank-based, no sums of squares). */
  nonparametric: boolean;
  groups: RunGroup[];
  statistic: number;
  pValue: number;
  /** dfBetween / dfWithin, read off the table for the F(df1, df2) display. */
  dfBetween: number;
  dfWithin: number;
  table: AnovaResult["table"];
  comparisons: AnovaResult["comparisons"];
}

export type NormalizedResult = NormalizedTTest | NormalizedAnova;

/** A failed run carries the engine (or resolver) reason so the UI can show it. */
export interface RunFailure {
  ok: false;
  error: string;
}

export type RunOutcome =
  | ({ ok: true } & NormalizedResult)
  | RunFailure;

/**
 * Read the input column ids out of a spec. We store them under inputs.columnIds
 * (an ordered string[]); a defensive parse keeps a malformed spec from throwing.
 */
export function specColumnIds(spec: AnalysisSpec): string[] {
  const raw = (spec.inputs as { columnIds?: unknown }).columnIds;
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
  return [];
}

/**
 * Resolve a spec's input column ids into named value groups, reading the finite
 * numbers out of each column. Unknown column ids are dropped. The display name
 * is the column's current name so a later rename flows through on re-run.
 */
export function resolveGroups(
  content: DataHubDocContent,
  columnIds: string[],
): RunGroup[] {
  const byId = new Map(groupColumns(content).map((c) => [c.id, c.name]));
  const out: RunGroup[] = [];
  for (const id of columnIds) {
    const name = byId.get(id);
    if (name === undefined) continue;
    out.push({ columnId: id, name, values: columnValues(content, id) });
  }
  return out;
}

/** Which analysis types are valid for the current table (by group count). The
 *  nonparametric kinds match the same group counts as their parametric peers,
 *  so a wizard fallback always has a runnable target. */
export function validAnalysisTypes(content: DataHubDocContent): AnalysisType[] {
  const k = groupColumns(content).length;
  const out: AnalysisType[] = [];
  if (k >= 2) {
    out.push("unpairedTTest", "pairedTTest", "mannWhitneyU", "wilcoxonSignedRank");
  }
  if (k >= 3) {
    out.push("oneWayAnova", "kruskalWallis");
  }
  return out;
}

function tableRow(table: AnovaResult["table"], source: string) {
  return table.find((r) => r.source === source);
}

/**
 * Run one analysis spec against the current table content and return a
 * normalized result (or a typed failure). Pure: no I/O, no Loro, no commit. The
 * caller stores the returned normalized result back into the spec's resultCache.
 */
export function runAnalysis(
  spec: AnalysisSpec,
  content: DataHubDocContent,
): RunOutcome {
  const type = spec.type as AnalysisType;
  const groups = resolveGroups(content, specColumnIds(spec));

  if (type === "oneWayAnova" || type === "kruskalWallis") {
    if (groups.length < 3) {
      const label =
        type === "kruskalWallis" ? "Kruskal-Wallis" : "One-way ANOVA";
      return { ok: false, error: `${label} needs at least 3 groups.` };
    }
    const data: Record<string, number[]> = {};
    for (const g of groups) data[g.name] = g.values;
    const r =
      type === "kruskalWallis"
        ? kruskalWallis(data)
        : oneWayAnova(data, { postHoc: "tukey" });
    if (!r.ok) return { ok: false, error: r.error };
    const between = tableRow(r.table, "Between groups");
    const within = tableRow(r.table, "Within groups");
    return {
      ok: true,
      kind: "anova",
      type,
      test: r.test,
      nonparametric: type === "kruskalWallis",
      groups,
      statistic: r.statistic,
      pValue: r.pValue,
      dfBetween: between?.df ?? groups.length - 1,
      dfWithin: within?.df ?? NaN,
      table: r.table,
      comparisons: r.comparisons,
    };
  }

  if (
    type === "unpairedTTest" ||
    type === "pairedTTest" ||
    type === "mannWhitneyU" ||
    type === "wilcoxonSignedRank"
  ) {
    if (groups.length < 2) {
      return { ok: false, error: "A two-group test needs exactly 2 groups." };
    }
    const [a, b] = groups;
    let r: ReturnType<typeof unpairedTTest>;
    switch (type) {
      case "pairedTTest":
        r = pairedTTest(a.values, b.values);
        break;
      case "mannWhitneyU":
        r = mannWhitneyU(a.values, b.values);
        break;
      case "wilcoxonSignedRank":
        r = wilcoxonSignedRank(a.values, b.values);
        break;
      default:
        r = unpairedTTest(a.values, b.values);
    }
    if (!r.ok) return { ok: false, error: r.error };
    const res = r as TTestResult & { ok: true };
    const meanA = res.groupA?.mean ?? NaN;
    const meanB = res.groupB?.mean ?? NaN;
    return {
      ok: true,
      kind: "ttest",
      type,
      test: res.test,
      nonparametric:
        type === "mannWhitneyU" || type === "wilcoxonSignedRank",
      groups: [a, b],
      statistic: res.statistic,
      df: res.df,
      pValue: res.pValue,
      effectSize: res.effectSize,
      effectSizeLabel: res.effectSizeLabel,
      ci95: res.ci95,
      meanA,
      meanB,
      meanDiff: meanA - meanB,
    };
  }

  return { ok: false, error: `Unsupported analysis type "${spec.type}".` };
}

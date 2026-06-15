// Data Hub — table capabilities (pure, constraint-aware).
//
// "What can I actually DO with this table" as a single deterministic answer:
// the statistical analyses AND the graphs that genuinely run on it, given its
// archetype and data shape. ONE engine, consumed by two doors — the Data Hub
// "Analyze" UI and the BeakerBot suggest_analyses chat tool. The point is that
// nothing here is EVER offered if it cannot run, so Beaker can never suggest an
// analysis or figure and then have to refuse it.
//
// Analyses reuse the existing, thorough validAnalysisTypes() (it already guards
// every test against the design). Graphs add the parallel valid-plots logic
// (the PlotKind names are archetype-bound by construction, so the mapping is
// conservative and correct). Labels are exhaustive via Record types, so the
// compiler fails if a new analysis or plot kind ships without one.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type {
  DataHubDocContent,
  DataHubTableType,
  AnalysisSpec,
} from "./model/types";
import { validAnalysisTypes, type AnalysisType } from "./run-analysis";
import type { PlotKind } from "./plot-spec";
import { groupColumns } from "./column-table";

export type CapabilityKind = "analysis" | "graph";

export interface Capability {
  /** The AnalysisType or PlotKind id (what the run/plot tools take). */
  id: string;
  kind: CapabilityKind;
  /** Human label (the chip / option text). */
  label: string;
  /** One-line plain description of what it does or compares. */
  hint: string;
}

export interface TableCapabilities {
  analyses: Capability[];
  graphs: Capability[];
}

interface LabelEntry {
  label: string;
  hint: string;
}

const ANALYSIS_LABEL: Record<AnalysisType, LabelEntry> = {
  unpairedTTest: { label: "Unpaired t-test", hint: "compare the means of two independent groups" },
  pairedTTest: { label: "Paired t-test", hint: "compare two matched measurements" },
  oneWayAnova: { label: "One-way ANOVA", hint: "compare the means of three or more groups" },
  mannWhitneyU: { label: "Mann-Whitney U", hint: "rank-based two-group comparison" },
  wilcoxonSignedRank: { label: "Wilcoxon signed-rank", hint: "rank-based paired comparison" },
  kruskalWallis: { label: "Kruskal-Wallis", hint: "rank-based comparison of three or more groups" },
  repeatedMeasuresAnova: { label: "Repeated-measures ANOVA", hint: "compare repeated measurements across conditions" },
  linearMixedModel: { label: "Linear mixed model", hint: "compare groups with random effects" },
  correlationPearson: { label: "Pearson correlation", hint: "linear association between two variables" },
  correlationSpearman: { label: "Spearman correlation", hint: "monotone association, rank-based" },
  linearRegression: { label: "Linear regression", hint: "fit a straight line to X versus Y" },
  logisticRegression: { label: "Logistic regression", hint: "model a binary outcome from predictors" },
  doseResponse: { label: "Dose-response", hint: "fit a sigmoidal 4PL or 5PL curve" },
  modelComparison: { label: "Model comparison", hint: "compare competing curve fits" },
  globalFit: { label: "Global fitting", hint: "share parameters across several datasets" },
  twoWayAnova: { label: "Two-way ANOVA", hint: "two factors on one measured outcome" },
  kaplanMeier: { label: "Kaplan-Meier", hint: "survival over time by group" },
  coxRegression: { label: "Cox regression", hint: "model survival hazard from predictors" },
  multipleRegression: { label: "Multiple regression", hint: "model an outcome from several predictors" },
  grubbsOutlier: { label: "Grubbs outlier test", hint: "flag a single outlier in a sample" },
  rocCurve: { label: "ROC analysis", hint: "classifier sensitivity versus specificity" },
  contingency: { label: "Contingency analysis", hint: "association in an R by C count table" },
  nestedTTest: { label: "Nested t-test", hint: "two groups with nested subsamples" },
  nestedOneWayAnova: { label: "Nested one-way ANOVA", hint: "three or more groups with nested subsamples" },
};

const PLOT_LABEL: Record<PlotKind, LabelEntry> = {
  columnScatter: { label: "Column scatter", hint: "every point, per group" },
  columnBar: { label: "Bar chart", hint: "group means with error bars" },
  xyScatter: { label: "XY scatter", hint: "points with a fitted curve" },
  groupedBar: { label: "Grouped bar", hint: "bars split by two factors" },
  survivalCurve: { label: "Survival curve", hint: "Kaplan-Meier step plot" },
  estimationGardnerAltman: { label: "Estimation plot", hint: "two groups with the effect size" },
  estimationCumming: { label: "Estimation plot", hint: "several groups versus one control" },
  qqPlot: { label: "QQ plot", hint: "check a sample against a normal distribution" },
  residualPlot: { label: "Residual plot", hint: "regression residuals versus fitted" },
  rocCurve: { label: "ROC curve", hint: "classifier performance" },
  pie: { label: "Pie chart", hint: "each category as a slice of the whole" },
  donut: { label: "Donut chart", hint: "each category as a ring segment" },
  stackedBar: { label: "Stacked bar", hint: "categories stacked to the total" },
};

/** Signals a diagnostic plot needs (it reads a stored analysis, not just the
 *  table shape). Matches NewGraphDialog's findRegression / findRoc gating so the
 *  GUI and the chat offer the EXACT same plots. */
export interface PlotSignals {
  /** A linear/multiple regression is stored on the table (feeds the residual plot). */
  hasRegression?: boolean;
  /** A ROC curve analysis is stored on the table (feeds the ROC visual). */
  hasRoc?: boolean;
}

/** The graphs a table can draw, given its archetype, group-column count, and the
 *  diagnostic-feeding analyses it already has. Pure, so it is directly
 *  unit-tested. Mirrors NewGraphDialog exactly (residual + ROC are diagnostic
 *  plots gated on a stored regression / ROC analysis, never offered without one,
 *  which is why a bare table-type guess would suggest-then-fail). */
export function plotKindsForTable(
  tableType: DataHubTableType,
  groupCount: number,
  signals: PlotSignals = {},
): PlotKind[] {
  const diagnostics: PlotKind[] = [];
  if (signals.hasRegression) diagnostics.push("residualPlot");
  if (signals.hasRoc) diagnostics.push("rocCurve");

  switch (tableType) {
    case "column": {
      if (groupCount < 1) return [];
      const kinds: PlotKind[] = ["columnBar", "columnScatter", "qqPlot"];
      if (groupCount >= 2) kinds.push("estimationGardnerAltman");
      if (groupCount >= 3) kinds.push("estimationCumming");
      return [...kinds, ...diagnostics];
    }
    case "xy":
      return ["xyScatter", ...diagnostics];
    case "grouped":
      return ["groupedBar"];
    case "survival":
      return ["survivalCurve"];
    case "partsOfWhole":
      return ["pie", "donut", "stackedBar"];
    case "contingency":
      return [];
    default:
      // nested / info and any future archetype: no graph offered until its
      // plotting is wired, so we never offer one that cannot draw.
      return [];
  }
}

/** The stored regression on the table (its residuals feed the diagnostics), or
 *  null. THE single source the GUI (NewGraphDialog) and the engine both read, so
 *  the diagnostic-plot gating lives in exactly one place. */
export function findRegressionAnalysis(
  content: DataHubDocContent,
): AnalysisSpec | null {
  return (
    content.analyses.find(
      (a) => a.type === "linearRegression" || a.type === "multipleRegression",
    ) ?? null
  );
}

/** The stored ROC curve analysis on the table (it feeds the ROC visual), or null. */
export function findRocAnalysis(content: DataHubDocContent): AnalysisSpec | null {
  return content.analyses.find((a) => a.type === "rocCurve") ?? null;
}

/** A linear/multiple regression is stored on the table. */
export function hasRegressionAnalysis(content: DataHubDocContent): boolean {
  return findRegressionAnalysis(content) !== null;
}

/** A ROC curve analysis is stored on the table. */
export function hasRocAnalysis(content: DataHubDocContent): boolean {
  return findRocAnalysis(content) !== null;
}

export function validPlotKinds(content: DataHubDocContent): PlotKind[] {
  return plotKindsForTable(content.meta.table_type, groupColumns(content).length, {
    hasRegression: hasRegressionAnalysis(content),
    hasRoc: hasRocAnalysis(content),
  });
}

function toCapability(
  id: string,
  kind: CapabilityKind,
  entry: LabelEntry,
): Capability {
  return { id, kind, label: entry.label, hint: entry.hint };
}

/** The full constraint-aware answer for a table. Every item is runnable. */
export function tableCapabilities(content: DataHubDocContent): TableCapabilities {
  const analyses = validAnalysisTypes(content).map((t) =>
    toCapability(t, "analysis", ANALYSIS_LABEL[t]),
  );
  const graphs = validPlotKinds(content).map((k) =>
    toCapability(k, "graph", PLOT_LABEL[k]),
  );
  return { analyses, graphs };
}

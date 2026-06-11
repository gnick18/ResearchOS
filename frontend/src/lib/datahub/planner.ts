// planner.ts
//
// The reusable spine of the guided analysis experience. Given a STRUCTURED
// INTENT (what is being compared, how many groups, paired vs independent) and
// the selected table, it picks the right test, runs the engine's assumption
// checks, and returns an editable ProposedPlan. Pure functions only, no React,
// no Loro, no LLM. The point is that several adapters can feed the same planner:
// the stepper UI is the first, a natural-language omnibox and an AI assistant
// are intended later adapters, all producing the same AnalysisIntent and
// reading back the same ProposedPlan. Keeping the planner free of any UI or LLM
// concern is what makes that possible.
//
// Why a Report Card. Bench scientists are not statisticians, and the most
// common analysis mistake is running a t-test or ANOVA on data that breaks its
// assumptions. So the planner does not just name a test. It checks normality
// (Shapiro-Wilk per group) and equal variance (Brown-Forsythe across groups),
// reports each as a plain-language pass or fail with a one-line why, and when an
// assumption fails it falls back to the matching nonparametric test that does
// not need that assumption. The recommendation a researcher sees is therefore
// already assumption-aware.
//
// All six target tests live in the validated engine already (t-tests, ANOVA +
// Tukey, and the rank-based Mann-Whitney U, Wilcoxon signed-rank, and
// Kruskal-Wallis), so the planner only chooses and explains; it never computes a
// statistic itself.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { shapiroWilk, brownForsythe } from "@/lib/datahub/engine";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import {
  columnValues,
  groupColumns,
  type GroupColumn,
} from "@/lib/datahub/column-table";
import { xColumn, xyPairs, yColumns } from "@/lib/datahub/xy-table";
import type { AnalysisType } from "@/lib/datahub/run-analysis";

/** The decision threshold the Report Card and the engine share. */
export const PLANNER_ALPHA = 0.05;

/**
 * What the researcher is comparing. "means" is the only family this slice plans
 * (two-group and multi-group mean comparisons); "association" (correlation /
 * regression) and "survival" are declared so an adapter can collect them and the
 * planner can name the gap rather than silently mis-plan. The intent is the
 * adapter-neutral contract: a stepper, an omnibox, or an assistant all produce
 * this shape.
 */
export type ComparisonFamily = "means" | "association" | "survival";

/** Independent samples (different subjects) vs paired (same subject, matched). */
export type Pairing = "independent" | "paired";

/**
 * The structured intent any adapter hands the planner. groupColumnIds is the
 * ordered set of group columns the comparison runs over; when omitted the
 * planner uses every group column in the table (the common case for the
 * stepper, which does not ask the user to pick columns).
 */
export interface AnalysisIntent {
  family: ComparisonFamily;
  /** How many groups are being compared. "two" or "three-plus". */
  groupCount: "two" | "three-plus";
  /** Only meaningful for a means comparison. */
  pairing: Pairing;
  /** Optional explicit column selection; defaults to all group columns. */
  groupColumnIds?: string[];
  /** For an association intent on an XY table, the Y column to relate to X. */
  yColumnId?: string;
}

/** One row of the assumption Report Card. */
export interface ReportCardItem {
  /** A stable key the UI can switch on. */
  key: "normality" | "equalVariance" | "fallbackNote";
  /** PASS / FAIL for a checked assumption; NOTE for an informational line. */
  status: "pass" | "fail" | "note";
  /** The short bold lead, e.g. "Normality". */
  title: string;
  /** The plain-language one-liner explaining the result and what it means. */
  detail: string;
}

/** A single step of the proposed plan. This slice produces exactly one
 *  run-test step, but the list shape leaves room for multi-step plans later
 *  (e.g. transform then test, or test then plot). */
export interface PlanStep {
  kind: "run-test";
  /** The engine analysis identifier to run, or null when unavailable. */
  analysisType: AnalysisType | null;
  /** The human label for the recommended test. */
  testLabel: string;
  /** The ordered group column ids the test runs over. */
  columnIds: string[];
}

/**
 * The editable plan the planner returns. The adapter shows the recommended test
 * and the Report Card, lets the user approve (run the step) or go back and edit
 * the intent. runnable is false when the recommended test cannot be computed in
 * this build (then the Report Card names it as "available soon").
 */
export interface ProposedPlan {
  intent: AnalysisIntent;
  /** The recommended test label, assumption-aware. */
  recommendation: string;
  /** A one-line statement of why this test fits the intent + the data. */
  rationale: string;
  /** The ordered plan steps. This slice yields one run-test step. */
  steps: PlanStep[];
  /** The assumption Report Card rows, in display order. */
  reportCard: ReportCardItem[];
  /** True when the recommended test can run now (every target test can today). */
  runnable: boolean;
  /** Set when the planner cannot plan the intent (wrong family for this slice). */
  unsupported?: string;
}

/** Resolve the group columns the intent runs over (explicit selection or all). */
function resolveGroupColumns(
  content: DataHubDocContent,
  intent: AnalysisIntent,
): GroupColumn[] {
  const all = groupColumns(content);
  if (!intent.groupColumnIds || intent.groupColumnIds.length === 0) return all;
  const wanted = new Set(intent.groupColumnIds);
  const picked = all.filter((c) => wanted.has(c.id));
  return picked.length > 0 ? picked : all;
}

/** Format a p-value for a Report Card line (methods-section style). */
function fmtP(p: number): string {
  if (!Number.isFinite(p)) return "p could not be computed";
  if (p < 0.0001) return "p < 0.0001";
  if (p < 0.001) return "p < 0.001";
  return `p = ${p.toFixed(p < 0.01 ? 4 : 3)}`;
}

/**
 * Check normality per group via Shapiro-Wilk and return one Report Card row.
 * The assumption holds only when EVERY group is consistent with normal, so the
 * row reports the smallest p across groups (the worst case). Groups too small
 * for the test (n < 3) are skipped and noted; if none can be tested the row is a
 * NOTE rather than a false PASS.
 */
function normalityRow(groups: number[][]): {
  pass: boolean;
  row: ReportCardItem;
} {
  let smallestP = Infinity;
  let tested = 0;
  for (const g of groups) {
    const r = shapiroWilk(g, PLANNER_ALPHA);
    if (!r.ok) continue;
    tested += 1;
    if (r.pValue < smallestP) smallestP = r.pValue;
  }

  if (tested === 0) {
    return {
      pass: true,
      row: {
        key: "normality",
        status: "note",
        title: "Normality",
        detail:
          "Too few values per group to test normality (Shapiro-Wilk needs at least 3). The recommendation assumes a normal distribution; add replicates to confirm it.",
      },
    };
  }

  const pass = smallestP >= PLANNER_ALPHA;
  return {
    pass,
    row: {
      key: "normality",
      status: pass ? "pass" : "fail",
      title: "Normality",
      detail: pass
        ? `Each group looks normally distributed (Shapiro-Wilk, smallest ${fmtP(
            smallestP,
          )}). A t-test family is appropriate.`
        : `At least one group departs from a normal distribution (Shapiro-Wilk, smallest ${fmtP(
            smallestP,
          )}). A rank-based test is the safer choice.`,
    },
  };
}

/**
 * Check equal variance across the groups via Brown-Forsythe (the median-centred
 * Levene variant, robust to non-normality, which is why the wizard uses it over
 * plain Levene). Returns one Report Card row. With fewer than two testable
 * groups the row is a NOTE.
 */
function equalVarianceRow(groups: number[][]): {
  pass: boolean;
  row: ReportCardItem;
} {
  const r = brownForsythe(groups, PLANNER_ALPHA);
  if (!r.ok) {
    return {
      pass: true,
      row: {
        key: "equalVariance",
        status: "note",
        title: "Equal variance",
        detail:
          "Not enough spread in the data to test equal variance yet. The recommendation assumes similar spread across groups.",
      },
    };
  }
  const pass = r.pass;
  return {
    pass,
    row: {
      key: "equalVariance",
      status: pass ? "pass" : "fail",
      title: "Equal variance",
      detail: pass
        ? `The groups have similar spread (Brown-Forsythe, ${fmtP(
            r.pValue,
          )}). The standard test is fine.`
        : `The groups have unequal spread (Brown-Forsythe, ${fmtP(
            r.pValue,
          )}). A test that does not assume equal variance is the safer choice.`,
    },
  };
}

/** Human labels for the means-comparison tests the planner can recommend. */
const TEST_LABELS: Partial<Record<AnalysisType, string>> = {
  unpairedTTest: "Unpaired t-test (Welch)",
  pairedTTest: "Paired t-test",
  oneWayAnova: "One-way ANOVA with Tukey",
  mannWhitneyU: "Mann-Whitney U",
  wilcoxonSignedRank: "Wilcoxon signed-rank",
  kruskalWallis: "Kruskal-Wallis",
};

/**
 * Plan a means comparison. Picks the parametric test for the group count +
 * pairing, runs the Report Card, and falls back to the matching nonparametric
 * test when normality (or, for the two-independent case, equal variance) fails.
 *
 * Fallback map (the standard, defensible substitutions):
 *   unpaired t  -> Mann-Whitney U        (independent, normality fails)
 *   paired t    -> Wilcoxon signed-rank  (paired, normality fails)
 *   one-way ANOVA -> Kruskal-Wallis      (3+ groups, normality fails)
 * Unequal variance alone does not switch families. Welch's t-test (the engine
 * default for unpaired) already handles it, and the two-independent case stays
 * on Welch and notes the unequal spread. A normality failure is the trigger
 * that moves to a rank-based test.
 */
function planMeans(
  content: DataHubDocContent,
  intent: AnalysisIntent,
): ProposedPlan {
  const cols = resolveGroupColumns(content, intent);
  const columnIds = cols.map((c) => c.id);
  const values = columnIds.map((id) => columnValues(content, id));

  const norm = normalityRow(values);
  const eqVar = equalVarianceRow(values);

  const multi = intent.groupCount === "three-plus";
  const paired = intent.pairing === "paired";

  // The parametric default for the intent.
  const parametricType: AnalysisType = multi
    ? "oneWayAnova"
    : paired
      ? "pairedTTest"
      : "unpairedTTest";

  // The nonparametric fallback for the intent.
  const nonparametricType: AnalysisType = multi
    ? "kruskalWallis"
    : paired
      ? "wilcoxonSignedRank"
      : "mannWhitneyU";

  // Normality failure moves to the rank-based test. Equal-variance failure does
  // not switch families (Welch absorbs it for the unpaired case).
  const useNonparametric = !norm.pass;
  const chosenType = useNonparametric ? nonparametricType : parametricType;

  // Safe label lookup (the means types always have an entry).
  const labelFor = (t: AnalysisType): string => TEST_LABELS[t] ?? t;

  const reportCard: ReportCardItem[] = [norm.row, eqVar.row];

  // A closing NOTE line. When the plan switched, state why and to what; when it
  // did not, state what would have happened, mirroring the mockup's NOTE row.
  if (useNonparametric) {
    reportCard.push({
      key: "fallbackNote",
      status: "note",
      title: "Switched test",
      detail: `Because normality did not hold, we switched you to ${labelFor(nonparametricType)}, a rank-based test that does not assume a normal distribution.`,
    });
  } else {
    reportCard.push({
      key: "fallbackNote",
      status: "note",
      title: "If an assumption had failed",
      detail: `We would switch you to ${labelFor(nonparametricType)} automatically and tell you why.`,
    });
  }

  const groupWord = multi
    ? `${cols.length} groups`
    : "two groups";
  const pairWord = paired ? "paired" : "independent";
  const rationale = useNonparametric
    ? `${groupWord}, ${pairWord}, one measured outcome. A rank-based test was chosen because the data is not normally distributed.`
    : `${groupWord}, ${pairWord}, one measured outcome. Here is what we checked before recommending it.`;

  return {
    intent,
    recommendation: labelFor(chosenType),
    rationale,
    steps: [
      {
        kind: "run-test",
        analysisType: chosenType,
        testLabel: labelFor(chosenType),
        columnIds,
      },
    ],
    reportCard,
    runnable: true,
  };
}

/**
 * Plan an association (correlation) intent on an XY table. Picks the Y column
 * (the intent's choice, else the first), checks normality of X and Y, and
 * recommends Pearson when both look normal (the linear-association coefficient)
 * or Spearman when either departs from normal (a rank-based monotone measure
 * that does not assume a straight line or a normal distribution). When the table
 * is not an XY table the plan is not runnable and names what is needed, which is
 * honest rather than guessing columns.
 */
function planAssociation(
  content: DataHubDocContent,
  intent: AnalysisIntent,
): ProposedPlan {
  const xCol = xColumn(content);
  const ys = yColumns(content);
  const notRunnable = (detail: string): ProposedPlan => ({
    intent,
    recommendation: "Correlation or linear regression",
    rationale:
      "A relationship between two measures is an XY analysis. It needs an XY table with an X column and at least one Y column.",
    steps: [
      {
        kind: "run-test",
        analysisType: null,
        testLabel: "Correlation or linear regression",
        columnIds: [],
      },
    ],
    reportCard: [
      { key: "fallbackNote", status: "note", title: "Available soon", detail },
    ],
    runnable: false,
    unsupported: "association",
  });

  if (content.meta.table_type !== "xy" || !xCol || ys.length === 0) {
    return notRunnable(
      "Correlation and regression run on an XY table. Make an XY table with an X column and a Y column, then try again.",
    );
  }

  const yCol = ys.find((c) => c.id === intent.yColumnId) ?? ys[0];
  const pairs = xyPairs(content, yCol.id);

  // Check normality of X and Y. Pearson assumes an approximately normal, linear
  // relationship; Spearman (rank-based) is the safer choice when either departs.
  const norm = normalityRow([pairs.x, pairs.y]);
  const usePearson = norm.pass;
  const chosenType: AnalysisType = usePearson
    ? "correlationPearson"
    : "correlationSpearman";
  const recommendation = usePearson
    ? "Pearson correlation"
    : "Spearman correlation";

  const reportCard: ReportCardItem[] = [norm.row];
  reportCard.push(
    usePearson
      ? {
          key: "fallbackNote",
          status: "note",
          title: "If normality had failed",
          detail:
            "We would switch you to Spearman, a rank-based correlation that does not assume a straight line or a normal distribution, and tell you why. You can also run a linear regression from the New analysis menu to get the slope.",
        }
      : {
          key: "fallbackNote",
          status: "note",
          title: "Switched method",
          detail:
            "Because the values are not normally distributed, we recommend Spearman, a rank-based correlation that captures a monotone trend without assuming a straight line.",
        },
  );

  const rationale = `${yCol.name} against ${xCol.name}, ${pairs.x.length} paired observations. Here is what we checked before recommending it.`;

  return {
    intent,
    recommendation,
    rationale,
    steps: [
      {
        kind: "run-test",
        analysisType: chosenType,
        testLabel: recommendation,
        columnIds: [yCol.id],
      },
    ],
    reportCard,
    runnable: true,
  };
}

/** Plan a survival intent. Kaplan-Meier and log-rank need the Survival table
 *  type, which is not built yet, so the planner names the method and marks the
 *  plan not-yet-runnable. */
function planSurvival(intent: AnalysisIntent): ProposedPlan {
  return {
    intent,
    recommendation: "Kaplan-Meier with the log-rank test",
    rationale:
      "Survival or time-to-event analysis needs a Survival table with event and time columns, which is a later table type.",
    steps: [
      {
        kind: "run-test",
        analysisType: null,
        testLabel: "Kaplan-Meier with the log-rank test",
        columnIds: [],
      },
    ],
    reportCard: [
      {
        key: "fallbackNote",
        status: "note",
        title: "Available soon",
        detail:
          "Survival analysis runs on a Survival table. The guided wizard will plan it once that table type lands.",
      },
    ],
    runnable: false,
    unsupported: "survival",
  };
}

/**
 * The planner entry point. Pure: takes a structured intent + the selected
 * table, returns an editable ProposedPlan (recommended test + Report Card +
 * fallback selection). No I/O. Every adapter (the stepper, a future omnibox, a
 * future assistant) calls exactly this.
 */
export function planAnalysis(
  content: DataHubDocContent,
  intent: AnalysisIntent,
): ProposedPlan {
  switch (intent.family) {
    case "means":
      return planMeans(content, intent);
    case "association":
      return planAssociation(content, intent);
    case "survival":
      return planSurvival(intent);
    default:
      return planMeans(content, intent);
  }
}

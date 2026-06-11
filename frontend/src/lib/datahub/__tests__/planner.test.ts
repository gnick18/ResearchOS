import { describe, expect, it } from "vitest";

import type {
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";
import {
  planAnalysis,
  type AnalysisIntent,
} from "@/lib/datahub/planner";

/**
 * Planner spine tests (the wizard slice). The planner is the pure, adapter-
 * neutral engine the stepper (and a future omnibox / assistant) call. These
 * pin, for structured intents over datasets with KNOWN assumption outcomes:
 *   - the recommended test,
 *   - each Report Card row's pass / fail,
 *   - and the nonparametric fallback selection when an assumption fails.
 *
 * The assumption p-values these datasets produce were read off the validated
 * engine (Shapiro-Wilk + Brown-Forsythe) before pinning, so a regression in the
 * planner's decision logic, not the engine's math, is what fails here.
 *
 * Known outcomes (engine-confirmed, alpha = 0.05):
 *   NORMAL_A / NORMAL_B / NORMAL_C  Shapiro-Wilk p ~0.99  PASS normality
 *   NORMAL_A vs NORMAL_B/C          Brown-Forsythe p ~0.99 PASS equal variance
 *   NORMAL_WIDE                     Shapiro-Wilk p = 0.72  PASS normality,
 *                                    but Brown-Forsythe vs NORMAL_A p = 0.0001
 *                                    FAIL equal variance
 *   SKEWED (outlier-heavy)          Shapiro-Wilk p = 0     FAIL normality
 */

const NORMAL_A = [98, 102, 95, 105, 100, 99, 101, 97];
const NORMAL_B = [78, 82, 75, 80, 85, 79, 81, 77];
const NORMAL_C = [55, 60, 52, 58, 50, 57, 54, 56];
// Symmetric and roughly normal, but a much wider spread than NORMAL_A.
const NORMAL_WIDE = [60, 140, 80, 120, 70, 130, 90, 110];
// Strong positive skew with an outlier; clearly non-normal.
const SKEWED = [1, 1, 1, 2, 2, 3, 4, 40];

const META: DataHubDocument = {
  id: "demo",
  name: "Assumption fixtures",
  project_ids: [],
  folder_path: null,
  table_type: "column",
  created_at: "2026-06-10T00:00:00.000Z",
};

/** Build a Column-table content from named series (one column per series). */
function content(series: { name: string; values: number[] }[]): DataHubDocContent {
  const cols = series.map((s, i) => ({
    id: `col-${i + 1}`,
    name: s.name,
    role: "y" as const,
    dataType: "number" as const,
  }));
  const n = Math.max(...series.map((s) => s.values.length));
  const rows = Array.from({ length: n }, (_, r) => {
    const cells: Record<string, number | null> = {};
    series.forEach((s, i) => {
      cells[`col-${i + 1}`] = r < s.values.length ? s.values[r] : null;
    });
    return { id: `row-${r + 1}`, cells };
  });
  return { meta: META, columns: cols, rows, analyses: [], plots: [] };
}

const meansIntent = (
  groupCount: AnalysisIntent["groupCount"],
  pairing: AnalysisIntent["pairing"],
): AnalysisIntent => ({ family: "means", groupCount, pairing });

/** The Report Card row for a key. */
function row(plan: ReturnType<typeof planAnalysis>, key: string) {
  return plan.reportCard.find((r) => r.key === key);
}

describe("planner: three-group means comparison", () => {
  it("recommends ANOVA with both assumptions passing on clean normal data", () => {
    const c = content([
      { name: "Control", values: NORMAL_A },
      { name: "Drug A", values: NORMAL_B },
      { name: "Drug B", values: NORMAL_C },
    ]);
    const plan = planAnalysis(c, meansIntent("three-plus", "independent"));

    expect(plan.steps[0].analysisType).toBe("oneWayAnova");
    expect(plan.recommendation).toContain("One-way ANOVA");
    expect(plan.runnable).toBe(true);
    expect(plan.steps[0].columnIds).toEqual(["col-1", "col-2", "col-3"]);

    expect(row(plan, "normality")?.status).toBe("pass");
    expect(row(plan, "equalVariance")?.status).toBe("pass");
    // No switch happened, so the closing note is the "if it had failed" line.
    expect(row(plan, "fallbackNote")?.title).toContain("If an assumption");
  });

  it("falls back to Kruskal-Wallis when one group is non-normal", () => {
    const c = content([
      { name: "Control", values: NORMAL_A },
      { name: "Drug A", values: NORMAL_B },
      { name: "Skewed", values: SKEWED },
    ]);
    const plan = planAnalysis(c, meansIntent("three-plus", "independent"));

    expect(plan.steps[0].analysisType).toBe("kruskalWallis");
    expect(plan.recommendation).toContain("Kruskal-Wallis");
    expect(row(plan, "normality")?.status).toBe("fail");
    expect(row(plan, "fallbackNote")?.title).toBe("Switched test");
    expect(row(plan, "fallbackNote")?.detail).toContain("Kruskal-Wallis");
  });
});

describe("planner: two-group independent means comparison", () => {
  it("recommends the unpaired t-test when both assumptions pass", () => {
    const c = content([
      { name: "Control", values: NORMAL_A },
      { name: "Drug A", values: NORMAL_B },
    ]);
    const plan = planAnalysis(c, meansIntent("two", "independent"));

    expect(plan.steps[0].analysisType).toBe("unpairedTTest");
    expect(row(plan, "normality")?.status).toBe("pass");
    expect(row(plan, "equalVariance")?.status).toBe("pass");
  });

  it("stays on Welch's unpaired t when only equal variance fails", () => {
    // Both groups are normal, so no rank fallback; spreads differ, so the
    // equal-variance row fails, but Welch already handles unequal variance.
    const c = content([
      { name: "Narrow", values: NORMAL_A },
      { name: "Wide", values: NORMAL_WIDE },
    ]);
    const plan = planAnalysis(c, meansIntent("two", "independent"));

    expect(plan.steps[0].analysisType).toBe("unpairedTTest");
    expect(row(plan, "normality")?.status).toBe("pass");
    expect(row(plan, "equalVariance")?.status).toBe("fail");
    // Unequal variance alone does not switch the test family.
    expect(row(plan, "fallbackNote")?.title).toContain("If an assumption");
  });

  it("falls back to Mann-Whitney U when a group is non-normal", () => {
    const c = content([
      { name: "Control", values: NORMAL_A },
      { name: "Skewed", values: SKEWED },
    ]);
    const plan = planAnalysis(c, meansIntent("two", "independent"));

    expect(plan.steps[0].analysisType).toBe("mannWhitneyU");
    expect(plan.recommendation).toContain("Mann-Whitney");
    expect(row(plan, "normality")?.status).toBe("fail");
    expect(row(plan, "fallbackNote")?.title).toBe("Switched test");
  });
});

describe("planner: two-group paired means comparison", () => {
  it("recommends the paired t-test when normality holds", () => {
    const c = content([
      { name: "Before", values: NORMAL_A },
      { name: "After", values: NORMAL_B },
    ]);
    const plan = planAnalysis(c, meansIntent("two", "paired"));

    expect(plan.steps[0].analysisType).toBe("pairedTTest");
    expect(row(plan, "normality")?.status).toBe("pass");
  });

  it("falls back to Wilcoxon signed-rank when a group is non-normal", () => {
    const c = content([
      { name: "Before", values: NORMAL_A },
      { name: "After", values: SKEWED },
    ]);
    const plan = planAnalysis(c, meansIntent("two", "paired"));

    expect(plan.steps[0].analysisType).toBe("wilcoxonSignedRank");
    expect(plan.recommendation).toContain("Wilcoxon");
    expect(row(plan, "normality")?.status).toBe("fail");
    expect(row(plan, "fallbackNote")?.title).toBe("Switched test");
  });
});

describe("planner: explicit column selection", () => {
  it("runs the test only over the chosen group columns", () => {
    const c = content([
      { name: "Control", values: NORMAL_A },
      { name: "Drug A", values: NORMAL_B },
      { name: "Drug B", values: NORMAL_C },
    ]);
    const intent: AnalysisIntent = {
      family: "means",
      groupCount: "two",
      pairing: "independent",
      groupColumnIds: ["col-1", "col-3"],
    };
    const plan = planAnalysis(c, intent);
    expect(plan.steps[0].columnIds).toEqual(["col-1", "col-3"]);
  });
});

describe("planner: small-sample degrade", () => {
  it("does not falsely PASS normality when groups are too small to test", () => {
    // Two values per group is below Shapiro-Wilk's n >= 3 floor, so the
    // normality row degrades to a NOTE rather than a false PASS, and the plan
    // stays on the parametric default.
    const c = content([
      { name: "A", values: [10, 12] },
      { name: "B", values: [20, 22] },
    ]);
    const plan = planAnalysis(c, meansIntent("two", "independent"));
    expect(row(plan, "normality")?.status).toBe("note");
    expect(plan.steps[0].analysisType).toBe("unpairedTTest");
  });
});

describe("planner: families not yet runnable", () => {
  it("names correlation / regression for an association intent without running", () => {
    const c = content([{ name: "x", values: NORMAL_A }]);
    const plan = planAnalysis(c, {
      family: "association",
      groupCount: "two",
      pairing: "independent",
    });
    expect(plan.runnable).toBe(false);
    expect(plan.steps[0].analysisType).toBeNull();
    expect(plan.recommendation).toMatch(/[Cc]orrelation|regression/);
    expect(plan.unsupported).toBe("association");
  });

  it("names Kaplan-Meier / log-rank for a survival intent without running", () => {
    const c = content([{ name: "t", values: NORMAL_A }]);
    const plan = planAnalysis(c, {
      family: "survival",
      groupCount: "two",
      pairing: "independent",
    });
    expect(plan.runnable).toBe(false);
    expect(plan.steps[0].analysisType).toBeNull();
    expect(plan.recommendation).toMatch(/Kaplan-Meier|log-rank/);
    expect(plan.unsupported).toBe("survival");
  });
});

describe("planner: two-factor and survival on their own table types", () => {
  // A minimal Grouped table: 2 row levels x 2 groups x 2 replicate columns.
  function groupedContent(): DataHubDocContent {
    const meta: DataHubDocument = {
      ...META,
      table_type: "grouped",
    };
    return {
      meta,
      columns: [
        { id: "rowlabel", name: "Stage", role: "x", dataType: "text" },
        { id: "a1", name: "A", role: "y", dataType: "number", datasetId: "g1", subcolumnKind: "replicate" },
        { id: "a2", name: "A", role: "y", dataType: "number", datasetId: "g1", subcolumnKind: "replicate" },
        { id: "b1", name: "B", role: "y", dataType: "number", datasetId: "g2", subcolumnKind: "replicate" },
        { id: "b2", name: "B", role: "y", dataType: "number", datasetId: "g2", subcolumnKind: "replicate" },
      ],
      rows: [
        { id: "r1", cells: { rowlabel: "lo", a1: 9, a2: 11, b1: 11, b2: 13 } },
        { id: "r2", cells: { rowlabel: "hi", a1: 14, a2: 16, b1: 17, b2: 19 } },
      ],
      analyses: [],
      plots: [],
    };
  }

  function survivalContent(): DataHubDocContent {
    const meta: DataHubDocument = { ...META, table_type: "survival" };
    return {
      meta,
      columns: [
        { id: "time", name: "Time", role: "x", dataType: "number" },
        { id: "event", name: "Event", role: "y", dataType: "number" },
        { id: "group", name: "Group", role: "group", dataType: "text" },
      ],
      rows: [
        { id: "r1", cells: { time: 5, event: 1, group: "A" } },
        { id: "r2", cells: { time: 8, event: 0, group: "A" } },
        { id: "r3", cells: { time: 6, event: 1, group: "B" } },
        { id: "r4", cells: { time: 9, event: 1, group: "B" } },
      ],
      analyses: [],
      plots: [],
    };
  }

  const intent = (family: AnalysisIntent["family"]): AnalysisIntent => ({
    family,
    groupCount: "two",
    pairing: "independent",
  });

  it("recommends and runs a two-way ANOVA on a ready Grouped table", () => {
    const plan = planAnalysis(groupedContent(), intent("twoFactor"));
    expect(plan.runnable).toBe(true);
    expect(plan.steps[0].analysisType).toBe("twoWayAnova");
    expect(plan.recommendation).toMatch(/[Tt]wo-way/);
    expect(plan.reportCard.length).toBeGreaterThan(0);
  });

  it("recommends and runs Kaplan-Meier / log-rank on a ready Survival table", () => {
    const plan = planAnalysis(survivalContent(), intent("survival"));
    expect(plan.runnable).toBe(true);
    expect(plan.steps[0].analysisType).toBe("kaplanMeier");
    expect(plan.recommendation).toMatch(/Kaplan-Meier|log-rank/);
  });

  it("does not run a two-factor intent on a Column table", () => {
    const c = content([{ name: "x", values: NORMAL_A }]);
    const plan = planAnalysis(c, intent("twoFactor"));
    expect(plan.runnable).toBe(false);
    expect(plan.steps[0].analysisType).toBeNull();
    expect(plan.unsupported).toBe("twoFactor");
  });
});

"use client";

// New Analysis dialog (Data Hub slice 2). Picks an analysis type valid for the
// current Column table (a t-test when there are 2 or more groups, one-way ANOVA
// with Tukey when there are 3 or more) and confirms which group columns feed it,
// then hands the choice back to the page, which runs it through the engine and
// stores the spec plus its cached result in the Loro doc.
//
// Only the analyses valid for the current table are offered, so a researcher
// never picks a test the data cannot support. A t-test takes exactly two groups
// (chosen here when the table has more than two); ANOVA takes every group.
//
// House style: a popup reads as a contained surface (bg-surface-overlay + border),
// the primary CTA uses .bg-brand-action text-white transition-colors hover:bg-brand-action/90, <Icon> only, no emojis / em-dashes /
// mid-sentence colons.

import { useEffect, useMemo, useState } from "react";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import { groupColumns } from "@/lib/datahub/column-table";
import { xColumn, yColumns } from "@/lib/datahub/xy-table";
import {
  validAnalysisTypes,
  type AnalysisType,
} from "@/lib/datahub/run-analysis";
import BeakerBot from "@/components/BeakerBot";
import { AI_ASSISTANT_ENABLED } from "@/lib/ai/config";
import { useBeakerSearch } from "@/components/beaker-search/BeakerSearchProvider";
import { sendToBeakerBot } from "@/components/ai/message-bridge";

export interface NewAnalysisSubmit {
  type: AnalysisType;
  /** The ordered group column ids that feed the analysis. */
  columnIds: string[];
}

const TYPE_META: Record<
  AnalysisType,
  {
    label: string;
    blurb: string;
    groupCount: "two" | "all" | "regression" | "globalFit" | "screen";
  }
> = {
  unpairedTTest: {
    label: "Unpaired t-test",
    blurb:
      "Compare two independent groups. Uses Welch's test, which does not assume equal spread.",
    groupCount: "two",
  },
  pairedTTest: {
    label: "Paired t-test",
    blurb:
      "Compare two groups measured on the same subjects, row by row. Use this when each row is one subject.",
    groupCount: "two",
  },
  oneWayAnova: {
    label: "One-way ANOVA",
    blurb:
      "Compare three or more groups at once, then Tukey shows which pairs differ without inflating the false-positive rate.",
    groupCount: "all",
  },
  mannWhitneyU: {
    label: "Mann-Whitney U",
    blurb:
      "Compare two independent groups without assuming a normal distribution. The rank-based answer to a non-normal unpaired t-test.",
    groupCount: "two",
  },
  wilcoxonSignedRank: {
    label: "Wilcoxon signed-rank",
    blurb:
      "Compare two paired groups without assuming a normal distribution. The rank-based answer to a non-normal paired t-test.",
    groupCount: "two",
  },
  kruskalWallis: {
    label: "Kruskal-Wallis",
    blurb:
      "Compare three or more groups without assuming a normal distribution. The rank-based answer to a non-normal one-way ANOVA.",
    groupCount: "all",
  },
  repeatedMeasuresAnova: {
    label: "Repeated-measures ANOVA",
    blurb:
      "Compare three or more conditions measured on the same subjects, row by row. Reports the condition F, partial eta-squared, and the Greenhouse-Geisser and Huynh-Feldt sphericity corrections. Use this when each row is one subject and each column is a condition.",
    groupCount: "all",
  },
  linearMixedModel: {
    label: "Linear mixed model",
    blurb:
      "Fit a random-intercept mixed model to three or more conditions measured on the same subjects, row by row. Reports each condition as a fixed effect against the first (the reference), with its standard error, z, p, and 95% interval, plus the between-subject and residual variance. The regression cousin of the repeated-measures ANOVA, fit by REML.",
    groupCount: "all",
  },
  multipleRegression: {
    label: "Multiple linear regression",
    blurb:
      "Predict one Y column from two or more predictor columns by ordinary least squares. Reports each coefficient with its standard error, t, p, and 95% interval, plus R-squared, adjusted R-squared, the overall F test, and per-predictor VIF.",
    groupCount: "regression",
  },
  correlationPearson: {
    label: "Pearson correlation",
    blurb:
      "Measure the strength of a linear relationship between X and a Y column. Reports r with a confidence interval.",
    groupCount: "two",
  },
  correlationSpearman: {
    label: "Spearman correlation",
    blurb:
      "Measure a monotone relationship by rank, without assuming a straight line or a normal distribution. Reports rho.",
    groupCount: "two",
  },
  linearRegression: {
    label: "Linear regression",
    blurb:
      "Fit a straight line y = intercept + slope x. Reports the slope, intercept, their confidence intervals, and R-squared.",
    groupCount: "two",
  },
  logisticRegression: {
    label: "Simple logistic regression",
    blurb:
      "Fit P(Y=1) from one X column and a binary 0/1 Y by maximum likelihood. Reports the slope and intercept, the odds ratio with a 95% confidence interval, McFadden pseudo-R-squared, and the X where P=0.5.",
    groupCount: "two",
  },
  rocCurve: {
    label: "ROC curve and AUC",
    blurb:
      "Score a diagnostic test against a binary 0/1 outcome. Sweeps every threshold to the ROC curve and reports the area under it (AUC) with a 95% confidence interval, plus the best cut point by Youden's J with its sensitivity and specificity.",
    groupCount: "two",
  },
  doseResponse: {
    label: "Dose-response curve",
    blurb:
      "Fit a 4PL or 5PL logistic to log(dose) vs response. Reports the EC50 / IC50 with a 95% confidence interval, the Hill slope, the Top and Bottom plateaus, and R-squared.",
    groupCount: "two",
  },
  modelComparison: {
    label: "Compare models",
    blurb:
      "Fit two curve models to the same X and Y, then say which one to keep. Reports the extra-sum-of-squares F test for nested models and AICc for any pair.",
    groupCount: "two",
  },
  globalFit: {
    label: "Global fit (shared parameters)",
    blurb:
      "Fit one dose-response curve shape to every Y column at once, sharing the Hill slope and the plateaus while each curve keeps its own EC50. Reports each shared parameter once and an EC50 per curve, so you can compare potencies with all curves held to a common shape.",
    groupCount: "globalFit",
  },
  twoWayAnova: {
    label: "Two-way ANOVA",
    blurb:
      "Test two factors at once (the row label and the column group) plus their interaction, with Tukey comparisons across the groups.",
    groupCount: "all",
  },
  kaplanMeier: {
    label: "Survival analysis",
    blurb:
      "Kaplan-Meier curves with median survival, plus the log-rank test when the table has two or more groups.",
    groupCount: "all",
  },
  coxRegression: {
    label: "Cox proportional hazards",
    blurb:
      "Fit a Cox model on the survival arms for the hazard ratio (with its 95% interval) of one arm versus the reference, plus the likelihood-ratio test and concordance.",
    groupCount: "all",
  },
  grubbsOutlier: {
    label: "Outlier detection (Grubbs)",
    blurb:
      "Screen each group column for a value that sits too far from the mean to be chance. Reports the Grubbs G and its critical value, every flagged outlier with its row, and the cleaned sample size. The iterative sweep clears more than one outlier from the same column.",
    groupCount: "screen",
  },
  contingency: {
    label: "Chi-square / Fisher exact",
    blurb:
      "Test whether two categorical factors are associated. Reports the chi-square test of independence and, for a 2x2 table, Fisher's exact p plus the relative risk and odds ratio with 95% intervals.",
    groupCount: "all",
  },
  nestedTTest: {
    label: "Nested t-test",
    blurb:
      "Compare two groups with subgroups (technical replicates nested within biological replicates). A random-intercept mixed model tests the group difference against the subgroup variation, so the technical replicates are not pseudo-replicated. Reports the difference, its 95% interval, and the variance components.",
    groupCount: "all",
  },
  nestedOneWayAnova: {
    label: "Nested one-way ANOVA",
    blurb:
      "Compare three or more groups with subgroups. Tests the group effect against the subgroup-to-subgroup variation (the exact balanced nested-ANOVA F, or a mixed model for an unbalanced design). Reports F, the variance components, and the subgroup and replicate counts.",
    groupCount: "all",
  },
};

export default function NewAnalysisDialog({
  open,
  content,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  /** The open table's content, used to offer valid types + group choices. */
  content: DataHubDocContent | null;
  onCancel: () => void;
  onSubmit: (data: NewAnalysisSubmit) => void;
}) {
  const { openBeakerBot } = useBeakerSearch();

  // Hand the test choice off to BeakerBot when the researcher is not sure which
  // analysis fits. The bot resolves "this table" through its own context bridge,
  // so the seed query stays generic. Closing this dialog moves focus cleanly
  // into the BeakerBot conversation.
  const handleHelpMeChoose = () => {
    onCancel();
    openBeakerBot();
    void sendToBeakerBot("help me choose an analysis for this table");
  };

  const isXY = content?.meta.table_type === "xy";
  const isGrouped = content?.meta.table_type === "grouped";
  const isSurvival = content?.meta.table_type === "survival";
  const isContingency = content?.meta.table_type === "contingency";
  const isNested = content?.meta.table_type === "nested";
  const wholeTable = isGrouped || isSurvival || isContingency || isNested;
  const groups = useMemo(
    () => (content ? groupColumns(content) : []),
    [content],
  );
  const ys = useMemo(() => (content ? yColumns(content) : []), [content]);
  const xCol = useMemo(() => (content ? xColumn(content) : null), [content]);
  const validTypes = useMemo(
    () => (content ? validAnalysisTypes(content) : []),
    [content],
  );

  const [type, setType] = useState<AnalysisType | null>(null);
  // The two group ids a t-test compares (ignored for ANOVA, which takes all).
  const [groupA, setGroupA] = useState<string>("");
  const [groupB, setGroupB] = useState<string>("");
  // The Y column an XY analysis runs against (the X column is the table's one).
  const [yColumn, setYColumn] = useState<string>("");
  // Multiple regression: the response column plus the chosen predictor ids.
  const [regYColumn, setRegYColumn] = useState<string>("");
  const [regPredictors, setRegPredictors] = useState<string[]>([]);

  // Reset the form each open: default to the first valid type and the first two
  // groups (or the first Y column for an XY table) so the common case is one
  // click away.
  useEffect(() => {
    if (!open) return;
    const firstType = validTypes[0] ?? null;
    setType(firstType);
    setGroupA(groups[0]?.id ?? "");
    setGroupB(groups[1]?.id ?? "");
    setYColumn(ys[0]?.id ?? "");
    // Default the regression Y to the first column and every OTHER column to a
    // predictor, the common all-predictors-but-Y starting point.
    setRegYColumn(groups[0]?.id ?? "");
    setRegPredictors(groups.slice(1).map((g) => g.id));
  }, [open, validTypes, groups, ys]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const isPair = type !== null && TYPE_META[type].groupCount === "two";
  const isRegression =
    type !== null && TYPE_META[type].groupCount === "regression";
  // Global fitting reads EVERY Y column at once, so it needs no single-Y pick.
  const isGlobalFit =
    type !== null && TYPE_META[type].groupCount === "globalFit";
  // Outlier screening reads EVERY group column at once (each is screened on its
  // own), so like global fitting it needs no single-column pick, only that the
  // table has at least one group column.
  const isScreen = type !== null && TYPE_META[type].groupCount === "screen";
  // The predictors that are not the chosen Y column (Y cannot also be an X).
  const regPredictorsClean = regPredictors.filter((id) => id !== regYColumn);
  const canSubmit = wholeTable
    ? type !== null
    : isScreen
    ? type !== null && groups.length >= 1
    : isGlobalFit
      ? type !== null && !!xCol && ys.length >= 2
      : isXY
      ? type !== null && yColumn !== "" && !!xCol
      : isRegression
        ? type !== null &&
          regYColumn !== "" &&
          regPredictorsClean.length >= 2
        : type !== null &&
          (isPair
            ? groupA !== "" && groupB !== "" && groupA !== groupB
            : groups.length >= 3);

  const submit = () => {
    if (!canSubmit || type === null) return;
    // A two-way ANOVA or a survival analysis reads the whole table, so it needs
    // no column selection.
    const columnIds = wholeTable
      ? []
      : isScreen
      ? groups.map((g) => g.id)
      : isGlobalFit
        ? ys.map((y) => y.id)
        : isXY
        ? [yColumn]
        : isRegression
          ? [regYColumn, ...regPredictorsClean]
          : isPair
            ? [groupA, groupB]
            : groups.map((g) => g.id);
    onSubmit({ type, columnIds });
  };

  const togglePredictor = (id: string) => {
    setRegPredictors((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      data-testid="datahub-new-analysis-dialog"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New analysis"
        className="relative flex max-h-[90vh] w-full max-w-md flex-col rounded-lg border border-border bg-surface-overlay shadow-xl"
      >
        <div className="flex-none px-5 pt-5">
          <h2 className="text-title font-semibold text-foreground">New analysis</h2>
          <p className="mt-1 text-meta text-foreground-muted">
            The result reads from this table live, so an edit to a replicate
            re-runs the test. You only choose the comparison once.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-1">
        {validTypes.length === 0 ? (
          <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-body text-foreground-muted">
            {isXY
              ? "Add an X column and at least one Y column with numbers before running an analysis."
              : isGrouped
                ? "Label at least two rows and fill at least two groups with numbers before running a two-way ANOVA."
                : isSurvival
                  ? "Enter a Time and an Event (1 or 0) for at least one subject before running a survival analysis."
                  : isContingency
                    ? "Enter at least one count in the contingency table before running the test."
                    : isNested
                      ? "Enter at least one replicate in the nested table before running the test."
                      : "Add at least two groups with numbers before running an analysis."}
          </p>
        ) : (
          <>
            <label className="mt-4 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
              Analysis
            </label>
            <div className="mt-1 flex flex-col gap-2">
              {validTypes.map((t) => {
                const active = type === t;
                const meta = TYPE_META[t];
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`rounded-md border px-3 py-2 text-left transition-colors ${
                      active
                        ? "border-sky-400 bg-accent-soft"
                        : "border-border bg-surface-raised hover:bg-surface-sunken"
                    }`}
                  >
                    <span className="block text-body font-medium text-foreground">
                      {meta.label}
                    </span>
                    <span className="mt-0.5 block text-meta text-foreground-muted">
                      {meta.blurb}
                    </span>
                  </button>
                );
              })}
            </div>

            {isGrouped ? (
              <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-meta text-foreground-muted">
                Runs across every row label and every column group on this table,
                including the interaction. No column picking needed.
              </p>
            ) : isSurvival ? (
              <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-meta text-foreground-muted">
                Estimates a Kaplan-Meier curve for each Group on this table, and
                runs the log-rank test when there are two or more groups. No
                column picking needed.
              </p>
            ) : isContingency ? (
              <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-meta text-foreground-muted">
                Reads every row and every count column on this table as the
                count matrix. A 2x2 table also reports Fisher's exact p, the
                relative risk, and the odds ratio. No column picking needed.
              </p>
            ) : isNested ? (
              <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-meta text-foreground-muted">
                Reads every group, its subgroups, and their replicates on this
                table. The test treats each subgroup as the unit of replication,
                so the technical replicates are not pseudo-replicated. No column
                picking needed.
              </p>
            ) : isGlobalFit ? (
              <div className="mt-4 flex flex-col gap-3">
                <div>
                  <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                    X column
                  </label>
                  <div className="mt-1 w-full rounded-md border border-border bg-surface-sunken px-2 py-1.5 text-body text-foreground-muted">
                    {xCol?.name ?? "X"}
                  </div>
                </div>
                <p className="rounded-md border border-border bg-surface-raised px-3 py-2 text-meta text-foreground-muted">
                  Fits every Y column on this table together ({ys.length}{" "}
                  curves: {ys.map((c) => c.name).join(", ")}). Choose which
                  parameters are shared after it runs.
                </p>
              </div>
            ) : isScreen ? (
              <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-meta text-foreground-muted">
                Screens every group column on this table for outliers (
                {groups.length}{" "}
                {groups.length === 1 ? "column" : "columns"}:{" "}
                {groups.map((g) => g.name).join(", ")}). Each column is screened
                on its own. No column picking needed.
              </p>
            ) : isXY ? (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                    X column
                  </label>
                  <div className="mt-1 w-full rounded-md border border-border bg-surface-sunken px-2 py-1.5 text-body text-foreground-muted">
                    {xCol?.name ?? "X"}
                  </div>
                </div>
                <div>
                  <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                    Y column
                  </label>
                  <select
                    value={yColumn}
                    onChange={(e) => setYColumn(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                  >
                    {ys.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : isRegression ? (
              <div className="mt-4 flex flex-col gap-3">
                <div>
                  <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                    Y column (outcome)
                  </label>
                  <select
                    value={regYColumn}
                    onChange={(e) => setRegYColumn(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                  >
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                    Predictor columns (pick 2 or more)
                  </label>
                  <div className="mt-1 flex flex-col gap-1 rounded-md border border-border bg-surface-raised p-2">
                    {groups
                      .filter((g) => g.id !== regYColumn)
                      .map((g) => (
                        <label
                          key={g.id}
                          className="flex items-center gap-2 rounded px-1.5 py-1 text-body text-foreground hover:bg-surface-sunken"
                        >
                          <input
                            type="checkbox"
                            checked={regPredictors.includes(g.id)}
                            onChange={() => togglePredictor(g.id)}
                            className="h-3.5 w-3.5 accent-sky-500"
                          />
                          {g.name}
                        </label>
                      ))}
                  </div>
                  {regPredictorsClean.length < 2 && (
                    <p className="mt-1 text-meta text-amber-600">
                      Pick at least 2 predictor columns.
                    </p>
                  )}
                </div>
              </div>
            ) : isPair ? (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                    First group
                  </label>
                  <select
                    value={groupA}
                    onChange={(e) => setGroupA(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                  >
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                    Second group
                  </label>
                  <select
                    value={groupB}
                    onChange={(e) => setGroupB(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                  >
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                {groupA === groupB && (
                  <p className="col-span-2 text-meta text-amber-600">
                    Pick two different groups to compare.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-meta text-foreground-muted">
                Compares all {groups.length} groups ({groups.map((g) => g.name).join(", ")}).
              </p>
            )}
          </>
        )}
        </div>

        <div className="flex flex-none items-center justify-between gap-2 border-t border-border px-5 py-4">
          {AI_ASSISTANT_ENABLED ? (
            <button
              type="button"
              onClick={handleHelpMeChoose}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-body font-medium text-brand-action hover:bg-accent-soft"
              data-testid="datahub-help-me-choose"
            >
              <BeakerBot pose="pointing" className="h-6 w-6" ariaLabel="BeakerBot" />
              Help me choose
            </button>
          ) : (
            <span />
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-border px-3 py-1.5 text-body font-medium text-foreground-muted hover:bg-surface-sunken"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-md px-3 py-1.5 text-body font-medium disabled:opacity-50"
            >
              Run analysis
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

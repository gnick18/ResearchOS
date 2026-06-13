"use client";

// GuidedAnalysisWizard (Data Hub wizard slice). The first ADAPTER on top of the
// pure planner (lib/datahub/planner.ts): it collects a structured AnalysisIntent
// through a short stepper, calls planAnalysis, and renders the recommended test
// plus the assumption Report Card. A natural-language omnibox and an AI
// assistant are intended later adapters into the SAME planner, so this component
// owns only the question-asking and the review surface, never the test choice or
// the assumption math.
//
// Why guided. Bench scientists are not statisticians, and the easy mistake is
// running a t-test or ANOVA on data that breaks its assumptions. The wizard asks
// what you are comparing in plain terms, then shows what it checked (normality,
// equal variance) before recommending a test, and switches you to the right
// rank-based test automatically when an assumption fails. The user approves the
// plan to run it (producing the same AnalysisSpec + ResultsSheet as New
// analysis) or steps back to edit the answers.
//
// Mirrors the mockup overlay in docs/mockups/data-hub-tab-mockup.html (the
// .wizard / .reportcard block).
//
// House style: <Icon> only, popup is a contained surface (bg-surface-overlay +
// border), primary CTA uses .bg-brand-action text-white transition-colors hover:bg-brand-action/90, no emojis / em-dashes / mid-sentence
// colons.

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import { groupColumns } from "@/lib/datahub/column-table";
import { yColumns } from "@/lib/datahub/xy-table";
import {
  planAnalysis,
  type AnalysisIntent,
  type ComparisonFamily,
  type Pairing,
  type ProposedPlan,
  type ReportCardItem,
} from "@/lib/datahub/planner";
import type { AnalysisType } from "@/lib/datahub/run-analysis";

export interface GuidedAnalysisSubmit {
  type: AnalysisType;
  /** The ordered group column ids the recommended test runs over. */
  columnIds: string[];
}

/** The answers collected so far. Undefined means not-yet-answered. */
interface Answers {
  family?: ComparisonFamily;
  groupCount?: "two" | "three-plus";
  pairing?: Pairing;
  /** For an XY association, which Y column to relate to X. */
  yColumnId?: string;
}

/** A single tappable option button (mirrors the mockup's .wopt). */
function OptionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-2 block w-full rounded-lg border border-border bg-surface-raised px-3.5 py-2.5 text-left text-body text-foreground transition-colors hover:border-sky-400 hover:bg-accent-soft"
    >
      {label}
    </button>
  );
}

/** One Report Card row, badge + plain-language line (mirrors .rc-row). */
function ReportRow({ item }: { item: ReportCardItem }) {
  const badge =
    item.status === "pass"
      ? { text: "PASS", cls: "bg-green-500/15 text-green-600 dark:text-green-400" }
      : item.status === "fail"
        ? { text: "FAIL", cls: "bg-red-500/15 text-red-600 dark:text-red-400" }
        : { text: "NOTE", cls: "bg-amber-500/20 text-amber-700 dark:text-amber-400" };
  return (
    <div className="flex items-start gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0">
      <span
        className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}
      >
        {badge.text}
      </span>
      <p className="text-meta leading-relaxed text-foreground">
        <span className="font-semibold">{item.title}.</span> {item.detail}
      </p>
    </div>
  );
}

export default function GuidedAnalysisWizard({
  open,
  content,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  /** The open table's content, fed to the planner. */
  content: DataHubDocContent | null;
  onCancel: () => void;
  onSubmit: (data: GuidedAnalysisSubmit) => void;
}) {
  // The stepper position. Step 0 = family, 1 = group count, 2 = pairing, 3 =
  // the recommendation + Report Card. For a means comparison all four steps
  // show; the association / survival families short-circuit to step 3.
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});

  const groupCols = useMemo(
    () => (content ? groupColumns(content) : []),
    [content],
  );
  const ys = useMemo(() => (content ? yColumns(content) : []), [content]);
  const tableType = content?.meta.table_type;
  const isXY = tableType === "xy";
  const isGrouped = tableType === "grouped";
  const isSurvival = tableType === "survival";

  // Reset the wizard each open so a re-entry starts clean.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setAnswers({});
  }, [open]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  // Build the intent from the collected answers, then plan. The plan is only
  // meaningful once the review step is reached (or for a short-circuited
  // family), so it is computed lazily here and read on the review step.
  const plan = useMemo<ProposedPlan | null>(() => {
    if (!content || !answers.family) return null;
    const intent: AnalysisIntent = {
      family: answers.family,
      groupCount: answers.groupCount ?? "two",
      pairing: answers.pairing ?? "independent",
      yColumnId: answers.yColumnId,
    };
    return planAnalysis(content, intent);
  }, [content, answers]);

  if (!open) return null;

  // The number of question steps before the review step depends on the family.
  // A means comparison asks family, count, pairing (then review = step 3). The
  // other families short-circuit to review right after family (step 1).
  const isMeans = answers.family === "means";
  const isAssoc = answers.family === "association";
  // An XY association inserts one Y-column question before review; everything
  // else short-circuits to review right after the family (or after pairing for
  // a means comparison).
  const needYStep = isAssoc && isXY && ys.length > 0;
  const reviewStep = isMeans ? 3 : needYStep ? 2 : 1;
  const totalSteps = reviewStep + 1;
  const onReview = step >= reviewStep;

  const pick = (patch: Answers, advanceTo: number) => {
    setAnswers((prev) => ({ ...prev, ...patch }));
    setStep(advanceTo);
  };

  // The table must have enough columns for the recommended test. A means
  // comparison needs two (or three) group columns; an association needs the one
  // resolved Y column; a two-way ANOVA and a survival analysis read the whole
  // table, so they need no column selection (the planner already checked the
  // table has the data). The planner still recommends, but a run needs the data.
  const isWholeTable =
    answers.family === "twoFactor" || answers.family === "survival";
  const requiredColumns = isWholeTable
    ? 0
    : isMeans
      ? answers.groupCount === "three-plus"
        ? 3
        : 2
      : 1;
  const enoughColumns =
    plan?.steps[0]?.analysisType == null
      ? false
      : (plan?.steps[0]?.columnIds.length ?? 0) >= requiredColumns;

  const canRun =
    !!plan && plan.runnable && plan.steps[0]?.analysisType != null && enoughColumns;

  const run = () => {
    if (!plan || !canRun) return;
    const step0 = plan.steps[0];
    if (!step0.analysisType) return;
    onSubmit({ type: step0.analysisType, columnIds: step0.columnIds });
  };

  const back = () => {
    if (step === 0) {
      onCancel();
      return;
    }
    // From review, step back to the last question for the family.
    if (onReview) {
      setStep(isMeans ? 2 : needYStep ? 1 : 0);
      return;
    }
    setStep((s) => Math.max(0, s - 1));
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      data-testid="datahub-guided-wizard"
    >
      <div className="absolute inset-0 bg-black/45" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Guided analysis"
        className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-surface-overlay shadow-xl"
      >
        {/* Header */}
        <div className="flex flex-none items-center gap-2 border-b border-border px-4 py-3">
          <Icon name="features" className="h-4 w-4 text-accent" />
          <span className="text-body font-semibold text-foreground">
            Guided analysis
          </span>
          <span className="ml-auto text-[11px] font-semibold text-foreground-muted">
            Step {Math.min(step, reviewStep) + 1} of {totalSteps}
          </span>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" data-testid="wizard-body">
          {step === 0 && (
            <div data-testid="wizard-step-family">
              <p className="mb-3 text-body font-semibold text-foreground">
                What are you comparing?
              </p>
              {/* The options are scoped to the open table type, so the wizard
                  never offers a test the table cannot run. A Grouped table
                  compares two factors; a Survival table compares survival; an
                  XY table looks at a relationship; a Column table compares
                  group means. With no table type, all families show. */}
              {(isGrouped) && (
                <OptionButton
                  label="Two factors at once (for example treatment and time)"
                  onClick={() => pick({ family: "twoFactor" }, 1)}
                />
              )}
              {(isSurvival) && (
                <OptionButton
                  label="Survival or time to an event"
                  onClick={() => pick({ family: "survival" }, 1)}
                />
              )}
              {(isXY) && (
                <OptionButton
                  label="A relationship between two measures"
                  onClick={() => pick({ family: "association" }, 1)}
                />
              )}
              {(!isGrouped && !isSurvival && !isXY) && (
                <>
                  <OptionButton
                    label="The means of two or more groups"
                    onClick={() => pick({ family: "means" }, 1)}
                  />
                  <OptionButton
                    label="A relationship between two measures"
                    onClick={() => pick({ family: "association" }, 1)}
                  />
                  <OptionButton
                    label="Survival or time to an event"
                    onClick={() => pick({ family: "survival" }, 1)}
                  />
                </>
              )}
            </div>
          )}

          {step === 1 && isMeans && (
            <div data-testid="wizard-step-count">
              <p className="mb-3 text-body font-semibold text-foreground">
                How many groups?
              </p>
              <OptionButton
                label="Two groups"
                onClick={() => pick({ groupCount: "two" }, 2)}
              />
              <OptionButton
                label="Three or more groups"
                onClick={() => pick({ groupCount: "three-plus" }, 2)}
              />
            </div>
          )}

          {step === 2 && isMeans && (
            <div data-testid="wizard-step-pairing">
              <p className="mb-3 text-body font-semibold text-foreground">
                Are the measurements paired?
              </p>
              <OptionButton
                label="Independent (different wells or animals)"
                onClick={() => pick({ pairing: "independent" }, 3)}
              />
              <OptionButton
                label="Paired (same subject before and after)"
                onClick={() => pick({ pairing: "paired" }, 3)}
              />
            </div>
          )}

          {step === 1 && needYStep && (
            <div data-testid="wizard-step-ycolumn">
              <p className="mb-3 text-body font-semibold text-foreground">
                Which measure do you want to relate to X?
              </p>
              {ys.map((c) => (
                <OptionButton
                  key={c.id}
                  label={c.name}
                  onClick={() => pick({ yColumnId: c.id }, 2)}
                />
              ))}
            </div>
          )}

          {onReview && plan && (
            <div data-testid="wizard-step-review">
              <p
                className="mb-1 text-body font-semibold text-foreground"
                data-testid="wizard-recommendation"
              >
                Recommended: {plan.recommendation}
              </p>
              <p className="mb-3 text-meta text-foreground-muted">
                {plan.rationale}
              </p>
              <div className="mb-3 overflow-hidden rounded-lg border border-border">
                {plan.reportCard.map((item) => (
                  <ReportRow key={item.key} item={item} />
                ))}
              </div>

              {!plan.runnable && (
                <p className="rounded-md border border-border bg-surface-raised px-3 py-2 text-meta text-foreground-muted">
                  This analysis is not available in the guided wizard yet. Pick a
                  table type that supports it, or run a group comparison instead.
                </p>
              )}

              {plan.runnable && !enoughColumns && (
                <p className="rounded-md border border-border bg-surface-raised px-3 py-2 text-meta text-amber-600">
                  This table does not have enough group columns for that test.
                  Add{" "}
                  {answers.groupCount === "three-plus" ? "three" : "two"} group
                  columns with numbers, then try again. The table currently has{" "}
                  {groupCols.length}.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-none items-center justify-between border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={back}
            className="rounded-md border border-border px-3 py-1.5 text-body font-medium text-foreground-muted hover:bg-surface-sunken"
          >
            {step === 0 ? "Cancel" : "Back"}
          </button>
          {onReview && (
            <button
              type="button"
              onClick={run}
              disabled={!canRun}
              className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-md px-3 py-1.5 text-body font-medium disabled:opacity-50"
              data-testid="wizard-run"
            >
              Run this analysis
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

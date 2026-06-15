"use client";

// New Graph dialog (Data Hub graphs slice). Picks the figure kind for the open
// Column table (a column scatter / dot plot, the default, or a bar with error
// bars) and, when the table already has a one-way ANOVA, offers to carry its
// significance brackets straight onto the figure. Hands the choice back to the
// page, which builds the PlotSpec, persists it via setPlot, and selects it.
//
// The scatter is the default because individual points show the real spread of
// the replicates rather than hiding it behind a bar, which is what a reviewer
// asks for. XY with a fitted curve is a later slice and is shown disabled so the
// surface reads as "more coming" without being clickable.
//
// House style: a popup reads as a contained surface (bg-surface-overlay + border),
// the primary CTA uses .bg-brand-action text-white transition-colors hover:bg-brand-action/90, <Icon> only, no emojis / em-dashes /
// mid-sentence colons.

import { useEffect, useMemo, useState } from "react";
import type {
  AnalysisSpec,
  DataHubDocContent,
} from "@/lib/datahub/model/types";
import { groupColumns } from "@/lib/datahub/column-table";
import { yColumns } from "@/lib/datahub/xy-table";
import type { PlotKind, FitModelId } from "@/lib/datahub/plot-spec";
import {
  findRegressionAnalysis,
  findRocAnalysis,
} from "@/lib/datahub/table-capabilities";

export interface NewGraphSubmit {
  kind: PlotKind;
  /** The linked analysis id (ANOVA brackets, or a diagnostic-plot source), or null. */
  analysisId: string | null;
  /** For an XY figure, the Y column to plot against X. */
  yColumnId?: string | null;
  /** For an XY figure, the initial fitted-curve model. */
  fitModel?: FitModelId;
  /** For an estimation figure, the paired variant (matched rows). */
  estimationPaired?: boolean;
  /** For an estimation figure, which group is the shared control. */
  estimationControlIndex?: number;
  /** For a QQ figure sourced from a table group, which group to plot. */
  diagnosticColumnIndex?: number;
}

/** The fitted-curve choices the XY graph dialog offers. */
const FIT_OPTIONS: { value: FitModelId; label: string }[] = [
  { value: "linear", label: "Linear (line of best fit)" },
  { value: "logistic4pl", label: "4-parameter logistic (dose-response)" },
  { value: "michaelis-menten", label: "Michaelis-Menten" },
  { value: "exp-decay-1phase", label: "Exponential decay" },
  { value: "exp-association-1phase", label: "Exponential association" },
  { value: "polynomial2", label: "Quadratic" },
  { value: "gaussian", label: "Gaussian peak" },
  { value: "none", label: "None (points only)" },
];

const KINDS: {
  kind: PlotKind;
  label: string;
  blurb: string;
  enabled: boolean;
}[] = [
  {
    kind: "columnScatter",
    label: "Column scatter",
    blurb:
      "Every replicate as a point over the group mean, with error bars. Shows the real spread, which is what a reviewer wants to see.",
    enabled: true,
  },
  {
    kind: "columnBar",
    label: "Bar with error bars",
    blurb: "A bar to the group mean with SD or SEM error bars.",
    enabled: true,
  },
  {
    kind: "estimationGardnerAltman",
    label: "Estimation plot (effect size)",
    blurb:
      "The raw data plus the bootstrap mean-difference and its 95% CI on a second axis. Shows the size of the effect, not just a significance star. Needs two or more groups.",
    enabled: true,
  },
  {
    kind: "xyScatter",
    label: "XY with fitted curve",
    blurb: "Dose-response and time courses with a fitted model. Coming soon.",
    enabled: false,
  },
];

/** The three Parts-of-whole figures, offered on a Parts-of-whole table. */
const PARTS_OF_WHOLE_KINDS: { kind: PlotKind; label: string; blurb: string }[] = [
  {
    kind: "pie",
    label: "Pie",
    blurb:
      "One wedge per category, sized by value, labeled with the category and its percent of the total.",
  },
  {
    kind: "donut",
    label: "Donut",
    blurb: "The pie with a center hole and the total in the middle.",
  },
  {
    kind: "stackedBar",
    label: "100% stacked bar",
    blurb:
      "A single column that sums to 100 percent, one segment per category.",
  },
];

/** Find a stored one-way ANOVA on the table (its Tukey pairs feed brackets). */
function findAnova(content: DataHubDocContent | null): AnalysisSpec | null {
  if (!content) return null;
  return content.analyses.find((a) => a.type === "oneWayAnova") ?? null;
}

/**
 * Map a curve-fit analysis to the figure fit model it should draw, so a new XY
 * figure inherits the model the user already fit rather than guessing a line.
 * doseResponse carries its model in params.model (the 5PL has no separate plot
 * curve, so it draws as the 4PL shape it specializes); the other entries map a
 * fit analysis type straight to its FitModelId.
 */
function fitModelForAnalysis(a: AnalysisSpec): FitModelId | null {
  switch (a.type) {
    case "doseResponse":
      return (a.params as { model?: unknown }).model === "logistic5pl"
        ? "logistic4pl"
        : "logistic4pl";
    case "linearRegression":
      return "linear";
    default:
      return null;
  }
}

/**
 * The fitted curve a brand-new XY figure should default to for the chosen Y
 * column. If a curve-fit analysis already exists for that column, inherit its
 * model so a dose-response opens as the S-curve, not a line. With no fit
 * analysis, draw points only rather than a misleading line of best fit.
 */
function defaultFitModel(
  content: DataHubDocContent | null,
  yColumnId: string,
): FitModelId {
  if (!content || !yColumnId) return "none";
  for (const a of content.analyses) {
    const model = fitModelForAnalysis(a);
    if (model === null) continue;
    const ids = (a.inputs as { columnIds?: unknown }).columnIds;
    const firstId = Array.isArray(ids) ? ids[0] : undefined;
    if (firstId === yColumnId) return model;
  }
  return "none";
}

export default function NewGraphDialog({
  open,
  content,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  content: DataHubDocContent | null;
  onCancel: () => void;
  onSubmit: (data: NewGraphSubmit) => void;
}) {
  const isXY = content?.meta.table_type === "xy";
  const isGrouped = content?.meta.table_type === "grouped";
  const isSurvival = content?.meta.table_type === "survival";
  const isPartsOfWhole = content?.meta.table_type === "partsOfWhole";
  const groups = useMemo(
    () => (content ? groupColumns(content) : []),
    [content],
  );
  const ys = useMemo(() => (content ? yColumns(content) : []), [content]);
  const anova = useMemo(() => findAnova(content), [content]);
  // The analyses on the table that a diagnostic plot can draw from. A regression
  // feeds the residual plot (and lets the QQ plot use its residuals); a ROC curve
  // analysis feeds the ROC visual.
  const regression = useMemo(
    () => (content ? findRegressionAnalysis(content) : null),
    [content],
  );
  const roc = useMemo(
    () => (content ? findRocAnalysis(content) : null),
    [content],
  );

  const [kind, setKind] = useState<PlotKind>("columnScatter");
  const [useBrackets, setUseBrackets] = useState(true);
  const [yColumn, setYColumn] = useState<string>("");
  const [fitModel, setFitModel] = useState<FitModelId>("linear");
  const [estPaired, setEstPaired] = useState(false);
  const [estControl, setEstControl] = useState(0);

  // The estimation kind is selected when the user picks either estimation entry.
  // Two groups makes a Gardner-Altman, three or more makes a Cumming (shared
  // control, one difference panel per other group); we resolve which at submit.
  const isEstimationSelected =
    kind === "estimationGardnerAltman" || kind === "estimationCumming";

  useEffect(() => {
    if (!open) return;
    setKind(
      isXY
        ? "xyScatter"
        : isGrouped
          ? "groupedBar"
          : isSurvival
            ? "survivalCurve"
            : isPartsOfWhole
              ? "pie"
              : "columnScatter",
    );
    setUseBrackets(true);
    const firstY = ys[0]?.id ?? "";
    setYColumn(firstY);
    // Inherit the fit model from a curve-fit analysis already on this Y column
    // (so a dose-response opens as the S-curve), else draw points only.
    setFitModel(defaultFitModel(content, firstY));
    setEstPaired(false);
    setEstControl(0);
  }, [open, isXY, isGrouped, isSurvival, isPartsOfWhole, ys, content]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const canSubmit = isXY
    ? yColumn !== ""
    : isGrouped || isSurvival || isPartsOfWhole
      ? true
      : isEstimationSelected
        ? groups.length >= 2
        : groups.length >= 1;

  // The three diagnostic plots a reviewer asks for alongside a fit. A QQ plot of
  // a table group is always available on a Column table; a residual plot needs a
  // linked regression; the ROC visual needs a linked ROC curve analysis. Each
  // submits immediately (no extra options), carrying the source analysis id.
  const submitDiagnostic = (
    plotKind: "qqPlot" | "residualPlot" | "rocCurve",
    analysisId: string | null,
  ) => {
    onSubmit({
      kind: plotKind,
      analysisId,
      diagnosticColumnIndex: 0,
    });
  };

  const submit = () => {
    if (!canSubmit) return;
    if (isXY) {
      onSubmit({
        kind: "xyScatter",
        analysisId: null,
        yColumnId: yColumn,
        fitModel,
      });
      return;
    }
    if (isGrouped) {
      onSubmit({ kind: "groupedBar", analysisId: null });
      return;
    }
    if (isSurvival) {
      onSubmit({ kind: "survivalCurve", analysisId: null });
      return;
    }
    if (isPartsOfWhole) {
      // kind holds the chosen pie / donut / stacked-bar from the picker.
      onSubmit({ kind, analysisId: null });
      return;
    }
    if (isEstimationSelected) {
      // Two groups draws a Gardner-Altman, three or more a Cumming. Paired only
      // applies to the two-group Gardner-Altman (matched rows of one contrast).
      const cumming = groups.length >= 3;
      onSubmit({
        kind: cumming ? "estimationCumming" : "estimationGardnerAltman",
        analysisId: null,
        estimationPaired: cumming ? false : estPaired,
        estimationControlIndex: Math.min(estControl, groups.length - 1),
      });
      return;
    }
    onSubmit({
      kind,
      analysisId: anova && useBrackets ? anova.id : null,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      data-testid="datahub-new-graph-dialog"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New graph"
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface-overlay p-5 shadow-xl"
      >
        <h2 className="text-title font-semibold text-foreground">New graph</h2>
        <p className="mt-1 text-meta text-foreground-muted">
          The figure reads from this table live, so an edit redraws the points
          and re-fits the curve. You only choose the kind once.
        </p>

        {isSurvival ? (
          <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-body text-foreground-muted">
            Makes a Kaplan-Meier survival curve, one step-down line per group,
            with time on the X axis and survival on the Y axis. Tune the colors
            from the style panel after it opens.
          </p>
        ) : isGrouped ? (
          <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-body text-foreground-muted">
            Makes a grouped bar chart, one cluster per row label and one bar per
            group, with error bars from the replicates. Tune the error-bar type
            and colors from the style panel after it opens.
          </p>
        ) : isPartsOfWhole ? (
          <>
            <label className="mt-4 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
              Figure
            </label>
            <div className="mt-1 flex flex-col gap-2">
              {PARTS_OF_WHOLE_KINDS.map((k) => {
                const active = kind === k.kind;
                return (
                  <button
                    key={k.kind}
                    type="button"
                    onClick={() => setKind(k.kind)}
                    className={`rounded-md border px-3 py-2 text-left transition-colors ${
                      active
                        ? "border-sky-400 bg-accent-soft"
                        : "border-border bg-surface-raised hover:bg-surface-sunken"
                    }`}
                    data-testid={`datahub-newgraph-${k.kind}`}
                  >
                    <span className="block text-body font-medium text-foreground">
                      {k.label}
                    </span>
                    <span className="mt-0.5 block text-meta text-foreground-muted">
                      {k.blurb}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 rounded-md border border-border bg-surface-raised px-3 py-2 text-meta text-foreground-muted">
              Each slice is one category sized by its share of the total. Recolor
              the slices and (for the donut) the hole size from the style panel
              after it opens.
            </p>
          </>
        ) : isXY ? (
          ys.length === 0 ? (
            <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-body text-foreground-muted">
              Add an X column and at least one Y column with numbers before
              making a graph.
            </p>
          ) : (
            <>
              <label className="mt-4 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                Y column
              </label>
              <select
                value={yColumn}
                onChange={(e) => {
                  const next = e.target.value;
                  setYColumn(next);
                  // Re-derive the fit so each Y column inherits its own curve-fit
                  // analysis (or points-only when it has none).
                  setFitModel(defaultFitModel(content, next));
                }}
                className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
              >
                {ys.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <label className="mt-4 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                Fitted curve
              </label>
              <select
                value={fitModel}
                onChange={(e) => setFitModel(e.target.value as FitModelId)}
                className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                data-testid="datahub-newgraph-fitmodel"
              >
                {FIT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-meta text-foreground-muted">
                The curve is fit by least squares from these points, the same way
                a notebook would. You can change the model later from the style
                panel.
              </p>
            </>
          )
        ) : groups.length === 0 ? (
          <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-body text-foreground-muted">
            Add at least one group with numbers before making a graph.
          </p>
        ) : (
          <>
            <label className="mt-4 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
              Graph type
            </label>
            <div className="mt-1 flex flex-col gap-2">
              {KINDS.map((k) => {
                const active = kind === k.kind;
                return (
                  <button
                    key={k.kind}
                    type="button"
                    disabled={!k.enabled}
                    onClick={() => k.enabled && setKind(k.kind)}
                    className={`rounded-md border px-3 py-2 text-left transition-colors ${
                      active
                        ? "border-sky-400 bg-accent-soft"
                        : "border-border bg-surface-raised hover:bg-surface-sunken"
                    } ${k.enabled ? "" : "cursor-not-allowed opacity-50"}`}
                  >
                    <span className="block text-body font-medium text-foreground">
                      {k.label}
                    </span>
                    <span className="mt-0.5 block text-meta text-foreground-muted">
                      {k.blurb}
                    </span>
                  </button>
                );
              })}
            </div>

            {isEstimationSelected ? (
              <>
                <label className="mt-4 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                  Control group
                </label>
                <select
                  value={estControl}
                  onChange={(e) => setEstControl(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                  data-testid="datahub-newgraph-est-control"
                >
                  {groups.map((g, i) => (
                    <option key={g.id} value={i}>
                      {g.name}
                    </option>
                  ))}
                </select>
                {groups.length === 2 ? (
                  <label className="mt-3 flex items-start gap-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-body text-foreground">
                    <input
                      type="checkbox"
                      checked={estPaired}
                      onChange={(e) => setEstPaired(e.target.checked)}
                      className="mt-0.5"
                      data-testid="datahub-newgraph-est-paired"
                    />
                    <span>
                      Paired. The two columns are the same subjects measured
                      twice, so each row is a matched pair. Draws slope lines and
                      a paired mean difference.
                    </span>
                  </label>
                ) : (
                  <p className="mt-3 rounded-md border border-border bg-surface-raised px-3 py-2 text-meta text-foreground-muted">
                    Three or more groups draws a Cumming plot, one difference
                    panel per group against the control. The mean difference and
                    its 95% CI come from a bootstrap, the same numbers an
                    estimation analysis reports.
                  </p>
                )}
              </>
            ) : anova ? (
              <label className="mt-4 flex items-start gap-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-body text-foreground">
                <input
                  type="checkbox"
                  checked={useBrackets}
                  onChange={(e) => setUseBrackets(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Add significance brackets from the one-way ANOVA. The
                  Tukey-adjusted stars drop straight onto the figure.
                </span>
              </label>
            ) : (
              <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-meta text-foreground-muted">
                Run a one-way ANOVA on this table to add significance brackets to
                the figure. You can also turn them on later from the style panel.
              </p>
            )}
          </>
        )}

        {/* Diagnostic plots: the figures a reviewer asks for alongside a fit.
            Shown whenever at least one is available (a Column group for the QQ
            plot, a linked regression for residuals, a linked ROC analysis for
            the ROC visual). Each is a one-click create with no extra options. */}
        {(groups.length >= 1 || regression || roc) && (
          <div className="mt-4" data-testid="datahub-newgraph-diagnostics">
            <p className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
              Diagnostic plots
            </p>
            <div className="mt-1 flex flex-col gap-2">
              {groups.length >= 1 && (
                <button
                  type="button"
                  onClick={() => submitDiagnostic("qqPlot", regression?.id ?? null)}
                  className="rounded-md border border-border bg-surface-raised px-3 py-2 text-left transition-colors hover:bg-surface-sunken"
                  data-testid="datahub-newgraph-qq"
                >
                  <span className="block text-body font-medium text-foreground">
                    Normal QQ plot
                  </span>
                  <span className="mt-0.5 block text-meta text-foreground-muted">
                    {regression
                      ? "Checks whether the regression residuals are normal, the ordered values against the theoretical normal quantiles with a reference line."
                      : "Checks whether a sample is normal, the ordered values against the theoretical normal quantiles with a reference line."}
                  </span>
                </button>
              )}
              {regression && (
                <button
                  type="button"
                  onClick={() => submitDiagnostic("residualPlot", regression.id)}
                  className="rounded-md border border-border bg-surface-raised px-3 py-2 text-left transition-colors hover:bg-surface-sunken"
                  data-testid="datahub-newgraph-residual"
                >
                  <span className="block text-body font-medium text-foreground">
                    Residual vs fitted
                  </span>
                  <span className="mt-0.5 block text-meta text-foreground-muted">
                    The regression residuals against the fitted values, with a
                    zero line. A fan or a curve flags a model that does not fit.
                  </span>
                </button>
              )}
              {roc && (
                <button
                  type="button"
                  onClick={() => submitDiagnostic("rocCurve", roc.id)}
                  className="rounded-md border border-border bg-surface-raised px-3 py-2 text-left transition-colors hover:bg-surface-sunken"
                  data-testid="datahub-newgraph-roc"
                >
                  <span className="block text-body font-medium text-foreground">
                    ROC curve
                  </span>
                  <span className="mt-0.5 block text-meta text-foreground-muted">
                    The true positive rate against the false positive rate from
                    the ROC analysis, with the chance diagonal and the AUC.
                  </span>
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
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
            Create graph
          </button>
        </div>
      </div>
    </div>
  );
}

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
// the primary CTA uses .btn-brand, <Icon> only, no emojis / em-dashes /
// mid-sentence colons.

import { useEffect, useMemo, useState } from "react";
import type {
  AnalysisSpec,
  DataHubDocContent,
} from "@/lib/datahub/model/types";
import { groupColumns } from "@/lib/datahub/column-table";
import { yColumns } from "@/lib/datahub/xy-table";
import type { PlotKind, FitModelId } from "@/lib/datahub/plot-spec";

export interface NewGraphSubmit {
  kind: PlotKind;
  /** The linked ANOVA analysis id for brackets, or null. */
  analysisId: string | null;
  /** For an XY figure, the Y column to plot against X. */
  yColumnId?: string | null;
  /** For an XY figure, the initial fitted-curve model. */
  fitModel?: FitModelId;
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
    kind: "xyScatter",
    label: "XY with fitted curve",
    blurb: "Dose-response and time courses with a fitted model. Coming soon.",
    enabled: false,
  },
];

/** Find a stored one-way ANOVA on the table (its Tukey pairs feed brackets). */
function findAnova(content: DataHubDocContent | null): AnalysisSpec | null {
  if (!content) return null;
  return content.analyses.find((a) => a.type === "oneWayAnova") ?? null;
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
  const groups = useMemo(
    () => (content ? groupColumns(content) : []),
    [content],
  );
  const ys = useMemo(() => (content ? yColumns(content) : []), [content]);
  const anova = useMemo(() => findAnova(content), [content]);

  const [kind, setKind] = useState<PlotKind>("columnScatter");
  const [useBrackets, setUseBrackets] = useState(true);
  const [yColumn, setYColumn] = useState<string>("");
  const [fitModel, setFitModel] = useState<FitModelId>("linear");

  useEffect(() => {
    if (!open) return;
    setKind(isXY ? "xyScatter" : isGrouped ? "groupedBar" : "columnScatter");
    setUseBrackets(true);
    setYColumn(ys[0]?.id ?? "");
    setFitModel("linear");
  }, [open, isXY, isGrouped, ys]);

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
    : isGrouped
      ? true
      : groups.length >= 1;

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
        className="relative w-full max-w-md rounded-lg border border-border bg-surface-overlay p-5 shadow-xl"
      >
        <h2 className="text-title font-semibold text-foreground">New graph</h2>
        <p className="mt-1 text-meta text-foreground-muted">
          The figure reads from this table live, so an edit redraws the points
          and re-fits the curve. You only choose the kind once.
        </p>

        {isGrouped ? (
          <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-body text-foreground-muted">
            Makes a grouped bar chart, one cluster per row label and one bar per
            group, with error bars from the replicates. Tune the error-bar type
            and colors from the style panel after it opens.
          </p>
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
                onChange={(e) => setYColumn(e.target.value)}
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

            {anova ? (
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
            className="btn-brand rounded-md px-3 py-1.5 text-body font-medium disabled:opacity-50"
          >
            Create graph
          </button>
        </div>
      </div>
    </div>
  );
}

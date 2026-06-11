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
import type { PlotKind } from "@/lib/datahub/plot-spec";

export interface NewGraphSubmit {
  kind: PlotKind;
  /** The linked ANOVA analysis id for brackets, or null. */
  analysisId: string | null;
}

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
  const groups = useMemo(
    () => (content ? groupColumns(content) : []),
    [content],
  );
  const anova = useMemo(() => findAnova(content), [content]);

  const [kind, setKind] = useState<PlotKind>("columnScatter");
  const [useBrackets, setUseBrackets] = useState(true);

  useEffect(() => {
    if (!open) return;
    setKind("columnScatter");
    setUseBrackets(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const canSubmit = groups.length >= 1;

  const submit = () => {
    if (!canSubmit) return;
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
          The figure reads from this table live, so an edit to a replicate
          redraws the points and error bars. You only choose the kind once.
        </p>

        {groups.length === 0 ? (
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

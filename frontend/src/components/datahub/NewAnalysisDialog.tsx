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
// the primary CTA uses .btn-brand, <Icon> only, no emojis / em-dashes /
// mid-sentence colons.

import { useEffect, useMemo, useState } from "react";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import { groupColumns } from "@/lib/datahub/column-table";
import {
  validAnalysisTypes,
  type AnalysisType,
} from "@/lib/datahub/run-analysis";

export interface NewAnalysisSubmit {
  type: AnalysisType;
  /** The ordered group column ids that feed the analysis. */
  columnIds: string[];
}

const TYPE_META: Record<
  AnalysisType,
  { label: string; blurb: string; groupCount: "two" | "all" }
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
  const groups = useMemo(
    () => (content ? groupColumns(content) : []),
    [content],
  );
  const validTypes = useMemo(
    () => (content ? validAnalysisTypes(content) : []),
    [content],
  );

  const [type, setType] = useState<AnalysisType | null>(null);
  // The two group ids a t-test compares (ignored for ANOVA, which takes all).
  const [groupA, setGroupA] = useState<string>("");
  const [groupB, setGroupB] = useState<string>("");

  // Reset the form each open: default to the first valid type and the first two
  // groups so the common case is one click away.
  useEffect(() => {
    if (!open) return;
    const firstType = validTypes[0] ?? null;
    setType(firstType);
    setGroupA(groups[0]?.id ?? "");
    setGroupB(groups[1]?.id ?? "");
  }, [open, validTypes, groups]);

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
  const canSubmit =
    type !== null &&
    (isPair ? groupA !== "" && groupB !== "" && groupA !== groupB : groups.length >= 3);

  const submit = () => {
    if (!canSubmit || type === null) return;
    const columnIds = isPair
      ? [groupA, groupB]
      : groups.map((g) => g.id);
    onSubmit({ type, columnIds });
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
        className="relative w-full max-w-md rounded-lg border border-border bg-surface-overlay p-5 shadow-xl"
      >
        <h2 className="text-title font-semibold text-foreground">New analysis</h2>
        <p className="mt-1 text-meta text-foreground-muted">
          The result reads from this table live, so an edit to a replicate
          re-runs the test. You only choose the comparison once.
        </p>

        {validTypes.length === 0 ? (
          <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-body text-foreground-muted">
            Add at least two groups with numbers before running an analysis.
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

            {isPair ? (
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
            Run analysis
          </button>
        </div>
      </div>
    </div>
  );
}

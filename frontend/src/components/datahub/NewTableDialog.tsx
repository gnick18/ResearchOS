"use client";

// New Data Table dialog (datahub-tab-p1). Picks a name, a collection, and a
// table type, then hands the create payload back to the page, which seeds the
// empty table through dataHubApi.create. Slice 1 ships only the Column type as a
// selectable kind (XY / Grouped / Survival are later slices); the others render
// disabled so the surface reads as "more coming" without being clickable.
//
// House style: a popup reads as a contained surface (bg-surface-overlay + border),
// the primary CTA uses .bg-brand-action text-white transition-colors hover:bg-brand-action/90, no emojis / em-dashes / mid-sentence colons.

import { useEffect, useState } from "react";
import type { Project } from "@/lib/types";
import type { DataHubTableType } from "@/lib/datahub/model/types";

export interface NewTableSubmit {
  name: string;
  /** "" means Unfiled (no project link); otherwise a stringified project id. */
  collectionId: string;
  tableType: DataHubTableType;
}

const TABLE_TYPES: {
  type: DataHubTableType;
  label: string;
  blurb: string;
  enabled: boolean;
}[] = [
  {
    type: "column",
    label: "Column",
    blurb: "One column per group, one row per replicate. The starting point.",
    enabled: true,
  },
  {
    type: "xy",
    label: "XY",
    blurb:
      "Paired X and Y for dose-response and time courses, with correlation, regression, and fitted curves.",
    enabled: true,
  },
  {
    type: "grouped",
    label: "Grouped",
    blurb:
      "Two factors at once, a row label and column groups with replicates, for two-way ANOVA.",
    enabled: true,
  },
  {
    type: "survival",
    label: "Survival",
    blurb:
      "Time to an event, with censoring, for Kaplan-Meier curves and the log-rank test.",
    enabled: true,
  },
  {
    type: "contingency",
    label: "Contingency",
    blurb:
      "Counts in an R x C grid of two categorical factors, for the chi-square test and a 2x2 Fisher exact test with relative risk and odds ratio.",
    enabled: true,
  },
  {
    type: "nested",
    label: "Nested",
    blurb:
      "Technical replicates nested within biological replicates (cells within a mouse, mice within a treatment), for the nested t-test and nested one-way ANOVA.",
    enabled: true,
  },
  {
    type: "partsOfWhole",
    label: "Parts of whole",
    blurb:
      "The composition of one whole, a category label and a value per slice, for pie, donut, and 100-percent stacked-bar figures with the percent of total.",
    enabled: true,
  },
];

export default function NewTableDialog({
  open,
  projects,
  defaultCollectionId,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  projects: Project[];
  /** Pre-select this collection (the active rail filter), "" for Unfiled. */
  defaultCollectionId: string;
  onCancel: () => void;
  onSubmit: (data: NewTableSubmit) => void;
}) {
  const [name, setName] = useState("");
  const [collectionId, setCollectionId] = useState(defaultCollectionId);
  const [tableType, setTableType] = useState<DataHubTableType>("column");

  // Reset the form each time the dialog opens so a prior draft never lingers,
  // and seed the collection from the active rail filter.
  useEffect(() => {
    if (open) {
      setName("");
      setCollectionId(defaultCollectionId);
      setTableType("column");
    }
  }, [open, defaultCollectionId]);

  // Escape closes the dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({ name: trimmed, collectionId, tableType });
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      data-testid="datahub-new-table-dialog"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New data table"
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface-overlay p-5 shadow-xl"
      >
        <h2 className="text-title font-semibold text-foreground">New data table</h2>
        <p className="mt-1 text-meta text-foreground-muted">
          A table holds your raw replicates. The summary and any graph read from
          it live, so you only enter the numbers once.
        </p>

        <label className="mt-4 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
          Name
        </label>
        <input
          type="text"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Cell viability assay"
          className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-body text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none"
        />

        <label className="mt-4 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
          Collection
        </label>
        <select
          value={collectionId}
          onChange={(e) => setCollectionId(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
        >
          <option value="">Unfiled</option>
          {projects.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.name}
            </option>
          ))}
        </select>

        <label className="mt-4 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
          Table type
        </label>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {TABLE_TYPES.map((t) => {
            const active = tableType === t.type;
            return (
              <button
                key={t.type}
                type="button"
                disabled={!t.enabled}
                onClick={() => t.enabled && setTableType(t.type)}
                className={`rounded-md border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-sky-400 bg-accent-soft"
                    : "border-border bg-surface-raised hover:bg-surface-sunken"
                } ${t.enabled ? "" : "cursor-not-allowed opacity-50"}`}
              >
                <span className="block text-body font-medium text-foreground">
                  {t.label}
                </span>
                <span className="mt-0.5 block text-meta text-foreground-muted">
                  {t.blurb}
                </span>
              </button>
            );
          })}
        </div>

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
            Create table
          </button>
        </div>
      </div>
    </div>
  );
}

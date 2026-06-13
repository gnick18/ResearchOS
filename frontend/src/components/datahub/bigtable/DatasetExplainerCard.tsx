"use client";

// DatasetExplainerCard (DataHub-largetables lane, Increment 2).
//
// The one-time explainer for a large dataset (mockup change 1, spec section 7).
// Calm, no alarm. It states the three honest facts: this table is LARGE, it runs
// LOCALLY on the user's own processor (nothing uploads), and what is shown is a
// PREVIEW (not all rows). Shown once per dataset, then dismissed to the quiet
// status chip. The same panel reopens from the chip ("what does this mean").
//
// House style: contained surface, <Icon> only, no emojis / em-dashes /
// mid-sentence colons.

import { Icon } from "@/components/icons";

export default function DatasetExplainerCard({
  name,
  rowCount,
  colCount,
  previewRows,
  onDismiss,
}: {
  name: string;
  rowCount: number;
  colCount: number;
  /** How many rows the preview shows up front. */
  previewRows: number;
  /** Dismiss (persisted once per dataset by the caller). */
  onDismiss: () => void;
}) {
  return (
    <div
      className="rounded-lg border border-sky-400/40 bg-sky-400/[0.06] p-4"
      data-testid="bigtable-explainer"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-md bg-brand-action/15 text-brand-action">
          <Icon name="database" className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-body font-semibold text-foreground">
            Large dataset detected
          </h4>
          <p className="mt-1 text-meta text-foreground-muted">
            <span className="font-medium text-foreground">{name}</span>,{" "}
            {rowCount.toLocaleString()} rows by {colCount.toLocaleString()}{" "}
            columns. ResearchOS is keeping this on your computer and running it
            with your own processor, so nothing uploads. At this size we show a
            preview of {previewRows.toLocaleString()} rows and you work through
            filters, transforms, and analyses instead of editing cells one at a
            time.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-md px-3 py-1.5 text-meta font-semibold"
              data-testid="bigtable-explainer-open"
            >
              Open as dataset
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss explainer"
          className="flex-none rounded-md p-1 text-foreground-muted transition-colors hover:bg-surface-sunken"
        >
          <Icon name="close" className="h-4 w-4" title="Dismiss" />
        </button>
      </div>
    </div>
  );
}

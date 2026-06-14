"use client";

// DatasetExplainerCard (DataHub-largetables lane, Increment 2).
//
// The one-time explainer for the large-table lane. Calm, no alarm. It states the
// honest facts: the lane runs LOCALLY on the user's own processor (nothing
// uploads), and you work through filters / transforms / analyses instead of
// editing cells one at a time. Shown once per dataset, then dismissed to the quiet
// status chip. The same panel reopens from the chip ("what does this mean").
//
// It adapts to WHY the lane is on. A table over the size threshold was
// auto-detected ("Large dataset detected", and the grid is a PREVIEW of the first
// rows). A small table the user MANUALLY switched into large-table mode is NOT
// large, so it must not claim to be "detected" or that a 12-row grid is a
// "preview" of 12 rows. isLargeTable decides which copy to show.
//
// House style: contained surface, <Icon> only, no emojis / em-dashes /
// mid-sentence colons.

import { Icon } from "@/components/icons";
import { isLargeTable } from "@/lib/datahub/bigtable/detection";

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
  // Auto-detected (genuinely over the size threshold) vs a small table the user
  // manually switched into large-table mode.
  const bySize = isLargeTable(rowCount, colCount);
  // Whether the grid is actually a truncated preview (more rows than it shows).
  const truncated = rowCount > previewRows;
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
            {bySize ? "Large dataset detected" : "Large-table mode"}
          </h4>
          <p className="mt-1 text-meta text-foreground-muted">
            <span className="font-medium text-foreground">{name}</span>,{" "}
            {rowCount.toLocaleString()} rows by {colCount.toLocaleString()}{" "}
            columns.{" "}
            {bySize
              ? "ResearchOS detected a large table, so it is keeping this on your computer and running it with your own processor, nothing uploads."
              : "You switched this table into large-table mode. It runs on your computer with your own processor, nothing uploads."}{" "}
            {truncated
              ? `At this size we show a preview of ${previewRows.toLocaleString()} rows and you work through filters, transforms, and analyses instead of editing cells one at a time.`
              : "You work through filters, transforms, and analyses here instead of editing cells one at a time."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-md px-3 py-1.5 text-meta font-semibold"
              data-testid="bigtable-explainer-open"
            >
              {bySize ? "Open as dataset" : "Got it"}
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

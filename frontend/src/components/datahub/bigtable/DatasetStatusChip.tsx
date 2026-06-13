"use client";

// DatasetStatusChip (DataHub-largetables lane, Increment 2).
//
// The persistent, calm status chip (mockup change 2, spec section 7). It states
// three things at a glance: LARGE, LOCAL (nothing leaves the machine), and
// PREVIEWED (you are not seeing all rows). No alarm, no red. Clicking it reopens
// the same explainer panel, and the tooltip explains the lane in one line.
//
// House style: <Icon> only, Tooltip component (never native title=), no emojis /
// em-dashes / mid-sentence colons.

import Tooltip from "@/components/Tooltip";

export default function DatasetStatusChip({
  previewRows,
  totalRows,
  onReopen,
}: {
  previewRows: number;
  totalRows: number;
  /** Reopen the "what does this mean" explainer. */
  onReopen: () => void;
}) {
  return (
    <Tooltip
      label="Large dataset, running locally"
      body="This table is stored on your computer and queried by a local engine. The grid shows a preview, not every row. Click to learn more."
    >
      <button
        type="button"
        onClick={onReopen}
        data-testid="bigtable-status-chip"
        className="inline-flex items-center gap-2 rounded-full border border-sky-400/40 bg-sky-400/[0.10] px-3 py-1 text-meta font-semibold text-brand-action transition-colors hover:bg-sky-400/20"
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 flex-none rounded-full bg-green-500"
        />
        Large dataset, running locally, previewing{" "}
        {previewRows.toLocaleString()} of {totalRows.toLocaleString()} rows
      </button>
    </Tooltip>
  );
}

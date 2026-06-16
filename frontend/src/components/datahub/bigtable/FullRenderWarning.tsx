"use client";

// FullRenderWarning (DataHub-largetables lane, Increment 2).
//
// The no-soft-lock warning for "render all rows" (mockup change 6, spec section
// 7). The full-render path is never a dead button. It is an honest warning that
// the browser cannot draw that many rows, points at the file on disk and at
// external apps, and keeps every safe operation (preview, jump-to-row, filter,
// analyze) alive. Every state has a visible escape (Keep previewing), so the user
// is informed, never blocked.
//
// House style: <Icon> only, no emojis / em-dashes / mid-sentence colons.

import { Icon } from "@/components/icons";

export default function FullRenderWarning({
  totalRows,
  onKeepPreviewing,
  onRevealFile,
}: {
  totalRows: number;
  /** The always-present escape (dismiss the warning, keep the preview). */
  onKeepPreviewing: () => void;
  /** Optional reveal-on-disk action; omitted in modes with no real file. */
  onRevealFile?: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label="Rendering all rows would freeze the tab"
      className="rounded-lg border border-amber-500/50 bg-amber-500/[0.08] p-4"
      data-testid="bigtable-full-render-warning"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex-none text-amber-600 dark:text-amber-400">
          <Icon name="alert" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-body font-semibold text-foreground">
            Rendering all {totalRows.toLocaleString()} rows would freeze this tab
          </h4>
          <p className="mt-1 text-meta text-foreground-muted">
            Chrome cannot draw that many rows at once, and neither can any
            browser. For a full hand-editable view, open the file in a
            spreadsheet or analysis app. Here you can preview, jump to any row,
            filter, transform, and analyze the entire dataset without loading it
            all.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {onRevealFile && (
              <button
                type="button"
                onClick={onRevealFile}
                className="ros-btn-neutral inline-flex items-center gap-1.5 px-3 py-1.5 text-meta font-medium text-foreground"
              >
                <Icon name="folder" className="h-3.5 w-3.5" />
                Reveal the file on disk
              </button>
            )}
            <button
              type="button"
              onClick={onKeepPreviewing}
              className="ros-btn-neutral px-3 py-1.5 text-meta font-medium text-foreground"
              data-testid="bigtable-keep-previewing"
            >
              Keep previewing
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

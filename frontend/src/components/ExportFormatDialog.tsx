"use client";

import { useState } from "react";
import type { ExportFormat } from "@/lib/export/types";
import {
  formatBytes,
  isLargeExport,
  supportsFileSystemAccessSave,
  type ExportSizeEstimate,
} from "@/lib/export/stream-output";
import LivingPopup from "@/components/ui/LivingPopup";

interface ExportFormatDialogProps {
  isOpen: boolean;
  taskCount: number;
  taskName?: string;
  isExporting?: boolean;
  // Optional size estimate computed by the caller (cheap walk of the
  // task results folders). When provided AND the export is "large"
  // (50+ tasks or >500 MB attachments) the dialog shows a soft warning
  // that requires an explicit Continue tap before the format buttons go
  // live. `null` means "not yet measured"; `undefined` means "caller
  // doesn't compute estimates" — both treat the export as small.
  sizeEstimate?: ExportSizeEstimate | null;
  // Optional progress signal — when the orchestrator emits per-experiment
  // progress + zip-pack progress, the dialog renders a status line and
  // a determinate progress bar. `null` means no progress yet.
  progress?: ExportProgressUi | null;
  onClose: () => void;
  onExport: (format: ExportFormat) => void;
  // Optional File System Access streaming path. When provided AND the
  // browser exposes `showSaveFilePicker` (Chromium-based), the dialog
  // renders a "Save to disk…" section under the format buttons. Clicking
  // pops the native Save-As dialog and streams the multi-experiment ZIP
  // directly to the chosen file — the full archive is never resident as a
  // Blob. Hidden entirely in Firefox / Safari and when the prop is
  // omitted (e.g. the single-task TaskDetailPopup caller).
  onExportToFile?: (format: ExportFormat) => void;
  // Optional "Combined PDF" path (combined-pdf bot, 2026-05-28). When
  // provided, the dialog renders an extra option that merges every selected
  // experiment into ONE navigable PDF (cover + clickable index + bookmarks)
  // instead of the default zip-of-individual-files. Omitted by single-item
  // callers (e.g. TaskDetailPopup) where "combined" has no meaning.
  onExportCombined?: () => void;
}

/**
 * Subset of `lib/export/orchestrate.ts`'s ExportProgress that's safe to
 * pass into the dialog: no Task object dependency (we just want a name +
 * counts so the dialog can render `Exporting "{name}" — 12 of 50`).
 */
export interface ExportProgressUi {
  current: number;
  total: number;
  taskName: string;
  // 0-100 ZIP packaging percent — set only during the multi-task
  // wrapper step. `undefined` while we're still building per-experiment
  // results.
  zipPercent?: number;
}

interface FormatOption {
  format: ExportFormat;
  title: string;
  description: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    format: "pdf",
    title: "PDF report",
    description:
      "Professional PDF with table of contents, bookmarks, and inline images. Files referenced inline are listed in an appendix at the end.",
  },
  {
    format: "html",
    title: "HTML report",
    description:
      "Single self-contained HTML page wrapped with its attachments. Open in any browser; share with anyone.",
  },
  {
    format: "raw",
    title: "Raw ResearchOS format",
    description:
      "The full experiment as a sharable bundle. Best for sharing with another ResearchOS user.",
  },
];

export default function ExportFormatDialog({
  isOpen,
  taskCount,
  taskName,
  isExporting = false,
  sizeEstimate,
  progress,
  onClose,
  onExport,
  onExportToFile,
  onExportCombined,
}: ExportFormatDialogProps) {
  // Once the user OKs the large-export warning we don't re-warn while the
  // dialog stays open. Reset on close so re-opening starts fresh. Tracked
  // via a derived `prevIsOpen` rather than an effect so React's
  // set-state-in-effect lint rule stays clean.
  const [warningAcknowledged, setWarningAcknowledged] = useState(false);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen) setWarningAcknowledged(false);
  }

  // Format chosen for the Save-to-disk path. Independent of the
  // click-to-export Blob buttons above; defaults to "raw" since the
  // power-user audience that reaches for streaming-to-disk is most likely
  // sharing/archiving the full bundle.
  const [saveToDiskFormat, setSaveToDiskFormat] = useState<ExportFormat>("raw");

  // Render the streaming Save-to-disk section only when the caller wired
  // up the callback AND the browser supports the underlying API. Hidden
  // (entire section) in Firefox / Safari and when the prop is omitted.
  const showSaveToDisk =
    !!onExportToFile && supportsFileSystemAccessSave() && taskCount > 1;

  const heading =
    taskCount === 1 && taskName
      ? `Export ${taskName}`
      : `Export ${taskCount} experiments`;

  // Scrim click / Escape / X close, but never mid-export (matches the
  // old guarded backdrop + Escape behavior).
  const handleClose = () => {
    if (!isExporting) onClose();
  };

  // Decide whether to show the soft warning. We only show it when:
  //   - The caller actually supplied an estimate (no estimate ⇒ assume
  //     small / caller didn't bother measuring).
  //   - `isLargeExport` returns true (50+ tasks or >500 MB).
  //   - The user hasn't already acknowledged it in this open session.
  //   - The export isn't already running (post-acknowledge state).
  const showWarning =
    !!sizeEstimate &&
    !warningAcknowledged &&
    !isExporting &&
    isLargeExport(taskCount, sizeEstimate);

  return (
    <LivingPopup
      open={isOpen}
      onClose={handleClose}
      label={heading}
      widthClassName="max-w-lg"
      card={false}
    >
      {/* This dialog brings its own white card chrome (card=false above). */}
      <div className="bg-surface-raised rounded-xl shadow-xl w-full overflow-hidden">
        <div className="px-6 pt-5 pb-3 border-b border-border">
          <h2 className="text-title font-semibold text-foreground line-clamp-2">
            {heading}
          </h2>
          <p className="text-meta text-foreground-muted mt-1">
            Choose a format. Multi-experiment exports produce a zip with one
            file per experiment.
          </p>
        </div>

        {showWarning ? (
          // Soft warning gate: blocks the format-picker until the user
          // explicitly clicks Continue. Estimate is approximate (sum of
          // attachment file sizes + per-task text overhead; uncompressed
          // ceiling, so the eventual download is typically smaller).
          <div className="p-5 space-y-3">
            <div className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-4 py-3">
              <div className="text-body font-medium text-amber-900 dark:text-amber-300">
                Large export
              </div>
              <div className="text-meta text-amber-800 dark:text-amber-300 mt-1 leading-relaxed">
                Exporting {taskCount} experiments (~
                {formatBytes(sizeEstimate.totalBytes)} of attachments). This
                may take a minute and use significant memory. The browser may
                slow down while the archive is built.
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setWarningAcknowledged(true)}
                className="ros-btn-raise px-3 py-1.5 text-body font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg"
              >
                Continue
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-4 space-y-2">
              {FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.format}
                  type="button"
                  disabled={isExporting}
                  onClick={() => onExport(opt.format)}
                  className="w-full text-left rounded-lg border border-border px-4 py-3 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-brand-action/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-surface-raised"
                >
                  <div className="text-body font-medium text-foreground">
                    {opt.title}
                  </div>
                  <div className="text-meta text-foreground-muted mt-1 leading-relaxed">
                    {opt.description}
                  </div>
                </button>
              ))}

              {onExportCombined && taskCount > 1 ? (
                <button
                  type="button"
                  disabled={isExporting}
                  onClick={onExportCombined}
                  className="w-full text-left rounded-lg border border-border px-4 py-3 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-brand-action/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-surface-raised"
                >
                  <div className="text-body font-medium text-foreground">
                    Combined PDF
                  </div>
                  <div className="text-meta text-foreground-muted mt-1 leading-relaxed">
                    One PDF for all selected experiments, with a cover page,
                    clickable index, and bookmarks.
                  </div>
                </button>
              ) : null}

              {showSaveToDisk ? (
                <div className="rounded-lg border border-border px-4 py-3 bg-surface-sunken">
                  <div className="text-body font-medium text-foreground">
                    Save as ZIP to a folder on your disk
                  </div>
                  <div className="text-meta text-foreground-muted mt-1 leading-relaxed">
                    Streams straight to a file you pick, keeping memory low for
                    large exports (Chrome / Edge only).
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <label className="text-meta text-foreground-muted">Format:</label>
                    <select
                      value={saveToDiskFormat}
                      onChange={(e) =>
                        setSaveToDiskFormat(e.target.value as ExportFormat)
                      }
                      disabled={isExporting}
                      className="text-meta border border-border rounded px-1.5 py-1 bg-surface-raised disabled:opacity-50"
                    >
                      {FORMAT_OPTIONS.map((opt) => (
                        <option key={opt.format} value={opt.format}>
                          {opt.title}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={isExporting}
                      onClick={() => onExportToFile?.(saveToDiskFormat)}
                      className="ros-btn-raise ml-auto px-3 py-1.5 text-meta font-medium text-white bg-brand-action hover:bg-brand-action/90 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Save to disk…
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="px-4 pb-4 pt-1">
              {isExporting && progress ? (
                <ExportProgressLine progress={progress} />
              ) : isExporting ? (
                <div className="text-meta text-foreground-muted flex items-center gap-2">
                  <Spinner />
                  Preparing export…
                </div>
              ) : (
                <div className="text-meta text-foreground-muted min-h-[1.25rem]">
                  {sizeEstimate && taskCount > 1 ? (
                    <span>
                      ~{formatBytes(sizeEstimate.totalBytes)} of attachments
                      across {taskCount} experiments.
                    </span>
                  ) : null}
                </div>
              )}
              <div className="flex justify-end mt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isExporting}
                  className="px-3 py-1.5 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </LivingPopup>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin w-3.5 h-3.5"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function ExportProgressLine({ progress }: { progress: ExportProgressUi }) {
  const { current, total, taskName, zipPercent } = progress;
  // Per-experiment progress (zipPercent undefined) → ratio of completed
  // experiments. ZIP-pack progress → use the streamed percent directly.
  const percent =
    typeof zipPercent === "number"
      ? zipPercent
      : Math.round(((current - 1) / Math.max(total, 1)) * 100);
  const label =
    typeof zipPercent === "number"
      ? `Packaging archive… ${Math.round(zipPercent)}%`
      : total > 1
        ? `Exporting "${taskName}" — ${current} of ${total}`
        : `Exporting "${taskName}"`;

  return (
    <div className="space-y-1.5">
      <div className="text-meta text-foreground-muted flex items-center gap-2">
        <Spinner />
        <span className="line-clamp-1">{label}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-surface-sunken overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-all duration-200"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
}

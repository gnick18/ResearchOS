"use client";

import { useState } from "react";
import Tooltip from "@/components/Tooltip";
import type {
  ELNImportResult,
  ParsedNotebook,
} from "@/lib/import/eln/types";

interface DoneStepProps {
  result: ELNImportResult;
  parsed: ParsedNotebook;
  onOpenBulkSort: () => void;
  onClose: () => void;
}

export default function DoneStep({
  result,
  parsed,
  onOpenBulkSort,
  onClose,
}: DoneStepProps) {
  const taskCount = result.tasksCreated.length;
  const projectCount = result.projectsCreated.length;
  const skippedCount = result.tasksSkippedAsDuplicate.length;
  const warningCount = result.warnings.length;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/15 px-4 py-3">
        <p className="text-body font-semibold text-emerald-900 dark:text-emerald-300">Import complete.</p>
        <p className="text-meta text-emerald-800 dark:text-emerald-300 mt-1">
          New tasks and projects are in your workspace. The next step is to
          re-classify or move any tasks that landed in the wrong place.
        </p>
      </div>

      <ul className="text-body text-gray-800 space-y-1">
        <SummaryLine
          ok={taskCount > 0}
          text={
            taskCount === 1
              ? "1 task created."
              : `${taskCount} tasks created.`
          }
        />
        <SummaryLine
          ok={projectCount >= 0}
          text={
            projectCount === 1
              ? "1 project created."
              : `${projectCount} projects created.`
          }
        />
        {skippedCount > 0 && (
          <SummaryLine
            warn
            text={`Skipped ${skippedCount} duplicate page${skippedCount === 1 ? "" : "s"} from prior imports.`}
          />
        )}
        {result.totalRehydratedInlineImages > 0 && (
          <SummaryLine
            ok
            text={`Fetched ${result.totalRehydratedInlineImages} online-only image${result.totalRehydratedInlineImages === 1 ? "" : "s"} from LabArchives.`}
          />
        )}
        {warningCount > 0 && (
          <SummaryLine
            warn
            text={`${warningCount} page${warningCount === 1 ? "" : "s"} failed mid-way — see warnings below.`}
          />
        )}
      </ul>

      {result.totalMissingInlineImages > 0 && (
        <MissingImagesPanel parsed={parsed} count={result.totalMissingInlineImages} />
      )}

      {warningCount > 0 && (
        <WarningsPanel warnings={result.warnings} />
      )}

      {skippedCount > 0 && (
        <SkippedPanel skipped={result.tasksSkippedAsDuplicate} />
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-2 text-body text-gray-700 hover:text-gray-900"
        >
          Close
        </button>
        <button
          type="button"
          onClick={onOpenBulkSort}
          disabled={taskCount === 0}
          className="px-4 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Open bulk-sort
        </button>
      </div>
    </div>
  );
}

function SummaryLine({
  ok,
  warn,
  text,
}: {
  ok?: boolean;
  warn?: boolean;
  text: string;
}) {
  const icon = warn ? "⚠" : ok ? "✓" : "·";
  const color = warn
    ? "text-amber-600 dark:text-amber-300"
    : ok
      ? "text-emerald-600 dark:text-emerald-300"
      : "text-gray-400";
  return (
    <li className="flex items-start gap-2">
      <span className={`${color} font-semibold w-4`}>{icon}</span>
      <span>{text}</span>
    </li>
  );
}

function MissingImagesPanel({
  parsed,
  count,
}: {
  parsed: ParsedNotebook;
  count: number;
}) {
  const [open, setOpen] = useState(false);
  const images = parsed.missingInlineImages;
  return (
    <div className="rounded-lg border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-2 flex items-center justify-between"
        aria-expanded={open}
      >
        <span className="text-body font-medium text-amber-900 dark:text-amber-300">
          {count} inline image{count === 1 ? "" : "s"} didn&apos;t bundle —{" "}
          <span className="underline">{open ? "hide" : "view"} list</span>
        </span>
        <span className="text-amber-700 dark:text-amber-300 text-meta" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="border-t border-amber-200 dark:border-amber-500/30">
          {images.length === 0 ? (
            <p className="text-meta text-amber-800 dark:text-amber-300 px-4 py-2">
              URLs not surfaced — re-open the parsed notebook to view.
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto divide-y divide-amber-200/60">
              {images.map((img, idx) => (
                <li
                  key={`${img.filename}:${idx}`}
                  className="px-4 py-1.5 text-meta flex items-center gap-2"
                >
                  <span
                    className="font-mono font-medium text-amber-900 dark:text-amber-300 truncate flex-shrink-0 max-w-[40%]"
                    title={img.filename}
                  >
                    {img.filename}
                  </span>
                  <Tooltip label={img.originalUrl} placement="top">
                    <span className="font-mono text-amber-700/90 truncate flex-1 min-w-0 cursor-help">
                      {img.originalUrl}
                    </span>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function WarningsPanel({
  warnings,
}: {
  warnings: ELNImportResult["warnings"];
}) {
  return (
    <div className="rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-4 py-2">
      <p className="text-meta font-medium text-red-800 dark:text-red-300 mb-1">Per-page warnings</p>
      <ul className="space-y-0.5 text-meta text-red-700 dark:text-red-300">
        {warnings.map((w, idx) => (
          <li key={`${w.pageId}:${idx}`}>
            <span className="font-mono mr-2">page {w.pageId}:</span>
            {w.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SkippedPanel({
  skipped,
}: {
  skipped: ELNImportResult["tasksSkippedAsDuplicate"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-surface-raised">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-2 flex items-center justify-between"
      >
        <span className="text-meta font-medium text-foreground">
          {skipped.length} duplicate page{skipped.length === 1 ? "" : "s"} skipped
        </span>
        <span className="text-foreground-muted text-meta">{open ? "Hide" : "Show"} list</span>
      </button>
      {open && (
        <div className="border-t border-border px-4 py-2 max-h-48 overflow-y-auto">
          <ul className="space-y-0.5 text-[11px] text-foreground-muted font-mono">
            {skipped.map((s) => (
              <li key={s.pageId}>
                page {s.pageId} → existing task #{s.existingTaskId}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

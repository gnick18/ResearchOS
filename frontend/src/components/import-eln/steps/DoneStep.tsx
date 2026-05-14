"use client";

import { useState } from "react";
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
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3">
        <p className="text-sm font-semibold text-emerald-900">Import complete.</p>
        <p className="text-xs text-emerald-800 mt-1">
          New tasks and projects are in your workspace. The next step is to
          re-classify or move any tasks that landed in the wrong place.
        </p>
      </div>

      <ul className="text-sm text-gray-800 space-y-1">
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
          className="px-3 py-2 text-sm text-gray-700 hover:text-gray-900"
        >
          Close
        </button>
        <button
          type="button"
          onClick={onOpenBulkSort}
          disabled={taskCount === 0}
          className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
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
    ? "text-amber-600"
    : ok
      ? "text-emerald-600"
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
    <div className="rounded-lg border border-amber-300 bg-amber-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-2 flex items-center justify-between"
      >
        <span className="text-sm font-medium text-amber-900">
          {count} online-only image{count === 1 ? "" : "s"} — relink manually
        </span>
        <span className="text-amber-700 text-xs">{open ? "Hide" : "Show"} URLs</span>
      </button>
      {open && (
        <div className="border-t border-amber-200 px-4 py-2 max-h-64 overflow-y-auto">
          <ul className="space-y-1 text-[11px] font-mono text-amber-900 break-all">
            {images.length === 0 ? (
              <li className="text-amber-700">URLs not surfaced — re-open the parsed notebook to view.</li>
            ) : (
              images.map((img, idx) => (
                <li key={`${img.filename}:${idx}`}>
                  <span className="font-semibold mr-2">{img.filename}</span>
                  <span>{img.originalUrl}</span>
                </li>
              ))
            )}
          </ul>
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
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2">
      <p className="text-xs font-medium text-red-800 mb-1">Per-page warnings</p>
      <ul className="space-y-0.5 text-[11px] text-red-700">
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
    <div className="rounded-lg border border-gray-200 bg-gray-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-2 flex items-center justify-between"
      >
        <span className="text-xs font-medium text-gray-800">
          {skipped.length} duplicate page{skipped.length === 1 ? "" : "s"} skipped
        </span>
        <span className="text-gray-500 text-xs">{open ? "Hide" : "Show"} list</span>
      </button>
      {open && (
        <div className="border-t border-gray-200 px-4 py-2 max-h-48 overflow-y-auto">
          <ul className="space-y-0.5 text-[11px] text-gray-700 font-mono">
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

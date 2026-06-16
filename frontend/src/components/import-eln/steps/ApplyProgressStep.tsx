"use client";

import type { ELNApplyProgress } from "@/lib/import/eln/types";

interface ApplyProgressStepProps {
  progress: ELNApplyProgress | null;
  errorMessage: string | null;
  onRetry: () => void;
  onCancel: () => void;
}

function phaseLabel(phase: ELNApplyProgress["phase"]): string {
  if (phase === "projects") return "Creating projects…";
  return "Importing pages…";
}

export default function ApplyProgressStep({
  progress,
  errorMessage,
  onRetry,
  onCancel,
}: ApplyProgressStepProps) {
  if (errorMessage) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-4 py-3">
          <p className="text-body font-semibold text-red-900 dark:text-red-300">Import failed</p>
          <p className="text-meta text-red-700 dark:text-red-300 mt-1 whitespace-pre-wrap break-words">{errorMessage}</p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 text-body text-gray-700 hover:text-gray-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="ros-btn-neutral px-3 py-2 text-body"
          >
            Back to mapping
          </button>
        </div>
      </div>
    );
  }

  const phase = progress?.phase ?? "projects";
  const current = progress?.current ?? 0;
  const total = progress?.total ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const label = progress?.label ?? "";

  return (
    <div className="space-y-4 py-6">
      <div className="flex items-center gap-3">
        <div className="h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-body text-gray-800 font-medium">{phaseLabel(phase)}</p>
      </div>

      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
        <div
          className="bg-blue-500 h-2 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-meta text-gray-600">
        <span>
          {current} / {total > 0 ? total : "—"}
        </span>
        <span className="truncate ml-2 max-w-[70%]">{label}</span>
      </div>

      <p className="text-meta text-gray-500">
        Please leave this tab open. Files are being written to your local
        folder. Large notebooks with many attachments can take a minute.
      </p>
    </div>
  );
}

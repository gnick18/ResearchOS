"use client";

// Cross-boundary PROJECT sharing (v1), the receive-side import dialog.
//
// A thin project sibling of ImportExperimentDialog. A project bundle brings MANY
// experiments and MANY methods, more than the single-experiment resolution dialog
// models, and v1 is ALWAYS-NEW (no project picker, methods always localize fresh,
// design §6.3). So the project receive flow is a small review-then-import dialog
// rather than a reuse of the per-method resolution UI:
//   1. Parse the bundle (parseProjectBundle) and show an inventory, project name,
//      N experiments, M methods, K dependency links, plus the sender.
//   2. On confirm, applyProjectImportPlan materializes a FRESH project (always-new)
//      with an imported_from provenance stamp, then the caller acks the relay.
//   3. Surface the aggregated notCarried (dropped links / method refs) so the
//      recipient is never left with a silently severed reference.
//
// The caller (SharedWithMeTab) owns the relay ack (ack-after-write) via onImported.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import Tooltip from "@/components/Tooltip";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { CloseIcon } from "@/components/sharing/icons";
import { ImportParseError } from "@/lib/import/parse";
import { parseProjectBundle, type ProjectImportPayload } from "@/lib/import/project-parse";
import {
  applyProjectImportPlan,
  type ProjectImportResult,
} from "@/lib/import/project-apply";

type Stage = "loading" | "review" | "applying" | "success" | "error";

interface ProjectImportDialogProps {
  /** The decrypted project-bundle bytes wrapped as a File (projectPayloadToFile). */
  initialFile: File;
  /** Sender label for the provenance stamp + the review header. */
  provenanceLabel: string;
  onClose: () => void;
  /** Fires after the import resolves on disk so the caller can ack the relay. */
  onImported: (result: ProjectImportResult) => void;
}

export default function ProjectImportDialog({
  initialFile,
  provenanceLabel,
  onClose,
  onImported,
}: ProjectImportDialogProps) {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<Stage>("loading");
  const [payload, setPayload] = useState<ProjectImportPayload | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [result, setResult] = useState<ProjectImportResult | null>(null);

  // Escape closes this dialog (app-wide convention).
  useEscapeToClose(onClose);

  // Parse on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const parsed = await parseProjectBundle(initialFile);
        if (cancelled) return;
        setPayload(parsed);
        setStage("review");
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(
          err instanceof ImportParseError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to read the project bundle.",
        );
        setStage("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialFile]);

  const inventory = useMemo(() => {
    if (!payload) return null;
    const methodIds = new Set<number>();
    // Count tasks by their actual task_type instead of labeling every task an
    // "experiment" (a project's list / purchase tasks were miscounted as
    // experiments). `payload.experiments` is the full task list regardless of
    // type; bucket it here. Default an unset task_type to "experiment" to match
    // the create-path default.
    let experiments = 0;
    let purchases = 0;
    let lists = 0;
    for (const exp of payload.experiments) {
      const type = exp.task.task_type ?? "experiment";
      if (type === "purchase") purchases += 1;
      else if (type === "list") lists += 1;
      else experiments += 1;
      for (const m of exp.methods) methodIds.add(m.record.id);
    }
    return {
      projectName: payload.project.name || payload.manifest.project_name,
      experiments,
      purchases,
      lists,
      methods: methodIds.size,
      dependencies: payload.dependencies.length,
      sequences: payload.sequences.length,
    };
  }, [payload]);

  const handleImport = useCallback(async () => {
    if (!payload) return;
    setStage("applying");
    setErrorMsg("");
    try {
      const res = await applyProjectImportPlan(payload, { sender: provenanceLabel });
      setResult(res);
      setStage("success");
      // Refresh project + task views so the new project appears immediately.
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      onImported(res);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "The project could not be imported.",
      );
      setStage("error");
    }
  }, [payload, provenanceLabel, queryClient, onImported]);

  const droppedCount =
    (result?.notCarried.dependencies.length ?? 0) +
    (result?.notCarried.methodRefs.length ?? 0);

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={stage === "applying" ? undefined : onClose}
    >
      <div
        className="bg-surface-raised rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border bg-surface-sunken flex items-center justify-between">
          <h3 className="text-title font-semibold text-foreground">Import shared project</h3>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={onClose}
              disabled={stage === "applying"}
              className="text-foreground-muted hover:text-foreground disabled:opacity-40"
              aria-label="Close"
            >
              <CloseIcon className="w-5 h-5" />
            </button>
          </Tooltip>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3 mb-4">
            <p className="text-meta text-foreground-muted mb-1">From</p>
            <p className="text-body font-medium text-foreground break-all">
              {provenanceLabel}
            </p>
          </div>

          {stage === "loading" && (
            <p className="text-body text-foreground-muted text-center py-8">
              Opening the project bundle…
            </p>
          )}

          {stage === "error" && (
            <p className="text-body text-red-600 dark:text-red-300 text-center py-6">{errorMsg}</p>
          )}

          {(stage === "review" || stage === "applying") && inventory && (
            <>
              <h4 className="text-heading font-semibold text-foreground mb-3">
                {inventory.projectName || "Untitled project"}
              </h4>
              <p className="text-body text-foreground-muted leading-relaxed mb-4">
                This imports a copy as a brand new project in your folder, with its
                experiments, notes, results, files, and methods. Your existing
                projects are not touched. The original sender keeps their version.
              </p>
              <ul className="space-y-1.5 mb-2">
                {inventory.experiments > 0 && (
                  <InventoryRow label="Experiments" value={inventory.experiments} />
                )}
                {inventory.purchases > 0 && (
                  <InventoryRow label="Purchases" value={inventory.purchases} />
                )}
                {inventory.lists > 0 && (
                  <InventoryRow label="Lists" value={inventory.lists} />
                )}
                <InventoryRow label="Methods" value={inventory.methods} />
                {inventory.sequences > 0 && (
                  <InventoryRow label="Sequences" value={inventory.sequences} />
                )}
                <InventoryRow label="Experiment links" value={inventory.dependencies} />
              </ul>
            </>
          )}

          {stage === "success" && result && (
            <div className="text-center py-4">
              <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center text-emerald-600 dark:text-emerald-300 mb-3">
                <CheckIcon className="w-6 h-6" />
              </div>
              <p className="text-title font-semibold text-foreground">
                Project imported
              </p>
              <p className="text-body text-foreground-muted mt-1">
                {droppedCount > 0
                  ? "Some content was not carried over (see below). Everything else landed as a new project."
                  : "It landed as a new project in your folder."}
              </p>
              {droppedCount > 0 && (
                <div className="mt-4 text-left rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-4 py-3">
                  <p className="text-meta font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300 mb-1.5">
                    Not carried over
                  </p>
                  <ul className="space-y-1 text-meta text-amber-800 dark:text-amber-300">
                    {result.notCarried.methodRefs.map((m, i) => (
                      <li key={`m-${i}`}>
                        {m.sourceMethodName
                          ? `Method "${m.sourceMethodName}" could not be localized.`
                          : "A referenced method could not be localized."}
                      </li>
                    ))}
                    {result.notCarried.dependencies.map((d, i) => (
                      <li key={`d-${i}`}>
                        An experiment link was dropped (one endpoint was not in
                        what was shared).
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border bg-surface-sunken flex items-center justify-end gap-2">
          {stage === "success" ? (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-meta font-medium text-white bg-brand-action hover:bg-brand-action/90 rounded-md transition-colors"
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={stage === "applying"}
                className="px-3 py-1.5 text-meta text-foreground-muted hover:bg-surface-sunken rounded-md transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleImport()}
                disabled={stage !== "review"}
                className="px-4 py-1.5 text-meta font-medium text-white bg-brand-action hover:bg-brand-action/90 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {stage === "applying" ? "Importing…" : "Import as a new project"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function InventoryRow({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-center justify-between text-body text-foreground px-3 py-1.5 rounded bg-surface-sunken">
      <span>{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </li>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

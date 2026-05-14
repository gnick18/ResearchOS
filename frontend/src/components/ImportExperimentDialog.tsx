"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  commitImport,
  ImportParseError,
  previewImport,
} from "@/lib/import/orchestrate";
import { pickImportedMethodName, pickImportedProjectName } from "@/lib/import/resolve";
import type {
  ImportPlan,
  ImportResult,
  MethodDecision,
  ProjectDecision,
} from "@/lib/import/types";

type Stage = "picker" | "loading" | "review" | "applying" | "success" | "error";

interface ImportExperimentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImported?: (result: ImportResult) => void;
}

export default function ImportExperimentDialog({
  isOpen,
  onClose,
  onImported,
}: ImportExperimentDialogProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [stage, setStage] = useState<Stage>("picker");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [projectImportedName, setProjectImportedName] = useState<string>("");
  const [methodImportedNames, setMethodImportedNames] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = useCallback(() => {
    setStage("picker");
    setPlan(null);
    setProjectImportedName("");
    setMethodImportedNames([]);
    setErrorMsg("");
    setResult(null);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stage !== "applying" && stage !== "loading") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, stage, onClose]);

  const handleFile = useCallback(async (file: File) => {
    setStage("loading");
    setErrorMsg("");
    try {
      const { plan: newPlan } = await previewImport(file);
      // Pre-compute the auto-suffixed names for any "import-new" entities so
      // the user sees what we'll actually call them.
      const previewProjectName =
        newPlan.project.decision === "import-new"
          ? await pickImportedProjectName(newPlan.project.sourceProjectName)
          : "";
      const previewMethodNames = await Promise.all(
        newPlan.methods.map((m) =>
          m.decision === "import-new"
            ? pickImportedMethodName(m.sourceMethodName)
            : Promise.resolve(""),
        ),
      );
      setPlan(newPlan);
      setProjectImportedName(previewProjectName);
      setMethodImportedNames(previewMethodNames);
      setStage("review");
    } catch (err) {
      if (err instanceof ImportParseError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg(
          err instanceof Error ? err.message : "Failed to read the .zip bundle.",
        );
      }
      setStage("error");
    }
  }, []);

  const onPickFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset the input so picking the same file twice still triggers change.
      e.target.value = "";
      if (file) await handleFile(file);
    },
    [handleFile],
  );

  const setProjectDecision = useCallback(
    (next: ProjectDecision, existingId: number | null = null) => {
      setPlan((prev) =>
        prev
          ? {
              ...prev,
              project: {
                ...prev.project,
                decision: next,
                existingProjectId: next === "use-existing" ? existingId : null,
              },
            }
          : prev,
      );
    },
    [],
  );

  const setMethodDecision = useCallback(
    (idx: number, next: MethodDecision, existingId: number | null = null) => {
      setPlan((prev) => {
        if (!prev) return prev;
        const methods = prev.methods.slice();
        methods[idx] = {
          ...methods[idx],
          decision: next,
          existingMethodId: next === "use-existing" ? existingId : null,
        };
        return { ...prev, methods };
      });
    },
    [],
  );

  const onConfirmImport = useCallback(async () => {
    if (!plan) return;
    setStage("applying");
    setErrorMsg("");
    try {
      const r = await commitImport(plan);
      setResult(r);
      setStage("success");
      // Invalidate the main read queries so the new task shows up immediately.
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["methods"] });
      onImported?.(r);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to import the experiment.");
      setStage("error");
    }
  }, [plan, queryClient, onImported]);

  if (!isOpen) return null;

  const handleBackdrop = () => {
    if (stage !== "applying" && stage !== "loading") onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={handleBackdrop}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={onFileInputChange}
        />

        <div className="px-6 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Import experiment</h2>
            <p className="text-xs text-gray-500 mt-1">
              Bring an experiment shared by another ResearchOS user into your workspace.
            </p>
          </div>
          {(stage === "review" || stage === "success" || stage === "error" || stage === "picker") && (
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none p-1"
              aria-label="Close"
            >
              ×
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {stage === "picker" && <PickerStage onPick={onPickFile} />}
          {stage === "loading" && <SpinnerStage label="Reading bundle…" />}
          {stage === "applying" && <SpinnerStage label="Writing to disk…" />}
          {stage === "review" && plan && (
            <ReviewStage
              plan={plan}
              projectImportedName={projectImportedName}
              methodImportedNames={methodImportedNames}
              setProjectDecision={setProjectDecision}
              setMethodDecision={setMethodDecision}
            />
          )}
          {stage === "success" && result && <SuccessStage result={result} />}
          {stage === "error" && (
            <ErrorStage
              message={errorMsg}
              onRetry={() => {
                reset();
              }}
            />
          )}
        </div>

        {stage === "review" && plan && (
          <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirmImport}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
            >
              Import experiment
            </button>
          </div>
        )}
        {stage === "success" && (
          <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PickerStage({ onPick }: { onPick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8">
      <p className="text-sm text-gray-700 text-center max-w-md">
        Select a <code className="px-1 py-0.5 bg-gray-100 rounded text-[11px]">-raw.zip</code> bundle
        exported by another ResearchOS user. You&apos;ll review what gets created before anything is written.
      </p>
      <button
        type="button"
        onClick={onPick}
        className="mt-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
      >
        Choose .zip file
      </button>
    </div>
  );
}

function SpinnerStage({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-gray-600">{label}</p>
    </div>
  );
}

function ErrorStage({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="py-6">
      <p className="text-sm text-red-700 font-medium">Import failed</p>
      <p className="text-sm text-red-600 mt-2 whitespace-pre-line break-words">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 px-3 py-2 text-sm bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg"
      >
        Try another file
      </button>
    </div>
  );
}

function SuccessStage({ result }: { result: ImportResult }) {
  return (
    <div className="py-6">
      <div className="flex items-center gap-2">
        <span className="text-emerald-600 text-lg">✓</span>
        <p className="text-sm font-medium text-gray-900">Imported successfully</p>
      </div>
      <p className="text-sm text-gray-600 mt-2">
        New task id <strong>{result.newTaskId}</strong> created in your workspace.
        {result.newProjectId !== null && (
          <> Linked to project id <strong>{result.newProjectId}</strong>.</>
        )}
      </p>
      {Object.keys(result.importedMethodIds).length > 0 && (
        <p className="text-xs text-gray-500 mt-2">
          {Object.keys(result.importedMethodIds).length} method{Object.keys(result.importedMethodIds).length === 1 ? "" : "s"} resolved.
        </p>
      )}
    </div>
  );
}

function ReviewStage({
  plan,
  projectImportedName,
  methodImportedNames,
  setProjectDecision,
  setMethodDecision,
}: {
  plan: ImportPlan;
  projectImportedName: string;
  methodImportedNames: string[];
  setProjectDecision: (next: ProjectDecision, existingId?: number | null) => void;
  setMethodDecision: (idx: number, next: MethodDecision, existingId?: number | null) => void;
}) {
  const taskName = plan.payload.task.name;
  const sourceOwner = plan.payload.manifest.source_owner;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500 font-medium">Experiment</p>
        <p className="text-sm text-gray-900 mt-1">
          <strong>{taskName}</strong>{" "}
          <span className="text-gray-500">from {sourceOwner || "(unknown user)"}</span>
        </p>
        <p className="text-xs text-gray-500 mt-1">
          A new task will be created in your workspace. Notes, results, files, and images come along.
        </p>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500 font-medium">Project</p>
        <p className="text-sm text-gray-700 mt-1">
          Source: <strong>{plan.project.sourceProjectName}</strong>
        </p>
        <div className="mt-2 space-y-2">
          <DecisionRow
            checked={plan.project.decision === "use-existing"}
            onSelect={() => {
              const first = plan.project.candidates[0];
              if (first) setProjectDecision("use-existing", first.id);
            }}
            disabled={plan.project.candidates.length === 0}
          >
            Use my existing project
            {plan.project.decision === "use-existing" && plan.project.candidates.length > 0 && (
              <select
                value={plan.project.existingProjectId ?? ""}
                onChange={(e) => setProjectDecision("use-existing", Number(e.target.value))}
                className="ml-2 text-xs border border-gray-200 rounded px-2 py-1"
              >
                {plan.project.candidates.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </DecisionRow>
          <DecisionRow
            checked={plan.project.decision === "import-new"}
            onSelect={() => setProjectDecision("import-new")}
          >
            Create a new project
            {plan.project.decision === "import-new" && (
              <span className="ml-2 text-xs text-gray-500">→ &ldquo;{projectImportedName}&rdquo;</span>
            )}
          </DecisionRow>
          <DecisionRow
            checked={plan.project.decision === "no-project"}
            onSelect={() => setProjectDecision("no-project")}
          >
            Don&apos;t link to a project
          </DecisionRow>
        </div>
      </div>

      {plan.methods.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500 font-medium">
            Methods ({plan.methods.length})
          </p>
          <div className="mt-2 space-y-3">
            {plan.methods.map((m, idx) => {
              const entry = plan.payload.methods[idx];
              const isPcr = m.sourceMethodType === "pcr";
              const pcrProtocolBundled = isPcr && entry?.pcrProtocol != null;
              const importNewDisabled = isPcr && !pcrProtocolBundled;
              return (
                <div key={`${m.sourceMethodId}:${idx}`} className="rounded-lg border border-gray-200 p-3">
                  <p className="text-sm text-gray-900">
                    <strong>{m.sourceMethodName}</strong>
                    <span className="ml-2 text-xs text-gray-500">
                      ({m.sourceMethodType ?? "unknown type"})
                    </span>
                  </p>
                  <div className="mt-2 space-y-1">
                    <DecisionRow
                      checked={m.decision === "use-existing"}
                      onSelect={() => {
                        const first = m.candidates[0];
                        if (first) setMethodDecision(idx, "use-existing", first.id);
                      }}
                      disabled={m.candidates.length === 0}
                    >
                      Use my existing method
                      {m.decision === "use-existing" && m.candidates.length > 0 && (
                        <select
                          value={m.existingMethodId ?? ""}
                          onChange={(e) => setMethodDecision(idx, "use-existing", Number(e.target.value))}
                          className="ml-2 text-xs border border-gray-200 rounded px-2 py-1"
                        >
                          {m.candidates.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      )}
                    </DecisionRow>
                    <DecisionRow
                      checked={m.decision === "import-new"}
                      onSelect={() => setMethodDecision(idx, "import-new")}
                      disabled={importNewDisabled}
                    >
                      {importNewDisabled
                        ? "Import as new (this bundle didn't carry the PCR protocol record)"
                        : "Import as a new method"}
                      {m.decision === "import-new" && methodImportedNames[idx] && (
                        <span className="ml-2 text-xs text-gray-500">→ &ldquo;{methodImportedNames[idx]}&rdquo;</span>
                      )}
                    </DecisionRow>
                    <DecisionRow
                      checked={m.decision === "skip"}
                      onSelect={() => setMethodDecision(idx, "skip")}
                    >
                      Skip this method
                    </DecisionRow>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DecisionRow({
  checked,
  onSelect,
  disabled = false,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-sm cursor-pointer ${
        disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-50"
      } rounded px-2 py-1`}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
      />
      <span className="text-gray-800">{children}</span>
    </label>
  );
}

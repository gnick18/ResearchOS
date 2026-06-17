"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  commitImport,
  ImportParseError,
  previewImport,
} from "@/lib/import/orchestrate";
import { pickImportedMethodName, pickImportedProjectName } from "@/lib/import/resolve";
import LivingPopup from "@/components/ui/LivingPopup";
import FileDropzone from "@/components/ui/FileDropzone";
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
  /**
   * Pre-load this bundle instead of showing the file picker. The cross-boundary
   * inbox uses this to drive a decrypted shared-experiment bundle through the
   * exact same parse + resolve + apply pipeline without a manual file pick.
   * When set, the dialog opens straight into review (or error). Additive, the
   * settings-page caller omits it and keeps the file-picker entry point.
   */
  initialFile?: File | null;
  /**
   * Optional provenance line shown in the review and success stages, for
   * example the verified email of the sender when the bundle arrived through
   * cross-boundary sharing. Omitted for the local file-picker import.
   *
   * When set, it ALSO stamps the imported experiment + its newly imported
   * methods with a verified-sender marker on the entity (commitImport's
   * `provenance` arg), so the "Received from X, verified" badge survives on the
   * entity, not just at receive time. The local file-picker import leaves this
   * undefined, so a locally imported bundle stays native (no stamp, no badge).
   */
  provenanceLabel?: string;
  /**
   * The sender's key fingerprint, paired with `provenanceLabel` on the
   * cross-boundary receive path. Surfaced in the badge hover for out-of-band
   * verification. Omitted for the local file-picker import.
   */
  provenanceFingerprint?: string;
}

export default function ImportExperimentDialog({
  isOpen,
  onClose,
  onImported,
  initialFile,
  provenanceLabel,
  provenanceFingerprint,
}: ImportExperimentDialogProps) {
  const queryClient = useQueryClient();

  // Start in "loading" when a bundle was pre-supplied (the inbox path) so the
  // file-picker stage never flashes before the auto-load effect runs.
  const [stage, setStage] = useState<Stage>(initialFile ? "loading" : "picker");
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

  // Closing is blocked mid-write so the user can't bail during a parse or an
  // apply. LivingPopup's scrim / X / Escape all route through this guard.
  const requestClose = useCallback(() => {
    if (stage === "applying" || stage === "loading") return;
    onClose();
  }, [stage, onClose]);

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

  // Cross-boundary inbox path, auto-load a pre-supplied bundle (the decrypted
  // shared experiment) the moment the dialog opens, so the user lands in review
  // without a file pick. Guarded so it fires once per (open + file) pair and
  // never while a load/review is already in flight from a prior render.
  const autoLoadedRef = useRef<File | null>(null);
  useEffect(() => {
    if (!isOpen) {
      autoLoadedRef.current = null;
      return;
    }
    if (!initialFile) return;
    if (autoLoadedRef.current === initialFile) return;
    autoLoadedRef.current = initialFile;
    void handleFile(initialFile);
  }, [isOpen, initialFile, handleFile]);

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
      // Only the cross-boundary inbox supplies provenanceLabel, so only a
      // received bundle stamps the verified-sender marker onto the imported
      // entity. The local file-picker import leaves provenanceLabel undefined
      // and the entity stays native (no stamp, no badge).
      const provenance = provenanceLabel
        ? { sender: provenanceLabel, fingerprint: provenanceFingerprint }
        : undefined;
      const r = await commitImport(plan, provenance);
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
  }, [plan, queryClient, onImported, provenanceLabel, provenanceFingerprint]);

  if (!isOpen) return null;

  // A standalone-method bundle is experiment-shaped on the wire, the manifest
  // `kind` is the only honest signal of what the recipient is actually
  // landing. Drive the dialog copy off it so a method import never claims to
  // create an experiment / task / project.
  const isMethod = plan?.payload.manifest.kind === "method";

  return (
    <LivingPopup
      open={isOpen}
      onClose={requestClose}
      label={isMethod ? "Import method" : "Import experiment"}
      widthClassName="max-w-2xl"
      card={false}
      fillHeight
    >
      <div className="bg-surface-raised rounded-xl ros-popup-card-shadow w-full flex flex-col overflow-hidden max-h-full">
        <div className="px-6 pt-5 pb-3 border-b border-border bg-surface-sunken flex items-center justify-between gap-4">
          <div>
            <h2 className="text-title font-semibold text-foreground">
              {isMethod ? "Import method" : "Import experiment"}
            </h2>
            <p className="text-meta text-foreground-muted mt-1">
              {isMethod
                ? "Bring a method shared by another ResearchOS user into your library."
                : "Bring an experiment shared by another ResearchOS user into your workspace."}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {stage === "picker" && (
            <PickerStage onFiles={handleFile} onReject={setErrorMsg} />
          )}
          {stage === "loading" && <SpinnerStage label="Reading bundle…" />}
          {stage === "applying" && <SpinnerStage label="Writing to disk…" />}
          {stage === "review" && plan && (
            <ReviewStage
              plan={plan}
              isMethod={isMethod}
              projectImportedName={projectImportedName}
              methodImportedNames={methodImportedNames}
              setProjectDecision={setProjectDecision}
              setMethodDecision={setMethodDecision}
              provenanceLabel={provenanceLabel}
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
          <div className="px-6 py-3 border-t border-border flex items-center justify-end gap-2 bg-surface-sunken">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-body text-foreground-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirmImport}
              className="ros-btn-raise px-4 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white rounded-lg"
            >
              {isMethod ? "Import method" : "Import experiment"}
            </button>
          </div>
        )}
        {stage === "success" && (
          <div className="px-6 py-3 border-t border-border flex items-center justify-end gap-2 bg-surface-sunken">
            <button
              type="button"
              onClick={onClose}
              className="ros-btn-raise px-4 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white rounded-lg"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </LivingPopup>
  );
}

function PickerStage({
  onFiles,
  onReject,
}: {
  onFiles: (file: File) => void | Promise<void>;
  onReject: (message: string) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8">
      <p className="text-body text-foreground text-center max-w-md">
        Select a <code className="px-1 py-0.5 bg-surface-sunken rounded text-meta">-raw.zip</code> bundle
        exported by another ResearchOS user. You&apos;ll review what gets created before anything is written.
      </p>
      <FileDropzone
        accept=".zip,application/zip"
        multiple={false}
        onFiles={(files) => {
          const file = files[0];
          if (file) void onFiles(file);
        }}
        onReject={onReject}
        hint="ZIP archive"
        className="mt-2 w-full max-w-md"
      />
    </div>
  );
}

function SpinnerStage({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-body text-foreground-muted">{label}</p>
    </div>
  );
}

function ErrorStage({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="py-6">
      <p className="text-body text-red-700 dark:text-red-300 font-medium">Import failed</p>
      <p className="text-body text-red-600 dark:text-red-300 mt-2 whitespace-pre-line break-words">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 px-3 py-2 text-body bg-surface-sunken hover:bg-gray-300 text-foreground rounded-lg"
      >
        Try another file
      </button>
    </div>
  );
}

function SuccessStage({ result }: { result: ImportResult }) {
  const droppedDeps = result.notCarried.dependencies.length;
  const droppedMethods = result.notCarried.methodRefs.length;
  const hasNotCarried = droppedDeps > 0 || droppedMethods > 0;
  // A method-only import (cross-boundary method sharing) lands just the method
  // and creates no task, so newTaskId is null. Show method-appropriate copy
  // rather than the experiment "new task id created" line.
  const isMethodOnly = result.newTaskId === null;

  return (
    <div className="py-6">
      <div className="text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center text-emerald-600 dark:text-emerald-300 mb-3">
          <CheckGlyph className="w-6 h-6" />
        </div>
        <p className="text-title font-semibold text-foreground">Imported successfully</p>
      </div>
      {isMethodOnly ? (
        <p className="text-body text-foreground-muted mt-2 text-center">
          The method was added to your method library.
        </p>
      ) : (
        <p className="text-body text-foreground-muted mt-2 text-center">
          New task id <strong>{result.newTaskId}</strong> created in your workspace.
          {result.newProjectId !== null && (
            <> Linked to project id <strong>{result.newProjectId}</strong>.</>
          )}
        </p>
      )}
      {Object.keys(result.importedMethodIds).length > 0 && (
        <p className="text-meta text-foreground-muted mt-2 text-center">
          {Object.keys(result.importedMethodIds).length} method{Object.keys(result.importedMethodIds).length === 1 ? "" : "s"} resolved.
        </p>
      )}

      {/* notCarried notice. The import never silently severs a link or leaves a
          dangling foreign-method reference, anything it could not carry over is
          dropped and reported here verbatim so the recipient knows. Empty on a
          clean (lossless) import, the normal single-experiment case for self-
          contained experiments. */}
      {hasNotCarried && (
        <div className="mt-4 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-3 py-2.5">
          <p className="text-meta font-medium text-amber-800 dark:text-amber-300">
            Some links or method references were not carried over
          </p>
          <ul className="mt-1.5 space-y-1 text-meta text-amber-700 dark:text-amber-300">
            {droppedDeps > 0 && (
              <li>
                {droppedDeps} task {droppedDeps === 1 ? "link was" : "links were"} dropped
                because the other experiment {droppedDeps === 1 ? "was" : "were"} not
                included in this share. {droppedDeps === 1 ? "It links" : "They link"} to
                an experiment you did not receive, so {droppedDeps === 1 ? "it" : "they"}{" "}
                could not be recreated.
              </li>
            )}
            {droppedMethods > 0 && (
              <li>
                {droppedMethods} method reference
                {droppedMethods === 1 ? " was" : "s were"} dropped because the method
                content was not bundled, so {droppedMethods === 1 ? "it" : "they"} could
                not be recreated locally.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function CheckGlyph({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ReviewStage({
  plan,
  isMethod,
  projectImportedName,
  methodImportedNames,
  setProjectDecision,
  setMethodDecision,
  provenanceLabel,
}: {
  plan: ImportPlan;
  isMethod: boolean;
  projectImportedName: string;
  methodImportedNames: string[];
  setProjectDecision: (next: ProjectDecision, existingId?: number | null) => void;
  setMethodDecision: (idx: number, next: MethodDecision, existingId?: number | null) => void;
  provenanceLabel?: string;
}) {
  const taskName = plan.payload.task.name;
  // Prefer the cross-boundary sender label (the verified email) when present,
  // else fall back to the manifest's source-owner (the local file-picker path).
  const sourceOwner = provenanceLabel || plan.payload.manifest.source_owner;

  // Orphan method-origin attachments (i.e. `methods/unattached/<filename>` in
  // the raw bundle) have no method id to bind to, so the apply pipeline drops
  // them. In practice this set is empty — only the PDF-magic-bytes fallback
  // in the export-side extractor emits anything here. Surface the drop so if
  // anyone hits it they'll notice and report it. (AGENTS.md §8, option C.)
  const droppedUnattached = plan.payload.attachments.filter(
    (a) => a.origin === "methods" && a.sub === null && a.methodId === undefined,
  );
  const droppedPreview = droppedUnattached.slice(0, 3).map((a) => a.filename).join(", ");
  const droppedExtra = droppedUnattached.length - 3;

  return (
    <div className="space-y-5">
      {isMethod ? (
        // A standalone-method import lands only the method, so the experiment
        // task + project resolution blocks don't apply. Show a short
        // provenance line and let the Methods section below drive the import.
        <div>
          <p className="text-meta uppercase tracking-wide text-foreground-muted font-medium">Method</p>
          <p className="text-body text-foreground mt-1">
            Shared <span className="text-foreground-muted">by {sourceOwner || "(unknown user)"}</span>
          </p>
          <p className="text-meta text-foreground-muted mt-1">
            The method will be added to your library. No experiment or project is created.
          </p>
        </div>
      ) : (
        <>
          <div>
            <p className="text-meta uppercase tracking-wide text-foreground-muted font-medium">Experiment</p>
            <p className="text-body text-foreground mt-1">
              <strong>{taskName}</strong>{" "}
              <span className="text-foreground-muted">from {sourceOwner || "(unknown user)"}</span>
            </p>
            <p className="text-meta text-foreground-muted mt-1">
              A new task will be created in your workspace. Notes, results, files, and images come along.
            </p>
          </div>

          <div>
            <p className="text-meta uppercase tracking-wide text-foreground-muted font-medium">Project</p>
            <p className="text-body text-foreground mt-1">
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
                    className="ml-2 text-meta border border-border rounded px-2 py-1"
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
                  <span className="ml-2 text-meta text-foreground-muted">→ &ldquo;{projectImportedName}&rdquo;</span>
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
        </>
      )}

      {plan.methods.length > 0 && (
        <div>
          <p className="text-meta uppercase tracking-wide text-foreground-muted font-medium">
            Methods ({plan.methods.length})
          </p>
          <div className="mt-2 space-y-3">
            {plan.methods.map((m, idx) => {
              const entry = plan.payload.methods[idx];
              const isPcr = m.sourceMethodType === "pcr";
              const pcrProtocolBundled = isPcr && entry?.pcrProtocol != null;
              const importNewDisabled = isPcr && !pcrProtocolBundled;
              return (
                <div key={`${m.sourceMethodId}:${idx}`} className="rounded-lg border border-border p-3">
                  <p className="text-body text-foreground">
                    <strong>{m.sourceMethodName}</strong>
                    <span className="ml-2 text-meta text-foreground-muted">
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
                          className="ml-2 text-meta border border-border rounded px-2 py-1"
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
                        <span className="ml-2 text-meta text-foreground-muted">→ &ldquo;{methodImportedNames[idx]}&rdquo;</span>
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

      {droppedUnattached.length > 0 && (
        <p className="text-meta text-foreground-muted flex items-start gap-1.5">
          <svg
            aria-hidden
            className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>
            {droppedUnattached.length} file{droppedUnattached.length === 1 ? "" : "s"} in this
            bundle {droppedUnattached.length === 1 ? "isn't" : "aren't"} attached to any method
            and will be dropped: {droppedPreview}
            {droppedExtra > 0 && <> and {droppedExtra} more</>}.
          </span>
        </p>
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
      className={`flex items-center gap-2 text-body cursor-pointer ${
        disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-surface-sunken"
      } rounded px-2 py-1`}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
      />
      <span className="text-foreground">{children}</span>
    </label>
  );
}

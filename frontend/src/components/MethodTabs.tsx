"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAllMethodsIncludingShared } from "@/lib/local-api";
import type { Task } from "@/lib/types";
import { resolveMethodForAttachment } from "@/lib/methods/lookup";
import MethodPicker from "./MethodPicker";
import Tooltip from "./Tooltip";
import { ownerScopedTasksApi } from "@/lib/tasks/owner-scoped-api";
import MarkdownMethodTabContent from "./methods/MarkdownMethodTabContent";
import PdfMethodTabContent from "./methods/PdfMethodTabContent";
import PcrMethodTabContent from "./methods/PcrMethodTabContent";
import LcMethodTabContent from "./methods/LcMethodTabContent";
import PlateMethodTabContent from "./methods/PlateMethodTabContent";
import CellCultureMethodTabContent from "./methods/CellCultureMethodTabContent";
import MassSpecMethodTabContent from "./methods/MassSpecMethodTabContent";
import CompoundMethodTabContent from "./methods/CompoundMethodTabContent";
import CodingWorkflowMethodTabContent from "./methods/CodingWorkflowMethodTabContent";
import QpcrAnalysisMethodTabContent from "./methods/QpcrAnalysisMethodTabContent";
import { WrapAsCompoundAction } from "./methods/WrapAsCompoundAction";

interface MethodTabsProps {
  task: Task;
  onTaskUpdate?: (task: Task) => void;
  readOnly?: boolean; // When true, all editing is disabled (for lab mode)
}

export default function MethodTabs({ task, onTaskUpdate, readOnly = false }: MethodTabsProps) {
  const queryClient = useQueryClient();
  // Receivers editing a shared task with `edit` permission must route every
  // mutation back to the OWNER's directory. Without this wrapper, the direct
  // calls below (addMethod/removeMethod) default to the current user's
  // namespace and silently fork the task on disk (orphan write under
  // users/{receiver}/tasks/...).
  const tasksApi = useMemo(() => ownerScopedTasksApi(task), [task]);
  const [activeMethodId, setActiveMethodId] = useState<number | null>(null);
  const [showMethodSelector, setShowMethodSelector] = useState(false);
  const [saving, setSaving] = useState(false);

  // Get method attachments from task
  const methodAttachments = useMemo(() => task.method_attachments || [], [task.method_attachments]);

  // Set initial active method
  useEffect(() => {
    if (methodAttachments.length > 0 && !activeMethodId) {
      setActiveMethodId(methodAttachments[0].method_id);
    }
  }, [methodAttachments, activeMethodId]);

  // Load all available methods
  const { data: allMethods = [] } = useQuery({
    queryKey: ["methods"],
    queryFn: fetchAllMethodsIncludingShared,
  });

  // Get the active method attachment. Resolve the method through the
  // attachment so the per-attachment `owner` field disambiguates against
  // per-user id collisions (e.g. attaching a public method whose id
  // collides with one of the current user's private methods).
  const activeAttachment = methodAttachments.find(a => a.method_id === activeMethodId);
  const activeMethod = resolveMethodForAttachment(activeAttachment, allMethods, task.owner);

  // Add method to task. `methodOwner` is the picker-selected method's owner
  // namespace ("public" / a username); the API persists it on the new
  // attachment so future reads disambiguate against per-user id collisions
  // without re-resolving from a list where the bare id is ambiguous.
  const handleAddMethod = useCallback(async (methodId: number, methodOwner: string) => {
    setSaving(true);
    try {
      const updatedTask = await tasksApi.addMethod(task.id, methodId, methodOwner);
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
      setActiveMethodId(methodId);
      setShowMethodSelector(false);
      if (updatedTask) onTaskUpdate?.(updatedTask);
    } catch (err) {
      console.error("Failed to add method:", err);
      alert("Failed to add method");
    } finally {
      setSaving(false);
    }
  }, [task.id, queryClient, onTaskUpdate, tasksApi]);

  // Remove method from task
  const handleRemoveMethod = useCallback(async (methodId: number) => {
    if (!confirm("Remove this method from the experiment?")) return;

    setSaving(true);
    try {
      const updatedTask = await tasksApi.removeMethod(task.id, methodId);
      if (!updatedTask) return;

      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });

      // Switch to another method if the removed one was active
      if (activeMethodId === methodId) {
        const remainingMethods = (updatedTask.method_attachments || []).filter(a => a.method_id !== methodId);
        setActiveMethodId(remainingMethods.length > 0 ? remainingMethods[0].method_id : null);
      }

      if (updatedTask) onTaskUpdate?.(updatedTask);
    } catch (err) {
      console.error("Failed to remove method:", err);
      alert("Failed to remove method");
    } finally {
      setSaving(false);
    }
  }, [task.id, activeMethodId, queryClient, onTaskUpdate, tasksApi]);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar - browser-like */}
      <div className="flex items-center bg-gray-100 border-b border-gray-200 px-2 pt-2">
        {/* Method tabs */}
        <div className="flex items-end gap-0.5 flex-1 overflow-x-auto">
          {methodAttachments.map((attachment) => {
            const method = resolveMethodForAttachment(attachment, allMethods, task.owner);
            const isActive = activeMethodId === attachment.method_id;

            return (
              <div
                key={attachment.method_id}
                className={`group relative flex items-center gap-1 px-3 py-2 rounded-t-lg text-sm font-medium cursor-pointer transition-colors min-w-[120px] max-w-[200px] ${
                  isActive
                    ? "bg-white text-gray-900 shadow-sm border-t border-l border-r border-gray-200"
                    : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                }`}
                onClick={() => setActiveMethodId(attachment.method_id)}
              >
                {/* Tab icon based on method type */}
                {method?.method_type === "pcr" ? (
                  <span className="text-xs">🧬</span>
                ) : method?.method_type === "lc_gradient" ? (
                  <span className="text-xs">📈</span>
                ) : method?.method_type === "plate" ? (
                  <span className="text-xs">🧫</span>
                ) : method?.method_type === "cell_culture" ? (
                  <span className="text-xs">🧪</span>
                ) : method?.method_type === "qpcr_analysis" ? (
                  <span className="text-xs">🔬</span>
                ) : method?.method_type === "mass_spec" ? (
                  <span className="text-xs">⚗️</span>
                ) : method?.method_type === "pdf" ? (
                  <span className="text-xs">📕</span>
                ) : method?.method_type === "compound" ? (
                  <span className="text-xs">📦</span>
                ) : method?.method_type === "coding_workflow" ? (
                  <span className="text-xs">💻</span>
                ) : (
                  <span className="text-xs">📄</span>
                )}

                {/* Tab title */}
                <span className="truncate flex-1">
                  {method?.name || `Method ${attachment.method_id}`}
                </span>

                {/* Close button - hidden in readOnly mode */}
                {!readOnly && (
                  <Tooltip label="Remove method" placement="bottom">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveMethod(attachment.method_id);
                      }}
                      disabled={saving}
                      className="opacity-0 group-hover:opacity-100 hover:bg-gray-300 rounded p-0.5 transition-opacity"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6L6 18M6 6l12 12"/>
                      </svg>
                    </button>
                  </Tooltip>
                )}
              </div>
            );
          })}

          {/* Add method button - hidden in readOnly mode */}
          {!readOnly && (
            <Tooltip label="Add method" placement="bottom">
              <button
                onClick={() => setShowMethodSelector(true)}
                className="flex items-center justify-center px-3 py-2 rounded-t-lg text-sm text-gray-500 hover:bg-gray-200 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
              </button>
            </Tooltip>
          )}
        </div>
        {/* Extend-into-kit affordance for the active non-compound method.
            Wrapping creates a new compound (kit) that lists the active
            method as its first child, then swaps this task's attachment
            from the source method to the new compound. */}
        {!readOnly && activeMethod && activeMethod.method_type !== "compound" && (
          <div className="ml-2 mb-2">
            <WrapAsCompoundAction
              method={activeMethod}
              task={task}
              onWrapped={(compound) => setActiveMethodId(compound.id)}
            />
          </div>
        )}
      </div>

      {/* Method picker modal */}
      <MethodPicker
        open={showMethodSelector}
        currentMethodId={null}
        currentProjectId={task.project_id}
        excludeMethods={methodAttachments.map((a) => ({
          method_id: a.method_id,
          // null = same user as task; resolve to the task's owner so the
          // picker can match strictly against `m.owner` without needing
          // the task context.
          owner: a.owner ?? task.owner,
        }))}
        onSelect={(id, owner) => {
          void handleAddMethod(id, owner);
        }}
        onClose={() => setShowMethodSelector(false)}
      />

      {/* Tab content — dispatch to per-type viewer */}
      <div className="flex-1 overflow-y-auto">
        {activeMethodId === null || !activeMethod ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="12" y1="18" x2="12" y2="12"/>
              <line x1="9" y1="15" x2="15" y2="15"/>
            </svg>
            <p className="mt-2 text-sm">No methods attached</p>
            <p className="mt-1 text-xs text-gray-300">Click the + button above to add a method</p>
          </div>
        ) : (
          (() => {
            // Resolve method type, with a defensive fallback for legacy
            // records whose `method_type` was never set but whose
            // `source_path` carries enough information to route them:
            //   - `pcr://protocol/{id}` ⇒ PCR
            //   - `*.pdf`               ⇒ PDF
            // Default falls through to markdown (the historical default
            // for legacy records that predate `method_type`).
            const resolvedType = resolveMethodType(activeMethod.method_type, activeMethod.source_path);
            // Switch (not registry lookup) so each viewer's bundle can be
            // dynamically code-split per route. Adding a new method type
            // here adds one case + one import — same shape, new viewer.
            switch (resolvedType) {
              case "pcr":
                return (
                  <PcrMethodTabContent
                    task={task}
                    method={activeMethod}
                    methodId={activeMethodId}
                    attachment={activeAttachment}
                    onTaskUpdate={onTaskUpdate}
                    readOnly={readOnly}
                  />
                );
              case "lc_gradient":
                return (
                  <LcMethodTabContent
                    task={task}
                    method={activeMethod}
                    methodId={activeMethodId}
                    attachment={activeAttachment}
                    onTaskUpdate={onTaskUpdate}
                    readOnly={readOnly}
                  />
                );
              case "plate":
                return (
                  <PlateMethodTabContent
                    task={task}
                    method={activeMethod}
                    methodId={activeMethodId}
                    attachment={activeAttachment}
                    onTaskUpdate={onTaskUpdate}
                    readOnly={readOnly}
                  />
                );
              case "cell_culture":
                return (
                  <CellCultureMethodTabContent
                    task={task}
                    method={activeMethod}
                    methodId={activeMethodId}
                    attachment={activeAttachment}
                    onTaskUpdate={onTaskUpdate}
                    readOnly={readOnly}
                  />
                );
              case "qpcr_analysis":
                return (
                  <QpcrAnalysisMethodTabContent
                    task={task}
                    method={activeMethod}
                    methodId={activeMethodId}
                    attachment={activeAttachment}
                    onTaskUpdate={onTaskUpdate}
                    readOnly={readOnly}
                  />
                );
              case "mass_spec":
                return (
                  <MassSpecMethodTabContent
                    task={task}
                    method={activeMethod}
                    methodId={activeMethodId}
                    attachment={activeAttachment}
                    onTaskUpdate={onTaskUpdate}
                    readOnly={readOnly}
                  />
                );
              case "pdf":
                return (
                  <PdfMethodTabContent
                    task={task}
                    method={activeMethod}
                    methodId={activeMethodId}
                    attachment={activeAttachment}
                    onTaskUpdate={onTaskUpdate}
                    readOnly={readOnly}
                  />
                );
              case "compound":
                return (
                  <CompoundMethodTabContent
                    task={task}
                    method={activeMethod}
                    methodId={activeMethodId}
                    attachment={activeAttachment}
                    onTaskUpdate={onTaskUpdate}
                    readOnly={readOnly}
                    onSwitchActiveMethod={(nextId) => setActiveMethodId(nextId)}
                  />
                );
              case "coding_workflow":
                return (
                  <CodingWorkflowMethodTabContent
                    task={task}
                    method={activeMethod}
                    methodId={activeMethodId}
                    attachment={activeAttachment}
                    onTaskUpdate={onTaskUpdate}
                    readOnly={readOnly}
                  />
                );
              case "markdown":
              default:
                return (
                  <MarkdownMethodTabContent
                    task={task}
                    method={activeMethod}
                    methodId={activeMethodId}
                    attachment={activeAttachment}
                    onTaskUpdate={onTaskUpdate}
                    readOnly={readOnly}
                  />
                );
            }
          })()
        )}
      </div>
    </div>
  );
}

/**
 * Resolve the effective viewer type for a method record. Honors the
 * `method_type` discriminator when set, otherwise sniffs `source_path`
 * for legacy records. Mirrors the historical fallback logic at the old
 * `isPcrMethod`/`isPdfMethod` derivation site so byte-identical
 * behavior is preserved.
 */
function resolveMethodType(
  methodType: string | null | undefined,
  sourcePath: string | null | undefined,
): "markdown" | "pdf" | "pcr" | "lc_gradient" | "plate" | "cell_culture" | "mass_spec" | "compound" | "coding_workflow" | "qpcr_analysis" {
  if (methodType === "compound") return "compound";
  // qPCR analysis is matched before PCR so the `qpcr_analysis://protocol/...`
  // source-path scheme isn't shadowed by the `pcr://` prefix match below
  // (which would otherwise also accept `qpcr_analysis://` as a prefix-hit if
  // we tightened the regex). The two are sibling types: one for the cycling
  // recipe, one for the analysis layer; composed via a compound to get the
  // full qPCR workflow.
  if (
    methodType === "qpcr_analysis" ||
    (sourcePath?.startsWith("qpcr_analysis://") ?? false)
  ) {
    return "qpcr_analysis";
  }
  if (methodType === "pcr" || (sourcePath?.startsWith("pcr://") ?? false)) return "pcr";
  if (
    methodType === "lc_gradient" ||
    (sourcePath?.startsWith("lc_gradient://") ?? false)
  ) {
    return "lc_gradient";
  }
  if (methodType === "plate" || (sourcePath?.startsWith("plate://") ?? false)) {
    return "plate";
  }
  if (
    methodType === "cell_culture" ||
    (sourcePath?.startsWith("cell_culture://") ?? false)
  ) {
    return "cell_culture";
  }
  if (
    methodType === "mass_spec" ||
    (sourcePath?.startsWith("mass_spec://") ?? false)
  ) {
    return "mass_spec";
  }
  if (
    methodType === "coding_workflow" ||
    (sourcePath?.startsWith("coding_workflow://") ?? false)
  ) {
    return "coding_workflow";
  }
  if (methodType === "pdf" || (sourcePath?.toLowerCase().endsWith(".pdf") ?? false)) return "pdf";
  return "markdown";
}

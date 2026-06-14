"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAllMethodsIncludingShared } from "@/lib/local-api";
import type { Task } from "@/lib/types";
import { attachmentKey, resolveMethodForAttachment } from "@/lib/methods/lookup";
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
import { ForkToLibraryAction } from "./methods/ForkToLibraryAction";
import ViewMethodOnPhoneButton from "./methods/ViewMethodOnPhoneButton";
import { Icon } from "@/components/icons";

interface MethodTabsProps {
  task: Task;
  onTaskUpdate?: (task: Task) => void;
  readOnly?: boolean; // When true, all editing is disabled (for lab mode)
  /** PI capability revamp: the lab head's username when editing this member's
   *  task on the role (after the confirm), so method mutations route to the
   *  owner's folder + audit. */
  piActor?: string;
}

export default function MethodTabs({ task, onTaskUpdate, readOnly = false, piActor }: MethodTabsProps) {
  const queryClient = useQueryClient();
  // Receivers editing a shared task with `edit` permission must route every
  // mutation back to the OWNER's directory. Without this wrapper, the direct
  // calls below (addMethod/removeMethod) default to the current user's
  // namespace and silently fork the task on disk (orphan write under
  // users/{receiver}/tasks/...). A PI editing a member's task on the role
  // passes piActor so the same routing + audit fires.
  const tasksApi = useMemo(
    () => ownerScopedTasksApi(task, piActor ? { actor: piActor } : undefined),
    [task, piActor],
  );
  // Composite `(owner:method_id)` key — bare method_id can't disambiguate
  // two attachments that happen to share a numeric id but reference methods
  // in different owner namespaces (e.g. alex's private 5 vs the public 5).
  // Resolved through `attachmentKey` so the same string matches the tab,
  // the click handler, and the lookup that hydrates `activeMethod`.
  const [activeAttachmentKey, setActiveAttachmentKey] = useState<string | null>(null);
  const [showMethodSelector, setShowMethodSelector] = useState(false);
  const [saving, setSaving] = useState(false);

  // Get method attachments from task
  const methodAttachments = useMemo(() => task.method_attachments || [], [task.method_attachments]);

  // Set initial active method
  useEffect(() => {
    if (methodAttachments.length > 0 && !activeAttachmentKey) {
      setActiveAttachmentKey(attachmentKey(methodAttachments[0], task.owner));
    }
  }, [methodAttachments, activeAttachmentKey, task.owner]);

  // Load all available methods
  const { data: allMethods = [] } = useQuery({
    queryKey: ["methods"],
    queryFn: fetchAllMethodsIncludingShared,
  });

  // Get the active method attachment. Resolve the method through the
  // attachment so the per-attachment `owner` field disambiguates against
  // per-user id collisions (e.g. attaching a public method whose id
  // collides with one of the current user's private methods).
  const activeAttachment = methodAttachments.find(
    (a) => attachmentKey(a, task.owner) === activeAttachmentKey,
  );
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
      // The newly-added attachment's persisted `owner` mirrors `methodOwner`
      // (or null when same as the task owner) — either way `attachmentKey`
      // produces the same string for the active key as for the tab lookup.
      setActiveAttachmentKey(
        attachmentKey({ method_id: methodId, owner: methodOwner }, task.owner),
      );
      // Multi-attach (selector redesign 2026-05-29): the picker now stays
      // OPEN after each attach so the user can pin several methods in a row.
      // The just-attached card flips to "Attached" via the picker's
      // `excludeMethods` machinery (we feed it the live attachment list
      // below). The user closes the picker via Esc / the close button. The
      // old force-close on attach was removed — see `keepOpenOnSelect` on the
      // MethodPicker mount.
      if (updatedTask) onTaskUpdate?.(updatedTask);
    } catch (err) {
      console.error("Failed to add method:", err);
      alert("Failed to add method");
    } finally {
      setSaving(false);
    }
  }, [task.id, task.owner, queryClient, onTaskUpdate, tasksApi]);

  // Remove method from task. `removedKey` is the composite `(owner:id)` of
  // the tab the user clicked the X on; without it we can't tell whether the
  // active tab is the one being removed when two attachments share a
  // numeric id but reference methods in different owner namespaces.
  const handleRemoveMethod = useCallback(async (methodId: number, removedKey: string) => {
    if (!confirm("Remove this method from the experiment?")) return;

    setSaving(true);
    try {
      const updatedTask = await tasksApi.removeMethod(task.id, methodId);
      if (!updatedTask) return;

      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });

      // Switch to another method if the removed one was active
      if (activeAttachmentKey === removedKey) {
        const remaining = (updatedTask.method_attachments || []).filter(
          (a) => attachmentKey(a, task.owner) !== removedKey,
        );
        setActiveAttachmentKey(
          remaining.length > 0 ? attachmentKey(remaining[0], task.owner) : null,
        );
      }

      if (updatedTask) onTaskUpdate?.(updatedTask);
    } catch (err) {
      console.error("Failed to remove method:", err);
      alert("Failed to remove method");
    } finally {
      setSaving(false);
    }
  }, [task.id, task.owner, activeAttachmentKey, queryClient, onTaskUpdate, tasksApi]);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar - browser-like */}
      <div className="flex items-center bg-surface-sunken border-b border-border px-2 pt-2">
        {/* Method tabs */}
        <div className="flex items-end gap-0.5 flex-1 overflow-x-auto">
          {methodAttachments.map((attachment) => {
            const method = resolveMethodForAttachment(attachment, allMethods, task.owner);
            const tabKey = attachmentKey(attachment, task.owner);
            const isActive = activeAttachmentKey === tabKey;

            return (
              <div
                key={tabKey}
                className={`group relative flex items-center gap-1 px-3 py-2 rounded-t-lg text-body font-medium cursor-pointer transition-colors min-w-[120px] max-w-[200px] ${
                  isActive
                    ? "bg-surface-raised text-foreground shadow-sm border-t border-l border-r border-border"
                    : "bg-surface-sunken text-foreground-muted hover:bg-gray-300"
                }`}
                onClick={() => setActiveAttachmentKey(tabKey)}
              >
                {/* Tab type badge — text-only, no emoji */}
                {method?.method_type && (
                  <span className="text-meta font-mono uppercase tracking-wide bg-surface-sunken group-[.active-tab]:bg-surface-sunken rounded px-1 py-0.5 text-foreground-muted shrink-0">
                    {method.method_type === "lc_gradient" ? "LC" :
                     method.method_type === "qpcr_analysis" ? "qPCR" :
                     method.method_type === "mass_spec" ? "MS" :
                     method.method_type === "cell_culture" ? "CC" :
                     method.method_type === "coding_workflow" ? "code" :
                     method.method_type === "pcr" ? "PCR" :
                     method.method_type === "pdf" ? "PDF" :
                     method.method_type === "compound" ? "cmpd" :
                     method.method_type === "plate" ? "plate" :
                     "md"}
                  </span>
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
                        handleRemoveMethod(attachment.method_id, tabKey);
                      }}
                      disabled={saving}
                      className="opacity-0 group-hover:opacity-100 hover:bg-gray-300 rounded p-0.5 transition-opacity"
                      data-force-hover-controls-target
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
                data-tour-target="experiment-attach-method"
                className="flex items-center justify-center px-3 py-2 rounded-t-lg text-body text-foreground-muted hover:bg-surface-sunken transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
              </button>
            </Tooltip>
          )}
        </div>
        {/* View method on phone (explicit entry point, Grant's locked v1
            decision). Publishes a sealed read-mode projection of this
            experiment's method(s) to the paired phone so the researcher can
            follow the protocol at the bench. Self-hides when no phone is
            paired. Shown in read AND edit mode (viewing is always allowed). */}
        {activeMethod && (
          <div className="ml-2 mb-2">
            <ViewMethodOnPhoneButton taskId={task.id} taskOwner={task.owner} />
          </div>
        )}
        {/* Gathered-reagent progress synced from the phone read mode. The
            companion ticks reagents off as they are gathered at the bench and
            syncs the count here (last-write-wins). Self-hides when nothing has
            been gathered yet. */}
        {activeMethod &&
          activeAttachment?.gathered_checks &&
          activeAttachment.gathered_checks.total > 0 && (
            <div className="ml-2 mb-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-sunken text-meta text-foreground-muted">
              <Icon name="check" className="w-3 h-3 text-green-600 shrink-0" />
              <span>
                {activeAttachment.gathered_checks.gatheredCount} of{" "}
                {activeAttachment.gathered_checks.total} reagents gathered on the phone
              </span>
            </div>
          )}
        {/* Extend-into-kit affordance for the active non-compound method.
            Wrapping creates a new compound (kit) that lists the active
            method as its first child, then swaps this task's attachment
            from the source method to the new compound. */}
        {!readOnly && activeMethod && activeMethod.method_type !== "compound" && (
          <div className="ml-2 mb-2">
            <WrapAsCompoundAction
              method={activeMethod}
              task={task}
              piActor={piActor}
              onWrapped={(compound) =>
                setActiveAttachmentKey(
                  attachmentKey(
                    { method_id: compound.id, owner: compound.owner },
                    task.owner,
                  ),
                )
              }
            />
          </div>
        )}
        {/* Promote this experiment's edited copy of the method into a brand-new
            standalone library method. The per-task edits (body_override / the
            per-type structured overrides / variation_notes) otherwise live only
            on this attachment; this is the only path to fork them back into the
            reusable library. Source method + this attachment stay untouched. */}
        {!readOnly && activeMethod && (
          <div className="ml-2 mb-2">
            <ForkToLibraryAction
              method={activeMethod}
              attachment={activeAttachment}
              task={task}
              piActor={piActor}
            />
          </div>
        )}
      </div>

      {/* Method picker modal */}
      <MethodPicker
        open={showMethodSelector}
        currentMethodId={null}
        currentProjectId={task.project_id}
        // Multi-attach context: keep the picker open after each attach so the
        // user can pin several methods without re-opening it. The attached
        // cards stay visible and flip to "Attached" rather than vanishing.
        keepOpenOnSelect
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
        {activeAttachmentKey === null || !activeMethod ? (
          <div className="flex flex-col items-center justify-center h-full text-foreground-muted">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="12" y1="18" x2="12" y2="12"/>
              <line x1="9" y1="15" x2="15" y2="15"/>
            </svg>
            <p className="mt-2 text-body">No methods attached</p>
            <p className="mt-1 text-meta text-foreground-muted">Click the + button above to add a method</p>
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
            // `activeAttachment` is guaranteed defined inside this branch:
            // `activeMethod` is only truthy when its attachment was found
            // above. Narrow once here so each viewer receives a `number`
            // (their `methodId` prop is non-nullable).
            const activeMethodId = activeAttachment!.method_id;
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
                    piActor={piActor}
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
                    piActor={piActor}
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
                    piActor={piActor}
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
                    piActor={piActor}
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
                    piActor={piActor}
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
                    onSwitchActiveMethod={(nextId) =>
                      setActiveAttachmentKey(
                        nextId === null
                          ? null
                          : attachmentKey(
                              { method_id: nextId, owner: null },
                              task.owner,
                            ),
                      )
                    }
                    piActor={piActor}
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
                    piActor={piActor}
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

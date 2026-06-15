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
import MakePhoneFriendlyButton from "./methods/MakePhoneFriendlyButton";
import { METHOD_PHONE_REFORMAT_ENABLED } from "@/lib/ai/config";
import VariationNotesPanel from "./methods/VariationNotesPanel";
import { Icon, type IconName } from "@/components/icons";

interface MethodTabsProps {
  task: Task;
  onTaskUpdate?: (task: Task) => void;
  readOnly?: boolean; // When true, all editing is disabled (for lab mode)
  /** PI capability revamp: the lab head's username when editing this member's
   *  task on the role (after the confirm), so method mutations route to the
   *  owner's folder + audit. */
  piActor?: string;
}

// Per-type visual identity for the component rail: a registry icon, a short
// sentence-case label, and an accent color. The color is a mid-ramp hue that
// stays legible on both light and dark surfaces (the active row tints to ~10%
// of it). Keyed by the resolved viewer type from resolveMethodType.
const TYPE_META: Record<string, { icon: IconName; label: string; color: string }> = {
  markdown: { icon: "text", label: "Markdown", color: "#5F5E5A" },
  pcr: { icon: "growth", label: "PCR", color: "#A32D2D" },
  qpcr_analysis: { icon: "chart", label: "qPCR analysis", color: "#534AB7" },
  lc_gradient: { icon: "chart", label: "LC gradient", color: "#0F6E56" },
  plate: { icon: "table", label: "Plate layout", color: "#854F0B" },
  cell_culture: { icon: "vial", label: "Cell culture", color: "#3B6D11" },
  mass_spec: { icon: "gauge", label: "Mass spec", color: "#185FA5" },
  compound: { icon: "layer", label: "Compound kit", color: "#993556" },
  coding_workflow: { icon: "transform", label: "Code workflow", color: "#444441" },
  pdf: { icon: "file", label: "PDF", color: "#993C1D" },
};

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
    <div className="flex h-full">
      {/* Left rail: method components, color-coded by type. Replaces the old
          cramped top tab bar so long names get vertical room and each type
          carries its own accent color instead of blurring into grey. */}
      <div className="flex w-56 flex-shrink-0 flex-col border-r border-border bg-surface-sunken">
        <div className="px-3 pb-1.5 pt-3 text-meta font-medium text-foreground-muted">
          Components
        </div>
        <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
          {methodAttachments.map((attachment) => {
            const method = resolveMethodForAttachment(attachment, allMethods, task.owner);
            const tabKey = attachmentKey(attachment, task.owner);
            const isActive = activeAttachmentKey === tabKey;
            const meta =
              TYPE_META[resolveMethodType(method?.method_type, method?.source_path)] ??
              TYPE_META.markdown;

            return (
              <div
                key={tabKey}
                title={method?.name || `Method ${attachment.method_id}`}
                onClick={() => setActiveAttachmentKey(tabKey)}
                className={`group relative flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 transition-colors ${
                  isActive ? "shadow-sm" : "hover:bg-surface-raised/60"
                }`}
                style={isActive ? { backgroundColor: `${meta.color}1A` } : undefined}
              >
                <span className="mt-0.5 flex-shrink-0" style={{ color: meta.color }}>
                  <Icon name={meta.icon} className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-body font-medium leading-snug ${
                      isActive ? "text-foreground" : "text-foreground-muted"
                    }`}
                    style={{
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {method?.name || `Method ${attachment.method_id}`}
                  </div>
                  <div className="mt-0.5 text-meta" style={{ color: meta.color }}>
                    {meta.label}
                  </div>
                </div>

                {/* Remove component - hidden in readOnly mode */}
                {!readOnly && (
                  <Tooltip label="Remove method" placement="left">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveMethod(attachment.method_id, tabKey);
                      }}
                      disabled={saving}
                      className="rounded p-0.5 text-foreground-muted opacity-0 transition-opacity hover:bg-surface-raised group-hover:opacity-100"
                      data-force-hover-controls-target
                      aria-label="Remove method"
                    >
                      <Icon name="close" className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip>
                )}
              </div>
            );
          })}
        </div>
        {/* Add component sits in the rail footer, full-width, so it reads as a
            list action rather than a tab. */}
        {!readOnly && (
          <div className="border-t border-border p-2">
            <button
              onClick={() => setShowMethodSelector(true)}
              data-tour-target="experiment-attach-method"
              className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-body text-foreground-muted transition-colors hover:bg-surface-raised"
            >
              <Icon name="plus" className="h-4 w-4" />
              Add component
            </button>
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

      {/* Right pane: active component header (name + actions) then the body. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {activeMethod && (
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <span
              className="flex-shrink-0"
              style={{ color: (TYPE_META[resolveMethodType(activeMethod.method_type, activeMethod.source_path)] ?? TYPE_META.markdown).color }}
            >
              <Icon
                name={(TYPE_META[resolveMethodType(activeMethod.method_type, activeMethod.source_path)] ?? TYPE_META.markdown).icon}
                className="h-4 w-4"
              />
            </span>
            {/* Full width for the title now that the actions live in the
                bottom toolbar, so long method names are no longer cut off. */}
            <span className="truncate text-body font-medium text-foreground">
              {activeMethod.name || `Method ${activeAttachment!.method_id}`}
            </span>
          </div>
        )}
        {/* Gathered-reagent progress synced from the phone read mode
            (last-write-wins). Self-hides when nothing has been gathered yet. */}
        {activeMethod &&
          activeAttachment?.gathered_checks &&
          activeAttachment.gathered_checks.total > 0 && (
            <div className="flex items-center gap-1.5 border-b border-border bg-surface-sunken px-4 py-1.5 text-meta text-foreground-muted">
              <Icon name="check" className="h-3 w-3 flex-shrink-0 text-green-600" />
              <span>
                {activeAttachment.gathered_checks.gatheredCount} of{" "}
                {activeAttachment.gathered_checks.total} reagents gathered on the phone
              </span>
            </div>
          )}

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
                    hideVariationNotes
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
                    hideVariationNotes
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
                    hideVariationNotes
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
                    hideVariationNotes
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
                    hideVariationNotes
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
                    hideVariationNotes
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
                    hideVariationNotes
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
                    hideVariationNotes
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
                    hideVariationNotes
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
                    hideVariationNotes
                    readOnly={readOnly}
                    piActor={piActor}
                  />
                );
            }
          })()
        )}
      </div>
        {/* Action toolbar pinned to the bottom of the content pane, so the
            method title above keeps the full header width instead of fighting
            these buttons for space. */}
        {activeMethod && (
          <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-4 py-2">
            <ViewMethodOnPhoneButton taskId={task.id} taskOwner={task.owner} />
            {METHOD_PHONE_REFORMAT_ENABLED &&
              !readOnly &&
              !!activeMethod.source_path &&
              !activeMethod.source_path.includes("://") && (
                <MakePhoneFriendlyButton method={activeMethod} />
              )}
            {!readOnly && activeMethod.method_type !== "compound" && (
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
            )}
            {!readOnly && (
              <ForkToLibraryAction
                method={activeMethod}
                attachment={activeAttachment}
                task={task}
                piActor={piActor}
              />
            )}
          </div>
        )}
      </div>

      {/* Variation Notes — hoisted out of the per-type viewers into a shared
          full-height right column (rail | content | variations). Reads the
          active attachment's notes; the per-type viewers are told to hide
          their own copy via `hideVariationNotes`. Only shown when a method
          component is actually open. */}
      {activeAttachmentKey !== null && activeMethod && activeAttachment && (
        <VariationNotesPanel
          task={task}
          methodId={activeAttachment.method_id}
          variationNotes={activeAttachment.variation_notes}
          onSaved={(updatedTask) => {
            if (updatedTask) onTaskUpdate?.(updatedTask);
            queryClient.refetchQueries({ queryKey: ["tasks"] });
            queryClient.refetchQueries({ queryKey: ["allTasks"] });
          }}
          readOnly={readOnly}
          piActor={piActor}
        />
      )}
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

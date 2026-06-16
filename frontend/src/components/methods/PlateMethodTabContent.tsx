"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { plateApi } from "@/lib/local-api";
import type {
  Method,
  PlateAnnotationSnapshot,
  PlateProtocol,
  PlateWellAnnotation,
  Task,
  TaskMethodAttachment,
} from "@/lib/types";
import PlateLayoutEditor, { regionLabelsToWells } from "@/components/PlateLayoutEditor";
import { ownerScopedTasksApi } from "@/lib/tasks/owner-scoped-api";
import type { NestedSnapshotAdapter } from "@/lib/methods/nested-snapshot";
import VariationNotesPanel from "./VariationNotesPanel";

interface PlateMethodTabContentProps {
  task: Task;
  method: Method;
  methodId: number;
  attachment: TaskMethodAttachment | undefined;
  onTaskUpdate?: (task: Task) => void;
  readOnly?: boolean;
  /** When this viewer renders as a child inside a CompoundMethodTabContent,
   *  the parent passes a `nestedSnapshot` adapter that routes per-child
   *  reads/writes through `compound_snapshots[child_id]` instead of the
   *  task's top-level `plate_annotation` attachment field. Absent for
   *  standalone (non-nested) attachments. */
  nestedSnapshot?: NestedSnapshotAdapter<PlateAnnotationSnapshot>;
  /** Hide the VariationNotesPanel; the compound parent owns variation
   *  notes once for the whole compound, not per-child. */
  hideVariationNotes?: boolean;
  /** PI capability revamp: lab head username when editing a member's task on the role, so writes route to the owner + audit. */
  piActor?: string;
}

function extractPlateProtocolId(sourcePath: string): number | null {
  const match = sourcePath.match(/^plate:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

/** Pulls the per-well snapshot stored on the task's attachment, falling back
 *  to the source protocol's region_labels expanded to a per-well map. Mirrors
 *  LC's snapshotOrSource: `attachment.plate_annotation` is either null
 *  (defer to source region_labels) or a full snapshot JSON. */
function snapshotOrSource(
  attachment: TaskMethodAttachment | undefined,
  source: PlateProtocol | null | undefined,
): { wells: Record<string, PlateWellAnnotation>; fromSnapshot: boolean } {
  if (attachment?.plate_annotation) {
    try {
      const parsed = JSON.parse(attachment.plate_annotation) as PlateAnnotationSnapshot;
      if (parsed && typeof parsed === "object" && parsed.wells) {
        return { wells: parsed.wells, fromSnapshot: true };
      }
    } catch {
      // Fall through to source on corrupted snapshot — safer than dropping
      // the user's source baseline.
    }
  }
  return { wells: regionLabelsToWells(source?.region_labels), fromSnapshot: false };
}

export default function PlateMethodTabContent({
  task,
  method,
  methodId,
  attachment,
  onTaskUpdate,
  readOnly = false,
  nestedSnapshot,
  hideVariationNotes = false,
  piActor,
}: PlateMethodTabContentProps) {
  const queryClient = useQueryClient();
  const tasksApi = useMemo(() => ownerScopedTasksApi(task, piActor ? { actor: piActor } : undefined), [task, piActor]);

  const plateProtocolId = method.source_path ? extractPlateProtocolId(method.source_path) : null;
  const plateProtocolOwner = method.owner || undefined;

  const { data: fetchedProtocol } = useQuery({
    queryKey: ["plate-layout", plateProtocolId, plateProtocolOwner],
    queryFn: () => plateApi.get(plateProtocolId!, plateProtocolOwner),
    enabled: plateProtocolId !== null,
  });

  const [wells, setWells] = useState<Record<string, PlateWellAnnotation>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  const sourceProtocol = fetchedProtocol ?? null;

  // Source baseline expanded to wells — both the editor's "original" diff
  // baseline and the initial state when the task has no snapshot yet.
  const sourceWells = useMemo(
    () => regionLabelsToWells(sourceProtocol?.region_labels),
    [sourceProtocol],
  );

  // Synthesize an attachment-shaped record from the nested-snapshot adapter
  // when this viewer is rendering as a compound child. Lets the existing
  // `snapshotOrSource` helper work unchanged in both modes.
  const nestedRead = nestedSnapshot?.read;
  const effectiveAttachment: TaskMethodAttachment | undefined = useMemo(() => {
    if (!nestedRead) return attachment;
    const snap = nestedRead();
    return {
      method_id: methodId,
      owner: null,
      pcr_gradient: null,
      pcr_ingredients: null,
      lc_gradient: null,
      body_override: null,
      plate_annotation: snap ? JSON.stringify(snap) : null,
      cell_culture_schedule: null,
      variation_notes: null,
      compound_snapshots: null,
      qpcr_analysis: null,
    };
  }, [nestedRead, attachment, methodId]);

  useEffect(() => {
    if (!sourceProtocol) return;
    const seed = snapshotOrSource(effectiveAttachment, sourceProtocol);
    setWells(seed.wells);
    setHasUnsavedChanges(false);
  }, [effectiveAttachment, sourceProtocol]);

  // Track unsaved changes vs. whatever the editor was initialized from.
  const lastSeed = useMemo(
    () => snapshotOrSource(effectiveAttachment, sourceProtocol),
    [effectiveAttachment, sourceProtocol],
  );

  useEffect(() => {
    if (!sourceProtocol) {
      setHasUnsavedChanges(false);
      return;
    }
    setHasUnsavedChanges(JSON.stringify(wells) !== JSON.stringify(lastSeed.wells));
  }, [lastSeed, wells, sourceProtocol]);

  const handleSave = useCallback(async () => {
    if (!sourceProtocol) return;
    setSaving(true);
    try {
      const snapshot: PlateAnnotationSnapshot = { wells };
      if (nestedSnapshot) {
        await nestedSnapshot.write(snapshot);
        setHasUnsavedChanges(false);
      } else {
        const updatedTask = await tasksApi.updateMethodPlate(task.id, methodId, {
          plate_annotation: JSON.stringify(snapshot),
        });
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", task.id] });
        setHasUnsavedChanges(false);
        if (updatedTask) onTaskUpdate?.(updatedTask);
      }
    } catch (err) {
      console.error("Failed to save plate annotations:", err);
      alert("Failed to save plate annotations");
    } finally {
      setSaving(false);
    }
  }, [task.id, methodId, sourceProtocol, wells, queryClient, onTaskUpdate, tasksApi, nestedSnapshot]);

  const handleReset = useCallback(async () => {
    if (!confirm("Reset plate annotations to match the source method? Your changes will be lost.")) return;
    setSaving(true);
    try {
      if (nestedSnapshot) {
        await nestedSnapshot.reset();
      } else {
        const updatedTask = await tasksApi.resetPlate(task.id, methodId);
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", task.id] });
        if (updatedTask) onTaskUpdate?.(updatedTask);
      }
    } catch (err) {
      console.error("Failed to reset plate:", err);
      alert("Failed to reset plate data");
    } finally {
      setSaving(false);
    }
  }, [task.id, methodId, queryClient, onTaskUpdate, tasksApi, nestedSnapshot]);

  return (
    <div className="flex flex-col h-full">
      {!hideVariationNotes && (
        <VariationNotesPanel
          task={task}
          methodId={methodId}
          variationNotes={attachment?.variation_notes || null}
          onSaved={(updatedTask) => {
            if (updatedTask) onTaskUpdate?.(updatedTask);
            queryClient.refetchQueries({ queryKey: ["tasks"] });
            queryClient.refetchQueries({ queryKey: ["allTasks"] });
          }}
          readOnly={readOnly}
          piActor={piActor}
        />
      )}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-body font-medium text-foreground">
              {method.name || "Plate Layout"}
            </span>
            <span className="text-meta px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 rounded">Plate</span>
          </div>
          {!readOnly && (
            <div className="flex items-center gap-2">
              {hasUnsavedChanges && (
                <span className="text-meta text-amber-600 dark:text-amber-300">Unsaved changes</span>
              )}
              <button
                onClick={handleReset}
                disabled={saving}
                className="ros-btn-neutral px-3 py-1.5 text-meta text-foreground-muted disabled:opacity-50"
                title="Reset to original method values"
              >
                Reset to Method
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !hasUnsavedChanges}
                className="ros-btn-raise px-3 py-1.5 text-meta text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          )}
        </div>

        {sourceProtocol ? (
          <PlateLayoutEditor
            plateSize={sourceProtocol.plate_size}
            wells={wells}
            onWellsChange={readOnly ? undefined : setWells}
            readOnly={readOnly}
            originalWells={sourceWells}
            originalPlateSize={sourceProtocol.plate_size}
            lockPlateSize
          />
        ) : (
          <p className="text-body text-foreground-muted">No plate layout data available</p>
        )}
      </div>
    </div>
  );
}

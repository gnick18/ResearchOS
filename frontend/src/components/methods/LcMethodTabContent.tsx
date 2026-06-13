"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lcGradientApi } from "@/lib/local-api";
import type {
  LCGradientColumn,
  LCGradientProtocol,
  LCGradientStep,
  LCIngredient,
  Method,
  Task,
  TaskMethodAttachment,
} from "@/lib/types";
import LcGradientEditor from "@/components/LcGradientEditor";
import { ownerScopedTasksApi } from "@/lib/tasks/owner-scoped-api";
import type { NestedSnapshotAdapter } from "@/lib/methods/nested-snapshot";
import VariationNotesPanel from "./VariationNotesPanel";

interface LcMethodTabContentProps {
  task: Task;
  method: Method;
  methodId: number;
  attachment: TaskMethodAttachment | undefined;
  onTaskUpdate?: (task: Task) => void;
  readOnly?: boolean;
  /** Compound-child mode: write the snapshot into the compound's
   *  `compound_snapshots[child_id]` slot instead of the task's top-level
   *  `lc_gradient` attachment field. See nested-snapshot.ts. */
  nestedSnapshot?: NestedSnapshotAdapter<LCGradientProtocol>;
  hideVariationNotes?: boolean;
  /** PI capability revamp: lab head username when editing a member's task on the role, so writes route to the owner + audit. */
  piActor?: string;
}

function extractLcProtocolId(sourcePath: string): number | null {
  const match = sourcePath.match(/^lc_gradient:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

/** Pulls the snapshot stored on the task's attachment, falling back to the
 *  source protocol when the snapshot has never been written. Mirrors
 *  PcrMethodTabContent's per-field fallback (gradient + ingredients), but
 *  collapsed to a single JSON snapshot here so the contract stays simple:
 *  `attachment.lc_gradient` is either null (use source) or a full snapshot. */
function snapshotOrSource(
  attachment: TaskMethodAttachment | undefined,
  source: LCGradientProtocol | null | undefined,
): LCGradientProtocol | null {
  if (attachment?.lc_gradient) {
    try {
      return JSON.parse(attachment.lc_gradient) as LCGradientProtocol;
    } catch {
      // Fall through to source if the snapshot was corrupted on disk —
      // safer than rendering empty fields and losing context.
    }
  }
  return source ?? null;
}

export default function LcMethodTabContent({
  task,
  method,
  methodId,
  attachment,
  onTaskUpdate,
  readOnly = false,
  nestedSnapshot,
  hideVariationNotes = false,
  piActor,
}: LcMethodTabContentProps) {
  const queryClient = useQueryClient();
  const tasksApi = useMemo(() => ownerScopedTasksApi(task, piActor ? { actor: piActor } : undefined), [task, piActor]);

  const lcProtocolId = method.source_path ? extractLcProtocolId(method.source_path) : null;
  const lcProtocolOwner = method.owner || undefined;

  const { data: fetchedProtocol } = useQuery({
    queryKey: ["lc-gradient", lcProtocolId, lcProtocolOwner],
    queryFn: () => lcGradientApi.get(lcProtocolId!, lcProtocolOwner),
    enabled: lcProtocolId !== null,
  });

  const [gradientSteps, setGradientSteps] = useState<LCGradientStep[]>([]);
  const [column, setColumn] = useState<LCGradientColumn>({});
  const [wavelength, setWavelength] = useState<number | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [ingredients, setIngredients] = useState<LCIngredient[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  // Source-of-truth for "what does the protocol look like before the user
  // touches it on this task". When the task has no snapshot, this IS the
  // editor's starting state. When the task has a snapshot, this is what
  // the diff-display contract compares the live state against.
  const sourceProtocol = fetchedProtocol ?? null;

  // When rendering as a compound child, the parent's nestedSnapshot adapter
  // owns the per-child snapshot; synthesize an attachment-shaped record so
  // the existing seed + diff logic works in both modes.
  const nestedRead = nestedSnapshot?.read;
  const effectiveAttachment: TaskMethodAttachment | undefined = useMemo(() => {
    if (!nestedRead) return attachment;
    const snap = nestedRead();
    return {
      method_id: methodId,
      owner: null,
      pcr_gradient: null,
      pcr_ingredients: null,
      lc_gradient: snap ? JSON.stringify(snap) : null,
      body_override: null,
      plate_annotation: null,
      cell_culture_schedule: null,
      variation_notes: null,
      compound_snapshots: null,
      qpcr_analysis: null,
    };
  }, [nestedRead, attachment, methodId]);

  // Initialize editor state from snapshot if present, else from source.
  useEffect(() => {
    const seed = snapshotOrSource(effectiveAttachment, sourceProtocol);
    if (!seed) {
      // Source not loaded yet AND no snapshot — keep empties; the effect
      // re-runs once fetchedProtocol resolves.
      return;
    }
    setGradientSteps(seed.gradient_steps ?? []);
    setColumn(seed.column ?? {});
    setWavelength(seed.detection_wavelength_nm ?? null);
    setDescription(seed.description ?? null);
    setIngredients(seed.ingredients ?? []);
    setHasUnsavedChanges(false);
    // attachment.lc_gradient is the JSON-stringified snapshot; depending on
    // attachment itself (not just .lc_gradient) keeps us in sync when the
    // task object reference changes via owner-scoped writes.
  }, [effectiveAttachment, sourceProtocol]);

  // The "baseline" for diff-display is the SNAPSHOT if present (so users
  // see "modified from snapshot" after saving once on the task), otherwise
  // the source protocol. PCR's PcrMethodTabContent uses the same logic per
  // attachment-field-or-source fallback. The "original*" props passed to
  // the editor below ALWAYS reference the source — diff-display semantics
  // chosen on the chip spec are "modified from source".
  const editorOriginal = sourceProtocol;

  // Track edit state — compare the live editor state to whatever the editor
  // was last initialized from.
  const lastSeed = useMemo(
    () => snapshotOrSource(effectiveAttachment, sourceProtocol),
    [effectiveAttachment, sourceProtocol],
  );

  useEffect(() => {
    if (!lastSeed) {
      setHasUnsavedChanges(false);
      return;
    }
    const liveSnapshot: LCGradientProtocol = {
      ...lastSeed,
      gradient_steps: gradientSteps,
      column,
      detection_wavelength_nm: wavelength,
      description,
      ingredients,
    };
    setHasUnsavedChanges(JSON.stringify(liveSnapshot) !== JSON.stringify(lastSeed));
  }, [lastSeed, gradientSteps, column, wavelength, description, ingredients]);

  const handleSave = useCallback(async () => {
    if (!sourceProtocol) return;
    setSaving(true);
    try {
      const snapshot: LCGradientProtocol = {
        ...sourceProtocol,
        gradient_steps: gradientSteps,
        column,
        detection_wavelength_nm: wavelength,
        description,
        ingredients,
      };
      if (nestedSnapshot) {
        await nestedSnapshot.write(snapshot);
        setHasUnsavedChanges(false);
      } else {
        const updatedTask = await tasksApi.updateMethodLc(task.id, methodId, {
          lc_gradient: JSON.stringify(snapshot),
        });
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", task.id] });
        setHasUnsavedChanges(false);
        if (updatedTask) onTaskUpdate?.(updatedTask);
      }
    } catch (err) {
      console.error("Failed to save LC changes:", err);
      alert("Failed to save LC changes");
    } finally {
      setSaving(false);
    }
  }, [
    task.id,
    methodId,
    sourceProtocol,
    gradientSteps,
    column,
    wavelength,
    description,
    ingredients,
    queryClient,
    onTaskUpdate,
    tasksApi,
    nestedSnapshot,
  ]);

  const handleReset = useCallback(async () => {
    if (!confirm("Reset LC data to match the original method? Your changes will be lost.")) return;
    setSaving(true);
    try {
      if (nestedSnapshot) {
        await nestedSnapshot.reset();
      } else {
        const updatedTask = await tasksApi.resetLc(task.id, methodId);
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", task.id] });
        if (updatedTask) onTaskUpdate?.(updatedTask);
      }
    } catch (err) {
      console.error("Failed to reset LC:", err);
      alert("Failed to reset LC data");
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
              {method.name || "LC Gradient"}
            </span>
            <span className="text-meta px-1.5 py-0.5 bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-300 rounded">LC</span>
          </div>
          {!readOnly && (
            <div className="flex items-center gap-2">
              {hasUnsavedChanges && (
                <span className="text-meta text-amber-600 dark:text-amber-300">Unsaved changes</span>
              )}
              <button
                onClick={handleReset}
                disabled={saving}
                className="px-3 py-1.5 text-meta bg-surface-sunken text-foreground-muted rounded-lg hover:bg-foreground-muted/15 disabled:opacity-50"
                title="Reset to original method values"
              >
                Reset to Method
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !hasUnsavedChanges}
                className="px-3 py-1.5 text-meta text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          )}
        </div>

        {sourceProtocol ? (
          <LcGradientEditor
            gradientSteps={gradientSteps}
            onGradientStepsChange={readOnly ? undefined : setGradientSteps}
            column={column}
            onColumnChange={readOnly ? undefined : setColumn}
            detectionWavelengthNm={wavelength}
            onDetectionWavelengthChange={readOnly ? undefined : setWavelength}
            description={description}
            onDescriptionChange={readOnly ? undefined : setDescription}
            ingredients={ingredients}
            onIngredientsChange={readOnly ? undefined : setIngredients}
            readOnly={readOnly}
            originalGradientSteps={editorOriginal?.gradient_steps}
            originalColumn={editorOriginal?.column}
            originalDetectionWavelengthNm={editorOriginal?.detection_wavelength_nm ?? null}
            originalDescription={editorOriginal?.description ?? null}
            originalIngredients={editorOriginal?.ingredients}
          />
        ) : (
          <p className="text-body text-foreground-muted">No LC gradient data available</p>
        )}
      </div>
    </div>
  );
}

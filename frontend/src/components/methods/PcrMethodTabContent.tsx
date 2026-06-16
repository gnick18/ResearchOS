"use client";

import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pcrApi } from "@/lib/local-api";
import type {
  Method,
  PCRGradient,
  PCRIngredient,
  PCRSnapshotPayload,
  Task,
  TaskMethodAttachment,
} from "@/lib/types";
import { InteractiveGradientEditor } from "@/components/InteractiveGradientEditor";
import { ownerScopedTasksApi } from "@/lib/tasks/owner-scoped-api";
import type { NestedSnapshotAdapter } from "@/lib/methods/nested-snapshot";
import Tooltip from "@/components/Tooltip";
import {
  ADDED_ROW_CLASSES,
  MODIFIED_BADGE_CLASSES,
  MODIFIED_CELL_CLASSES,
  MODIFIED_CHIP_TEXT,
  REMOVED_ROW_CLASSES,
  originalValueTooltip,
} from "@/lib/methods/diff-display";
import VariationNotesPanel from "./VariationNotesPanel";

interface PcrMethodTabContentProps {
  task: Task;
  method: Method;
  methodId: number;
  attachment: TaskMethodAttachment | undefined;
  onTaskUpdate?: (task: Task) => void;
  readOnly?: boolean;
  /** Compound-child mode: write the snapshot (gradient + ingredients
   *  bundled into a PCRSnapshotPayload) into the compound's
   *  `compound_snapshots[child_id]` slot instead of the task's top-level
   *  `pcr_gradient` + `pcr_ingredients` attachment fields. */
  nestedSnapshot?: NestedSnapshotAdapter<PCRSnapshotPayload>;
  hideVariationNotes?: boolean;
  /** PI capability revamp: lab head username when editing a member's task on the role, so writes route to the owner + audit. */
  piActor?: string;
}

// Extract PCR protocol ID from source_path like "pcr://protocol/123".
function extractPCRProtocolId(sourcePath: string): number | null {
  const match = sourcePath.match(/^pcr:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

export default function PcrMethodTabContent({
  task,
  method,
  methodId,
  attachment,
  onTaskUpdate,
  readOnly = false,
  nestedSnapshot,
  hideVariationNotes = false,
  piActor,
}: PcrMethodTabContentProps) {
  const queryClient = useQueryClient();
  // Receivers editing a shared task with `edit` permission must route every
  // mutation back to the OWNER's directory. Without this wrapper, direct
  // calls default to the current user's namespace and silently fork the
  // task on disk (orphan write under users/{receiver}/tasks/...).
  const tasksApi = useMemo(() => ownerScopedTasksApi(task, piActor ? { actor: piActor } : undefined), [task, piActor]);

  const pcrProtocolId = method.source_path ? extractPCRProtocolId(method.source_path) : null;

  // Per-user id spaces mean a numeric protocol id alone is ambiguous:
  // alex's private pcr_protocols/1 and public pcr_protocols/1 are different
  // records. The protocol lives in the SAME namespace as the method that
  // references it (a method's `source_path: "pcr://protocol/{id}"` is a
  // relative reference within the method's own user dir), so we thread the
  // method's owner through.
  const pcrProtocolOwner = method.owner || undefined;
  const { data: fetchedPcrProtocol } = useQuery({
    queryKey: ["pcr-protocol", pcrProtocolId, pcrProtocolOwner],
    queryFn: () => pcrApi.get(pcrProtocolId!, pcrProtocolOwner),
    enabled: pcrProtocolId !== null,
  });

  const [pcrGradient, setPcrGradient] = useState<PCRGradient | null>(null);
  const [pcrIngredients, setPcrIngredients] = useState<PCRIngredient[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  // Synthesize an attachment-shaped record from the nested-snapshot adapter
  // when this viewer is rendering as a compound child, so the existing
  // attachment-or-source fallback logic works unchanged in both modes.
  const nestedRead = nestedSnapshot?.read;
  const effectiveAttachment: TaskMethodAttachment | undefined = useMemo(() => {
    if (!nestedRead) return attachment;
    const snap = nestedRead();
    return {
      method_id: methodId,
      owner: null,
      pcr_gradient: snap?.pcr_gradient ? JSON.stringify(snap.pcr_gradient) : null,
      pcr_ingredients: snap?.pcr_ingredients ? JSON.stringify(snap.pcr_ingredients) : null,
      lc_gradient: null,
      body_override: null,
      plate_annotation: null,
      cell_culture_schedule: null,
      variation_notes: null,
      compound_snapshots: null,
      qpcr_analysis: null,
    };
  }, [nestedRead, attachment, methodId]);

  // Initialize PCR state from attachment, falling back to the source protocol
  // for any field the attachment doesn't override. `method_attachments` entries
  // typically only carry `{method_id, owner, snapshot_at}` until the user edits
  // the gradient/recipe inside the task; without the fallback the table renders
  // empty even though the protocol on disk has real data.
  useEffect(() => {
    if (effectiveAttachment?.pcr_gradient) {
      try {
        setPcrGradient(JSON.parse(effectiveAttachment.pcr_gradient));
      } catch {
        setPcrGradient(fetchedPcrProtocol?.gradient ?? null);
      }
    } else if (fetchedPcrProtocol) {
      setPcrGradient(fetchedPcrProtocol.gradient ?? null);
    } else if (!effectiveAttachment) {
      setPcrGradient(null);
    }

    if (effectiveAttachment?.pcr_ingredients) {
      try {
        const parsed = JSON.parse(effectiveAttachment.pcr_ingredients);
        setPcrIngredients(Array.isArray(parsed) ? parsed : []);
      } catch {
        setPcrIngredients(
          Array.isArray(fetchedPcrProtocol?.ingredients) ? fetchedPcrProtocol!.ingredients : []
        );
      }
    } else if (fetchedPcrProtocol) {
      setPcrIngredients(
        Array.isArray(fetchedPcrProtocol.ingredients) ? fetchedPcrProtocol.ingredients : []
      );
    } else if (!effectiveAttachment) {
      setPcrIngredients([]);
    }

    setHasUnsavedChanges(false);
  }, [effectiveAttachment, fetchedPcrProtocol]);

  // Track PCR changes — original = attachment override if present, otherwise
  // the source protocol value. Without this fallback, `hasUnsavedChanges`
  // always evaluates against null/[] and the Save button reports false
  // negatives when only the protocol-defined baseline is loaded.
  const originalPcrGradient = useMemo(() => {
    if (effectiveAttachment?.pcr_gradient) {
      try {
        return JSON.parse(effectiveAttachment.pcr_gradient);
      } catch {
        return fetchedPcrProtocol?.gradient ?? null;
      }
    }
    return fetchedPcrProtocol?.gradient ?? null;
  }, [effectiveAttachment?.pcr_gradient, fetchedPcrProtocol]);

  const originalPcrIngredients = useMemo(() => {
    if (effectiveAttachment?.pcr_ingredients) {
      try {
        const parsed = JSON.parse(effectiveAttachment.pcr_ingredients);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return Array.isArray(fetchedPcrProtocol?.ingredients) ? fetchedPcrProtocol!.ingredients : [];
      }
    }
    return Array.isArray(fetchedPcrProtocol?.ingredients) ? fetchedPcrProtocol.ingredients : [];
  }, [effectiveAttachment?.pcr_ingredients, fetchedPcrProtocol]);

  // Source-of-truth — the canonical method as defined under the owner's
  // pcr_protocols/{id}. Distinct from `originalPcr*` above: those fold in
  // any prior snapshot so the Save button can detect *new* live edits.
  // `sourcePcr*` is always the unmodified source, used to drive the
  // diff-display chip + per-cell highlighting. Mirrors LC's `sourceProtocol`
  // contract.
  const sourcePcrGradient = fetchedPcrProtocol?.gradient ?? null;
  const sourcePcrIngredients = useMemo(
    () =>
      Array.isArray(fetchedPcrProtocol?.ingredients)
        ? fetchedPcrProtocol.ingredients
        : [],
    [fetchedPcrProtocol],
  );

  // "Modified from source" — true when the live state (which equals the
  // snapshot when no unsaved edits) diverges from the canonical method.
  // Survives a save: persists across reloads because the chip is computed
  // from `pcrGradient` (initialized from `attachment.pcr_gradient`) vs
  // `sourcePcrGradient` (always the source). Without this, the chip would
  // only flicker while editing and disappear after save.
  const isModifiedFromSource = useMemo(() => {
    if (!sourcePcrGradient) return false;
    if (!pcrGradient) return false;
    if (JSON.stringify(pcrGradient) !== JSON.stringify(sourcePcrGradient)) return true;
    if (JSON.stringify(pcrIngredients) !== JSON.stringify(sourcePcrIngredients)) return true;
    return false;
  }, [pcrGradient, pcrIngredients, sourcePcrGradient, sourcePcrIngredients]);

  useEffect(() => {
    if (pcrGradient && originalPcrGradient) {
      setHasUnsavedChanges(
        JSON.stringify(pcrGradient) !== JSON.stringify(originalPcrGradient) ||
        JSON.stringify(pcrIngredients) !== JSON.stringify(originalPcrIngredients)
      );
    }
  }, [pcrGradient, pcrIngredients, originalPcrGradient, originalPcrIngredients]);

  const handleSavePcrChanges = useCallback(async () => {
    if (!pcrGradient || !pcrIngredients) return;
    setSaving(true);
    try {
      if (nestedSnapshot) {
        await nestedSnapshot.write({
          pcr_gradient: pcrGradient,
          pcr_ingredients: pcrIngredients,
        });
        setHasUnsavedChanges(false);
      } else {
        const updatedTask = await tasksApi.updateMethodPcr(task.id, methodId, {
          pcr_gradient: JSON.stringify(pcrGradient),
          pcr_ingredients: JSON.stringify(pcrIngredients),
        });
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", task.id] });
        setHasUnsavedChanges(false);
        if (updatedTask) onTaskUpdate?.(updatedTask);
      }
    } catch (err) {
      console.error("Failed to save PCR changes:", err);
      alert("Failed to save PCR changes");
    } finally {
      setSaving(false);
    }
  }, [task.id, methodId, pcrGradient, pcrIngredients, queryClient, onTaskUpdate, tasksApi, nestedSnapshot]);

  const handleResetPcr = useCallback(async () => {
    if (!confirm("Reset PCR data to match the original method? Your changes will be lost.")) return;
    setSaving(true);
    try {
      if (nestedSnapshot) {
        await nestedSnapshot.reset();
      } else {
        const updatedTask = await tasksApi.resetPcr(task.id, methodId);
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", task.id] });
        if (updatedTask) onTaskUpdate?.(updatedTask);
      }
    } catch (err) {
      console.error("Failed to reset PCR:", err);
      alert("Failed to reset PCR data");
    } finally {
      setSaving(false);
    }
  }, [task.id, methodId, queryClient, onTaskUpdate, tasksApi, nestedSnapshot]);

  return (
    <div className="flex flex-col h-full">
      {/* Variation Notes Panel */}
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
        {/* PCR header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-body font-medium text-foreground">{method.name || "PCR Protocol"}</span>
            <span className="text-meta px-1.5 py-0.5 bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-300 rounded">PCR</span>
            {isModifiedFromSource && (
              <span className={MODIFIED_BADGE_CLASSES}>{MODIFIED_CHIP_TEXT}</span>
            )}
          </div>
          {/* Save/Reset buttons - hidden in readOnly mode */}
          {!readOnly && (
            <div className="flex items-center gap-2">
              {hasUnsavedChanges && (
                <span className="text-meta text-amber-600 dark:text-amber-300">Unsaved changes</span>
              )}
              <button
                onClick={handleResetPcr}
                disabled={saving}
                className="ros-btn-neutral px-3 py-1.5 text-meta text-foreground-muted disabled:opacity-50"
                title="Reset to original method values"
              >
                Reset to Method
              </button>
              <button
                onClick={handleSavePcrChanges}
                disabled={saving || !hasUnsavedChanges}
                className="px-3 py-1.5 text-meta text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          )}
        </div>

        {/* Gradient Visualization */}
        <div>
          <label className="block text-meta font-medium text-foreground-muted mb-2">
            Thermal Gradient
          </label>
          {pcrGradient ? (
            <InteractiveGradientEditor
              gradient={pcrGradient}
              onChange={(g) => {
                setPcrGradient(g);
              }}
              sourceGradient={sourcePcrGradient}
            />
          ) : (
            <p className="text-body text-foreground-muted">No gradient data available</p>
          )}
        </div>

        {/* Recipe Table */}
        <div>
          <label className="block text-meta font-medium text-foreground-muted mb-2">
            Reaction Recipe
          </label>
          <PCRRecipeTable
            ingredients={pcrIngredients}
            onChange={(ing) => {
              setPcrIngredients(ing);
            }}
            editable={!readOnly}
            sourceIngredients={sourcePcrIngredients}
          />
        </div>

        {/* Notes */}
        {fetchedPcrProtocol?.notes && (
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">Notes</label>
            <p className="text-body text-foreground-muted whitespace-pre-wrap">
              {fetchedPcrProtocol.notes}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── PCR Recipe Table Component ───────────────────────────────────────────────

function PCRRecipeTable({
  ingredients,
  onChange,
  editable,
  sourceIngredients,
}: {
  ingredients: PCRIngredient[];
  onChange?: (ingredients: PCRIngredient[]) => void;
  editable: boolean;
  /** Source-of-truth ingredients (the canonical method's recipe). When set,
   *  per-cell highlighting + tooltips kick in: modified cells get
   *  MODIFIED_CELL_CLASSES, added rows (no matching source id) get
   *  ADDED_ROW_CLASSES, and source rows missing from live render as faint
   *  strikethrough ghost rows below. When omitted (standalone /pcr builder
   *  has no source), behavior is byte-identical to today. */
  sourceIngredients?: PCRIngredient[];
}) {
  const sourceById = useMemo(() => {
    const map = new Map<string, PCRIngredient>();
    if (sourceIngredients) {
      for (const ing of sourceIngredients) map.set(ing.id, ing);
    }
    return map;
  }, [sourceIngredients]);
  const liveIds = useMemo(() => new Set(ingredients.map((i) => i.id)), [ingredients]);
  const removedSourceIngredients = useMemo(() => {
    if (!sourceIngredients) return [];
    // Filter out the auto-computed Total row — it gets re-derived from
    // visible ingredients, so a missing Total in live isn't a real "deletion".
    return sourceIngredients.filter(
      (s) => !liveIds.has(s.id) && s.name !== "Total",
    );
  }, [sourceIngredients, liveIds]);

  const handleChange = (id: string, field: keyof PCRIngredient, value: string | boolean) => {
    if (!onChange) return;
    onChange(
      ingredients.map((ing) =>
        ing.id === id ? { ...ing, [field]: value } : ing
      )
    );
  };

  const toggleChecked = (id: string) => {
    if (!onChange) return;
    onChange(
      ingredients.map((ing) =>
        ing.id === id ? { ...ing, checked: !ing.checked } : ing
      )
    );
  };

  const addRow = () => {
    if (!onChange) return;
    const newId = String(Date.now());
    // Insert before Total row if it exists
    const totalIndex = ingredients.findIndex((ing) => ing.name === "Total");
    if (totalIndex >= 0) {
      const newIngredients = [
        ...ingredients.slice(0, totalIndex),
        { id: newId, name: "", concentration: "", amount_per_reaction: "", checked: false },
        ...ingredients.slice(totalIndex),
      ];
      onChange(newIngredients);
    } else {
      onChange([
        ...ingredients,
        { id: newId, name: "", concentration: "", amount_per_reaction: "", checked: false },
      ]);
    }
  };

  const removeRow = (id: string) => {
    if (!onChange) return;
    // Don't remove if it's the Total row
    const ing = ingredients.find((i) => i.id === id);
    if (ing?.name === "Total") return;
    onChange(ingredients.filter((i) => i.id !== id));
  };

  // Count checked items (excluding Total row)
  const checkedCount = ingredients.filter(ing => ing.name !== "Total" && ing.checked).length;
  const totalCount = ingredients.filter(ing => ing.name !== "Total").length;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Progress indicator */}
      {totalCount > 0 && (
        <div className="bg-surface-sunken px-3 py-2 border-b border-border flex items-center gap-2">
          <div className="flex-1 h-2 bg-foreground-muted/15 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-300"
              style={{ width: `${(checkedCount / totalCount) * 100}%` }}
            />
          </div>
          <span className="text-meta text-foreground-muted flex-shrink-0">
            {checkedCount}/{totalCount} checked
          </span>
        </div>
      )}
      <table className="w-full text-body">
        <thead className="bg-surface-sunken">
          <tr>
            <th className="px-2 py-2 w-10 text-center text-meta font-medium text-foreground-muted" title="Check off ingredients as you add them">✓</th>
            <th className="px-3 py-2 text-left text-meta font-medium text-foreground-muted">Ingredient</th>
            <th className="px-3 py-2 text-left text-meta font-medium text-foreground-muted">Concentration</th>
            <th className="px-3 py-2 text-left text-meta font-medium text-foreground-muted">Amount (uL)</th>
            {editable && <th className="px-3 py-2 w-10"></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {ingredients.map((ing) => {
            const isTotal = ing.name === "Total";
            const orig = sourceById.get(ing.id);
            // The Total row is auto-derived; skip diff display entirely
            // for it so the math row never glows amber.
            const diffActive = !!sourceIngredients && !isTotal;
            const isAdded = diffActive && !orig;
            const cellModified = (field: keyof PCRIngredient): boolean => {
              if (!diffActive || !orig) return false;
              return (ing[field] ?? "") !== (orig[field] ?? "");
            };
            const cellTooltipLabel = (field: keyof PCRIngredient): string | undefined => {
              if (!cellModified(field) || !orig) return undefined;
              return originalValueTooltip(String(orig[field] ?? "(empty)"));
            };
            const rowDiffClass = isAdded ? ADDED_ROW_CLASSES : "";
            return (
              <tr
                key={ing.id}
                className={`${isTotal ? "bg-surface-sunken font-medium" : ""} ${ing.checked && !isTotal ? "bg-green-50 dark:bg-green-500/10" : ""} ${rowDiffClass} transition-colors`}
              >
                <td className="px-2 py-2 text-center">
                  {!isTotal && (
                    <Tooltip label={ing.checked ? "Mark as not added" : "Mark as added"} placement="bottom">
                      <button
                        onClick={() => toggleChecked(ing.id)}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                          ing.checked
                            ? "bg-green-500 border-green-500 text-white"
                            : "border-border hover:border-green-400 hover:bg-green-50 dark:hover:bg-green-500/10"
                        }`}
                      >
                        {ing.checked && (
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    </Tooltip>
                  )}
                </td>
                <DiffCell
                  modified={cellModified("name")}
                  tooltipLabel={cellTooltipLabel("name")}
                >
                  {editable && !isTotal ? (
                    <input
                      type="text"
                      value={ing.name}
                      onChange={(e) => handleChange(ing.id, "name", e.target.value)}
                      className={`w-full px-2 py-1 border border-border rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-500 ${ing.checked ? "line-through text-foreground-muted" : ""}`}
                    />
                  ) : (
                    <span className={`text-foreground ${ing.checked ? "line-through text-foreground-muted" : ""}`}>{ing.name}</span>
                  )}
                </DiffCell>
                <DiffCell
                  modified={cellModified("concentration")}
                  tooltipLabel={cellTooltipLabel("concentration")}
                >
                  {editable && !isTotal ? (
                    <input
                      type="text"
                      value={ing.concentration}
                      onChange={(e) => handleChange(ing.id, "concentration", e.target.value)}
                      className={`w-full px-2 py-1 border border-border rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-500 ${ing.checked ? "line-through text-foreground-muted" : ""}`}
                      placeholder="e.g. 10x"
                    />
                  ) : (
                    <span className={`text-foreground-muted ${ing.checked ? "line-through text-foreground-muted" : ""}`}>{ing.concentration || "-"}</span>
                  )}
                </DiffCell>
                <DiffCell
                  modified={cellModified("amount_per_reaction")}
                  tooltipLabel={cellTooltipLabel("amount_per_reaction")}
                >
                  {editable ? (
                    <input
                      type="text"
                      value={ing.amount_per_reaction}
                      onChange={(e) => handleChange(ing.id, "amount_per_reaction", e.target.value)}
                      className={`w-full px-2 py-1 border border-border rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-500 ${ing.checked ? "line-through text-foreground-muted" : ""}`}
                      placeholder="e.g. 2.5"
                    />
                  ) : (
                    <span className={`text-foreground-muted ${ing.checked ? "line-through text-foreground-muted" : ""}`}>{ing.amount_per_reaction || "-"}</span>
                  )}
                </DiffCell>
                {editable && !isTotal && (
                  <td className="px-3 py-2">
                    <Tooltip label="Remove ingredient" placement="left">
                      <button
                        onClick={() => removeRow(ing.id)}
                        className="text-foreground-muted hover:text-red-500"
                      >
                        x
                      </button>
                    </Tooltip>
                  </td>
                )}
              </tr>
            );
          })}
          {/* Ghost rows for ingredients in source but not in live. Matches
              LC's removed-row affordance: faint, strikethrough, no editing
              affordances. */}
          {removedSourceIngredients.map((ing) => (
            <tr key={`removed-${ing.id}`} className={REMOVED_ROW_CLASSES}>
              <td className="px-2 py-2" />
              <td className="px-3 py-2 text-foreground">{ing.name}</td>
              <td className="px-3 py-2 text-foreground-muted">{ing.concentration || "-"}</td>
              <td className="px-3 py-2 text-foreground-muted">{ing.amount_per_reaction || "-"}</td>
              {editable && <td className="px-3 py-2" />}
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <button
          onClick={addRow}
          className="w-full py-2 text-meta text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-brand-action/10 border-t border-border"
        >
          + Add Row
        </button>
      )}
    </div>
  );
}

// ── Diff-display helper for recipe-table cells ──────────────────────────────
//
// Wraps a single child (typically an <input> or <span>) inside a <td>. Adds
// the MODIFIED_CELL_CLASSES amber background when `modified` is true, and a
// <Tooltip> revealing the original source value when `tooltipLabel` is set.
// Matches the per-cell pattern in LcGradientEditor (StepRow + IngredientRow)
// while keeping the JSX in PCRRecipeTable readable.
function DiffCell({
  modified,
  tooltipLabel,
  children,
}: {
  modified: boolean;
  tooltipLabel?: string;
  children: ReactElement<Record<string, unknown>>;
}) {
  return (
    <td className={`px-3 py-2 ${modified ? MODIFIED_CELL_CLASSES : ""}`}>
      {tooltipLabel ? (
        <Tooltip label={tooltipLabel} placement="top">
          {children}
        </Tooltip>
      ) : (
        children
      )}
    </td>
  );
}

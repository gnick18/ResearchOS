"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { qpcrAnalysisApi } from "@/lib/local-api";
import type {
  Method,
  QPCRAnalysisProtocol,
  QPCRAnalysisSnapshot,
  Task,
  TaskMethodAttachment,
} from "@/lib/types";
import Tooltip from "@/components/Tooltip";
import QpcrAnalysisViz from "@/components/QpcrAnalysisViz";
import {
  MODIFIED_BADGE_CLASSES,
  MODIFIED_CHIP_TEXT,
} from "@/lib/methods/diff-display";
import { ownerScopedTasksApi } from "@/lib/tasks/owner-scoped-api";
import type { NestedSnapshotAdapter } from "@/lib/methods/nested-snapshot";
import VariationNotesPanel from "./VariationNotesPanel";

/**
 * Per-task experiment-page surface for a qPCR analysis method.
 *
 * Unlike LC / cell-culture, the qPCR analysis method's per-task state is
 * the EXPERIMENT DATA: Cq readouts, optional per-target replicates, melt-
 * curve Tm values, computed fold-change. The source method record carries
 * the protocol template (target list, reference assignment, ΔΔCq toggle);
 * this surface lets the user enter the per-run readouts and see the
 * downstream calculations.
 *
 * Layout:
 *  1. Variation-notes panel (top, suppressed in compound-child mode)
 *  2. "Per-target Cq readouts" entry table — one row per target on the
 *     protocol's references list. Editor writes mean Cq + optional melt Tm.
 *  3. QpcrAnalysisViz — recharts Cq bar chart, optional standard-curve plot
 *     from the source protocol, ΔΔCq fold-change table when applicable.
 */
interface QpcrAnalysisMethodTabContentProps {
  task: Task;
  method: Method;
  methodId: number;
  attachment: TaskMethodAttachment | undefined;
  onTaskUpdate?: (task: Task) => void;
  readOnly?: boolean;
  /** Compound-child mode: route the snapshot into the parent compound's
   *  `compound_snapshots[child_id]` slot. Snapshot shape is QPCRAnalysisSnapshot. */
  nestedSnapshot?: NestedSnapshotAdapter<QPCRAnalysisSnapshot>;
  hideVariationNotes?: boolean;
  /** PI capability revamp: lab head username when editing a member's task on the role, so writes route to the owner + audit. */
  piActor?: string;
}

function extractQpcrAnalysisId(sourcePath: string): number | null {
  const match = sourcePath.match(/^qpcr_analysis:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

function parseSnapshot(att: TaskMethodAttachment | undefined): QPCRAnalysisSnapshot | null {
  if (!att?.qpcr_analysis) return null;
  try {
    const parsed = JSON.parse(att.qpcr_analysis);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      cqs: parsed.cqs && typeof parsed.cqs === "object" ? parsed.cqs : {},
      melt_tms:
        parsed.melt_tms && typeof parsed.melt_tms === "object" ? parsed.melt_tms : undefined,
      notes: typeof parsed.notes === "string" ? parsed.notes : null,
    };
  } catch {
    return null;
  }
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return String(n);
}

function parseNum(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function QpcrAnalysisMethodTabContent({
  task,
  method,
  methodId,
  attachment,
  onTaskUpdate,
  readOnly = false,
  nestedSnapshot,
  hideVariationNotes = false,
  piActor,
}: QpcrAnalysisMethodTabContentProps) {
  const queryClient = useQueryClient();
  const tasksApi = useMemo(() => ownerScopedTasksApi(task, piActor ? { actor: piActor } : undefined), [task, piActor]);

  const protocolId = method.source_path ? extractQpcrAnalysisId(method.source_path) : null;
  const protocolOwner = method.owner || undefined;

  const { data: fetchedProtocol } = useQuery({
    queryKey: ["qpcr-analysis", protocolId, protocolOwner],
    queryFn: () => qpcrAnalysisApi.get(protocolId!, protocolOwner),
    enabled: protocolId !== null,
  });

  const sourceProtocol: QPCRAnalysisProtocol | null = fetchedProtocol ?? null;
  const nestedRead = nestedSnapshot?.read;
  const baselineSnapshot = useMemo<QPCRAnalysisSnapshot | null>(() => {
    if (nestedRead) return nestedRead();
    return parseSnapshot(attachment);
  }, [nestedRead, attachment]);

  // Local editable state.
  const [cqs, setCqs] = useState<QPCRAnalysisSnapshot["cqs"]>({});
  const [meltTms, setMeltTms] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCqs(baselineSnapshot?.cqs ?? {});
    setMeltTms(baselineSnapshot?.melt_tms ?? {});
    setNotes(baselineSnapshot?.notes ?? null);
    setHasUnsavedChanges(false);
  }, [baselineSnapshot]);

  // Live snapshot for the viz panel — re-build on every keystroke so the
  // bars + ΔΔCq table update immediately.
  const liveSnapshot = useMemo<QPCRAnalysisSnapshot>(() => {
    const trimmedMelts = Object.fromEntries(
      Object.entries(meltTms).filter(([, v]) => Number.isFinite(v)),
    );
    return {
      cqs,
      melt_tms: Object.keys(trimmedMelts).length > 0 ? trimmedMelts : undefined,
      notes,
    };
  }, [cqs, meltTms, notes]);

  useEffect(() => {
    const baseline = baselineSnapshot;
    const same =
      JSON.stringify(liveSnapshot.cqs) === JSON.stringify(baseline?.cqs ?? {}) &&
      JSON.stringify(liveSnapshot.melt_tms ?? {}) === JSON.stringify(baseline?.melt_tms ?? {}) &&
      (liveSnapshot.notes ?? "") === (baseline?.notes ?? "");
    setHasUnsavedChanges(!same);
  }, [liveSnapshot, baselineSnapshot]);

  const hasReadouts =
    Object.values(cqs).some((c) => Number.isFinite(c.cq)) ||
    Object.values(meltTms).some((v) => Number.isFinite(v));

  const updateCq = useCallback((refId: string, cq: number | null) => {
    setCqs((prev) => {
      const next = { ...prev };
      if (cq === null) {
        delete next[refId];
      } else {
        next[refId] = { ...(next[refId] ?? {}), cq };
      }
      return next;
    });
  }, []);

  const updateNoteForTarget = useCallback((refId: string, text: string) => {
    setCqs((prev) => {
      const next = { ...prev };
      if (!next[refId]) {
        if (!text) return prev;
        next[refId] = { cq: NaN as unknown as number, notes: text };
      } else {
        next[refId] = { ...next[refId], notes: text || null };
      }
      return next;
    });
  }, []);

  const updateMeltTm = useCallback((refId: string, tm: number | null) => {
    setMeltTms((prev) => {
      const next = { ...prev };
      if (tm === null) {
        delete next[refId];
      } else {
        next[refId] = tm;
      }
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!sourceProtocol) return;
    setSaving(true);
    try {
      // Drop rows that have neither a Cq nor a note — keeps the on-disk JSON
      // tidy. Renaming on save once is cheaper than every render.
      const cleanCqs: QPCRAnalysisSnapshot["cqs"] = {};
      for (const [refId, entry] of Object.entries(cqs)) {
        if (Number.isFinite(entry.cq) || (entry.notes && entry.notes.length > 0)) {
          cleanCqs[refId] = {
            cq: Number.isFinite(entry.cq) ? entry.cq : 0,
            ...(entry.notes ? { notes: entry.notes } : {}),
          };
        }
      }
      const snapshot: QPCRAnalysisSnapshot = {
        cqs: cleanCqs,
        ...(Object.keys(meltTms).length > 0 ? { melt_tms: meltTms } : {}),
        ...(notes ? { notes } : {}),
      };
      if (nestedSnapshot) {
        await nestedSnapshot.write(snapshot);
        setHasUnsavedChanges(false);
      } else {
        const updatedTask = await tasksApi.updateMethodQpcrAnalysis(task.id, methodId, {
          qpcr_analysis: JSON.stringify(snapshot),
        });
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", task.id] });
        setHasUnsavedChanges(false);
        if (updatedTask) onTaskUpdate?.(updatedTask);
      }
    } catch (err) {
      console.error("Failed to save qPCR analysis snapshot:", err);
      alert("Failed to save qPCR analysis snapshot");
    } finally {
      setSaving(false);
    }
  }, [
    task.id,
    methodId,
    sourceProtocol,
    cqs,
    meltTms,
    notes,
    queryClient,
    onTaskUpdate,
    tasksApi,
    nestedSnapshot,
  ]);

  const handleReset = useCallback(async () => {
    if (!confirm("Reset qPCR readouts for this experiment? Your entered Cq values will be lost.")) {
      return;
    }
    setSaving(true);
    try {
      if (nestedSnapshot) {
        await nestedSnapshot.reset();
      } else {
        const updatedTask = await tasksApi.resetQpcrAnalysis(task.id, methodId);
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", task.id] });
        if (updatedTask) onTaskUpdate?.(updatedTask);
      }
    } catch (err) {
      console.error("Failed to reset qPCR analysis:", err);
      alert("Failed to reset qPCR analysis");
    } finally {
      setSaving(false);
    }
  }, [task.id, methodId, queryClient, onTaskUpdate, tasksApi, nestedSnapshot]);

  const meltCurveEnabled = sourceProtocol?.melt_curve != null;

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
              {method.name || "qPCR analysis"}
            </span>
            <span className="text-meta px-1.5 py-0.5 bg-surface-sunken text-foreground-muted rounded">qPCR</span>
            {hasReadouts && (
              <span className={MODIFIED_BADGE_CLASSES}>{MODIFIED_CHIP_TEXT}</span>
            )}
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
                title="Reset to empty readouts"
              >
                Reset readouts
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
          <>
            {/* Per-target Cq readouts table */}
            <div>
              <h3 className="text-body font-semibold text-foreground mb-1">
                Per-target Cq readouts for this run
              </h3>
              <p className="text-meta text-foreground-muted mb-3">
                Enter the measured Cq for each target. The reference target&rsquo;s row drives the
                ΔΔCq fold-change column in the visualization below.
              </p>
              {sourceProtocol.references.length === 0 ? (
                <p className="text-body text-foreground-muted">
                  No targets defined on this method yet — edit the protocol via /methods to add targets.
                </p>
              ) : (
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-meta">
                    <thead className="bg-surface-sunken">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-medium text-foreground-muted">Target</th>
                        <th className="px-3 py-1.5 text-left font-medium text-foreground-muted w-20">Channel</th>
                        <th className="px-3 py-1.5 text-left font-medium text-foreground-muted w-24">Cq</th>
                        {meltCurveEnabled && (
                          <th className="px-3 py-1.5 text-left font-medium text-foreground-muted w-24">Tm (°C)</th>
                        )}
                        <th className="px-3 py-1.5 text-left font-medium text-foreground-muted">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sourceProtocol.references.map((ref, idx) => (
                        <tr key={ref.id} className={idx % 2 === 0 ? "bg-surface-raised" : "bg-surface-sunken"}>
                          <td className="px-3 py-1">
                            <span className="font-medium text-foreground">{ref.target || "(unnamed)"}</span>
                            {ref.is_reference && (
                              <span className="ml-1.5 text-meta px-1.5 py-0.5 border border-border text-foreground-muted rounded">
                                ref
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1 text-foreground-muted">{ref.channel}</td>
                          <td className="px-3 py-1">
                            <input
                              type="number"
                              step="0.01"
                              value={fmtNum(cqs[ref.id]?.cq)}
                              onChange={(e) => updateCq(ref.id, parseNum(e.target.value))}
                              readOnly={readOnly}
                              placeholder="—"
                              className="w-full px-2 py-1 border border-border rounded"
                            />
                          </td>
                          {meltCurveEnabled && (
                            <td className="px-3 py-1">
                              <input
                                type="number"
                                step="0.1"
                                value={fmtNum(meltTms[ref.id])}
                                onChange={(e) => updateMeltTm(ref.id, parseNum(e.target.value))}
                                readOnly={readOnly}
                                placeholder="—"
                                className="w-full px-2 py-1 border border-border rounded"
                              />
                            </td>
                          )}
                          <td className="px-3 py-1">
                            <input
                              type="text"
                              value={cqs[ref.id]?.notes ?? ""}
                              onChange={(e) => updateNoteForTarget(ref.id, e.target.value)}
                              readOnly={readOnly}
                              placeholder={ref.is_reference ? "housekeeping baseline" : "—"}
                              className="w-full px-2 py-1 border border-border rounded"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <label className="block mt-3 text-meta text-foreground-muted space-y-1">
                <span>Run notes</span>
                <textarea
                  value={notes ?? ""}
                  onChange={(e) => setNotes(e.target.value || null)}
                  readOnly={readOnly}
                  rows={2}
                  placeholder="e.g. NTC came up at Cq 36, well A1 showed primer-dimer in the melt curve."
                  className="w-full px-2 py-1.5 border border-border rounded resize-y"
                />
              </label>
            </div>

            {/* Visualization panel */}
            <div className="border-t border-border pt-4">
              <h3 className="text-body font-semibold text-foreground mb-3">Visualization &amp; ΔΔCq</h3>
              <QpcrAnalysisViz protocol={sourceProtocol} snapshot={liveSnapshot} />
            </div>

            {/* Protocol template summary (read-only at a glance) */}
            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-body font-semibold text-foreground">Protocol template</h3>
                <Tooltip label="Edit the protocol template via the /methods page" placement="left">
                  <span className="text-meta text-foreground-muted">read-only</span>
                </Tooltip>
              </div>
              <div className="mt-2 text-meta text-foreground-muted space-y-1">
                <div>
                  <span className="font-medium">Chemistry:</span> {sourceProtocol.chemistry}
                  {sourceProtocol.chemistry === "other" && sourceProtocol.chemistry_label
                    ? ` (${sourceProtocol.chemistry_label})`
                    : ""}
                </div>
                <div>
                  <span className="font-medium">ΔΔCq:</span>{" "}
                  {sourceProtocol.use_delta_delta_cq ? "enabled" : "disabled"}
                </div>
                <div>
                  <span className="font-medium">Standard curve:</span>{" "}
                  {sourceProtocol.standard_curve.length > 0
                    ? `${sourceProtocol.standard_curve.length} points`
                    : "none"}
                </div>
                <div>
                  <span className="font-medium">Melt curve:</span>{" "}
                  {sourceProtocol.melt_curve
                    ? `${sourceProtocol.melt_curve.start_c}–${sourceProtocol.melt_curve.end_c} °C @ ${sourceProtocol.melt_curve.ramp_rate_c_per_sec} °C/sec`
                    : "not configured"}
                </div>
                {sourceProtocol.description && (
                  <div className="text-foreground-muted italic">{sourceProtocol.description}</div>
                )}
              </div>
            </div>
          </>
        ) : (
          <p className="text-body text-foreground-muted">No qPCR analysis protocol available</p>
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cellCultureApi } from "@/lib/local-api";
import type {
  CellCultureActualEvent,
  CellCultureCellLine,
  CellCultureEventType,
  CellCultureMedia,
  CellCulturePlannedEvent,
  CellCultureSchedule,
  CellCultureScheduleInstance,
  Method,
  Task,
  TaskMethodAttachment,
} from "@/lib/types";
import CellCultureScheduleEditor from "@/components/CellCultureScheduleEditor";
import Tooltip from "@/components/Tooltip";
import {
  MODIFIED_BADGE_CLASSES,
  MODIFIED_CHIP_TEXT,
} from "@/lib/methods/diff-display";
import { ownerScopedTasksApi } from "@/lib/tasks/owner-scoped-api";
import type { NestedSnapshotAdapter } from "@/lib/methods/nested-snapshot";
import VariationNotesPanel from "./VariationNotesPanel";

interface CellCultureMethodTabContentProps {
  task: Task;
  method: Method;
  methodId: number;
  attachment: TaskMethodAttachment | undefined;
  onTaskUpdate?: (task: Task) => void;
  readOnly?: boolean;
  /** Compound-child mode: route the schedule instance into the compound's
   *  `compound_snapshots[child_id]` slot. Snapshot shape is the
   *  `CellCultureScheduleInstance` produced by the editor. */
  nestedSnapshot?: NestedSnapshotAdapter<CellCultureScheduleInstance>;
  hideVariationNotes?: boolean;
  /** PI capability revamp: lab head username when editing a member's task on the role, so writes route to the owner + audit. */
  piActor?: string;
}

function extractCellCultureScheduleId(sourcePath: string): number | null {
  const match = sourcePath.match(/^cell_culture:\/\/protocol\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

const EVENT_TYPE_LABELS: Record<CellCultureEventType, string> = {
  feed: "Feed",
  split: "Split",
  observe: "Observe",
  harvest: "Harvest",
};

/** Decode the JSON snapshot stored on `attachment.cell_culture_schedule`,
 *  if present and well-formed. Returns null on missing-or-corrupt so the
 *  caller can fall back to the source schedule's `planned_events`. */
function parseInstance(att: TaskMethodAttachment | undefined): CellCultureScheduleInstance | null {
  if (!att?.cell_culture_schedule) return null;
  try {
    const parsed = JSON.parse(att.cell_culture_schedule);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      planned_events: Array.isArray(parsed.planned_events) ? parsed.planned_events : [],
      actual_events: Array.isArray(parsed.actual_events) ? parsed.actual_events : [],
      notes_per_event:
        parsed.notes_per_event && typeof parsed.notes_per_event === "object"
          ? parsed.notes_per_event
          : undefined,
      cell_line: parsed.cell_line,
      media: parsed.media,
      description: parsed.description,
    };
  } catch {
    return null;
  }
}

export default function CellCultureMethodTabContent({
  task,
  method,
  methodId,
  attachment,
  onTaskUpdate,
  readOnly = false,
  nestedSnapshot,
  hideVariationNotes = false,
  piActor,
}: CellCultureMethodTabContentProps) {
  const queryClient = useQueryClient();
  const tasksApi = useMemo(() => ownerScopedTasksApi(task, piActor ? { actor: piActor } : undefined), [task, piActor]);

  const scheduleId = method.source_path
    ? extractCellCultureScheduleId(method.source_path)
    : null;
  const scheduleOwner = method.owner || undefined;

  const { data: fetchedSchedule } = useQuery({
    queryKey: ["cell-culture", scheduleId, scheduleOwner],
    queryFn: () => cellCultureApi.get(scheduleId!, scheduleOwner),
    enabled: scheduleId !== null,
  });

  const sourceSchedule: CellCultureSchedule | null = fetchedSchedule ?? null;
  // Compound-child mode: pull the snapshot from the nested adapter; otherwise
  // parse it out of the task's standalone attachment field.
  const nestedRead = nestedSnapshot?.read;
  const instance = useMemo<CellCultureScheduleInstance | null>(() => {
    if (nestedRead) return nestedRead();
    return parseInstance(attachment);
  }, [nestedRead, attachment]);

  // Editable planned-schedule overlay state. Hydrates from the snapshot if
  // present (so the user can edit the template for this run), otherwise from
  // the source schedule.
  const [cellLine, setCellLine] = useState<CellCultureCellLine>({});
  const [media, setMedia] = useState<CellCultureMedia>({});
  const [plannedEvents, setPlannedEvents] = useState<CellCulturePlannedEvent[]>([]);
  const [description, setDescription] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  // Actual-events log — persisted as part of the snapshot.
  const [actualEvents, setActualEvents] = useState<CellCultureActualEvent[]>([]);

  // Seed editor state from snapshot or source.
  useEffect(() => {
    const seedCellLine = instance?.cell_line ?? sourceSchedule?.cell_line ?? {};
    const seedMedia = instance?.media ?? sourceSchedule?.media ?? {};
    const seedPlanned =
      instance?.planned_events && instance.planned_events.length > 0
        ? instance.planned_events
        : sourceSchedule?.planned_events ?? [];
    const seedDescription =
      instance?.description ?? sourceSchedule?.description ?? null;
    setCellLine(seedCellLine);
    setMedia(seedMedia);
    setPlannedEvents(seedPlanned);
    setDescription(seedDescription);
    setActualEvents(instance?.actual_events ?? []);
    setHasUnsavedChanges(false);
  }, [instance, sourceSchedule]);

  // Track unsaved changes against whatever was last hydrated.
  useEffect(() => {
    const baselinePlanned =
      instance?.planned_events && instance.planned_events.length > 0
        ? instance.planned_events
        : sourceSchedule?.planned_events ?? [];
    const baselineCellLine = instance?.cell_line ?? sourceSchedule?.cell_line ?? {};
    const baselineMedia = instance?.media ?? sourceSchedule?.media ?? {};
    const baselineDescription = instance?.description ?? sourceSchedule?.description ?? null;
    const baselineActual = instance?.actual_events ?? [];
    const sameTemplate =
      JSON.stringify(plannedEvents) === JSON.stringify(baselinePlanned) &&
      JSON.stringify(cellLine) === JSON.stringify(baselineCellLine) &&
      JSON.stringify(media) === JSON.stringify(baselineMedia) &&
      (description ?? "") === (baselineDescription ?? "");
    const sameActual = JSON.stringify(actualEvents) === JSON.stringify(baselineActual);
    setHasUnsavedChanges(!(sameTemplate && sameActual));
  }, [
    plannedEvents,
    cellLine,
    media,
    description,
    actualEvents,
    instance,
    sourceSchedule,
  ]);

  const handleSave = useCallback(async () => {
    if (!sourceSchedule) return;
    setSaving(true);
    try {
      const snapshot: CellCultureScheduleInstance = {
        planned_events: plannedEvents,
        actual_events: actualEvents,
        cell_line: cellLine,
        media,
        description,
      };
      if (nestedSnapshot) {
        await nestedSnapshot.write(snapshot);
        setHasUnsavedChanges(false);
      } else {
        const updatedTask = await tasksApi.updateMethodCellCulture(task.id, methodId, {
          cell_culture_schedule: JSON.stringify(snapshot),
        });
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", task.id] });
        setHasUnsavedChanges(false);
        if (updatedTask) onTaskUpdate?.(updatedTask);
      }
    } catch (err) {
      console.error("Failed to save cell culture changes:", err);
      alert("Failed to save cell culture changes");
    } finally {
      setSaving(false);
    }
  }, [
    task.id,
    methodId,
    sourceSchedule,
    plannedEvents,
    actualEvents,
    cellLine,
    media,
    description,
    queryClient,
    onTaskUpdate,
    tasksApi,
    nestedSnapshot,
  ]);

  const handleReset = useCallback(async () => {
    if (!confirm("Reset cell culture data to match the source method? Your logged events will be lost.")) {
      return;
    }
    setSaving(true);
    try {
      if (nestedSnapshot) {
        await nestedSnapshot.reset();
      } else {
        const updatedTask = await tasksApi.resetCellCulture(task.id, methodId);
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["task", task.id] });
        if (updatedTask) onTaskUpdate?.(updatedTask);
      }
    } catch (err) {
      console.error("Failed to reset cell culture:", err);
      alert("Failed to reset cell culture data");
    } finally {
      setSaving(false);
    }
  }, [task.id, methodId, queryClient, onTaskUpdate, tasksApi, nestedSnapshot]);

  // Actual-event log mutators
  const addActualEvent = useCallback((eventType: CellCultureEventType) => {
    const now = new Date();
    const next: CellCultureActualEvent = {
      timestamp: now.toISOString(),
      event_type: eventType,
    };
    setActualEvents((prev) => [...prev, next]);
  }, []);

  const updateActualEvent = useCallback(
    <K extends keyof CellCultureActualEvent>(
      idx: number,
      field: K,
      value: CellCultureActualEvent[K],
    ) => {
      setActualEvents((prev) => prev.map((e, i) => (i === idx ? { ...e, [field]: value } : e)));
    },
    [],
  );

  const removeActualEvent = useCallback((idx: number) => {
    setActualEvents((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const hasLoggedEvents = actualEvents.length > 0;

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
              {method.name || "Cell culture passaging"}
            </span>
            <span className="text-meta px-1.5 py-0.5 bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-300 rounded">
              Cell culture
            </span>
            {hasLoggedEvents && (
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
                title="Reset to source method values (clears logged events)"
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

        {/* Planned schedule (top half) */}
        {sourceSchedule ? (
          <div>
            <h3 className="text-body font-semibold text-foreground mb-3">Planned schedule</h3>
            <CellCultureScheduleEditor
              cellLine={cellLine}
              onCellLineChange={readOnly ? undefined : setCellLine}
              media={media}
              onMediaChange={readOnly ? undefined : setMedia}
              plannedEvents={plannedEvents}
              onPlannedEventsChange={readOnly ? undefined : setPlannedEvents}
              description={description}
              onDescriptionChange={readOnly ? undefined : setDescription}
              readOnly={readOnly}
              originalCellLine={sourceSchedule.cell_line}
              originalMedia={sourceSchedule.media}
              originalPlannedEvents={sourceSchedule.planned_events}
              originalDescription={sourceSchedule.description ?? null}
            />
          </div>
        ) : (
          <p className="text-body text-foreground-muted">No cell culture schedule available</p>
        )}

        {/* Actual events log (bottom half) — the unique value-add for cell culture */}
        <div className="border-t border-border pt-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-body font-semibold text-foreground">Actual events</h3>
              <p className="text-meta text-foreground-muted mt-0.5">
                Documentation along the way — log what was actually fed, split, or observed.
              </p>
            </div>
            {!readOnly && (
              <div className="flex items-center gap-1">
                <span className="text-meta text-foreground-muted mr-2">Log:</span>
                <QuickLogButton onClick={() => addActualEvent("feed")} label="Feed" />
                <QuickLogButton onClick={() => addActualEvent("split")} label="Split" />
                <QuickLogButton onClick={() => addActualEvent("observe")} label="Observe" />
                <QuickLogButton onClick={() => addActualEvent("harvest")} label="Harvest" />
              </div>
            )}
          </div>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-meta">
              <thead className="bg-surface-sunken">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-foreground-muted w-44">Timestamp</th>
                  <th className="px-3 py-2 text-left font-medium text-foreground-muted w-28">Event</th>
                  <th className="px-3 py-2 text-left font-medium text-foreground-muted w-24">Split ratio</th>
                  <th className="px-3 py-2 text-left font-medium text-foreground-muted w-24">Confluence %</th>
                  <th className="px-3 py-2 text-left font-medium text-foreground-muted">Observation</th>
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {actualEvents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-foreground-muted text-meta">
                      No events logged yet. Use the &ldquo;Log&rdquo; buttons above to record passage history.
                    </td>
                  </tr>
                ) : (
                  actualEvents.map((event, idx) => (
                    <tr key={idx} className={idx % 2 === 0 ? "bg-surface-raised" : "bg-surface-sunken"}>
                      <td className="px-3 py-1.5">
                        <input
                          type="datetime-local"
                          value={isoToLocal(event.timestamp)}
                          onChange={(e) =>
                            updateActualEvent(idx, "timestamp", localToIso(e.target.value))
                          }
                          readOnly={readOnly}
                          className="w-full px-2 py-1 border border-border rounded"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <select
                          value={event.event_type}
                          onChange={(e) =>
                            updateActualEvent(idx, "event_type", e.target.value as CellCultureEventType)
                          }
                          disabled={readOnly}
                          className="w-full px-2 py-1 border border-border rounded bg-surface-raised"
                        >
                          {(["feed", "split", "observe", "harvest"] as CellCultureEventType[]).map(
                            (opt) => (
                              <option key={opt} value={opt}>
                                {EVENT_TYPE_LABELS[opt]}
                              </option>
                            ),
                          )}
                        </select>
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={event.split_ratio ?? ""}
                          onChange={(e) =>
                            updateActualEvent(idx, "split_ratio", e.target.value || undefined)
                          }
                          readOnly={readOnly || event.event_type !== "split"}
                          className={`w-full px-2 py-1 border border-border rounded ${
                            event.event_type !== "split" ? "bg-surface-sunken text-foreground-muted" : ""
                          }`}
                          placeholder={event.event_type === "split" ? "1:5" : "—"}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          value={event.confluence_percent ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateActualEvent(
                              idx,
                              "confluence_percent",
                              v === "" ? undefined : Number(v),
                            );
                          }}
                          readOnly={readOnly}
                          className="w-full px-2 py-1 border border-border rounded"
                          placeholder="80"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={event.observation_text ?? ""}
                          onChange={(e) =>
                            updateActualEvent(idx, "observation_text", e.target.value || undefined)
                          }
                          readOnly={readOnly}
                          className="w-full px-2 py-1 border border-border rounded"
                          placeholder="Cells looking healthy, no contamination"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {!readOnly && (
                          <Tooltip label="Remove event" placement="left">
                            <button
                              onClick={() => removeActualEvent(idx)}
                              className="text-foreground-muted hover:text-red-500"
                            >
                              ✕
                            </button>
                          </Tooltip>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickLogButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Tooltip label={`Log a ${label.toLowerCase()} event at the current time`} placement="bottom">
      <button
        onClick={onClick}
        className="px-2 py-1 text-meta rounded border border-border text-foreground-muted hover:bg-surface-sunken"
      >
        + {label}
      </button>
    </Tooltip>
  );
}

/** ISO → "YYYY-MM-DDTHH:mm" (the value format the <input type="datetime-local">
 *  expects). Falls back to "" if the timestamp is malformed. */
function isoToLocal(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIso(local: string): string {
  if (!local) return new Date().toISOString();
  const d = new Date(local);
  if (isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

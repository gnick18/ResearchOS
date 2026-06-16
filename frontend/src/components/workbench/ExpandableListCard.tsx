"use client";

// Workbench Lists tab inline-expand card.
//
// Replaces the popup behavior previously used on /workbench → Lists tab.
// Clicking the card toggles an accordion-style panel below that mirrors
// the popup's interactions (rename, items checklist, add item, mark
// list complete) but renders inline. The popup mount path stays intact
// for the Gantt page and every other surface — only the Lists panel
// is rerouted to this component.
//
// Single-expanded contract: parent owns `isExpanded`, so opening one
// card collapses the previously-open one. This avoids deep page
// scroll-jank when several lists carry long item arrays.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SubTask, Task } from "@/lib/types";
import { taskKey } from "@/lib/types";
import { ownerScopedTasksApi } from "@/lib/tasks/owner-scoped-api";
import Tooltip from "@/components/Tooltip";
import SubTaskProgressDots from "@/components/workbench/SubTaskProgressDots";
import type { DateSignalKind } from "@/components/workbench/ListTaskRow";
import DynamicAnimation from "@/components/DynamicAnimation";
import { useAppStore } from "@/lib/store";

// Celebration-animation overlay state. The `nonce` is bumped on every
// fire and used as the DynamicAnimation `key`, so a second check
// before the previous animation finishes unmounts the in-flight
// overlay (clearing its timers via the animation component's
// useEffect cleanup) and mounts the new one fresh. Halt-and-restart,
// no queueing. Mirrors the settings animation picker pattern from
// commit 0d778d95.
interface CelebrationState {
  x: number;
  y: number;
  nonce: number;
}

const DATE_CHIP_CLASSES: Record<DateSignalKind, string> = {
  overdue: "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30",
  doing: "text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 border border-blue-200 dark:border-blue-500/30",
  upcoming: "text-foreground-muted bg-surface-sunken border border-border",
  done: "text-foreground-muted bg-surface-sunken border border-border",
};

export interface ExpandableListCardProps {
  task: Task;
  projectName: string;
  projectColor: string;
  dateSignal: string;
  dateKind: DateSignalKind;
  sharedIndicator?: ReactNode;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onToggleComplete: () => void;
  canToggleComplete?: boolean;
  /** Optional escape hatch: open the full popup view from inside the
   *  expanded panel (parent supplies this so the popup mount stays
   *  centralized in the panel). */
  onOpenFullView?: () => void;
  /** PI capability revamp Phase 2: right-click handler for the PI action menu
   *  on the card header. Wired by the parent only when the active user is a
   *  lab head viewing a member's task; otherwise the normal right-click runs. */
  onHeaderContextMenu?: (e: React.MouseEvent) => void;
}

export default function ExpandableListCard({
  task,
  projectName,
  projectColor,
  dateSignal,
  dateKind,
  sharedIndicator,
  isExpanded,
  onToggleExpand,
  onToggleComplete,
  canToggleComplete = true,
  onOpenFullView,
  onHeaderContextMenu,
}: ExpandableListCardProps) {
  const queryClient = useQueryClient();
  const tasksApi = useMemo(() => ownerScopedTasksApi(task), [task]);

  const readOnly = task.is_shared_with_me && task.shared_permission !== "edit";

  // Celebration animation (parity with TaskDetailPopup / TaskQuickPopup /
  // HighLevelGoalSidebar). Fires on the false -> true transition for:
  //   - subtask checkbox check (one animation per check)
  //   - parent "Mark list complete" button click
  //   - parent header checkbox click
  // Never fires on uncheck. The mark-list-complete handler also cascades
  // subtasks to is_complete=true in a single tasksApi.update, but only one
  // animation fires for that action because the subtask handler is a
  // separate code path (the cascade goes straight through the update call,
  // not through handleToggleSubTask).
  const animationType = useAppStore((s) => s.animationType);
  const [celebration, setCelebration] = useState<CelebrationState | null>(null);
  const fireCelebration = useCallback((rect: DOMRect) => {
    setCelebration({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      nonce: Date.now(),
    });
  }, []);

  // ── Items state ─────────────────────────────────────────────────────────
  const [subTasks, setSubTasks] = useState<SubTask[]>(task.sub_tasks ?? []);
  const [newItemText, setNewItemText] = useState("");
  const [saving, setSaving] = useState(false);

  // Keep local state in sync when the task prop changes (parent refetched).
  useEffect(() => {
    setSubTasks(task.sub_tasks ?? []);
  }, [task.sub_tasks]);

  // ── Name editing ────────────────────────────────────────────────────────
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(task.name);
  useEffect(() => {
    setNameDraft(task.name);
  }, [task.name]);

  // ── Item-text editing (per-row) ─────────────────────────────────────────
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemDraft, setItemDraft] = useState("");

  // ── Animation: expand height via max-height with measured content ──────
  const panelRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(
    isExpanded ? undefined : 0,
  );

  // Recompute max-height whenever the expanded state or content changes.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    if (isExpanded) {
      // First lock to measured pixel height for the animation, then drop
      // the cap on transitionend so adds/edits inside the panel can grow
      // freely without re-measuring on every keystroke.
      const measured = content.scrollHeight;
      setMaxHeight(measured);
    } else {
      // If currently uncapped (undefined), set to current rendered height
      // first so the transition has a starting value, then collapse to 0.
      if (panelRef.current && maxHeight === undefined) {
        const h = panelRef.current.scrollHeight;
        setMaxHeight(h);
        // Yield to let the browser commit the starting value before we
        // animate to 0.
        requestAnimationFrame(() => setMaxHeight(0));
      } else {
        setMaxHeight(0);
      }
    }
    // We intentionally exclude maxHeight from deps — including it
    // creates a feedback loop with the collapse two-step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded, subTasks.length]);

  const handleTransitionEnd = useCallback(() => {
    if (isExpanded) {
      // Drop the height cap so dynamic content (added items, growing
      // textareas) can size naturally.
      setMaxHeight(undefined);
    }
  }, [isExpanded]);

  // ── Mutations ───────────────────────────────────────────────────────────

  const refetch = useCallback(async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["tasks"] }),
      queryClient.refetchQueries({ queryKey: ["task", taskKey(task)] }),
    ]);
  }, [queryClient, task]);

  const handleSaveName = useCallback(async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === task.name) {
      setNameDraft(task.name);
      setEditingName(false);
      return;
    }
    setSaving(true);
    try {
      await tasksApi.update(task.id, { name: trimmed });
      await refetch();
    } catch {
      alert("Failed to rename list");
      setNameDraft(task.name);
    } finally {
      setSaving(false);
      setEditingName(false);
    }
  }, [nameDraft, task, tasksApi, refetch]);

  const handleToggleSubTask = useCallback(
    async (subTaskId: string, event: React.MouseEvent<HTMLButtonElement>) => {
      const prior = subTasks.find((st) => st.id === subTaskId);
      const next = subTasks.map((st) =>
        st.id === subTaskId ? { ...st, is_complete: !st.is_complete } : st,
      );
      // Celebrate on false -> true only. Position at the checkbox center so
      // the animation overlay anchors to the user's click, same pattern as
      // TaskDetailPopup's SimpleTaskChecklist.
      if (prior && !prior.is_complete) {
        const rect = event.currentTarget.getBoundingClientRect();
        fireCelebration(rect);
      }
      setSubTasks(next);
      setSaving(true);
      try {
        await tasksApi.update(task.id, { sub_tasks: next });
        await refetch();
      } catch {
        alert("Failed to update item");
        // Roll back local state on failure.
        setSubTasks(task.sub_tasks ?? []);
      } finally {
        setSaving(false);
      }
    },
    [subTasks, task, tasksApi, refetch, fireCelebration],
  );

  const handleAddItem = useCallback(async () => {
    const text = newItemText.trim();
    if (!text) return;
    const next: SubTask[] = [
      ...subTasks,
      { id: `st-${Date.now()}`, text, is_complete: false },
    ];
    setSubTasks(next);
    setNewItemText("");
    setSaving(true);
    try {
      await tasksApi.update(task.id, { sub_tasks: next });
      await refetch();
    } catch {
      alert("Failed to add item");
      setSubTasks(task.sub_tasks ?? []);
    } finally {
      setSaving(false);
    }
  }, [newItemText, subTasks, task, tasksApi, refetch]);

  const handleDeleteItem = useCallback(
    async (subTaskId: string) => {
      const next = subTasks.filter((st) => st.id !== subTaskId);
      setSubTasks(next);
      setSaving(true);
      try {
        await tasksApi.update(task.id, { sub_tasks: next });
        await refetch();
      } catch {
        alert("Failed to delete item");
        setSubTasks(task.sub_tasks ?? []);
      } finally {
        setSaving(false);
      }
    },
    [subTasks, task, tasksApi, refetch],
  );

  const handleSaveItemText = useCallback(
    async (subTaskId: string) => {
      const trimmed = itemDraft.trim();
      const original = subTasks.find((st) => st.id === subTaskId);
      setEditingItemId(null);
      if (!original) return;
      if (!trimmed || trimmed === original.text) return;
      const next = subTasks.map((st) =>
        st.id === subTaskId ? { ...st, text: trimmed } : st,
      );
      setSubTasks(next);
      setSaving(true);
      try {
        await tasksApi.update(task.id, { sub_tasks: next });
        await refetch();
      } catch {
        alert("Failed to update item");
        setSubTasks(task.sub_tasks ?? []);
      } finally {
        setSaving(false);
      }
    },
    [itemDraft, subTasks, task, tasksApi, refetch],
  );

  const handleMarkListComplete = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      const nextComplete = !task.is_complete;
      // Celebrate on false -> true only. One animation fires from the
      // parent click regardless of how many subtasks the cascade flips,
      // because the cascade goes through this single tasksApi.update
      // call (not through handleToggleSubTask).
      if (nextComplete) {
        const rect = event.currentTarget.getBoundingClientRect();
        fireCelebration(rect);
      }
      // Forward-cascade matches WorkbenchListsPanel's existing parent
      // checkbox behavior.
      const cascadeSubTasks =
        nextComplete && subTasks.length > 0
          ? subTasks.map((st) =>
              st.is_complete ? st : { ...st, is_complete: true },
            )
          : undefined;
      setSaving(true);
      try {
        await tasksApi.update(task.id, {
          is_complete: nextComplete,
          ...(cascadeSubTasks ? { sub_tasks: cascadeSubTasks } : {}),
        });
        await refetch();
      } catch {
        alert("Failed to update list");
      } finally {
        setSaving(false);
      }
    },
    [task, subTasks, tasksApi, refetch, fireCelebration],
  );

  const totalSubTasks = subTasks.length;
  const completedSubTasks = subTasks.filter((s) => s.is_complete).length;

  const handleCardKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggleExpand();
    }
  };

  return (
    <div
      className={`bg-surface-raised border rounded-lg transition-all ${
        isExpanded
          ? "border-violet-300 dark:border-violet-500/30 shadow-sm"
          : "border-border hover:border-border hover:shadow-sm"
      }`}
      data-testid="expandable-list-card"
      data-expanded={isExpanded ? "true" : "false"}
    >
      {/* ── Card header (clickable to expand/collapse) ───────────────── */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={onToggleExpand}
        onContextMenu={onHeaderContextMenu}
        onKeyDown={handleCardKey}
        className="group flex items-start gap-3 px-3 py-2.5 cursor-pointer text-left"
      >
        {/* Parent completion checkbox */}
        <Tooltip
          label={task.is_complete ? "Mark as incomplete" : "Mark as complete"}
          placement="top"
        >
          <button
            type="button"
            aria-label={
              task.is_complete ? "Mark as incomplete" : "Mark as complete"
            }
            disabled={!canToggleComplete}
            onClick={(e) => {
              e.stopPropagation();
              if (!canToggleComplete) return;
              // Celebrate on false -> true only. Fire from the header
              // checkbox so the animation works even when the card is
              // collapsed (the mark-list-complete button only exists
              // inside the expanded panel).
              if (!task.is_complete) {
                fireCelebration(e.currentTarget.getBoundingClientRect());
              }
              onToggleComplete();
            }}
            className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-colors ${
              task.is_complete
                ? "bg-emerald-500 border border-emerald-500 text-white hover:bg-emerald-600"
                : "border border-border hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/20"
            } ${canToggleComplete ? "" : "opacity-50 cursor-not-allowed"}`}
          >
            {task.is_complete && (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
          </button>
        </Tooltip>

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <span
              className={`text-body flex-1 min-w-0 truncate ${
                task.is_complete
                  ? "text-foreground-muted line-through"
                  : "text-foreground font-medium"
              }`}
            >
              {task.name}
            </span>

            {totalSubTasks > 0 && (
              <SubTaskProgressDots
                completed={completedSubTasks}
                total={totalSubTasks}
              />
            )}
          </div>

          <div className="mt-1 flex items-center gap-2 flex-wrap text-meta">
            <span className="inline-flex items-center gap-1.5 text-foreground-muted">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: projectColor }}
                aria-hidden
              />
              <span className="truncate max-w-[16rem]">{projectName}</span>
            </span>
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-meta tabular-nums ${DATE_CHIP_CLASSES[dateKind]}`}
            >
              {dateKind === "overdue" && (
                <svg
                  aria-hidden
                  className="w-3 h-3 mr-0.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 0 0-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"
                  />
                </svg>
              )}
              {dateSignal}
            </span>
          </div>
        </div>

        {sharedIndicator && (
          <div className="flex-shrink-0 ml-2 self-center">{sharedIndicator}</div>
        )}

        {/* Chevron — rotates 90° when expanded. */}
        <svg
          aria-hidden
          className={`w-4 h-4 mt-1 text-foreground-muted flex-shrink-0 transition-transform duration-200 ${
            isExpanded ? "rotate-90" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 5l7 7-7 7"
          />
        </svg>
      </div>

      {/* ── Expanded inline panel ───────────────────────────────────── */}
      <div
        ref={panelRef}
        onTransitionEnd={handleTransitionEnd}
        aria-hidden={!isExpanded}
        style={{
          maxHeight:
            maxHeight === undefined ? "none" : `${maxHeight}px`,
          opacity: isExpanded ? 1 : 0,
          overflow: maxHeight === undefined ? "visible" : "hidden",
          transition:
            "max-height 200ms ease-out, opacity 200ms ease-out",
        }}
        data-testid="expandable-list-card-panel"
      >
        <div
          ref={contentRef}
          className="border-t border-border px-4 py-3 bg-surface-sunken/40"
        >
          {/* Editable name row */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-meta uppercase tracking-wide text-foreground-muted flex-shrink-0">
              Name
            </span>
            {editingName && !readOnly ? (
              <input
                type="text"
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={handleSaveName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  } else if (e.key === "Escape") {
                    setNameDraft(task.name);
                    setEditingName(false);
                  }
                }}
                className="flex-1 px-2 py-1 text-body border border-violet-300 dark:border-violet-500/30 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-300"
                aria-label="List name"
              />
            ) : (
              <button
                type="button"
                disabled={readOnly}
                onClick={() => !readOnly && setEditingName(true)}
                className={`flex-1 text-left text-body px-2 py-1 rounded-md ${
                  readOnly
                    ? "text-foreground-muted cursor-default"
                    : "text-foreground hover:bg-surface-raised hover:ring-1 hover:ring-border"
                }`}
                title={readOnly ? undefined : "Click to rename"}
              >
                {task.name}
              </button>
            )}
          </div>

          {/* Items checklist */}
          <ul className="space-y-1 mb-3" data-testid="expandable-list-items">
            {subTasks.length === 0 && (
              <li className="text-meta text-foreground-muted italic px-1 py-1">
                No items yet.
              </li>
            )}
            {subTasks.map((st, idx) => {
              const isEditing = editingItemId === st.id;
              return (
                <li
                  key={st.id}
                  className={`flex items-center gap-2.5 group py-1.5 px-2 rounded-md hover:bg-surface-raised transition-colors ${
                    st.is_complete ? "opacity-60" : ""
                  }`}
                >
                  <Tooltip
                    label={
                      st.is_complete ? "Mark as incomplete" : "Mark as complete"
                    }
                    placement="top"
                  >
                    <button
                      type="button"
                      aria-label={
                        st.is_complete
                          ? "Mark item incomplete"
                          : "Mark item complete"
                      }
                      onClick={
                        readOnly
                          ? undefined
                          : (e) => handleToggleSubTask(st.id, e)
                      }
                      disabled={saving || readOnly}
                      // Workbench fix manager R1 2026-05-22 (Verify-A P0-1):
                      // ExpandableListCard is the active rendering path on
                      // /workbench Lists tab (TaskDetailPopup no longer
                      // mounts here). Stamp the first sub-task checkbox
                      // with the render-scoped tour anchor so the
                      // workbench-list-mark-done cursor demo lands on the
                      // same item every time. Re-stamped on every render
                      // so back-step + forward-step gets a fresh latch.
                      data-tour-target={
                        idx === 0 ? "workbench-list-item-checkbox" : undefined
                      }
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                        st.is_complete
                          ? "bg-violet-500 border-violet-500"
                          : "border-border hover:border-violet-400"
                      } ${readOnly ? "cursor-default" : ""}`}
                    >
                      {st.is_complete && (
                        <svg
                          className="w-3.5 h-3.5 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                    </button>
                  </Tooltip>

                  {isEditing && !readOnly ? (
                    <input
                      type="text"
                      autoFocus
                      value={itemDraft}
                      onChange={(e) => setItemDraft(e.target.value)}
                      onBlur={() => handleSaveItemText(st.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          (e.target as HTMLInputElement).blur();
                        } else if (e.key === "Escape") {
                          setEditingItemId(null);
                        }
                      }}
                      className="flex-1 px-2 py-0.5 text-body border border-violet-300 dark:border-violet-500/30 rounded focus:outline-none focus:ring-2 focus:ring-violet-300"
                      aria-label="Edit item text"
                    />
                  ) : (
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => {
                        if (readOnly) return;
                        setItemDraft(st.text);
                        setEditingItemId(st.id);
                      }}
                      className={`flex-1 text-left text-body px-1 py-0.5 rounded ${
                        st.is_complete
                          ? "line-through text-foreground-muted"
                          : "text-foreground"
                      } ${
                        readOnly
                          ? "cursor-default"
                          : "hover:bg-surface-raised"
                      }`}
                    >
                      {st.text}
                    </button>
                  )}

                  {!readOnly && (
                    <Tooltip label="Delete item" placement="top">
                      <button
                        type="button"
                        aria-label="Delete item"
                        onClick={() => handleDeleteItem(st.id)}
                        className="opacity-0 group-hover:opacity-100 text-foreground-muted hover:text-red-500 transition-opacity"
                        data-force-hover-controls-target
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </Tooltip>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Add new item */}
          {!readOnly && (
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddItem();
                  }
                }}
                placeholder="Add item..."
                aria-label="Add item"
                // Workbench fix manager R1 2026-05-22 (Verify-A P0-1):
                // ExpandableListCard's Add-item input is the active
                // target on /workbench (replaces TaskDetailPopup's
                // input). Stamped so the workbench-list-create-shell
                // cursor demo can type the 3 demo items.
                data-tour-target="workbench-list-add-item-input"
                className="flex-1 px-3 py-1.5 text-body border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-transparent bg-surface-raised"
              />
              <button
                type="button"
                onClick={handleAddItem}
                disabled={!newItemText.trim() || saving}
                className="ros-btn-raise px-3 py-1.5 text-body bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          )}

          {/* Footer actions */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            {!readOnly ? (
              <button
                type="button"
                onClick={handleMarkListComplete}
                disabled={saving}
                // Note: handleMarkListComplete reads
                // event.currentTarget.getBoundingClientRect() for the
                // animation anchor. Don't wrap this in (e) => fn(e) at
                // a higher level — currentTarget would point at the
                // wrapper and the animation would mis-position.
                // Workbench fix manager R1 2026-05-22 (Verify-A P0-1):
                // ExpandableListCard's Mark-list-complete button is the
                // active target on /workbench (replaces TaskDetailPopup
                // header button). Stamped so the workbench-list-mark-
                // done cursor demo can click it.
                data-tour-target="workbench-list-mark-complete"
                className={`text-meta px-3 py-1.5 rounded-md font-medium transition-colors ${
                  task.is_complete
                    ? "bg-surface-sunken text-foreground-muted hover:bg-surface-sunken"
                    : "bg-emerald-600 text-white hover:bg-emerald-700"
                } disabled:opacity-50`}
              >
                {task.is_complete
                  ? "Mark list incomplete"
                  : "Mark list complete"}
              </button>
            ) : (
              <span className="text-meta text-foreground-muted italic">
                View only (shared)
              </span>
            )}

            {onOpenFullView && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenFullView();
                }}
                className="text-meta text-foreground-muted hover:text-foreground underline-offset-2 hover:underline"
              >
                Open full view
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Celebration overlay. Rendered at viewport coordinates (the
       *  animation components use position: fixed internally), so this
       *  works whether or not the card is expanded. `key={celebration.nonce}`
       *  forces React to unmount the previous DynamicAnimation when a
       *  second check fires before the first finishes, clearing the
       *  underlying timers + particle state via the animation's useEffect
       *  cleanup. The old onComplete fires during cleanup but the
       *  setCelebration(null) it queues is harmless because the new
       *  state has already replaced null. Same pattern as the settings
       *  animation preview (commit 0d778d95). */}
      {celebration && (
        <DynamicAnimation
          key={celebration.nonce}
          type={animationType}
          x={celebration.x}
          y={celebration.y}
          onComplete={() => setCelebration(null)}
        />
      )}
    </div>
  );
}

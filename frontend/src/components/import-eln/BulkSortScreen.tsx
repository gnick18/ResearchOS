"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { projectsApi, tasksApi } from "@/lib/local-api";
import type { ELNAppliedTask, ELNImportResult } from "@/lib/import/eln/types";

interface BulkSortScreenProps {
  result: ELNImportResult;
  onDone: () => void;
}

type TaskType = "experiment" | "purchase" | "list";

const TASK_TYPES: TaskType[] = ["experiment", "purchase", "list"];

interface ExistingProject {
  id: number;
  name: string;
}

interface SortRow {
  task: ELNAppliedTask;
  projectId: number | null;
  taskType: TaskType;
  deleted: boolean;
  saving: boolean;
  error: string | null;
}

function initialRows(result: ELNImportResult): SortRow[] {
  return result.tasksCreated.map((t) => ({
    task: t,
    projectId: t.newProjectId,
    taskType: "experiment",
    deleted: false,
    saving: false,
    error: null,
  }));
}

export default function BulkSortScreen({ result, onDone }: BulkSortScreenProps) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<SortRow[]>(() => initialRows(result));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [existing, setExisting] = useState<ExistingProject[]>([]);

  useEffect(() => {
    let cancelled = false;
    projectsApi
      .list()
      .then((list) => {
        if (cancelled) return;
        const mapped = list
          .filter((p) => !p.is_archived)
          .map((p) => ({ id: p.id, name: p.name }));
        mapped.sort((a, b) => a.name.localeCompare(b.name));
        setExisting(mapped);
      })
      .catch(() => {
        if (!cancelled) setExisting([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Group surviving rows by project.
  const grouped = useMemo(() => {
    const groups = new Map<number | null, SortRow[]>();
    for (const r of rows) {
      if (r.deleted) continue;
      const key = r.projectId ?? null;
      const existingList = groups.get(key) ?? [];
      existingList.push(r);
      groups.set(key, existingList);
    }
    const entries = Array.from(groups.entries()).map(([projectId, list]) => ({
      projectId,
      rows: list,
    }));
    entries.sort((a, b) => {
      const an = projectNameFor(a.projectId, existing);
      const bn = projectNameFor(b.projectId, existing);
      return an.localeCompare(bn);
    });
    return entries;
  }, [rows, existing]);

  const toggleSelect = useCallback((taskId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const setRowSaving = (taskId: number, saving: boolean) => {
    setRows((prev) =>
      prev.map((r) => (r.task.newTaskId === taskId ? { ...r, saving } : r)),
    );
  };

  const setRowError = (taskId: number, error: string | null) => {
    setRows((prev) =>
      prev.map((r) => (r.task.newTaskId === taskId ? { ...r, error } : r)),
    );
  };

  const patchRow = (taskId: number, patch: Partial<SortRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.task.newTaskId === taskId ? { ...r, ...patch } : r)),
    );
  };

  const invalidateTaskQueries = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
  }, [queryClient]);

  const updateProject = useCallback(
    async (taskId: number, nextProjectId: number | null) => {
      const original = rows.find((r) => r.task.newTaskId === taskId);
      if (!original) return;
      patchRow(taskId, { projectId: nextProjectId });
      setRowSaving(taskId, true);
      setRowError(taskId, null);
      try {
        // TaskUpdate.project_id is `number | null | undefined`; passing `null`
        // unassigns the task ("no project"). The JsonStore writer accepts any
        // non-undefined value, so this round-trips to disk faithfully.
        await tasksApi.update(taskId, { project_id: nextProjectId });
        invalidateTaskQueries();
      } catch (err) {
        patchRow(taskId, { projectId: original.projectId });
        setRowError(
          taskId,
          err instanceof Error ? err.message : "Failed to move task.",
        );
      } finally {
        setRowSaving(taskId, false);
      }
    },
    [rows, invalidateTaskQueries],
  );

  const updateType = useCallback(
    async (taskId: number, nextType: TaskType) => {
      const original = rows.find((r) => r.task.newTaskId === taskId);
      if (!original) return;
      patchRow(taskId, { taskType: nextType });
      setRowSaving(taskId, true);
      setRowError(taskId, null);
      try {
        await tasksApi.update(taskId, { task_type: nextType });
        invalidateTaskQueries();
      } catch (err) {
        patchRow(taskId, { taskType: original.taskType });
        setRowError(
          taskId,
          err instanceof Error ? err.message : "Failed to change task type.",
        );
      } finally {
        setRowSaving(taskId, false);
      }
    },
    [rows, invalidateTaskQueries],
  );

  const deleteTask = useCallback(
    async (taskId: number) => {
      patchRow(taskId, { deleted: true, saving: true, error: null });
      try {
        await tasksApi.delete(taskId);
        invalidateTaskQueries();
      } catch (err) {
        patchRow(taskId, {
          deleted: false,
          error: err instanceof Error ? err.message : "Failed to delete task.",
        });
      } finally {
        setRowSaving(taskId, false);
      }
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    },
    [invalidateTaskQueries],
  );

  const bulkMoveProject = useCallback(
    async (nextProjectId: number | null) => {
      const ids = Array.from(selected);
      for (const id of ids) {
        await updateProject(id, nextProjectId);
      }
    },
    [selected, updateProject],
  );

  const bulkChangeType = useCallback(
    async (nextType: TaskType) => {
      const ids = Array.from(selected);
      for (const id of ids) {
        await updateType(id, nextType);
      }
    },
    [selected, updateType],
  );

  const bulkDelete = useCallback(async () => {
    const ids = Array.from(selected);
    for (const id of ids) {
      await deleteTask(id);
    }
    setConfirmDeleteOpen(false);
    setSelected(new Set());
  }, [selected, deleteTask]);

  const totalSurviving = rows.filter((r) => !r.deleted).length;

  return (
    <div className="fixed inset-0 z-[80] bg-surface-raised flex flex-col">
      <div className="border-b border-border px-6 py-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-heading font-semibold text-foreground">
            Bulk sort imported tasks
          </h2>
          <p className="text-meta text-foreground-muted mt-1">
            {totalSurviving} task{totalSurviving === 1 ? "" : "s"} imported.
            Re-classify or move to different projects before they show up in
            your gantt.
          </p>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="px-4 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white rounded-lg whitespace-nowrap"
        >
          Done
        </button>
      </div>

      {selected.size > 0 && (
        <BulkActionBar
          selectedCount={selected.size}
          existing={existing}
          onMoveProject={bulkMoveProject}
          onChangeType={bulkChangeType}
          onDeleteRequested={() => setConfirmDeleteOpen(true)}
        />
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6 bg-surface-sunken">
        {grouped.length === 0 && (
          <div className="text-center text-body text-foreground-muted py-12">
            All imported tasks have been deleted or moved away.
          </div>
        )}
        {grouped.map((group) => (
          <ProjectGroup
            key={group.projectId ?? "null"}
            projectId={group.projectId}
            rows={group.rows}
            existing={existing}
            selected={selected}
            onToggleSelect={toggleSelect}
            onChangeProject={updateProject}
            onChangeType={updateType}
            onDelete={deleteTask}
          />
        ))}
      </div>

      {confirmDeleteOpen && (
        <ConfirmDeleteModal
          count={selected.size}
          onCancel={() => setConfirmDeleteOpen(false)}
          onConfirm={bulkDelete}
        />
      )}
    </div>
  );
}

function projectNameFor(
  projectId: number | null,
  existing: ExistingProject[],
): string {
  if (projectId == null) return "(no project)";
  const hit = existing.find((p) => p.id === projectId);
  return hit?.name ?? `Project #${projectId}`;
}

function BulkActionBar({
  selectedCount,
  existing,
  onMoveProject,
  onChangeType,
  onDeleteRequested,
}: {
  selectedCount: number;
  existing: ExistingProject[];
  onMoveProject: (next: number | null) => void;
  onChangeType: (next: TaskType) => void;
  onDeleteRequested: () => void;
}) {
  return (
    <div className="border-b border-border bg-blue-50 dark:bg-blue-500/15 px-6 py-2 flex items-center gap-4 flex-wrap text-meta">
      <span className="font-medium text-blue-900 dark:text-blue-300">
        {selectedCount} selected
      </span>
      <div className="flex items-center gap-2">
        <span className="text-foreground">Move to:</span>
        <select
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") return;
            const next = v === "null" ? null : Number(v);
            onMoveProject(next);
            e.target.value = "";
          }}
          className="border border-border rounded px-2 py-1 text-meta bg-surface-raised"
        >
          <option value="">— pick project —</option>
          <option value="null">(no project)</option>
          {existing.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-foreground">Change type to:</span>
        <select
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value as TaskType | "";
            if (v === "") return;
            onChangeType(v);
            e.target.value = "";
          }}
          className="border border-border rounded px-2 py-1 text-meta bg-surface-raised"
        >
          <option value="">— pick type —</option>
          {TASK_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={onDeleteRequested}
        className="ml-auto px-2 py-1 text-meta bg-red-600 hover:bg-red-700 text-white rounded"
      >
        Delete {selectedCount} task{selectedCount === 1 ? "" : "s"}
      </button>
    </div>
  );
}

function ProjectGroup({
  projectId,
  rows,
  existing,
  selected,
  onToggleSelect,
  onChangeProject,
  onChangeType,
  onDelete,
}: {
  projectId: number | null;
  rows: SortRow[];
  existing: ExistingProject[];
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  onChangeProject: (id: number, next: number | null) => void;
  onChangeType: (id: number, next: TaskType) => void;
  onDelete: (id: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const name = projectNameFor(projectId, existing);
  return (
    <div className="rounded-lg border border-border bg-surface-raised overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2 text-left flex items-center justify-between bg-surface-sunken border-b border-border"
      >
        <span className="text-body font-medium text-foreground">
          {name}{" "}
          <span className="text-foreground-muted font-normal">
            ({rows.length} task{rows.length === 1 ? "" : "s"})
          </span>
        </span>
        <span className="text-meta text-foreground-muted">{open ? "Collapse" : "Expand"}</span>
      </button>
      {open && (
        <div className="divide-y divide-border">
          {rows.map((row) => (
            <TaskRow
              key={row.task.newTaskId}
              row={row}
              existing={existing}
              selected={selected.has(row.task.newTaskId)}
              onToggleSelect={onToggleSelect}
              onChangeProject={onChangeProject}
              onChangeType={onChangeType}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskRow({
  row,
  existing,
  selected,
  onToggleSelect,
  onChangeProject,
  onChangeType,
  onDelete,
}: {
  row: SortRow;
  existing: ExistingProject[];
  selected: boolean;
  onToggleSelect: (id: number) => void;
  onChangeProject: (id: number, next: number | null) => void;
  onChangeType: (id: number, next: TaskType) => void;
  onDelete: (id: number) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const subtitle = row.task.treePath
    .slice(0, Math.max(0, row.task.treePath.length - 1))
    .join("/");
  return (
    <div className="px-4 py-2 flex items-center gap-3 hover:bg-surface-sunken">
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(row.task.newTaskId)}
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="text-body text-foreground truncate">{row.task.pageName}</p>
        {subtitle && (
          <p className="text-meta text-foreground-muted truncate">from {subtitle}</p>
        )}
        {row.error && (
          <p className="text-meta text-red-600 dark:text-red-300 mt-0.5">{row.error}</p>
        )}
      </div>
      <select
        value={row.projectId ?? "null"}
        onChange={(e) => {
          const v = e.target.value;
          onChangeProject(row.task.newTaskId, v === "null" ? null : Number(v));
        }}
        className="border border-border rounded px-2 py-1 text-meta bg-surface-raised shrink-0"
        disabled={row.saving}
      >
        <option value="null">(no project)</option>
        {existing.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select
        value={row.taskType}
        onChange={(e) =>
          onChangeType(row.task.newTaskId, e.target.value as TaskType)
        }
        className="border border-border rounded px-2 py-1 text-meta bg-surface-raised shrink-0"
        disabled={row.saving}
      >
        {TASK_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="text-meta text-red-600 dark:text-red-300 hover:text-red-700 px-2 py-1 rounded shrink-0"
        disabled={row.saving}
      >
        Delete
      </button>
      {confirmOpen && (
        <div
          className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            className="bg-surface-raised rounded-lg shadow-xl w-full max-w-sm p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-body text-foreground font-medium">
              Delete &ldquo;{row.task.pageName}&rdquo;?
            </p>
            <p className="text-meta text-foreground-muted mt-1">
              This removes the task and its imported notes. Cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="px-3 py-1.5 text-meta text-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  onDelete(row.task.newTaskId);
                }}
                className="px-3 py-1.5 text-meta bg-red-600 hover:bg-red-700 text-white rounded"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfirmDeleteModal({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-surface-raised rounded-lg shadow-xl w-full max-w-sm p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-body text-foreground font-medium">
          Delete {count} task{count === 1 ? "" : "s"}?
        </p>
        <p className="text-meta text-foreground-muted mt-1">
          This removes the selected tasks and their imported notes. Cannot be undone.
        </p>
        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-meta text-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-3 py-1.5 text-meta bg-red-600 hover:bg-red-700 text-white rounded"
          >
            Delete {count}
          </button>
        </div>
      </div>
    </div>
  );
}

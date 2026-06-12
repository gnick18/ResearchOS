// Check-ins Phase 3. Unit coverage for the IDP action-row -> Task sync, against
// an in-memory IdpTaskSyncOps mock. Covers create / edit / complete / detach /
// delete, plus the task -> row status reconcile.

import { describe, expect, it } from "vitest";
import {
  addRowToTasks,
  reconcileRowTask,
  reconcileRowStatusFromTask,
  deleteRowTask,
  rowShouldHaveTask,
  statusToComplete,
  type IdpTaskSyncOps,
  type IdpSyncedTaskDraft,
} from "./action-task-sync";
import type { IdpActionRow, Task } from "../types";

function makeOps() {
  const store = new Map<string, Map<number, Task>>();
  const nextId = new Map<string, number>();
  const ofOwner = (owner: string) => {
    let m = store.get(owner);
    if (!m) {
      m = new Map();
      store.set(owner, m);
    }
    return m;
  };
  const ops: IdpTaskSyncOps = {
    createTask: async (owner: string, draft: IdpSyncedTaskDraft) => {
      const id = (nextId.get(owner) ?? 0) + 1;
      nextId.set(owner, id);
      const task = {
        id,
        project_id: 0,
        name: draft.name,
        start_date: draft.start_date,
        duration_days: 1,
        end_date: draft.start_date,
        is_high_level: false,
        is_complete: draft.is_complete,
        task_type: "list",
        weekend_override: null,
        method_ids: [],
        deviation_log: null,
        tags: null,
        sort_order: 0,
        experiment_color: null,
        sub_tasks: null,
        method_attachments: [],
        comments: [],
        owner: draft.owner,
        shared_with: draft.shared_with,
        assignee: null,
        source: draft.source,
      } as unknown as Task;
      ofOwner(owner).set(id, task);
      return task;
    },
    updateTask: async (owner: string, id: number, patch: Partial<Task>) => {
      const m = ofOwner(owner);
      const existing = m.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch };
      m.set(id, updated);
      return updated;
    },
    deleteTask: async (owner: string, id: number) => {
      ofOwner(owner).delete(id);
    },
    getTask: async (owner: string, id: number) => ofOwner(owner).get(id) ?? null,
  };
  return { ops, store, ofOwner };
}

function row(overrides: Partial<IdpActionRow> = {}): IdpActionRow {
  return {
    id: "r1",
    objective: "Take the scientific writing workshop",
    approach: "Grad-school short course",
    target_date: "2026-09-15",
    outcome: "A full Aim 1 draft",
    status: "in_progress",
    synced_task_id: null,
    ...overrides,
  };
}

describe("predicates", () => {
  it("rowShouldHaveTask is true only with a target date", () => {
    expect(rowShouldHaveTask(row())).toBe(true);
    expect(rowShouldHaveTask(row({ target_date: null }))).toBe(false);
  });
  it("statusToComplete only completes on done", () => {
    expect(statusToComplete("done")).toBe(true);
    expect(statusToComplete("in_progress")).toBe(false);
    expect(statusToComplete("not_started")).toBe(false);
  });
});

describe("addRowToTasks", () => {
  it("creates a standalone trainee-owned list task for a dated row", async () => {
    const { ops, ofOwner } = makeOps();
    const r = row();
    const { synced_task_id } = await addRowToTasks(ops, "mira", "idp-1", r);
    expect(synced_task_id).toBe(1);
    const task = ofOwner("mira").get(1)!;
    expect(task.task_type).toBe("list");
    expect(task.project_id).toBe(0);
    expect(task.owner).toBe("mira");
    expect(task.name).toBe(r.objective);
    expect(task.start_date).toBe("2026-09-15");
    expect(task.source).toEqual({ kind: "idp_action", idp_id: "idp-1", row_id: "r1" });
  });

  it("mirrors a done status onto the new task", async () => {
    const { ops, ofOwner } = makeOps();
    const { synced_task_id } = await addRowToTasks(ops, "mira", "idp-1", row({ status: "done" }));
    expect(ofOwner("mira").get(synced_task_id!)!.is_complete).toBe(true);
  });

  it("no-ops for an undated row", async () => {
    const { ops } = makeOps();
    const { synced_task_id } = await addRowToTasks(ops, "mira", "idp-1", row({ target_date: null }));
    expect(synced_task_id).toBeNull();
  });

  it("does not double-create when the row is already synced", async () => {
    const { ops } = makeOps();
    const { synced_task_id } = await addRowToTasks(ops, "mira", "idp-1", row({ synced_task_id: 7 }));
    expect(synced_task_id).toBe(7);
  });
});

describe("reconcileRowTask (edit)", () => {
  it("updates name/date/completion of an existing synced task", async () => {
    const { ops, ofOwner } = makeOps();
    const { synced_task_id } = await addRowToTasks(ops, "mira", "idp-1", row());
    const edited = row({
      synced_task_id,
      objective: "Draft Aim 1",
      target_date: "2026-10-01",
      status: "done",
    });
    const out = await reconcileRowTask(ops, "mira", edited);
    expect(out.synced_task_id).toBe(synced_task_id);
    const task = ofOwner("mira").get(synced_task_id!)!;
    expect(task.name).toBe("Draft Aim 1");
    expect(task.start_date).toBe("2026-10-01");
    expect(task.is_complete).toBe(true);
  });

  it("detaches + deletes the task when the date is cleared", async () => {
    const { ops, ofOwner } = makeOps();
    const { synced_task_id } = await addRowToTasks(ops, "mira", "idp-1", row());
    const out = await reconcileRowTask(ops, "mira", row({ synced_task_id, target_date: null }));
    expect(out.synced_task_id).toBeNull();
    expect(ofOwner("mira").get(synced_task_id!)).toBeUndefined();
  });

  it("no-ops for a never-synced row (no auto-create on edit)", async () => {
    const { ops, store } = makeOps();
    const out = await reconcileRowTask(ops, "mira", row({ synced_task_id: null }));
    expect(out.synced_task_id).toBeNull();
    expect(store.get("mira")).toBeUndefined();
  });
});

describe("deleteRowTask", () => {
  it("deletes the synced task", async () => {
    const { ops, ofOwner } = makeOps();
    const { synced_task_id } = await addRowToTasks(ops, "mira", "idp-1", row());
    await deleteRowTask(ops, "mira", { synced_task_id });
    expect(ofOwner("mira").get(synced_task_id!)).toBeUndefined();
  });
  it("no-ops when there is no task", async () => {
    const { ops } = makeOps();
    await expect(deleteRowTask(ops, "mira", { synced_task_id: null })).resolves.toBeUndefined();
  });
});

describe("reconcileRowStatusFromTask", () => {
  it("sets the row to done when the trainee completed the task", async () => {
    const { ops } = makeOps();
    const { synced_task_id } = await addRowToTasks(ops, "mira", "idp-1", row());
    await ops.updateTask("mira", synced_task_id!, { is_complete: true });
    const out = await reconcileRowStatusFromTask(ops, "mira", {
      synced_task_id,
      status: "in_progress",
    });
    expect(out.changed).toBe(true);
    expect(out.status).toBe("done");
  });

  it("reverts a done row to in_progress when the task is un-completed", async () => {
    const { ops } = makeOps();
    const { synced_task_id } = await addRowToTasks(ops, "mira", "idp-1", row({ status: "done" }));
    await ops.updateTask("mira", synced_task_id!, { is_complete: false });
    const out = await reconcileRowStatusFromTask(ops, "mira", {
      synced_task_id,
      status: "done",
    });
    expect(out.changed).toBe(true);
    expect(out.status).toBe("in_progress");
  });

  it("no-ops when row and task agree", async () => {
    const { ops } = makeOps();
    const { synced_task_id } = await addRowToTasks(ops, "mira", "idp-1", row({ status: "done" }));
    const out = await reconcileRowStatusFromTask(ops, "mira", {
      synced_task_id,
      status: "done",
    });
    expect(out.changed).toBe(false);
  });

  it("no-ops for an unsynced row", async () => {
    const { ops } = makeOps();
    const out = await reconcileRowStatusFromTask(ops, "mira", {
      synced_task_id: null,
      status: "not_started",
    });
    expect(out.changed).toBe(false);
  });
});

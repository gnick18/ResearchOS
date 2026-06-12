// Check-ins revamp Phase 2 (checkins-phase2 bot, 2026-06-12). Unit coverage for
// the D4 action-item -> Task sync engine, exercised against a tiny in-memory
// TaskSyncOps mock (no file system, no current-user plumbing). Covers the
// create / edit / complete / delete / detach transitions.

import { describe, expect, it } from "vitest";
import {
  reconcileSyncedTask,
  pushCompletionToTask,
  reconcileCompletionFromTask,
  shouldHaveSyncedTask,
  syncedTaskShareList,
  type TaskSyncOps,
  type SyncedTaskDraft,
} from "./action-item-sync";
import type { Task } from "../types";

// A minimal in-memory task store, keyed by owner -> id -> task. Assigns numeric
// ids per owner, mirroring the per-user namespace.
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
  const ops: TaskSyncOps = {
    createTask: async (owner: string, draft: SyncedTaskDraft) => {
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
        assignee: draft.assignee,
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
  return { ops, store };
}

const base = {
  id: "item-1",
  one_on_one_id: "oo-1",
  is_done: false,
};

describe("shouldHaveSyncedTask", () => {
  it("requires BOTH assignee and due_date", () => {
    expect(shouldHaveSyncedTask({ assignee: "a", due_date: "2026-06-12" })).toBe(true);
    expect(shouldHaveSyncedTask({ assignee: "a", due_date: null })).toBe(false);
    expect(shouldHaveSyncedTask({ assignee: null, due_date: "2026-06-12" })).toBe(false);
    expect(shouldHaveSyncedTask({ assignee: null, due_date: null })).toBe(false);
  });
});

describe("syncedTaskShareList", () => {
  it("shares the task with the assignee at edit", () => {
    expect(syncedTaskShareList("alex")).toEqual([{ username: "alex", level: "edit" }]);
  });
});

describe("reconcileSyncedTask: CREATE", () => {
  it("materializes a task when the item first has both fields", async () => {
    const { ops, store } = makeOps();
    const next = { ...base, text: "Send draft", assignee: "alex", due_date: "2026-06-20" };
    const res = await reconcileSyncedTask(ops, "pi", { synced_task_id: null, one_on_one_id: "oo-1", id: "item-1" }, next);
    expect(res.synced_task_id).toBe(1);
    const task = store.get("pi")!.get(1)!;
    expect(task.name).toBe("Send draft");
    expect(task.owner).toBe("pi");
    expect(task.assignee).toBe("alex");
    expect(task.start_date).toBe("2026-06-20");
    expect(task.task_type).toBe("list");
    expect(task.project_id).toBe(0);
    expect(task.shared_with).toEqual([{ username: "alex", level: "edit" }]);
    expect(task.source).toEqual({
      kind: "checkin_action_item",
      one_on_one_id: "oo-1",
      action_item_id: "item-1",
    });
  });

  it("does NOT create a task when only one field is set", async () => {
    const { ops, store } = makeOps();
    const next = { ...base, text: "x", assignee: "alex", due_date: null };
    const res = await reconcileSyncedTask(ops, "pi", { synced_task_id: null, one_on_one_id: "oo-1", id: "item-1" }, next);
    expect(res.synced_task_id).toBeNull();
    expect(store.get("pi")?.size ?? 0).toBe(0);
  });
});

describe("reconcileSyncedTask: EDIT", () => {
  it("updates the existing task name/date/assignee in place", async () => {
    const { ops, store } = makeOps();
    const created = { ...base, text: "v1", assignee: "alex", due_date: "2026-06-20" };
    const r1 = await reconcileSyncedTask(ops, "pi", { synced_task_id: null, one_on_one_id: "oo-1", id: "item-1" }, created);
    const edited = { ...base, text: "v2", assignee: "sam", due_date: "2026-06-25" };
    const r2 = await reconcileSyncedTask(ops, "pi", { synced_task_id: r1.synced_task_id, one_on_one_id: "oo-1", id: "item-1" }, edited);
    expect(r2.synced_task_id).toBe(r1.synced_task_id);
    const task = store.get("pi")!.get(1)!;
    expect(task.name).toBe("v2");
    expect(task.assignee).toBe("sam");
    expect(task.start_date).toBe("2026-06-25");
    expect(task.shared_with).toEqual([{ username: "sam", level: "edit" }]);
  });
});

describe("reconcileSyncedTask: DETACH", () => {
  it("deletes the task and clears the link when the assignee is cleared", async () => {
    const { ops, store } = makeOps();
    const created = { ...base, text: "x", assignee: "alex", due_date: "2026-06-20" };
    const r1 = await reconcileSyncedTask(ops, "pi", { synced_task_id: null, one_on_one_id: "oo-1", id: "item-1" }, created);
    const detached = { ...base, text: "x", assignee: null, due_date: "2026-06-20" };
    const r2 = await reconcileSyncedTask(ops, "pi", { synced_task_id: r1.synced_task_id, one_on_one_id: "oo-1", id: "item-1" }, detached);
    expect(r2.synced_task_id).toBeNull();
    expect(store.get("pi")!.has(1)).toBe(false);
  });

  it("deletes the task when the due date is cleared", async () => {
    const { ops, store } = makeOps();
    const created = { ...base, text: "x", assignee: "alex", due_date: "2026-06-20" };
    const r1 = await reconcileSyncedTask(ops, "pi", { synced_task_id: null, one_on_one_id: "oo-1", id: "item-1" }, created);
    const detached = { ...base, text: "x", assignee: "alex", due_date: null };
    const r2 = await reconcileSyncedTask(ops, "pi", { synced_task_id: r1.synced_task_id, one_on_one_id: "oo-1", id: "item-1" }, detached);
    expect(r2.synced_task_id).toBeNull();
    expect(store.get("pi")!.has(1)).toBe(false);
  });
});

describe("completion sync (both directions)", () => {
  it("pushCompletionToTask mirrors the item's done state onto the task", async () => {
    const { ops, store } = makeOps();
    const created = { ...base, text: "x", assignee: "alex", due_date: "2026-06-20" };
    const r1 = await reconcileSyncedTask(ops, "pi", { synced_task_id: null, one_on_one_id: "oo-1", id: "item-1" }, created);
    await pushCompletionToTask(ops, "pi", { synced_task_id: r1.synced_task_id, is_done: true });
    expect(store.get("pi")!.get(1)!.is_complete).toBe(true);
  });

  it("pushCompletionToTask is a no-op when no synced task exists", async () => {
    const { ops } = makeOps();
    await expect(
      pushCompletionToTask(ops, "pi", { synced_task_id: null, is_done: true }),
    ).resolves.toBeUndefined();
  });

  it("reconcileCompletionFromTask lets the task's completion win on read", async () => {
    const { ops } = makeOps();
    const created = { ...base, text: "x", assignee: "alex", due_date: "2026-06-20" };
    const r1 = await reconcileSyncedTask(ops, "pi", { synced_task_id: null, one_on_one_id: "oo-1", id: "item-1" }, created);
    // Member completes the to-do directly in their Lists view.
    await ops.updateTask("pi", r1.synced_task_id as number, { is_complete: true });
    const reconciled = await reconcileCompletionFromTask(ops, "pi", {
      synced_task_id: r1.synced_task_id,
      is_done: false,
    });
    expect(reconciled).toEqual({ is_done: true, changed: true });
  });

  it("reconcileCompletionFromTask reports no change when already in sync", async () => {
    const { ops } = makeOps();
    const created = { ...base, text: "x", assignee: "alex", due_date: "2026-06-20" };
    const r1 = await reconcileSyncedTask(ops, "pi", { synced_task_id: null, one_on_one_id: "oo-1", id: "item-1" }, created);
    const reconciled = await reconcileCompletionFromTask(ops, "pi", {
      synced_task_id: r1.synced_task_id,
      is_done: false,
    });
    expect(reconciled).toEqual({ is_done: false, changed: false });
  });
});

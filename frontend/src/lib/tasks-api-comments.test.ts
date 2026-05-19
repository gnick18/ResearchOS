// frontend/src/lib/tasks-api-comments.test.ts
//
// Exercises `tasksApi.addComment`, `tasksApi.deleteComment`, and the
// `normalizeTaskRecord` lazy-default for the new `comments` field.
//
// Per Grant's clickable design lock ("Add to experiments, same component,
// mount on TaskDetailPopup"), tasks now carry a comment thread that mirrors
// the Note pattern at `notesApi.addComment` / `deleteComment`. Tests:
//
//   1. addComment writes the new entry to disk.
//   2. deleteComment removes the entry.
//   3. Lazy-normalize: a task on disk without a `comments` field surfaces
//      as `comments: []` in memory (no migration needed).
//   4. Shared-task edit permission: addComment with `owner` argument routes
//      to the owner's directory — mirror of the owner-routing in every other
//      mutating tasks call.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Task, TaskComment } from "./types";

// ── Mock surface ────────────────────────────────────────────────────────────
const memFs = new Map<string, unknown>();

vi.mock("./file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async () => []),
    deleteFile: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("./file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alex"),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { tasksApi } from "./local-api";

function seedTask(overrides: Partial<Task> & { ownerDir?: string } = {}): Task {
  const { ownerDir = "alex", ...rest } = overrides;
  const task: Task = {
    id: 42,
    project_id: 7,
    name: "test task",
    start_date: "2026-05-14",
    duration_days: 1,
    end_date: "2026-05-14",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment",
    weekend_override: null,
    method_ids: [],
    deviation_log: null,
    tags: null,
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [],
    owner: ownerDir,
    shared_with: [],
    comments: [],
    ...rest,
  };
  memFs.set(`users/${ownerDir}/tasks/${task.id}.json`, task);
  return task;
}

beforeEach(() => {
  memFs.clear();
});

describe("tasksApi.addComment", () => {
  it("appends a new TaskComment to the task's comments array on disk", async () => {
    seedTask({ id: 42 });
    const updated = await tasksApi.addComment(42, "Looks good", "kritika");

    expect(updated).not.toBeNull();
    expect(updated!.comments).toHaveLength(1);
    expect(updated!.comments![0]).toMatchObject({
      author: "kritika",
      text: "Looks good",
    });
    expect(updated!.comments![0].id).toBeTruthy();
    expect(updated!.comments![0].created_at).toBeTruthy();

    const persisted = memFs.get("users/alex/tasks/42.json") as Task;
    expect(persisted.comments).toHaveLength(1);
    expect(persisted.comments![0].text).toBe("Looks good");
  });

  it("returns null on whitespace-only text (no write)", async () => {
    seedTask({ id: 42 });
    const result = await tasksApi.addComment(42, "   \n  ", "kritika");
    expect(result).toBeNull();
    const persisted = memFs.get("users/alex/tasks/42.json") as Task;
    expect(persisted.comments ?? []).toHaveLength(0);
  });

  it("preserves prior comments — append-only", async () => {
    const prior: TaskComment = {
      id: "c1",
      author: "alex",
      text: "first",
      created_at: "2026-05-18T12:00:00.000Z",
    };
    seedTask({ id: 42, comments: [prior] });

    await tasksApi.addComment(42, "second", "kritika");
    const persisted = memFs.get("users/alex/tasks/42.json") as Task;
    expect(persisted.comments).toHaveLength(2);
    expect(persisted.comments![0]).toMatchObject({ id: "c1", text: "first" });
    expect(persisted.comments![1].text).toBe("second");
  });
});

describe("tasksApi.deleteComment", () => {
  it("removes the matching comment by id", async () => {
    const c1: TaskComment = {
      id: "c1",
      author: "alex",
      text: "keep me",
      created_at: "2026-05-18T12:00:00.000Z",
    };
    const c2: TaskComment = {
      id: "c2",
      author: "kritika",
      text: "delete me",
      created_at: "2026-05-18T12:05:00.000Z",
    };
    seedTask({ id: 42, comments: [c1, c2] });

    const updated = await tasksApi.deleteComment(42, "c2");
    expect(updated).not.toBeNull();
    expect(updated!.comments).toHaveLength(1);
    expect(updated!.comments![0].id).toBe("c1");

    const persisted = memFs.get("users/alex/tasks/42.json") as Task;
    expect(persisted.comments).toHaveLength(1);
    expect(persisted.comments![0].id).toBe("c1");
  });

  it("no-ops cleanly when the id isn't in the array", async () => {
    const c1: TaskComment = {
      id: "c1",
      author: "alex",
      text: "keep",
      created_at: "2026-05-18T12:00:00.000Z",
    };
    seedTask({ id: 42, comments: [c1] });

    const updated = await tasksApi.deleteComment(42, "missing");
    expect(updated).not.toBeNull();
    expect(updated!.comments).toHaveLength(1);
  });
});

describe("normalizeTaskRecord — lazy default for comments", () => {
  it("surfaces tasks with no `comments` field as `comments: []` on read", async () => {
    // Hand-seed a task on disk WITHOUT the `comments` field — simulating a
    // pre-comments-feature task file. The normalizer at the read boundary
    // should backfill in memory; we never touch the on-disk file.
    const taskOnDisk = {
      id: 42,
      project_id: 7,
      name: "legacy task",
      start_date: "2026-05-14",
      duration_days: 1,
      end_date: "2026-05-14",
      is_high_level: false,
      is_complete: false,
      task_type: "experiment",
      weekend_override: null,
      method_ids: [],
      deviation_log: null,
      tags: null,
      sort_order: 0,
      experiment_color: null,
      sub_tasks: null,
      method_attachments: [],
      owner: "alex",
      shared_with: [],
      // intentionally NO `comments` field
    };
    memFs.set("users/alex/tasks/42.json", taskOnDisk);

    const task = await tasksApi.get(42);
    expect(task).not.toBeNull();
    expect(task!.comments).toEqual([]);
  });
});

describe("tasksApi.addComment — owner routing (shared edit permission)", () => {
  it("routes the write to the owner's tasks directory when `owner` is passed", async () => {
    // Set the current user to alex (the receiver). Seed the task in
    // kritika's tasks directory — that's the owner's file location.
    seedTask({ id: 99, ownerDir: "kritika", owner: "kritika" });

    // alex (the receiver, current user) comments on kritika's shared task
    // with edit permission. The receiver's tasksDetailPopup invokes
    // ownerScopedTasksApi(task).addComment, which routes through this owner
    // argument. The write must land on kritika's file.
    await tasksApi.addComment(99, "Receiver's comment", "alex", "kritika");

    const ownerFile = memFs.get("users/kritika/tasks/99.json") as Task;
    expect(ownerFile).toBeDefined();
    expect(ownerFile.comments).toHaveLength(1);
    expect(ownerFile.comments![0]).toMatchObject({
      author: "alex",
      text: "Receiver's comment",
    });

    // alex's own tasks dir is untouched.
    expect(memFs.get("users/alex/tasks/99.json")).toBeUndefined();
  });

  it("deleteComment also routes to the owner's directory", async () => {
    const c1: TaskComment = {
      id: "c1",
      author: "alex",
      text: "to delete",
      created_at: "2026-05-18T12:00:00.000Z",
    };
    seedTask({ id: 99, ownerDir: "kritika", owner: "kritika", comments: [c1] });

    await tasksApi.deleteComment(99, "c1", "kritika");
    const ownerFile = memFs.get("users/kritika/tasks/99.json") as Task;
    expect(ownerFile.comments).toHaveLength(0);
  });
});

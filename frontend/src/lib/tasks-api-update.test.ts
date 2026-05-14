// frontend/src/lib/tasks-api-update.test.ts
//
// Regression test for `tasksApi.update(id, { project_id: null })`.
//
// The ELN-import BulkSortScreen relies on passing `null` to clear a task's
// project assignment ("(no project)" column). Before the fix, the call sat
// behind a `Parameters<typeof tasksApi.update>[1]` cast because TaskUpdate
// typed `project_id` as `number | undefined`. The cast hid two real risks:
//
//   1. If a stricter `Partial<Task>` write boundary rejected `null`, the call
//      would no-op silently — the row would render unassigned in memory but
//      the disk would still carry the old project_id.
//   2. If `null` got through, it would persist as `project_id: null` —
//      diverging from the create-flow convention (`project_id ?? 0`) and
//      breaking any reader that types `project_id` as `number`.
//
// The fix:
//   - Widen `TaskUpdate.project_id` to `number | null` so callers don't need
//     to cast.
//   - Normalize `null → 0` at the `tasksApi.update` boundary so on-disk
//     records stay `project_id: number` (the canonical "no project"
//     sentinel matches `tasksApi.create`).
//
// This test exercises both halves against an in-memory file-service mock.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Task } from "./types";

// ── Mock surface ────────────────────────────────────────────────────────────
// JsonStore reads from / writes to fileService; we replace its read/write
// methods with an in-memory map so the test owns the on-disk state.

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

function seedTask(overrides: Partial<Task> = {}): Task {
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
    owner: "alex",
    shared_with: [],
    ...overrides,
  };
  // The JsonStore path for the current user's tasks dir.
  memFs.set(`users/alex/tasks/${task.id}.json`, task);
  return task;
}

beforeEach(() => {
  memFs.clear();
});

describe("tasksApi.update — project_id: null", () => {
  it("accepts `project_id: null` from a caller (no cast required)", async () => {
    seedTask({ id: 42, project_id: 7 });
    // The whole point of the type widening: this call typechecks without a
    // `Parameters<typeof tasksApi.update>[1]` cast.
    const result = await tasksApi.update(42, { project_id: null });
    expect(result).not.toBeNull();
  });

  it("normalizes `project_id: null` to `0` on disk (canonical 'no project')", async () => {
    seedTask({ id: 42, project_id: 7 });
    await tasksApi.update(42, { project_id: null });

    const persisted = memFs.get("users/alex/tasks/42.json") as Task;
    expect(persisted).toBeDefined();
    // 0 is the on-disk sentinel for "no project" — matches `tasksApi.create`'s
    // `project_id: data.project_id ?? 0`. A reader that types
    // `task.project_id` as `number` stays correct.
    expect(persisted.project_id).toBe(0);
  });

  it("leaves a numeric project_id untouched", async () => {
    seedTask({ id: 42, project_id: 7 });
    await tasksApi.update(42, { project_id: 11 });

    const persisted = memFs.get("users/alex/tasks/42.json") as Task;
    expect(persisted.project_id).toBe(11);
  });

  it("leaves `project_id` alone when the field isn't in the patch", async () => {
    seedTask({ id: 42, project_id: 7 });
    await tasksApi.update(42, { name: "renamed" });

    const persisted = memFs.get("users/alex/tasks/42.json") as Task;
    expect(persisted.project_id).toBe(7);
    expect(persisted.name).toBe("renamed");
  });
});

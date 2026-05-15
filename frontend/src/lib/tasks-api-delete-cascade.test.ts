// Regression test for the `tasksApi.delete` cascade — specifically the
// step-4 cleanup that recursively removes the task's results subtree
// (notes.md + results.md + per-tab Images/ + Files/ + PDF panels) at
// `users/<owner>/results/task-<id>/` plus the legacy global
// `results/task-<id>/`.
//
// This became load-bearing after the attachment GC (`gcUnreferencedAttachments`)
// was removed alongside the drop-behavior paradigm shift at `e0ffbefb`:
// "attached but not body-referenced" is now a valid state, so per-save
// sweeping over Images/Files was wrong. With that sweep gone, the ONLY
// remaining cleanup mechanism for orphan attachments is this delete-time
// cascade. If it regresses, deleted tasks leave their entire results subtree
// behind on disk.
//
// We mock fileService end-to-end so the test owns disk state and can assert
// exactly which paths the cascade asks to remove.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Task } from "./types";

const memFs = new Map<string, unknown>();
const deletedDirs: string[] = [];

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
    deleteFile: vi.fn(async (path: string) => {
      memFs.delete(path);
      return true;
    }),
    deleteDirectory: vi.fn(async (path: string) => {
      deletedDirs.push(path);
      return true;
    }),
    fileExists: vi.fn(async () => false),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("./file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alex"),
}));

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
  memFs.set(`users/alex/tasks/${task.id}.json`, task);
  return task;
}

beforeEach(() => {
  memFs.clear();
  deletedDirs.length = 0;
});

describe("tasksApi.delete — results-subtree cascade", () => {
  it("recursively removes the canonical per-user results subtree", async () => {
    seedTask({ id: 42, owner: "alex" });
    await tasksApi.delete(42);
    expect(deletedDirs).toContain("users/alex/results/task-42");
  });

  it("also removes the legacy global results subtree for pre-namespacing data", async () => {
    seedTask({ id: 42, owner: "alex" });
    await tasksApi.delete(42);
    expect(deletedDirs).toContain("results/task-42");
  });

  it("removes the task JSON file last so the cascade can read owner + id", async () => {
    seedTask({ id: 99, owner: "alex" });
    await tasksApi.delete(99);
    // Both cascade paths recorded BEFORE the tasksStore.delete writes the
    // tombstone — verifies the cascade ran while the task record was still
    // available to read.
    expect(deletedDirs).toEqual([
      "users/alex/results/task-99",
      "results/task-99",
    ]);
    expect(memFs.has("users/alex/tasks/99.json")).toBe(false);
  });

  it("does not invoke the subtree cascade when the task record is missing", async () => {
    // No seedTask call — store returns null on get.
    await tasksApi.delete(123);
    expect(deletedDirs).toEqual([]);
  });
});

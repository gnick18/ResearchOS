// VC Phase 3 (VC-Phase3-Task sub-bot of HR, 2026-05-31): the save-path wiring
// test for the Task / Experiment pilot. Mirrors notes-entry-history.test.ts.
// `tasksApi.update` (local-api.ts) must, on every tracked save:
//   - record EXACTLY ONE history row with the correct pre/post task states,
//   - route the history file under the TASK OWNER's folder,
//   - thread the optional historyMeta stamp ("revert" / "undo-revert") through,
//   - default historyMeta to {kind:"update"} so existing 2-arg callers are
//     byte-for-byte unchanged,
//   - clear the revert_undo_window field on a `null` clear signal.
//
// We mock `@/lib/history` so `recordTaskHistory` is a spy (the engine itself is
// covered by task-history.test.ts) with the flag forced ON. The fileService +
// indexeddb-store mocks mirror notes-entry-history.test.ts so the real tasksApi
// runs against an in-memory file map.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/types";

interface RecordArgs {
  type: string;
  id: number;
  owner: string;
  actor: string;
  prevState: Task;
  nextState: Task;
  revertTargetVersion?: number;
}

// Spy on recordTaskHistory; keep the flag ON so the update path takes the
// history branch. recordNoteHistory is also exported from the module, so the
// mock must provide it too (local-api imports both). vi.hoisted lets the spies
// exist before the hoisted factory runs.
const { recordTaskHistory, recordNoteHistory } = vi.hoisted(() => ({
  recordTaskHistory: vi.fn(async (_args: RecordArgs): Promise<void> => undefined),
  recordNoteHistory: vi.fn(async (): Promise<void> => undefined),
}));
vi.mock("@/lib/history", () => ({
  HISTORY_ENGINE_ENABLED: true,
  recordTaskHistory,
  recordNoteHistory,
}));

const fakeFiles: Record<string, unknown> = {};

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => fakeFiles[path] ?? null),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      fakeFiles[path] = data;
    }),
    ensureDir: vi.fn(async () => undefined),
    listFiles: vi.fn(async () => []),
    deleteFile: vi.fn(async (path: string) => {
      const had = path in fakeFiles;
      delete fakeFiles[path];
      return had;
    }),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("@/lib/file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "mira"),
}));

import { tasksApi } from "@/lib/local-api";
import { clearCurrentUserCache } from "@/lib/storage/json-store";

function seedTask(owner: string, overrides: Partial<Task> = {}): Task {
  const t = {
    id: 5,
    project_id: 0,
    name: "PCR run",
    start_date: "2026-05-01",
    duration_days: 1,
    end_date: "2026-05-01",
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
    owner,
    shared_with: [],
    ...overrides,
  } as Task;
  fakeFiles[`users/${owner}/tasks/${t.id}.json`] = t;
  return t;
}

beforeEach(() => {
  for (const k of Object.keys(fakeFiles)) delete fakeFiles[k];
  recordTaskHistory.mockClear();
  clearCurrentUserCache();
});

describe("tasksApi.update records version history", () => {
  it("records ONE row with the pre/post task states and defaults kind to 'update'", async () => {
    seedTask("mira");
    const updated = await tasksApi.update(5, {
      deviation_log: "day 2: split 1:4",
    });
    expect(updated?.deviation_log).toBe("day 2: split 1:4");

    expect(recordTaskHistory).toHaveBeenCalledTimes(1);
    const arg = recordTaskHistory.mock.calls[0][0];
    expect(arg.type).toBe("update");
    expect(arg.id).toBe(5);
    expect(arg.owner).toBe("mira");
    expect(arg.prevState.deviation_log).toBeNull();
    expect(arg.nextState.deviation_log).toBe("day 2: split 1:4");
  });

  it("threads a 'revert' historyMeta stamp + target version through", async () => {
    seedTask("mira");
    await tasksApi.update(5, { name: "restored name" }, undefined, {
      kind: "revert",
      revert_target_version: 2,
    });
    expect(recordTaskHistory).toHaveBeenCalledTimes(1);
    const arg = recordTaskHistory.mock.calls[0][0];
    expect(arg.type).toBe("revert");
    expect(arg.revertTargetVersion).toBe(2);
  });

  it("owner-routed edits record history under the TARGET owner's folder", async () => {
    seedTask("alex");
    await tasksApi.update(5, { name: "pi edit" }, "alex");
    expect(recordTaskHistory).toHaveBeenCalledTimes(1);
    expect(recordTaskHistory.mock.calls[0][0].owner).toBe("alex");
  });

  it("a missing task short-circuits without recording history", async () => {
    const result = await tasksApi.update(404, { name: "x" });
    expect(result).toBeNull();
    expect(recordTaskHistory).not.toHaveBeenCalled();
  });

  it("clears the revert_undo_window field on a null clear signal", async () => {
    seedTask("mira", {
      revert_undo_window: {
        from_version: 3,
        to_version: 1,
        reverted_at: "2026-05-31T12:00:00.000Z",
        expires_at: "2026-06-01T12:00:00.000Z",
        reverted_by: "mira",
      },
    });
    const updated = await tasksApi.update(5, { revert_undo_window: null });
    // The live task no longer carries the window field.
    expect(updated?.revert_undo_window).toBeUndefined();
    const onDisk = fakeFiles["users/mira/tasks/5.json"] as Task;
    expect("revert_undo_window" in onDisk).toBe(false);
  });
});

// frontend/src/lib/engine/dep-semantics.test.ts
//
// Locks in the strict-gap semantics for the three dependency types
// (FS, SS, SF) as resolved by `shiftTask`'s downstream cascade. Added
// alongside the 2026-05-27 SF bug fix (dep semantics manager).
//
// Convention (post-fix):
//   FS (Finish-Start): child.start = parent.end + 1     (strict gap, day after)
//   SS (Start-Start):  child.start = parent.start       (exact overlap on day 1)
//   SF (Start-Finish): child.end   = parent.start - 1   (strict gap, day before)
//
// All three are exercised here for duration_days = 1 and duration_days = 3.
// The "before fix" SF behavior (child.end = parent.start, same-day overlap)
// would fail these assertions: a child duration-1 task whose parent starts
// 2026-06-05 used to land on 2026-06-05 itself; post-fix it lands on
// 2026-06-04 (one day strictly before).
//
// Test surface: drive `shiftTask` on a fresh in-memory file service so the
// downstream cascade walks each dep type and writes the recomputed child
// start_date back to the store.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Task, Project, Dependency } from "../types";

const memFs = new Map<string, unknown>();
const currentUser = "alex";

vi.mock("../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async (dirPath: string) => {
      // Return the basenames of any memFs entries directly under dirPath.
      const prefix = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
      const names: string[] = [];
      for (const key of memFs.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (rest.includes("/")) continue;
        names.push(rest);
      }
      return names;
    }),
    deleteFile: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("../file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => currentUser),
}));

// Imports must come after the mocks.
import { shiftTask } from "./shift";
import { parseDate } from "./dates";
import { clearCurrentUserCache } from "../storage/json-store";

function seedProject(weekendActive: boolean): Project {
  const project: Project = {
    id: 1,
    name: "test project",
    weekend_active: weekendActive,
    tags: null,
    color: null,
    created_at: "2026-01-01T00:00:00Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: currentUser,
    shared_with: [],
  };
  memFs.set(`users/${currentUser}/projects/1.json`, project);
  return project;
}

function seedTask(overrides: Partial<Task> & { id: number; start_date: string; duration_days: number }): Task {
  const task: Task = {
    project_id: 1,
    name: `task ${overrides.id}`,
    end_date: overrides.start_date, // will be recomputed by the engine on shift
    is_high_level: false,
    is_complete: false,
    task_type: "experiment",
    weekend_override: true, // weekend-active so the date math is calendar-arithmetic
    method_ids: [],
    deviation_log: null,
    tags: null,
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [],
    owner: currentUser,
    shared_with: [],
    ...overrides,
  } as Task;
  memFs.set(`users/${currentUser}/tasks/${task.id}.json`, task);
  return task;
}

function seedDep(id: number, parentId: number, childId: number, depType: "FS" | "SS" | "SF"): Dependency {
  const dep: Dependency = {
    id,
    parent_id: parentId,
    child_id: childId,
    dep_type: depType,
  };
  memFs.set(`users/${currentUser}/dependencies/${id}.json`, dep);
  return dep;
}

function readTask(id: number): Task {
  const t = memFs.get(`users/${currentUser}/tasks/${id}.json`) as Task | undefined;
  if (!t) throw new Error(`task ${id} missing from memFs`);
  return t;
}

beforeEach(() => {
  memFs.clear();
  clearCurrentUserCache();
  seedProject(true);
});

describe("dep semantics: strict-gap convention (FS / SS / SF)", () => {
  // ── FS ────────────────────────────────────────────────────────────────────
  //   child.start = parent.end + 1 (strict gap)

  it("FS, duration 1: child starts the day AFTER parent ends", async () => {
    seedTask({ id: 1, start_date: "2026-06-05", duration_days: 1 }); // parent
    seedTask({ id: 2, start_date: "2026-06-05", duration_days: 1 }); // child, currently overlapping
    seedDep(10, 1, 2, "FS");

    // Move parent to 2026-06-10 (Wednesday). Cascade should push child to 06-11.
    await shiftTask(1, parseDate("2026-06-10"), true);

    expect(readTask(1).start_date).toBe("2026-06-10");
    expect(readTask(2).start_date).toBe("2026-06-11");
  });

  it("FS, duration 3: child starts the day after parent's 3-day window ends", async () => {
    seedTask({ id: 1, start_date: "2026-06-05", duration_days: 3 }); // parent (5,6,7)
    seedTask({ id: 2, start_date: "2026-06-05", duration_days: 3 }); // child
    seedDep(10, 1, 2, "FS");

    await shiftTask(1, parseDate("2026-06-10"), true);

    expect(readTask(1).start_date).toBe("2026-06-10");
    // parent ends 2026-06-12; child starts 2026-06-13
    expect(readTask(2).start_date).toBe("2026-06-13");
  });

  // ── SS ────────────────────────────────────────────────────────────────────
  //   child.start = parent.start (exact overlap on day 1)

  it("SS, duration 1: child starts on the SAME day as parent", async () => {
    seedTask({ id: 1, start_date: "2026-06-05", duration_days: 1 });
    seedTask({ id: 2, start_date: "2026-06-05", duration_days: 1 });
    seedDep(10, 1, 2, "SS");

    await shiftTask(1, parseDate("2026-06-10"), true);

    expect(readTask(1).start_date).toBe("2026-06-10");
    expect(readTask(2).start_date).toBe("2026-06-10");
  });

  it("SS, duration 3: child still starts on the same day as parent", async () => {
    seedTask({ id: 1, start_date: "2026-06-05", duration_days: 3 });
    seedTask({ id: 2, start_date: "2026-06-05", duration_days: 3 });
    seedDep(10, 1, 2, "SS");

    await shiftTask(1, parseDate("2026-06-10"), true);

    expect(readTask(2).start_date).toBe("2026-06-10");
  });

  // ── SF ────────────────────────────────────────────────────────────────────
  //   child.end = parent.start - 1 (strict gap, day BEFORE)
  //   child.start = parent.start - duration

  it("SF, duration 1: child FINISHES the day BEFORE parent starts (no overlap)", async () => {
    seedTask({ id: 1, start_date: "2026-06-05", duration_days: 1 }); // parent
    // Seed child with an unrelated date so we can prove the cascade rewrites it.
    seedTask({ id: 2, start_date: "2026-05-01", duration_days: 1 });
    seedDep(10, 1, 2, "SF");

    // Move parent to 2026-06-10. Cascade should pull child onto 06-09.
    await shiftTask(1, parseDate("2026-06-10"), true);

    expect(readTask(1).start_date).toBe("2026-06-10");
    // Strict-gap: child.start = parent.start - duration = 06-10 - 1 = 06-09.
    // Crucially NOT 06-10 (which was the buggy "same day" overlap).
    expect(readTask(2).start_date).toBe("2026-06-09");
    expect(readTask(2).start_date).not.toBe(readTask(1).start_date);
  });

  it("SF, duration 3: child's 3-day window ends the day before parent starts", async () => {
    seedTask({ id: 1, start_date: "2026-06-10", duration_days: 3 }); // parent (10,11,12)
    seedTask({ id: 2, start_date: "2026-05-01", duration_days: 3 });
    seedDep(10, 1, 2, "SF");

    await shiftTask(1, parseDate("2026-06-15"), true);

    expect(readTask(1).start_date).toBe("2026-06-15");
    // child.start = parent.start - duration = 06-15 - 3 = 06-12.
    // child runs 06-12, 06-13, 06-14; ends 06-14; parent starts 06-15. Gap of 1 day.
    expect(readTask(2).start_date).toBe("2026-06-12");
  });

  // ── Upstream cascade (child shifted, parent follows) ─────────────────────

  it("SF upstream: shifting the child forward pushes the parent to (child.end + 1)", async () => {
    // SF means: child finishes BEFORE parent starts. So if the child moves
    // later, the parent must move later too (parent.start = child.end + 1).
    seedTask({ id: 1, start_date: "2026-06-20", duration_days: 1 }); // parent
    seedTask({ id: 2, start_date: "2026-06-05", duration_days: 1 }); // child
    seedDep(10, 1, 2, "SF");

    // Push the child to 2026-06-10. Parent should land on 06-11.
    await shiftTask(2, parseDate("2026-06-10"), true);

    expect(readTask(2).start_date).toBe("2026-06-10");
    expect(readTask(1).start_date).toBe("2026-06-11");
  });
});

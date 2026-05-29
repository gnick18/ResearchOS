// getProjectsWithProgress task breakdown (single-project-widget bot,
// 2026-05-29).
//
// The Single-Project + Projects Overview widgets render an at-a-glance
// Active / Overdue / Upcoming counts row off the per-project breakdown this
// reader computes. This test pins that arithmetic against the OLD Home
// project-card logic:
//   - taskUpcoming = incomplete && start_date >= today
//   - taskOverdue  = incomplete && end_date   <  today
//   - taskActive   = incomplete && start_date <= today && end_date >= today
// with `today` derived as the LOCAL calendar day, and completed tasks never
// counted in any of the three buckets.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── In-memory file service (mirrors weekly-goals-api.test.ts) ──────────────
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
    listFiles: vi.fn(async (dir: string) => {
      const prefix = `${dir}/`;
      const names: string[] = [];
      for (const key of memFs.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (rest.includes("/")) continue; // direct children only
        names.push(rest);
      }
      return names;
    }),
    deleteFile: vi.fn(async (path: string) => memFs.delete(path)),
    isConnected: vi.fn(() => true),
  },
}));

// Single-user lab: morgan owns the project under test.
vi.mock("./file-system/user-discovery", () => ({
  discoverUsers: vi.fn(async () => ["morgan"]),
}));

// Mirror the sibling node test files (comment-notifications, weekly-goals):
// the node project shares one worker without per-file isolation, so we mock
// the same `indexeddb-store.getCurrentUser` surface they do and clear the
// `local-api` current-user cache in `beforeEach`. Without this, the
// module-level `getCurrentUserCached` singleton can leak a stale user from
// this file into the next file that runs in the same worker.
vi.mock("./file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "morgan"),
}));

import { labApi } from "./local-api";
import { clearCurrentUserCache } from "./storage/json-store";

// We derive task dates RELATIVE to the real local "today" rather than
// freezing the clock: `getProjectsWithProgress` derives today from
// `new Date()`, and using `vi.useFakeTimers()` here leaks the patched
// `setTimeout` into sibling test files that `await` real timers, so we
// avoid fake timers entirely and just offset off the real day.
function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}
function offsetDays(days: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // noon: dodge midnight UTC/local rollover
  d.setDate(d.getDate() + days);
  return ymd(d);
}
const TODAY = ymd((() => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
})());

function seedProject(id: number, fields: Record<string, unknown>) {
  memFs.set(`users/morgan/projects/${id}.json`, {
    id,
    name: `Project ${id}`,
    owner: "morgan",
    color: "#3b82f6",
    is_hidden: false,
    is_archived: false,
    shared_with: [],
    ...fields,
  });
}

function seedTask(
  id: number,
  fields: {
    project_id: number;
    start_date: string;
    end_date: string;
    is_complete: boolean;
  },
) {
  memFs.set(`users/morgan/tasks/${id}.json`, {
    id,
    name: `Task ${id}`,
    owner: "morgan",
    ...fields,
  });
}

beforeEach(() => {
  memFs.clear();
  clearCurrentUserCache();
});

describe("getProjectsWithProgress: Active/Overdue/Upcoming breakdown", () => {
  it("buckets a mix of complete / overdue / upcoming / in-progress tasks", async () => {
    seedProject(1, {});

    // Two ACTIVE (span today). Both start in the PAST so they sit cleanly
    // in the active bucket only (a task starting exactly today would also
    // count as upcoming under the old-card boundary; covered separately).
    seedTask(10, {
      project_id: 1,
      start_date: offsetDays(-3),
      end_date: offsetDays(12),
      is_complete: false,
    });
    seedTask(11, {
      project_id: 1,
      start_date: offsetDays(-9),
      end_date: TODAY,
      is_complete: false,
    });
    // One OVERDUE (end_date strictly before today).
    seedTask(12, {
      project_id: 1,
      start_date: offsetDays(-28),
      end_date: offsetDays(-1),
      is_complete: false,
    });
    // One UPCOMING (start_date in the future).
    seedTask(13, {
      project_id: 1,
      start_date: offsetDays(3),
      end_date: offsetDays(7),
      is_complete: false,
    });
    // One COMPLETE task that, were it open, would be active, must NOT be
    // counted in any bucket (and lifts taskCompleted).
    seedTask(14, {
      project_id: 1,
      start_date: offsetDays(-9),
      end_date: offsetDays(12),
      is_complete: true,
    });

    const projects = await labApi.getProjectsWithProgress();
    const p = projects.find((x) => x.id === 1);
    expect(p).toBeDefined();

    expect(p!.taskTotal).toBe(5);
    expect(p!.taskCompleted).toBe(1);
    expect(p!.taskIncomplete).toBe(4);

    // The new breakdown fields.
    expect(p!.taskActive).toBe(2);
    expect(p!.taskOverdue).toBe(1);
    expect(p!.taskUpcoming).toBe(1);
  });

  it("a task whose end_date is exactly today is ACTIVE, not overdue", async () => {
    seedProject(2, {});
    seedTask(20, {
      project_id: 2,
      start_date: offsetDays(-4),
      end_date: TODAY, // boundary: end_date === today
      is_complete: false,
    });

    const projects = await labApi.getProjectsWithProgress();
    const p = projects.find((x) => x.id === 2)!;
    expect(p.taskActive).toBe(1);
    expect(p.taskOverdue).toBe(0);
    expect(p.taskUpcoming).toBe(0);
  });

  it("a task whose start_date is exactly today is both UPCOMING and ACTIVE (old-card boundary)", async () => {
    // The old cards counted upcoming as start_date >= today and active as
    // start_date <= today && end_date >= today, so a task starting today
    // lands in BOTH buckets at the boundary. We preserve that verbatim.
    seedProject(3, {});
    seedTask(30, {
      project_id: 3,
      start_date: TODAY,
      end_date: offsetDays(12),
      is_complete: false,
    });

    const projects = await labApi.getProjectsWithProgress();
    const p = projects.find((x) => x.id === 3)!;
    expect(p.taskUpcoming).toBe(1);
    expect(p.taskActive).toBe(1);
    expect(p.taskOverdue).toBe(0);
  });
});

// Weekly goals widget (PI beta feedback, weekly-goals widget, 2026-05-29).
//
// Exercises the WeeklyGoal data layer end to end against an in-memory file
// service (the same harness `tasks-api-comments.test.ts` uses):
//
//   1. Round-trip: weeklyGoalsApi.create writes a record to the owner's
//      `weekly_goals` dir; list/get read it back; update + delete mutate it.
//   2. Sharing defaults: a new goal defaults to whole-lab shared ("*") with
//      is_shared=true so the PI can see it; flipping is_shared rewrites
//      shared_with in lockstep.
//   3. The sharing/privacy gate for the lab aggregation: a PRIVATE goal and
//      a goal shared with a DIFFERENT user are excluded for a PI viewer.
//      `labApi.getWeeklyGoals({ shared_only })` is GATE 1 (is_shared); the
//      widget layers `canRead` as GATE 2 (asserted here directly against
//      the unified primitive on the aggregation output).

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WeeklyGoal } from "../types";
import { canRead } from "../sharing/unified";

// ── In-memory file service ────────────────────────────────────────────────
const memFs = new Map<string, unknown>();

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
    // listFiles returns the basenames of every memFs key directly under
    // `dir/` (one level deep), mirroring the real fileService contract that
    // JsonStore.listAllForUser depends on.
    listFiles: vi.fn(async (dir: string) => {
      const prefix = `${dir}/`;
      const names: string[] = [];
      for (const key of memFs.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (rest.includes("/")) continue; // not a direct child
        names.push(rest);
      }
      return names;
    }),
    deleteFile: vi.fn(async (path: string) => memFs.delete(path)),
    isConnected: vi.fn(() => true),
  },
}));

// Current user is the trainee 'morgan' for the CRUD tests.
vi.mock("../file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "morgan"),
}));

// Lab roster for the aggregation: pat (PI), morgan + alex (trainees).
vi.mock("../file-system/user-discovery", () => ({
  discoverUsers: vi.fn(async () => ["pat", "morgan", "alex"]),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────
import { weeklyGoalsApi, labApi } from "../local-api";
import { clearCurrentUserCache } from "../storage/json-store";

beforeEach(() => {
  memFs.clear();
  clearCurrentUserCache();
});

describe("weeklyGoalsApi round-trip", () => {
  it("creates a goal in the owner's weekly_goals dir and reads it back", async () => {
    const created = await weeklyGoalsApi.create({
      text: "Finish the western blots",
      week_of: "2026-05-25",
    });

    // Landed in morgan's dir at the JsonStore numeric-id path.
    expect(created.owner).toBe("morgan");
    expect(created.created_by).toBe("morgan");
    expect(created.text).toBe("Finish the western blots");
    expect(created.week_of).toBe("2026-05-25");
    expect(created.is_complete).toBe(false);
    expect(memFs.has(`users/morgan/weekly_goals/${created.id}.json`)).toBe(true);

    const fetched = await weeklyGoalsApi.get(created.id);
    expect(fetched).toMatchObject({ id: created.id, text: "Finish the western blots" });

    const listed = await weeklyGoalsApi.list();
    expect(listed.map((g) => g.id)).toContain(created.id);
  });

  it("defaults a new goal to whole-lab shared so the PI can see it", async () => {
    const created = await weeklyGoalsApi.create({ text: "Default sharing" });
    expect(created.is_shared).toBe(true);
    expect(created.shared_with).toEqual([{ username: "*", level: "read" }]);
  });

  it("creates a private goal when is_shared:false is passed", async () => {
    const created = await weeklyGoalsApi.create({
      text: "Private goal",
      is_shared: false,
    });
    expect(created.is_shared).toBe(false);
    expect(created.shared_with).toEqual([]);
  });

  it("toggles is_complete and keeps is_shared <-> shared_with in lockstep on update", async () => {
    const created = await weeklyGoalsApi.create({ text: "Toggle me" });

    const done = await weeklyGoalsApi.update(created.id, { is_complete: true });
    expect(done?.is_complete).toBe(true);
    // Update without touching is_shared leaves shared_with intact.
    expect(done?.shared_with).toEqual([{ username: "*", level: "read" }]);

    const madePrivate = await weeklyGoalsApi.update(created.id, {
      is_shared: false,
    });
    expect(madePrivate?.is_shared).toBe(false);
    expect(madePrivate?.shared_with).toEqual([]);

    const reshared = await weeklyGoalsApi.update(created.id, {
      is_shared: true,
    });
    expect(reshared?.shared_with).toEqual([{ username: "*", level: "read" }]);
  });

  it("deletes a goal", async () => {
    const created = await weeklyGoalsApi.create({ text: "Delete me" });
    await weeklyGoalsApi.delete(created.id);
    expect(memFs.has(`users/morgan/weekly_goals/${created.id}.json`)).toBe(false);
    expect(await weeklyGoalsApi.get(created.id)).toBeNull();
  });
});

describe("labApi.getWeeklyGoals — sharing / privacy gate", () => {
  // Seed morgan's goals directly on disk: whole-lab, PI-explicit, private,
  // and shared-with-alex-only. Mirrors the note fixtures shape.
  function seedMorganGoals() {
    const goals: WeeklyGoal[] = [
      {
        id: 1,
        owner: "morgan",
        text: "whole-lab goal",
        week_of: "2026-05-25",
        is_complete: false,
        created_at: "2026-05-25T09:00:00.000Z",
        created_by: "morgan",
        is_shared: true,
        shared_with: [{ username: "*", level: "read" }],
      },
      {
        id: 2,
        owner: "morgan",
        text: "PI-explicit goal",
        week_of: "2026-05-25",
        is_complete: false,
        created_at: "2026-05-25T09:01:00.000Z",
        created_by: "morgan",
        is_shared: true,
        shared_with: [{ username: "pat", level: "read" }],
      },
      {
        id: 3,
        owner: "morgan",
        text: "PRIVATE goal",
        week_of: "2026-05-25",
        is_complete: false,
        created_at: "2026-05-25T09:02:00.000Z",
        created_by: "morgan",
        is_shared: false,
        shared_with: [],
      },
      {
        id: 4,
        owner: "morgan",
        text: "alex-only goal",
        week_of: "2026-05-25",
        is_complete: false,
        created_at: "2026-05-25T09:03:00.000Z",
        created_by: "morgan",
        is_shared: true,
        shared_with: [{ username: "alex", level: "read" }],
      },
    ];
    for (const g of goals) {
      memFs.set(`users/morgan/weekly_goals/${g.id}.json`, g);
    }
  }

  it("GATE 1 (shared_only) drops the private goal from the dataset", async () => {
    seedMorganGoals();
    const shared = await labApi.getWeeklyGoals({ shared_only: true });
    const texts = shared.map((g) => g.text);
    expect(texts).not.toContain("PRIVATE goal");
    // Non-private goals all survive GATE 1.
    expect(texts).toEqual(
      expect.arrayContaining(["whole-lab goal", "PI-explicit goal", "alex-only goal"]),
    );
  });

  it("GATE 2 (canRead) excludes the alex-only goal for a PI viewer who is NOT lab_head-bypassing", async () => {
    seedMorganGoals();
    const shared = await labApi.getWeeklyGoals({ shared_only: true });

    // Apply the precise per-viewer gate the widget uses. Model the PI as a
    // plain "lab" account (no implicit view-all) so canRead does the work:
    // the PI sees the whole-lab goal + the PI-explicit goal, but NOT the
    // alex-only goal and NOT the private goal (already gone via GATE 1).
    const viewer = { username: "pat", account_type: "lab" as const };
    const visible = shared.filter((g) =>
      canRead({ owner: g.owner, shared_with: g.shared_with ?? [] }, viewer),
    );
    const texts = visible.map((g) => g.text);

    expect(texts).toContain("whole-lab goal");
    expect(texts).toContain("PI-explicit goal");
    expect(texts).not.toContain("alex-only goal");
    expect(texts).not.toContain("PRIVATE goal");
  });

  it("a lab_head viewer sees every SHARED goal (view-all) but never the private one", async () => {
    seedMorganGoals();
    const shared = await labApi.getWeeklyGoals({ shared_only: true });

    const labHead = { username: "pat", account_type: "lab_head" as const };
    const visible = shared.filter((g) =>
      canRead({ owner: g.owner, shared_with: g.shared_with ?? [] }, labHead),
    );
    const texts = visible.map((g) => g.text);

    // view-all sees the alex-only goal too (it passed GATE 1)...
    expect(texts).toContain("alex-only goal");
    // ...but the private goal NEVER entered the dataset (GATE 1).
    expect(texts).not.toContain("PRIVATE goal");
  });
});

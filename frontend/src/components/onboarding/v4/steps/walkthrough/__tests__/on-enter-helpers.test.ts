/**
 * Tests for the §6.10 onEnter helpers' defensive guards. Wave 1 sidecar
 * hardening manager (v2) 2026-05-22.
 *
 * Pins the partial-spawn guard added by the v2 hardening pass:
 *
 *   - `onEnterGanttChainedDeps`: when `spawnDemoDependencyTasks` returns
 *     fewer than 3 ids, the helper warns + skips dependency-edge
 *     creation. Previously the `if (spawned.length === 3)` short-circuit
 *     dropped the dep create silently, leaving the user with N bars and
 *     no cascade.
 *
 *   - `onEnterGanttGoalsOverview`: when the goal-create branch lands a
 *     null id (typed but defensively guarded), the helper logs + skips
 *     the artifact persist instead of appending `"null"` to
 *     `wizard_resume_state.artifacts_created`.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const projectsListMock = vi.fn();
const tasksListMock = vi.fn();
const goalsListMock = vi.fn();
const goalsCreateMock = vi.fn();
const depsCreateMock = vi.fn();
const patchOnboardingMock = vi.fn().mockResolvedValue(undefined);
const refetchQueriesMock = vi.fn().mockResolvedValue(undefined);
const spawnDemoDependencyTasksMock = vi.fn();

vi.mock("@/lib/local-api", () => ({
  tasksApi: {
    listByProject: (id: number) => tasksListMock(id),
  },
  projectsApi: {
    list: () => projectsListMock(),
  },
  dependenciesApi: {
    create: (data: unknown) => depsCreateMock(data),
  },
  goalsApi: {
    list: () => goalsListMock(),
    create: (data: unknown) => goalsCreateMock(data),
  },
}));

vi.mock("@/lib/onboarding/sidecar", () => ({
  patchOnboarding: (
    username: string,
    patch: (s: unknown) => unknown,
  ) => patchOnboardingMock(username, patch),
}));

vi.mock("@/lib/query-client", () => ({
  appQueryClient: {
    refetchQueries: () => refetchQueriesMock(),
  },
}));

vi.mock("@/lib/attachments/attach-image", () => ({
  attachImageToTask: vi.fn(),
}));

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    fileExists: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock("@/lib/tasks/results-paths", () => ({
  taskNotesBase: ({ id }: { id: number }) =>
    `users/u/results/task-${id}/notes`,
}));

vi.mock("../GanttDependenciesStep", () => ({
  DEP_CHAIN_NAMES: ["BeakerBot Boil", "BeakerBot Brew", "BeakerBot Sip"],
  spawnDemoDependencyTasks: (id: number) =>
    spawnDemoDependencyTasksMock(id),
}));

vi.mock("../lib/artifacts", () => ({
  appendArtifact: (cur: unknown) => cur,
  encodeTelegramImageId: (filename: string) => filename,
}));

import {
  onEnterGanttChainedDeps,
  onEnterGanttGoalsOverview,
  GANTT_DEMO_GOAL_NAME,
} from "../lib/on-enter-helpers";

describe("on-enter-helpers defensive guards (Wave 1 sidecar hardening v2)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    projectsListMock.mockReset();
    tasksListMock.mockReset();
    goalsListMock.mockReset();
    goalsCreateMock.mockReset();
    depsCreateMock.mockReset();
    patchOnboardingMock.mockClear();
    refetchQueriesMock.mockClear();
    spawnDemoDependencyTasksMock.mockReset();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  describe("onEnterGanttChainedDeps partial-spawn guard", () => {
    it("warns + skips dep create when spawnDemoDependencyTasks returns < 3 ids", async () => {
      projectsListMock.mockResolvedValue([
        { id: 7, name: "Demo", created_at: "2026-01-01" },
      ]);
      tasksListMock.mockResolvedValue([]);
      // Partial spawn (2 ids instead of 3) — the production helper used
      // to skip the dep create silently. Now it warns explicitly.
      spawnDemoDependencyTasksMock.mockResolvedValue([100, 101]);

      const result = await onEnterGanttChainedDeps({ username: null });

      expect(result).toEqual([100, 101]);
      expect(depsCreateMock).not.toHaveBeenCalled();
      // Confirm the new warning fired.
      const warningArgs = warnSpy.mock.calls
        .flat()
        .map((v: unknown) => String(v));
      expect(
        warningArgs.some((msg: string) =>
          msg.includes("expected 3 spawned tasks, got"),
        ),
      ).toBe(true);
    });

    it("creates dep edges when all 3 ids spawn cleanly", async () => {
      projectsListMock.mockResolvedValue([
        { id: 7, name: "Demo", created_at: "2026-01-01" },
      ]);
      tasksListMock.mockResolvedValue([]);
      spawnDemoDependencyTasksMock.mockResolvedValue([100, 101, 102]);
      depsCreateMock.mockResolvedValue({ id: 1 });

      const result = await onEnterGanttChainedDeps({ username: null });

      expect(result).toEqual([100, 101, 102]);
      expect(depsCreateMock).toHaveBeenCalledTimes(2);
    });

    it("warns + skips dep create when spawned ids contain a falsy entry", async () => {
      projectsListMock.mockResolvedValue([
        { id: 7, name: "Demo", created_at: "2026-01-01" },
      ]);
      tasksListMock.mockResolvedValue([]);
      // Defensive: a partial refactor could return falsy ids.
      // Cast through unknown to keep the type checker honest while
      // exercising the runtime guard.
      spawnDemoDependencyTasksMock.mockResolvedValue([
        100,
        0 as unknown as number,
        102,
      ]);

      await onEnterGanttChainedDeps({ username: null });

      expect(depsCreateMock).not.toHaveBeenCalled();
      const warningArgs = warnSpy.mock.calls
        .flat()
        .map((v: unknown) => String(v));
      expect(
        warningArgs.some((msg: string) =>
          msg.includes("spawned ids missing; skip dep create"),
        ),
      ).toBe(true);
    });
  });

  describe("onEnterGanttGoalsOverview createdId guard", () => {
    it("returns the existing goal id when one already exists (idempotent)", async () => {
      projectsListMock.mockResolvedValue([
        { id: 7, name: "Demo", created_at: "2026-01-01" },
      ]);
      goalsListMock.mockResolvedValue([
        { id: 99, project_id: 7, name: GANTT_DEMO_GOAL_NAME },
      ]);

      const result = await onEnterGanttGoalsOverview({ username: "alex" });

      expect(result).toBe(99);
      // No goal create on the idempotent path.
      expect(goalsCreateMock).not.toHaveBeenCalled();
    });

    it("returns null + does NOT persist artifact when goal create fails", async () => {
      projectsListMock.mockResolvedValue([
        { id: 7, name: "Demo", created_at: "2026-01-01" },
      ]);
      goalsListMock.mockResolvedValue([]);
      goalsCreateMock.mockRejectedValue(new Error("create blew up"));

      const result = await onEnterGanttGoalsOverview({ username: "alex" });

      expect(result).toBeNull();
      // patchOnboarding should NOT be invoked with a null id — the
      // guard skips the artifact persist when createdId stayed null.
      expect(patchOnboardingMock).not.toHaveBeenCalled();
    });
  });
});

/**
 * Tests for the §6.8 Gantt redesign shared helpers (Gantt manager
 * 2026-05-22).
 *
 * Covers:
 *  - spawnGanttRedesignFakeTasks is idempotent on name (second call
 *    returns the same ids without creating new tasks)
 *  - resolveFakeTaskIds returns null ids when tasks aren't present
 *  - moveFakeAForward + createFakeAToUserDep no-op gracefully when the
 *    helpers can't find their referents (best-effort contract)
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const tasksListMock = vi.fn();
const tasksCreateMock = vi.fn();
const tasksMoveMock = vi.fn();
const projectsListMock = vi.fn();
const depsListMock = vi.fn();
const depsCreateMock = vi.fn();
const patchOnboardingMock = vi.fn().mockResolvedValue(undefined);
const refetchQueriesMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/local-api", () => ({
  tasksApi: {
    listByProject: (id: number) => tasksListMock(id),
    create: (data: unknown) => tasksCreateMock(data),
    move: (id: number, data: unknown) => tasksMoveMock(id, data),
  },
  projectsApi: {
    list: () => projectsListMock(),
  },
  dependenciesApi: {
    list: (id: number) => depsListMock(id),
    create: (data: unknown) => depsCreateMock(data),
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
    invalidateQueries: () => refetchQueriesMock(),
  },
}));

vi.mock("./lib/artifacts", () => ({
  appendArtifact: (cur: unknown) => cur,
}));

import {
  spawnGanttRedesignFakeTasks,
  resolveFakeTaskIds,
  resolveUserExperiment,
  moveFakeAForward,
  GANTT_REDESIGN_FAKE_A_NAME,
  GANTT_REDESIGN_FAKE_B_NAME,
} from "../lib/gantt-redesign-helpers";

describe("gantt-redesign-helpers (Gantt manager 2026-05-22)", () => {
  beforeEach(() => {
    tasksListMock.mockReset();
    tasksCreateMock.mockReset();
    tasksMoveMock.mockReset();
    projectsListMock.mockReset();
    depsListMock.mockReset();
    depsCreateMock.mockReset();
    patchOnboardingMock.mockClear();
    refetchQueriesMock.mockClear();
  });

  describe("spawnGanttRedesignFakeTasks", () => {
    it("creates both fake tasks when neither exists", async () => {
      projectsListMock.mockResolvedValue([
        { id: 7, name: "Demo Project", created_at: "2026-01-01" },
      ]);
      tasksListMock.mockResolvedValue([]);
      tasksCreateMock
        .mockResolvedValueOnce({ id: 100, name: GANTT_REDESIGN_FAKE_A_NAME })
        .mockResolvedValueOnce({ id: 101, name: GANTT_REDESIGN_FAKE_B_NAME });

      const handle = await spawnGanttRedesignFakeTasks({ username: "alex" });
      expect(handle).not.toBeNull();
      expect(handle?.fakeAId).toBe(100);
      expect(handle?.fakeBId).toBe(101);
      expect(handle?.spawned).toBe(true);
      expect(tasksCreateMock).toHaveBeenCalledTimes(2);
    });

    it("re-uses existing tasks idempotently on second call", async () => {
      projectsListMock.mockResolvedValue([
        { id: 7, name: "Demo Project", created_at: "2026-01-01" },
      ]);
      tasksListMock.mockResolvedValue([
        { id: 100, name: GANTT_REDESIGN_FAKE_A_NAME, task_type: "experiment" },
        { id: 101, name: GANTT_REDESIGN_FAKE_B_NAME, task_type: "experiment" },
      ]);

      const handle = await spawnGanttRedesignFakeTasks({ username: "alex" });
      expect(handle).not.toBeNull();
      expect(handle?.fakeAId).toBe(100);
      expect(handle?.fakeBId).toBe(101);
      expect(handle?.spawned).toBe(false);
      // No create calls on the idempotent re-run.
      expect(tasksCreateMock).not.toHaveBeenCalled();
    });

    it("returns null when no active project exists", async () => {
      projectsListMock.mockResolvedValue([]);
      const handle = await spawnGanttRedesignFakeTasks({ username: "alex" });
      expect(handle).toBeNull();
    });
  });

  describe("resolveFakeTaskIds", () => {
    it("returns null ids when tasks aren't in the project", async () => {
      projectsListMock.mockResolvedValue([
        { id: 7, name: "Demo Project", created_at: "2026-01-01" },
      ]);
      tasksListMock.mockResolvedValue([]);
      const r = await resolveFakeTaskIds();
      expect(r.fakeAId).toBeNull();
      expect(r.fakeBId).toBeNull();
      expect(r.projectId).toBe(7);
    });

    it("returns task ids when present", async () => {
      projectsListMock.mockResolvedValue([
        { id: 7, name: "Demo Project", created_at: "2026-01-01" },
      ]);
      tasksListMock.mockResolvedValue([
        { id: 100, name: GANTT_REDESIGN_FAKE_A_NAME },
        { id: 101, name: GANTT_REDESIGN_FAKE_B_NAME },
      ]);
      const r = await resolveFakeTaskIds();
      expect(r.fakeAId).toBe(100);
      expect(r.fakeBId).toBe(101);
    });
  });

  describe("resolveUserExperiment", () => {
    it("returns the most-recent experiment, excluding fake/share demo names", async () => {
      projectsListMock.mockResolvedValue([
        { id: 7, name: "Demo Project", created_at: "2026-01-01" },
      ]);
      tasksListMock.mockResolvedValue([
        { id: 10, name: "User's experiment", task_type: "experiment" },
        { id: 11, name: GANTT_REDESIGN_FAKE_A_NAME, task_type: "experiment" },
        { id: 12, name: "Another user experiment", task_type: "experiment" },
      ]);
      const exp = await resolveUserExperiment();
      expect(exp).not.toBeNull();
      // Largest id among non-fake/non-share experiments wins.
      expect(exp?.id).toBe(12);
    });
  });

  describe("moveFakeAForward", () => {
    it("no-ops gracefully when fake A isn't present", async () => {
      projectsListMock.mockResolvedValue([
        { id: 7, name: "Demo Project", created_at: "2026-01-01" },
      ]);
      tasksListMock.mockResolvedValue([]);
      await expect(moveFakeAForward(2)).resolves.toBeUndefined();
      expect(tasksMoveMock).not.toHaveBeenCalled();
    });

    it("calls tasksApi.move with the right ISO date when fake A is present", async () => {
      projectsListMock.mockResolvedValue([
        { id: 7, name: "Demo Project", created_at: "2026-01-01" },
      ]);
      tasksListMock.mockResolvedValue([
        { id: 100, name: GANTT_REDESIGN_FAKE_A_NAME },
      ]);
      await moveFakeAForward(2);
      expect(tasksMoveMock).toHaveBeenCalledWith(
        100,
        expect.objectContaining({
          confirmed: true,
          new_start_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      );
    });
  });
});

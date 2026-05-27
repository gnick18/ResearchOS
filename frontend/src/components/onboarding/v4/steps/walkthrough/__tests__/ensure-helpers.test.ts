/**
 * Tests for the tour robustification ensureX helpers (tour
 * robustification manager 2026-05-27).
 *
 * Each helper:
 *  - returns the existing artifact when already present (no-op).
 *  - creates a placeholder via the relevant API when missing.
 *  - returns null gracefully when create fails.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const projectsListMock = vi.fn();
const projectsCreateMock = vi.fn();
const tasksListMock = vi.fn();
const tasksCreateMock = vi.fn();
const methodsListMock = vi.fn();
const methodsCreateMock = vi.fn();

vi.mock("@/lib/local-api", () => ({
  projectsApi: {
    list: () => projectsListMock(),
    create: (data: unknown) => projectsCreateMock(data),
  },
  tasksApi: {
    listByProject: (id: number) => tasksListMock(id),
    create: (data: unknown) => tasksCreateMock(data),
  },
  methodsApi: {
    list: () => methodsListMock(),
    create: (data: unknown) => methodsCreateMock(data),
  },
}));

import {
  ensureFirstExperimentExists,
  ensureFirstMethodExists,
  ensureFirstProjectExists,
  PLACEHOLDER_EXPERIMENT_NAME,
  PLACEHOLDER_METHOD_NAME,
  PLACEHOLDER_PROJECT_NAME,
  resolveFirstExperiment,
  resolveFirstMethod,
  resolveFirstProjectId,
} from "../lib/ensure-helpers";

describe("ensure-helpers (tour robustification manager 2026-05-27)", () => {
  beforeEach(() => {
    projectsListMock.mockReset();
    projectsCreateMock.mockReset();
    tasksListMock.mockReset();
    tasksCreateMock.mockReset();
    methodsListMock.mockReset();
    methodsCreateMock.mockReset();
  });

  // -------------------------------------------------------------------------
  // ensureFirstProjectExists
  // -------------------------------------------------------------------------
  describe("ensureFirstProjectExists", () => {
    it("returns the existing project id when one already exists (no create)", async () => {
      projectsListMock.mockResolvedValue([
        { id: 5, name: "Test Project", is_archived: false, is_shared_with_me: false },
      ]);

      const id = await ensureFirstProjectExists();

      expect(id).toBe(5);
      expect(projectsCreateMock).not.toHaveBeenCalled();
    });

    it("creates a placeholder project when none exists, returns new id", async () => {
      projectsListMock.mockResolvedValue([]);
      projectsCreateMock.mockResolvedValue({ id: 42, name: PLACEHOLDER_PROJECT_NAME });

      const id = await ensureFirstProjectExists();

      expect(id).toBe(42);
      expect(projectsCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: PLACEHOLDER_PROJECT_NAME,
        }),
      );
    });

    it("returns null gracefully when create throws", async () => {
      projectsListMock.mockResolvedValue([]);
      projectsCreateMock.mockRejectedValue(new Error("disk full"));

      const id = await ensureFirstProjectExists();

      expect(id).toBeNull();
    });

    it("filters out Miscellaneous, archived, and shared projects", async () => {
      projectsListMock.mockResolvedValue([
        { id: 1, name: "Miscellaneous", is_archived: false, is_shared_with_me: false },
        { id: 2, name: "Archived", is_archived: true, is_shared_with_me: false },
        { id: 3, name: "Shared", is_archived: false, is_shared_with_me: true },
      ]);
      projectsCreateMock.mockResolvedValue({ id: 99, name: PLACEHOLDER_PROJECT_NAME });

      const id = await ensureFirstProjectExists();

      // None of the listed projects qualify, so we expect a create.
      expect(id).toBe(99);
      expect(projectsCreateMock).toHaveBeenCalled();
    });

    it("picks the most-recently-created (highest id) when several exist", async () => {
      projectsListMock.mockResolvedValue([
        { id: 5, name: "Old", is_archived: false, is_shared_with_me: false },
        { id: 10, name: "Newer", is_archived: false, is_shared_with_me: false },
        { id: 3, name: "Oldest", is_archived: false, is_shared_with_me: false },
      ]);

      const id = await ensureFirstProjectExists();

      expect(id).toBe(10);
    });
  });

  // -------------------------------------------------------------------------
  // resolveFirstProjectId — direct
  // -------------------------------------------------------------------------
  describe("resolveFirstProjectId", () => {
    it("returns null when no eligible project exists", async () => {
      projectsListMock.mockResolvedValue([]);
      const id = await resolveFirstProjectId();
      expect(id).toBeNull();
    });

    it("returns null on list error", async () => {
      projectsListMock.mockRejectedValue(new Error("boom"));
      const id = await resolveFirstProjectId();
      expect(id).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // ensureFirstExperimentExists
  // -------------------------------------------------------------------------
  describe("ensureFirstExperimentExists", () => {
    it("returns the existing experiment when one already exists", async () => {
      projectsListMock.mockResolvedValue([
        { id: 5, name: "Project", is_archived: false, is_shared_with_me: false },
      ]);
      tasksListMock.mockResolvedValue([
        { id: 20, name: "User's experiment", task_type: "experiment" },
      ]);

      const exp = await ensureFirstExperimentExists();

      expect(exp?.id).toBe(20);
      expect(tasksCreateMock).not.toHaveBeenCalled();
    });

    it("creates a placeholder experiment when none exists", async () => {
      projectsListMock.mockResolvedValue([
        { id: 5, name: "Project", is_archived: false, is_shared_with_me: false },
      ]);
      tasksListMock.mockResolvedValue([]);
      tasksCreateMock.mockResolvedValue({
        id: 99,
        name: PLACEHOLDER_EXPERIMENT_NAME,
      });

      const exp = await ensureFirstExperimentExists();

      expect(exp?.id).toBe(99);
      expect(tasksCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: 5,
          name: PLACEHOLDER_EXPERIMENT_NAME,
          task_type: "experiment",
        }),
      );
    });

    it("filters out Fake A / Fake B / shared coffee-experiment names", async () => {
      projectsListMock.mockResolvedValue([
        { id: 5, name: "Project", is_archived: false, is_shared_with_me: false },
      ]);
      tasksListMock.mockResolvedValue([
        { id: 1, name: "Fake experiment A", task_type: "experiment" },
        { id: 2, name: "Fake experiment B", task_type: "experiment" },
        { id: 3, name: "Make some coffee together", task_type: "experiment" },
      ]);
      tasksCreateMock.mockResolvedValue({
        id: 50,
        name: PLACEHOLDER_EXPERIMENT_NAME,
      });

      const exp = await ensureFirstExperimentExists();

      // All listed experiments are demo bars, so we expect a create.
      expect(exp?.id).toBe(50);
      expect(tasksCreateMock).toHaveBeenCalled();
    });

    it("returns null when no project exists and project create fails", async () => {
      projectsListMock.mockResolvedValue([]);
      projectsCreateMock.mockRejectedValue(new Error("no disk"));

      const exp = await ensureFirstExperimentExists();

      expect(exp).toBeNull();
      expect(tasksCreateMock).not.toHaveBeenCalled();
    });

    it("returns null gracefully when task create throws", async () => {
      projectsListMock.mockResolvedValue([
        { id: 5, name: "Project", is_archived: false, is_shared_with_me: false },
      ]);
      tasksListMock.mockResolvedValue([]);
      tasksCreateMock.mockRejectedValue(new Error("boom"));

      const exp = await ensureFirstExperimentExists();

      expect(exp).toBeNull();
    });

    it("creates a project AND experiment when both missing", async () => {
      projectsListMock.mockResolvedValue([]);
      projectsCreateMock.mockResolvedValue({ id: 7, name: PLACEHOLDER_PROJECT_NAME });
      // resolveFirstExperiment runs first and re-lists projects internally
      // (via resolveFirstProjectId), but since it returns null on empty,
      // ensureFirstProjectExists is called next and produces id 7.
      tasksListMock.mockResolvedValue([]);
      tasksCreateMock.mockResolvedValue({ id: 8, name: PLACEHOLDER_EXPERIMENT_NAME });

      const exp = await ensureFirstExperimentExists();

      expect(exp?.id).toBe(8);
      expect(projectsCreateMock).toHaveBeenCalled();
      expect(tasksCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ project_id: 7 }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // resolveFirstExperiment
  // -------------------------------------------------------------------------
  describe("resolveFirstExperiment", () => {
    it("returns the most-recently-created experiment", async () => {
      projectsListMock.mockResolvedValue([
        { id: 5, name: "Project", is_archived: false, is_shared_with_me: false },
      ]);
      tasksListMock.mockResolvedValue([
        { id: 10, name: "Old exp", task_type: "experiment" },
        { id: 12, name: "Newer exp", task_type: "experiment" },
        { id: 11, name: "Middle exp", task_type: "experiment" },
      ]);

      const exp = await resolveFirstExperiment();

      expect(exp?.id).toBe(12);
    });

    it("returns null when no project exists", async () => {
      projectsListMock.mockResolvedValue([]);

      const exp = await resolveFirstExperiment();

      expect(exp).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // ensureFirstMethodExists
  // -------------------------------------------------------------------------
  describe("ensureFirstMethodExists", () => {
    it("returns the existing method when one already exists", async () => {
      methodsListMock.mockResolvedValue([
        { id: 30, name: "First method", is_public: false, is_shared_with_me: false },
      ]);

      const method = await ensureFirstMethodExists();

      expect(method?.id).toBe(30);
      expect(methodsCreateMock).not.toHaveBeenCalled();
    });

    it("creates a placeholder when no method exists", async () => {
      methodsListMock.mockResolvedValue([]);
      methodsCreateMock.mockResolvedValue({
        id: 7,
        name: PLACEHOLDER_METHOD_NAME,
      });

      const method = await ensureFirstMethodExists();

      expect(method?.id).toBe(7);
      expect(methodsCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: PLACEHOLDER_METHOD_NAME,
          method_type: "markdown",
        }),
      );
    });

    it("ignores public methods and received-shared methods when picking", async () => {
      methodsListMock.mockResolvedValue([
        { id: 1, name: "Public method", is_public: true, is_shared_with_me: false },
        { id: 2, name: "Shared with me", is_public: false, is_shared_with_me: true },
      ]);
      methodsCreateMock.mockResolvedValue({
        id: 99,
        name: PLACEHOLDER_METHOD_NAME,
      });

      const method = await ensureFirstMethodExists();

      // None of the listed methods are own-private, so we expect a create.
      expect(method?.id).toBe(99);
      expect(methodsCreateMock).toHaveBeenCalled();
    });

    it("returns null gracefully when create throws", async () => {
      methodsListMock.mockResolvedValue([]);
      methodsCreateMock.mockRejectedValue(new Error("disk full"));

      const method = await ensureFirstMethodExists();

      expect(method).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // resolveFirstMethod
  // -------------------------------------------------------------------------
  describe("resolveFirstMethod", () => {
    it("picks the most-recently-created own method", async () => {
      methodsListMock.mockResolvedValue([
        { id: 10, name: "Old", is_public: false, is_shared_with_me: false },
        { id: 20, name: "Newest", is_public: false, is_shared_with_me: false },
        { id: 15, name: "Middle", is_public: false, is_shared_with_me: false },
      ]);

      const method = await resolveFirstMethod();

      expect(method?.id).toBe(20);
    });

    it("returns null when list throws", async () => {
      methodsListMock.mockRejectedValue(new Error("boom"));

      const method = await resolveFirstMethod();

      expect(method).toBeNull();
    });
  });
});

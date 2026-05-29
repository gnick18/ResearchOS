/**
 * Tests for the §6.8 lab-only share-cluster helpers (Gantt fix manager
 * R1, 2026-05-22 — see ONBOARDING_V4_GANTT_REDESIGN.md).
 *
 * Covers:
 *  - spawnGanttShareBeakerBot attaches the coffee method (P0 #1)
 *  - spawnGanttShareBeakerBot falls back to ANY recipient method when
 *    the coffee method is missing
 *  - spawnGanttShareBeakerBot patches an existing experiment whose
 *    method_attachments was empty (idempotent self-healing)
 *  - shareCoffeeExperimentWithUser resolves the handle from disk when
 *    the in-memory cache is empty (P1 #4)
 *  - appendNoteToTaskNotes writes to notes.md, not comments (P1 #7)
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// --- Mocks shared across the suite -----------------------------------

const projectsListAllForUserMock = vi.fn();
const projectsSaveForUserMock = vi.fn();
const tasksListAllForUserMock = vi.fn();
const tasksSaveForUserMock = vi.fn();
const methodsListAllForUserMock = vi.fn();

const sharingShareTaskAsMock = vi.fn();
const filesReadFileMock = vi.fn();
const filesWriteFileMock = vi.fn();
const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/storage/json-store", () => {
  class FakeJsonStore {
    constructor(private kind: string) {}
    listAllForUser(u: string): unknown {
      if (this.kind === "projects") return projectsListAllForUserMock(u);
      if (this.kind === "tasks") return tasksListAllForUserMock(u);
      if (this.kind === "methods") return methodsListAllForUserMock(u);
      return [];
    }
    saveForUser(id: number, rec: unknown, u: string): unknown {
      if (this.kind === "projects")
        return projectsSaveForUserMock(id, rec, u);
      if (this.kind === "tasks") return tasksSaveForUserMock(id, rec, u);
      return undefined;
    }
  }
  return {
    JsonStore: FakeJsonStore,
    getCurrentUserCached: vi.fn().mockResolvedValue("alex"),
  };
});

vi.mock("@/lib/local-api", () => ({
  sharingApi: {
    shareTaskAs: (
      actor: string,
      id: number,
      recipient: string,
      perm: string,
    ) => sharingShareTaskAsMock(actor, id, recipient, perm),
  },
  filesApi: {
    readFile: (p: string) => filesReadFileMock(p),
    writeFile: (p: string, c: string) => filesWriteFileMock(p, c),
  },
}));

vi.mock("@/lib/query-client", () => ({
  appQueryClient: {
    invalidateQueries: () => invalidateQueriesMock(),
    refetchQueries: () => invalidateQueriesMock(),
  },
}));

const ensureUserFolderStructureMock = vi.fn().mockResolvedValue(true);
const setUserMetadataFieldMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/file-system/user-discovery", () => ({
  ensureUserFolderStructure: (u: string) => ensureUserFolderStructureMock(u),
}));

vi.mock("@/lib/file-system/user-metadata", () => ({
  setUserMetadataField: (u: string, k: string, v: unknown) =>
    setUserMetadataFieldMock(u, k, v),
  getUserMetadata: vi.fn().mockResolvedValue({
    deleted_at: null,
  }),
}));

vi.mock("../lab/lib/lab-fake-user", () => ({
  BEAKERBOT_LAB_USERNAME: "beakerbot",
  BEAKERBOT_LAB_COLOR: "#0ea5e9",
}));

import {
  spawnGanttShareBeakerBot,
  shareCoffeeExperimentWithUser,
  ensureBeakerBotUser,
  appendNoteToTaskNotes,
  COFFEE_METHOD_NAME,
  SHARE_DEMO_EXPERIMENT_NAME,
  SHARE_DEMO_PROJECT_NAME,
  _resetShareDemoHandleForTests,
} from "../lib/gantt-share-helpers";

describe("gantt-share-helpers (Gantt fix manager R1, 2026-05-22)", () => {
  beforeEach(() => {
    projectsListAllForUserMock.mockReset();
    projectsSaveForUserMock.mockReset();
    tasksListAllForUserMock.mockReset();
    tasksSaveForUserMock.mockReset();
    methodsListAllForUserMock.mockReset();
    sharingShareTaskAsMock.mockReset();
    filesReadFileMock.mockReset();
    filesWriteFileMock.mockReset();
    invalidateQueriesMock.mockClear();
    ensureUserFolderStructureMock.mockReset();
    ensureUserFolderStructureMock.mockResolvedValue(true);
    setUserMetadataFieldMock.mockReset();
    setUserMetadataFieldMock.mockResolvedValue(undefined);
    _resetShareDemoHandleForTests();
  });

  describe("ensureBeakerBotUser (gantt-share-robust manager, BUG B)", () => {
    it("seeds the BeakerBot folder + clears the tombstone + is_tutorial + color metadata", async () => {
      const ok = await ensureBeakerBotUser();
      expect(ok).toBe(true);
      expect(ensureUserFolderStructureMock).toHaveBeenCalledWith("beakerbot");
      // REVIVE: a prior cleanup tombstones BeakerBot via `deleted_at`, and
      // `discoverUsers` filters tombstoned users out of the share dropdown.
      // The seed must clear it so BeakerBot is discoverable again (the
      // full-walkthrough / re-run bug where BeakerBot was missing from the
      // "Pick a user" list).
      expect(setUserMetadataFieldMock).toHaveBeenCalledWith(
        "beakerbot",
        "deleted_at",
        undefined,
      );
      expect(setUserMetadataFieldMock).toHaveBeenCalledWith(
        "beakerbot",
        "is_tutorial",
        true,
      );
      expect(setUserMetadataFieldMock).toHaveBeenCalledWith(
        "beakerbot",
        "color",
        "#0ea5e9",
      );
    });

    it("is idempotent: repeat calls re-run the same idempotent seeders", async () => {
      await ensureBeakerBotUser();
      await ensureBeakerBotUser();
      // Both calls fire the underlying idempotent seeders (which no-op on
      // existing data); no throw, returns true each time. Three metadata
      // writes per call now (deleted_at revive + is_tutorial + color) => 6.
      expect(ensureUserFolderStructureMock).toHaveBeenCalledTimes(2);
      expect(setUserMetadataFieldMock).toHaveBeenCalledTimes(6);
    });

    it("returns false when the folder ensure fails", async () => {
      ensureUserFolderStructureMock.mockResolvedValueOnce(false);
      const ok = await ensureBeakerBotUser();
      expect(ok).toBe(false);
      // Metadata writes are skipped when the folder ensure fails.
      expect(setUserMetadataFieldMock).not.toHaveBeenCalled();
    });

    it("spawnGanttShareBeakerBot routes its user-seed through ensureBeakerBotUser", async () => {
      projectsListAllForUserMock.mockResolvedValue([]);
      tasksListAllForUserMock.mockResolvedValue([]);
      methodsListAllForUserMock.mockResolvedValue([]);

      await spawnGanttShareBeakerBot("alex");
      // The seed runs exactly once via the shared helper (one source of
      // truth), not duplicated inline.
      expect(ensureUserFolderStructureMock).toHaveBeenCalledWith("beakerbot");
      expect(setUserMetadataFieldMock).toHaveBeenCalledWith(
        "beakerbot",
        "is_tutorial",
        true,
      );
    });
  });

  describe("spawnGanttShareBeakerBot (P0 #1: coffee method attached)", () => {
    it("attaches the coffee method when it exists on the recipient", async () => {
      projectsListAllForUserMock.mockResolvedValue([]);
      tasksListAllForUserMock.mockResolvedValue([]);
      methodsListAllForUserMock.mockResolvedValue([
        { id: 42, name: COFFEE_METHOD_NAME },
      ]);

      const handle = await spawnGanttShareBeakerBot("alex");
      expect(handle).not.toBeNull();
      // Project was created for BeakerBot.
      expect(projectsSaveForUserMock).toHaveBeenCalledTimes(1);
      // Task was created with the coffee method attached.
      expect(tasksSaveForUserMock).toHaveBeenCalledTimes(1);
      const [, task] = tasksSaveForUserMock.mock.calls[0];
      expect((task as { method_ids: number[] }).method_ids).toEqual([42]);
      expect(
        (task as { method_attachments: Array<{ method_id: number; owner: string }> })
          .method_attachments,
      ).toEqual([
        expect.objectContaining({ method_id: 42, owner: "alex" }),
      ]);
    });

    it("falls back to any method the recipient owns when coffee is missing", async () => {
      projectsListAllForUserMock.mockResolvedValue([]);
      tasksListAllForUserMock.mockResolvedValue([]);
      methodsListAllForUserMock.mockResolvedValue([
        { id: 7, name: "Some other method" },
        { id: 3, name: "Yet another method" },
      ]);

      await spawnGanttShareBeakerBot("alex");
      const [, task] = tasksSaveForUserMock.mock.calls[0];
      // Fallback picks the largest id (most recent).
      expect((task as { method_ids: number[] }).method_ids).toEqual([7]);
    });

    it("patches an existing experiment whose method_attachments was empty", async () => {
      projectsListAllForUserMock.mockResolvedValue([
        { id: 5, name: SHARE_DEMO_PROJECT_NAME },
      ]);
      tasksListAllForUserMock.mockResolvedValue([
        {
          id: 9,
          name: SHARE_DEMO_EXPERIMENT_NAME,
          method_ids: [],
          method_attachments: [],
        },
      ]);
      methodsListAllForUserMock.mockResolvedValue([
        { id: 42, name: COFFEE_METHOD_NAME },
      ]);

      const handle = await spawnGanttShareBeakerBot("alex");
      expect(handle?.experimentId).toBe(9);
      // The existing-task patch path fires the save with the new
      // method attached.
      expect(tasksSaveForUserMock).toHaveBeenCalledTimes(1);
      const [, patched] = tasksSaveForUserMock.mock.calls[0];
      expect((patched as { method_ids: number[] }).method_ids).toEqual([42]);
    });

    it("leaves an existing experiment alone when no methods are available", async () => {
      projectsListAllForUserMock.mockResolvedValue([
        { id: 5, name: SHARE_DEMO_PROJECT_NAME },
      ]);
      tasksListAllForUserMock.mockResolvedValue([
        {
          id: 9,
          name: SHARE_DEMO_EXPERIMENT_NAME,
          method_ids: [],
          method_attachments: [],
        },
      ]);
      methodsListAllForUserMock.mockResolvedValue([]);

      await spawnGanttShareBeakerBot("alex");
      // No patch (no methodRef → needsMethodPatch is false).
      expect(tasksSaveForUserMock).not.toHaveBeenCalled();
    });
  });

  describe("shareCoffeeExperimentWithUser (P1 #4: disk-resolve fallback)", () => {
    it("falls back to disk when the in-memory cache is empty", async () => {
      // Cache reset in beforeEach. Stub the disk so the fallback resolves.
      projectsListAllForUserMock.mockResolvedValue([
        { id: 5, name: SHARE_DEMO_PROJECT_NAME },
      ]);
      tasksListAllForUserMock.mockResolvedValue([
        { id: 9, name: SHARE_DEMO_EXPERIMENT_NAME },
      ]);
      sharingShareTaskAsMock.mockResolvedValue(undefined);

      const ok = await shareCoffeeExperimentWithUser("alex");
      expect(ok).toBe(true);
      expect(sharingShareTaskAsMock).toHaveBeenCalledWith(
        "beakerbot",
        9,
        "alex",
        "edit",
      );
    });

    it("returns false when neither cache nor disk has the handle", async () => {
      projectsListAllForUserMock.mockResolvedValue([]);
      tasksListAllForUserMock.mockResolvedValue([]);

      const ok = await shareCoffeeExperimentWithUser("alex");
      expect(ok).toBe(false);
      expect(sharingShareTaskAsMock).not.toHaveBeenCalled();
    });
  });

  describe("appendNoteToTaskNotes (P1 #7: writes to notes.md)", () => {
    it("writes to the task's notes.md (NOT comments)", async () => {
      filesReadFileMock.mockResolvedValue({ content: "# Existing\n" });
      filesWriteFileMock.mockResolvedValue({ path: "x", sha: "y" });

      const ok = await appendNoteToTaskNotes(
        9,
        "alex",
        "BeakerBot was here.",
      );
      expect(ok).toBe(true);
      // Wrote to the right path.
      const [path, content] = filesWriteFileMock.mock.calls[0];
      expect(path).toBe("users/alex/results/task-9/notes.md");
      expect(content).toContain("# Existing");
      expect(content).toContain("BeakerBot was here.");
      expect(content).toContain("Note from beakerbot");
    });

    it("creates notes.md fresh when it doesn't exist yet", async () => {
      filesReadFileMock.mockRejectedValue(new Error("not found"));
      filesWriteFileMock.mockResolvedValue({ path: "x", sha: "y" });

      const ok = await appendNoteToTaskNotes(
        9,
        "alex",
        "BeakerBot was here.",
      );
      expect(ok).toBe(true);
      const [, content] = filesWriteFileMock.mock.calls[0];
      expect(content).toContain("BeakerBot was here.");
    });

    it("is idempotent on repeat calls with the same note text", async () => {
      filesReadFileMock.mockResolvedValue({
        content: "Existing\n\nBeakerBot was here.\n",
      });

      const ok = await appendNoteToTaskNotes(
        9,
        "alex",
        "BeakerBot was here.",
      );
      expect(ok).toBe(true);
      // No write — note already present.
      expect(filesWriteFileMock).not.toHaveBeenCalled();
    });
  });
});

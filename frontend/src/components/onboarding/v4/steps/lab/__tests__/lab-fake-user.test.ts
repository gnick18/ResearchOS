/**
 * Onboarding v4 P7: lab-fake-user helper tests.
 *
 * Covers §6.16a + §6.16c:
 *   - spawnBeakerBotLabUser creates the user folder, sets the
 *     `is_tutorial: true` flag + sky-blue color, creates 2 placeholder
 *     experiments inside BeakerBot's namespace, and issues 2
 *     shareTaskAs calls (one edit, one view).
 *   - cleanupBeakerBotLabUser revokes the shares + tombstones the
 *     user via usersApi.delete (step=2, ack=true).
 *   - Calling cleanup twice is idempotent.
 *
 * Mocks every external surface so the test doesn't read the FS.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { UserMetadataEntry } from "@/lib/file-system/user-metadata";

const {
  ensureUserFolderStructure,
  setUserMetadataField,
  getUserMetadata,
  listAllForUserMock,
  saveForUserMock,
  shareTaskAs,
  unshareTaskAs,
  usersApiDelete,
} = vi.hoisted(() => ({
  ensureUserFolderStructure: vi.fn(async () => true),
  setUserMetadataField: vi.fn(async () => null),
  getUserMetadata: vi.fn(
    async (): Promise<UserMetadataEntry | null> => null,
  ),
  listAllForUserMock: vi.fn(),
  saveForUserMock: vi.fn(),
  shareTaskAs: vi.fn(async () => ({
    status: "ok",
    item_id: 1,
    shared_with: "",
    permission: "",
    actor: "",
  })),
  unshareTaskAs: vi.fn(async () => ({
    status: "ok",
    item_id: 1,
    shared_with: "",
    actor: "",
  })),
  usersApiDelete: vi.fn(async () => ({
    status: "ok",
    deleted_username: "beakerbot",
    message: "ok",
  })),
}));

vi.mock("@/lib/file-system/user-discovery", () => ({
  ensureUserFolderStructure,
}));
vi.mock("@/lib/file-system/user-metadata", () => ({
  setUserMetadataField,
  getUserMetadata,
}));

vi.mock("@/lib/storage/json-store", () => {
  // Each constructed store routes its listAllForUser + saveForUser
  // calls through the shared mock so the spawn helper's two-store
  // pattern (projects + tasks) doesn't need per-entity mocks.
  class JsonStore<T extends { id: number }> {
    private entityName: string;
    constructor(entityName: string) {
      this.entityName = entityName;
    }
    listAllForUser(username: string): Promise<T[]> {
      return listAllForUserMock(this.entityName, username);
    }
    saveForUser(id: number, data: T, username: string): Promise<T> {
      return saveForUserMock(this.entityName, id, data, username);
    }
  }
  return {
    JsonStore,
    getCurrentUserCached: vi.fn(async () => "alex"),
  };
});

vi.mock("@/lib/local-api", () => ({
  sharingApi: { shareTaskAs, unshareTaskAs },
  usersApi: { delete: usersApiDelete },
}));

import {
  spawnBeakerBotLabUser,
  cleanupBeakerBotLabUser,
  BEAKERBOT_LAB_USERNAME,
  BEAKERBOT_EDIT_TASK_NAME,
  BEAKERBOT_VIEW_TASK_NAME,
  _resetCachedHandleForTests,
} from "../lib/lab-fake-user";

beforeEach(() => {
  ensureUserFolderStructure.mockClear();
  setUserMetadataField.mockClear();
  getUserMetadata.mockReset();
  listAllForUserMock.mockReset();
  saveForUserMock.mockReset();
  shareTaskAs.mockClear();
  unshareTaskAs.mockClear();
  usersApiDelete.mockClear();
  _resetCachedHandleForTests();
});

describe("spawnBeakerBotLabUser", () => {
  it("creates BeakerBot user with is_tutorial=true + sky color", async () => {
    listAllForUserMock.mockResolvedValue([]);
    saveForUserMock.mockImplementation(async (_e, id, data) => ({ ...data, id }));

    await spawnBeakerBotLabUser("alex");

    expect(ensureUserFolderStructure).toHaveBeenCalledWith(
      BEAKERBOT_LAB_USERNAME,
    );
    // Tutorial flag + color get written.
    expect(setUserMetadataField).toHaveBeenCalledWith(
      BEAKERBOT_LAB_USERNAME,
      "is_tutorial",
      true,
    );
    expect(setUserMetadataField).toHaveBeenCalledWith(
      BEAKERBOT_LAB_USERNAME,
      "color",
      "#0ea5e9",
    );
  });

  it("creates one project + 2 placeholder experiments inside BeakerBot's namespace", async () => {
    listAllForUserMock.mockResolvedValue([]);
    saveForUserMock.mockImplementation(async (_e, id, data) => ({ ...data, id }));

    const handle = await spawnBeakerBotLabUser("alex");

    // 1 project save + 2 task saves
    expect(saveForUserMock).toHaveBeenCalledTimes(3);
    expect(saveForUserMock.mock.calls[0][0]).toBe("projects");
    expect(saveForUserMock.mock.calls[0][3]).toBe(BEAKERBOT_LAB_USERNAME);

    const projectSave = saveForUserMock.mock.calls[0][2];
    expect(projectSave.owner).toBe(BEAKERBOT_LAB_USERNAME);
    expect(projectSave.name).toBe("BeakerBot's lab notebook");

    const taskCalls = saveForUserMock.mock.calls.filter(
      (c: any[]) => c[0] === "tasks",
    );
    expect(taskCalls).toHaveLength(2);
    const taskNames = taskCalls.map((c: any[]) => c[2].name);
    expect(taskNames).toContain(BEAKERBOT_EDIT_TASK_NAME);
    expect(taskNames).toContain(BEAKERBOT_VIEW_TASK_NAME);
    // Both task records have BeakerBot as owner + experiment task_type.
    for (const call of taskCalls) {
      expect(call[2].owner).toBe(BEAKERBOT_LAB_USERNAME);
      expect(call[2].task_type).toBe("experiment");
    }

    expect(handle.recipient).toBe("alex");
    expect(handle.actor).toBe(BEAKERBOT_LAB_USERNAME);
    expect(handle.editTaskId).toBeGreaterThan(0);
    expect(handle.viewTaskId).toBeGreaterThan(0);
    expect(handle.editTaskId).not.toBe(handle.viewTaskId);
  });

  it("issues 2 shareTaskAs calls with correct permissions", async () => {
    listAllForUserMock.mockResolvedValue([]);
    saveForUserMock.mockImplementation(async (_e, id, data) => ({ ...data, id }));

    const handle = await spawnBeakerBotLabUser("alex");

    expect(shareTaskAs).toHaveBeenCalledTimes(2);
    expect(shareTaskAs).toHaveBeenCalledWith(
      BEAKERBOT_LAB_USERNAME,
      handle.editTaskId,
      "alex",
      "edit",
    );
    expect(shareTaskAs).toHaveBeenCalledWith(
      BEAKERBOT_LAB_USERNAME,
      handle.viewTaskId,
      "alex",
      "view",
    );
  });

  it("refuses to spawn when recipient equals the BeakerBot username", async () => {
    await expect(
      spawnBeakerBotLabUser(BEAKERBOT_LAB_USERNAME),
    ).rejects.toThrow(/cannot be BeakerBot/);
  });

  it("is idempotent: a second spawn with existing artifacts reuses ids and does not duplicate", async () => {
    // First spawn: empty namespace.
    listAllForUserMock.mockResolvedValueOnce([]); // projects pass 1
    listAllForUserMock.mockResolvedValueOnce([]); // tasks pass 1
    saveForUserMock.mockImplementation(async (_e, id, data) => ({ ...data, id }));

    const first = await spawnBeakerBotLabUser("alex");

    // Second spawn: simulate the artifacts now exist.
    saveForUserMock.mockClear();
    shareTaskAs.mockClear();
    const existingProject = saveForUserMock.mock.calls; // empty after clear
    void existingProject;
    listAllForUserMock.mockResolvedValueOnce([
      {
        id: first.projectId,
        name: "BeakerBot's lab notebook",
        owner: BEAKERBOT_LAB_USERNAME,
      },
    ]);
    listAllForUserMock.mockResolvedValueOnce([
      {
        id: first.editTaskId,
        name: BEAKERBOT_EDIT_TASK_NAME,
        owner: BEAKERBOT_LAB_USERNAME,
      },
      {
        id: first.viewTaskId,
        name: BEAKERBOT_VIEW_TASK_NAME,
        owner: BEAKERBOT_LAB_USERNAME,
      },
    ]);

    const second = await spawnBeakerBotLabUser("alex");

    // No new saves on the idempotent pass.
    expect(saveForUserMock).not.toHaveBeenCalled();
    // shareTaskAs still fires (the underlying impl is itself idempotent).
    expect(shareTaskAs).toHaveBeenCalledTimes(2);
    // Same ids returned.
    expect(second.editTaskId).toBe(first.editTaskId);
    expect(second.viewTaskId).toBe(first.viewTaskId);
  });
});

describe("cleanupBeakerBotLabUser", () => {
  it("revokes shares + tombstones the user via usersApi.delete(2, true)", async () => {
    getUserMetadata.mockResolvedValue({
      color: "#38bdf8",
      created_at: "2026-01-01T00:00:00.000Z",
      is_tutorial: true,
    });
    listAllForUserMock.mockResolvedValue([
      { id: 11, owner: BEAKERBOT_LAB_USERNAME, name: "Edit task" },
      { id: 12, owner: BEAKERBOT_LAB_USERNAME, name: "View task" },
    ]);

    await cleanupBeakerBotLabUser("alex");

    expect(unshareTaskAs).toHaveBeenCalledWith(
      BEAKERBOT_LAB_USERNAME,
      11,
      "alex",
    );
    expect(unshareTaskAs).toHaveBeenCalledWith(
      BEAKERBOT_LAB_USERNAME,
      12,
      "alex",
    );
    expect(usersApiDelete).toHaveBeenCalledWith(
      BEAKERBOT_LAB_USERNAME,
      2,
      true,
    );
  });

  it("is a no-op when the BeakerBot user does not exist", async () => {
    getUserMetadata.mockResolvedValue(null);

    await cleanupBeakerBotLabUser("alex");

    expect(unshareTaskAs).not.toHaveBeenCalled();
    expect(usersApiDelete).not.toHaveBeenCalled();
  });

  it("is a no-op when the BeakerBot user is already tombstoned", async () => {
    getUserMetadata.mockResolvedValue({
      color: "#38bdf8",
      created_at: "2026-01-01T00:00:00.000Z",
      is_tutorial: true,
      deleted_at: "2026-01-01T00:00:00.000Z",
    });

    await cleanupBeakerBotLabUser("alex");

    expect(unshareTaskAs).not.toHaveBeenCalled();
    expect(usersApiDelete).not.toHaveBeenCalled();
  });

  it("swallows usersApi.delete failures and never throws", async () => {
    getUserMetadata.mockResolvedValue({
      color: "#38bdf8",
      created_at: "2026-01-01T00:00:00.000Z",
      is_tutorial: true,
    });
    listAllForUserMock.mockResolvedValue([]);
    usersApiDelete.mockRejectedValueOnce(new Error("FS locked"));

    // Suppress the expected console.warn so the test output stays clean.
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await expect(cleanupBeakerBotLabUser("alex")).resolves.toBeUndefined();
    } finally {
      console.warn = originalWarn;
    }
  });

  it("calling cleanup twice is idempotent (second call no-ops)", async () => {
    // First call: user exists, gets tombstoned.
    getUserMetadata.mockResolvedValueOnce({
      color: "#38bdf8",
      created_at: "2026-01-01T00:00:00.000Z",
      is_tutorial: true,
    });
    listAllForUserMock.mockResolvedValueOnce([]);

    await cleanupBeakerBotLabUser("alex");

    expect(usersApiDelete).toHaveBeenCalledTimes(1);

    // Second call: user is gone now. Helper detects + no-ops.
    getUserMetadata.mockResolvedValueOnce(null);

    await cleanupBeakerBotLabUser("alex");

    // Still only one usersApi.delete call across both passes.
    expect(usersApiDelete).toHaveBeenCalledTimes(1);
  });
});

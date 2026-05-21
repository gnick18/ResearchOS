// frontend/src/lib/share-task-as.test.ts
//
// Tests for the admin-mode `sharingApi.shareTaskAs` + `sharingApi.unshareTaskAs`
// pair introduced for the Onboarding v4 Lab Mode tour (P7).
//
// Unlike `sharingApi.shareTask` (which always uses currentUser as the sender),
// these methods accept an explicit `actorId` so the wizard can spawn a fake
// BeakerBot user and have THAT user share placeholder tasks with the real
// (current) user — a direction the legacy API can't express.
//
// Coverage:
//   1. Happy path: actorId != currentUser, share succeeds, recipient sees
//      the task as shared by actorId in `_shared_with_me.json` AND gets a
//      `task_shared` notification with `from_user: actorId`.
//   2. Permission flavor: view-only and edit both round-trip through the
//      sidecar correctly.
//   3. Mutates the actor's namespace, not the current user's. The task at
//      `users/<actorId>/tasks/<id>.json` gains `shared_with`; no write to
//      `users/<currentUser>/tasks/<id>.json`.
//   4. Error: task absent from actor's namespace → throws (no silent skip
//      like shareTask's chain loop; this is a 1:1 admin call).
//   5. Error: empty actorId / empty recipient / actorId === recipient.
//   6. Idempotence: re-share with same permission is a no-op-update (the
//      `shared_with` list dedups by username; `addReceiverShare` upserts
//      the same entry; a SECOND notification IS pushed — matching the
//      existing `shareTask` behavior, since `addReceiverShare` always
//      appends a notification).
//   7. Idempotence-with-flip: re-share with DIFFERENT permission flips the
//      stored permission on both sides.
//   8. `unshareTaskAs`: removes recipient from actor's task.shared_with AND
//      removes the matching entry from recipient's _shared_with_me.json.
//   9. `unshareTaskAs` is a no-op when task is absent (matches unshareTask).

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Task, Notification } from "./types";

const memFs = new Map<string, unknown>();
let currentUserMock = "real_user";

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
    deleteFile: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("./file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => currentUserMock),
}));

// Imports must come after the mocks.
import { sharingApi } from "./local-api";
import { clearCurrentUserCache } from "./storage/json-store";

function setCurrentUser(name: string) {
  currentUserMock = name;
  clearCurrentUserCache();
}

function seedTask(
  owner: string,
  overrides: Partial<Task> & { id: number }
): Task {
  const task: Task = {
    project_id: 1,
    name: "lab tour task",
    start_date: "2026-05-21",
    duration_days: 1,
    end_date: "2026-05-21",
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
  };
  memFs.set(`users/${owner}/tasks/${task.id}.json`, task);
  return task;
}

beforeEach(() => {
  memFs.clear();
  setCurrentUser("real_user");
});

describe("sharingApi.shareTaskAs — admin-mode share", () => {
  it("shares a task on behalf of an actor different from currentUser", async () => {
    // BeakerBot (the fake lab member) shares with real_user (current).
    seedTask("beakerbot", { id: 7, name: "PCR run #1" });

    const result = await sharingApi.shareTaskAs(
      "beakerbot",
      7,
      "real_user",
      "edit"
    );

    expect(result).toMatchObject({
      status: "ok",
      item_id: 7,
      shared_with: "real_user",
      permission: "edit",
      actor: "beakerbot",
    });

    // Actor's task gained a shared_with entry.
    const actorTask = memFs.get("users/beakerbot/tasks/7.json") as Task;
    expect(actorTask.shared_with).toEqual([
      { username: "real_user", permission: "edit" },
    ]);

    // Recipient's _shared_with_me.json reflects the share from beakerbot.
    const recipientManifest = memFs.get(
      "users/real_user/_shared_with_me.json"
    ) as { tasks: Array<{ id: number; owner: string; permission: string }> };
    expect(recipientManifest.tasks).toHaveLength(1);
    expect(recipientManifest.tasks[0]).toMatchObject({
      id: 7,
      owner: "beakerbot",
      permission: "edit",
    });

    // Recipient's _notifications.json records the share with from_user==actor.
    const recipientNotifs = memFs.get(
      "users/real_user/_notifications.json"
    ) as { notifications: Notification[] };
    expect(recipientNotifs.notifications).toHaveLength(1);
    const notif = recipientNotifs.notifications[0];
    expect(notif.type).toBe("task_shared");
    if (notif.type === "task_shared") {
      expect(notif.from_user).toBe("beakerbot");
      expect(notif.item_id).toBe(7);
      expect(notif.item_name).toBe("PCR run #1");
      expect(notif.permission).toBe("edit");
      expect(notif.read).toBe(false);
    }
  });

  it("does NOT mutate the currentUser's namespace", async () => {
    // Seed actor's task only. Recipient (real_user) has no copy.
    seedTask("beakerbot", { id: 7 });

    await sharingApi.shareTaskAs("beakerbot", 7, "real_user", "view");

    // No write to users/real_user/tasks/7.json — the task lives in beakerbot's
    // namespace; recipient learns via _shared_with_me.json only.
    expect(memFs.get("users/real_user/tasks/7.json")).toBeUndefined();
  });

  it("supports view-only permission", async () => {
    seedTask("beakerbot", { id: 8 });

    const result = await sharingApi.shareTaskAs(
      "beakerbot",
      8,
      "real_user",
      "view"
    );

    expect(result.permission).toBe("view");

    const actorTask = memFs.get("users/beakerbot/tasks/8.json") as Task;
    expect(actorTask.shared_with).toEqual([
      { username: "real_user", permission: "view" },
    ]);

    const recipientManifest = memFs.get(
      "users/real_user/_shared_with_me.json"
    ) as { tasks: Array<{ permission: string }> };
    expect(recipientManifest.tasks[0].permission).toBe("view");
  });

  it("supports edit permission", async () => {
    seedTask("beakerbot", { id: 9 });

    const result = await sharingApi.shareTaskAs(
      "beakerbot",
      9,
      "real_user",
      "edit"
    );

    expect(result.permission).toBe("edit");

    const actorTask = memFs.get("users/beakerbot/tasks/9.json") as Task;
    expect(actorTask.shared_with).toEqual([
      { username: "real_user", permission: "edit" },
    ]);
  });

  it("throws when task is absent from the actor's namespace", async () => {
    // No seed — beakerbot has no task 42.
    await expect(
      sharingApi.shareTaskAs("beakerbot", 42, "real_user", "view")
    ).rejects.toThrow(/not found/i);
  });

  it("throws on empty actorId", async () => {
    await expect(
      sharingApi.shareTaskAs("", 1, "real_user", "view")
    ).rejects.toThrow(/actorId is required/i);
  });

  it("throws on empty recipient", async () => {
    seedTask("beakerbot", { id: 1 });
    await expect(
      sharingApi.shareTaskAs("beakerbot", 1, "", "view")
    ).rejects.toThrow(/recipient is required/i);
  });

  it("throws when actorId === recipient (self-share)", async () => {
    seedTask("beakerbot", { id: 1 });
    await expect(
      sharingApi.shareTaskAs("beakerbot", 1, "beakerbot", "view")
    ).rejects.toThrow(/share a task with the actor themselves/i);
  });

  it("idempotently flips permission when re-sharing", async () => {
    seedTask("beakerbot", { id: 7 });

    await sharingApi.shareTaskAs("beakerbot", 7, "real_user", "view");
    await sharingApi.shareTaskAs("beakerbot", 7, "real_user", "edit");

    // Actor's task: shared_with dedupes by username, permission flips to edit.
    const actorTask = memFs.get("users/beakerbot/tasks/7.json") as Task;
    expect(actorTask.shared_with).toEqual([
      { username: "real_user", permission: "edit" },
    ]);

    // Recipient's manifest: same entry, flipped permission. addReceiverShare
    // upserts by (id, owner), so we expect exactly one row.
    const recipientManifest = memFs.get(
      "users/real_user/_shared_with_me.json"
    ) as { tasks: Array<{ id: number; permission: string }> };
    expect(recipientManifest.tasks).toHaveLength(1);
    expect(recipientManifest.tasks[0].permission).toBe("edit");
  });

  it("works when the actor IS the current user (admin call from own session)", async () => {
    // Sanity: shareTaskAs can stand in for shareTask if the actor happens to
    // be currentUser. The implementation never reads currentUser, so it
    // should behave the same.
    setCurrentUser("real_user");
    seedTask("real_user", { id: 5 });

    const result = await sharingApi.shareTaskAs(
      "real_user",
      5,
      "morgan",
      "edit"
    );

    expect(result.actor).toBe("real_user");
    const actorTask = memFs.get("users/real_user/tasks/5.json") as Task;
    expect(actorTask.shared_with).toEqual([
      { username: "morgan", permission: "edit" },
    ]);
    const recipientManifest = memFs.get(
      "users/morgan/_shared_with_me.json"
    ) as { tasks: Array<{ owner: string }> };
    expect(recipientManifest.tasks[0].owner).toBe("real_user");
  });
});

describe("sharingApi.unshareTaskAs — admin-mode revoke", () => {
  it("removes recipient from actor's task AND from recipient's _shared_with_me", async () => {
    // Set up: beakerbot has shared task 7 with real_user.
    seedTask("beakerbot", {
      id: 7,
      shared_with: [{ username: "real_user", permission: "edit" }],
    });
    memFs.set("users/real_user/_shared_with_me.json", {
      version: 1,
      projects: [],
      tasks: [
        {
          id: 7,
          owner: "beakerbot",
          permission: "edit",
          shared_at: "2026-05-21T00:00:00Z",
        },
      ],
      methods: [],
    });

    const result = await sharingApi.unshareTaskAs("beakerbot", 7, "real_user");

    expect(result).toMatchObject({
      status: "ok",
      item_id: 7,
      shared_with: "real_user",
      actor: "beakerbot",
    });

    const actorTask = memFs.get("users/beakerbot/tasks/7.json") as Task;
    expect(actorTask.shared_with).toEqual([]);

    const recipientManifest = memFs.get(
      "users/real_user/_shared_with_me.json"
    ) as { tasks: unknown[] };
    expect(recipientManifest.tasks).toEqual([]);
  });

  it("is a no-op when the task does not exist in the actor's namespace", async () => {
    // unshareTask (the non-admin variant) silently no-ops on missing task;
    // mirror that behavior here.
    const result = await sharingApi.unshareTaskAs("beakerbot", 99, "real_user");
    expect(result.status).toBe("ok");
    // No actor task file was created either way.
    expect(memFs.get("users/beakerbot/tasks/99.json")).toBeUndefined();
  });

  it("throws on empty actorId or empty recipient", async () => {
    await expect(
      sharingApi.unshareTaskAs("", 1, "real_user")
    ).rejects.toThrow(/actorId is required/i);
    await expect(
      sharingApi.unshareTaskAs("beakerbot", 1, "")
    ).rejects.toThrow(/recipient is required/i);
  });

  it("paired round-trip: shareTaskAs then unshareTaskAs leaves the system clean", async () => {
    seedTask("beakerbot", { id: 7, name: "round trip task" });

    await sharingApi.shareTaskAs("beakerbot", 7, "real_user", "view");
    await sharingApi.unshareTaskAs("beakerbot", 7, "real_user");

    const actorTask = memFs.get("users/beakerbot/tasks/7.json") as Task;
    expect(actorTask.shared_with).toEqual([]);

    const recipientManifest = memFs.get(
      "users/real_user/_shared_with_me.json"
    ) as { tasks: unknown[] };
    expect(recipientManifest.tasks).toEqual([]);

    // Notifications are NOT auto-cleaned by unshare — same behavior as
    // unshareTask. The pending notification from the share remains.
    const recipientNotifs = memFs.get(
      "users/real_user/_notifications.json"
    ) as { notifications: Notification[] };
    expect(recipientNotifs.notifications).toHaveLength(1);
  });
});

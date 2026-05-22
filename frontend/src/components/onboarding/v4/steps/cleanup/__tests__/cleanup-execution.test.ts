import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WizardArtifact } from "@/lib/onboarding/sidecar";

/**
 * Onboarding v4 Phase 4 cleanup-execution unit tests.
 *
 * Mirror of the v3 routing checks plus the v4-only artifact additions
 * (task / purchase / purchase_item / category / funding_string /
 * variation_note / note_entry).
 */

const {
  projectDelete,
  methodDelete,
  taskDelete,
  goalDelete,
  userDelete,
  purchaseDelete,
  deleteFeed,
  clearPairing,
  deleteImageFromBase,
  patchUserSettings,
  tasksGet,
  getNotifications,
  dismissNotification,
} = vi.hoisted(() => ({
  projectDelete: vi.fn(async (_id: number) => {}),
  methodDelete: vi.fn(async (_id: number) => {}),
  taskDelete: vi.fn(async (_id: number) => {}),
  goalDelete: vi.fn(async (_id: number) => {}),
  userDelete: vi.fn(async (
    _username: string,
    _step: number,
    _ack: boolean,
  ) => ({ status: "ok", deleted_username: "", message: "" })),
  purchaseDelete: vi.fn(async (_id: number) => {}),
  deleteFeed: vi.fn(async (_username: string, _id: number) => true),
  clearPairing: vi.fn(async (_username: string) => {}),
  deleteImageFromBase: vi.fn(
    async (_basePath: string, _filename: string) => {},
  ),
  patchUserSettings: vi.fn(async () => ({}) as never),
  tasksGet: vi.fn(async (_id: number) => ({
    id: 999,
    owner: "test-user",
    name: "demo",
  })),
  getNotifications: vi.fn(async () => ({ notifications: [] as unknown[] })),
  dismissNotification: vi.fn(async (_id: string) => ({
    status: "ok",
    notification_id: _id,
  })),
}));

vi.mock("@/lib/local-api", () => ({
  projectsApi: { delete: projectDelete },
  methodsApi: { delete: methodDelete },
  tasksApi: { delete: taskDelete, get: tasksGet },
  goalsApi: { delete: goalDelete },
  usersApi: { delete: userDelete },
  purchasesApi: { delete: purchaseDelete },
  sharingApi: {
    getNotifications,
    dismissNotification,
  },
}));

vi.mock("@/lib/calendar/external-feeds-store", () => ({
  deleteFeed,
}));

vi.mock("@/lib/telegram/telegram-store", () => ({
  clearPairing,
}));

vi.mock("@/lib/attachments/move-image", () => ({
  deleteImageFromBase,
}));

vi.mock("@/lib/settings/user-settings", () => ({
  patchUserSettings,
}));

import {
  cleanupArtifacts,
  isCleanupExcluded,
} from "../cleanup-execution";

function art(
  type: WizardArtifact["type"],
  id: string,
  def: "keep" | "discard" = "discard",
): WizardArtifact {
  return { type, id, cleanup_default: def };
}

beforeEach(() => {
  projectDelete.mockClear();
  methodDelete.mockClear();
  taskDelete.mockClear();
  goalDelete.mockClear();
  userDelete.mockClear();
  purchaseDelete.mockClear();
  deleteFeed.mockClear();
  clearPairing.mockClear();
  deleteImageFromBase.mockClear();
  patchUserSettings.mockClear();
  tasksGet.mockClear();
  getNotifications.mockReset();
  dismissNotification.mockReset();
  getNotifications.mockResolvedValue({ notifications: [] });
  dismissNotification.mockResolvedValue({
    status: "ok",
    notification_id: "x",
  });
});

describe("cleanupArtifacts per-type routing", () => {
  it("routes project to projectsApi.delete with numeric id", async () => {
    await cleanupArtifacts([art("project", "42")], "u");
    expect(projectDelete).toHaveBeenCalledWith(42);
  });

  it("routes method to methodsApi.delete with the decoded id", async () => {
    await cleanupArtifacts([art("method", "17:placeholder")], "u");
    expect(methodDelete).toHaveBeenCalledWith(17);
  });

  it("routes experiment and task to tasksApi.delete", async () => {
    await cleanupArtifacts(
      [art("experiment", "5"), art("task", "11")],
      "u",
    );
    expect(taskDelete).toHaveBeenCalledTimes(2);
    expect(taskDelete).toHaveBeenCalledWith(5);
    expect(taskDelete).toHaveBeenCalledWith(11);
  });

  it("routes whole-purchase artifact to tasksApi.delete (cascades items)", async () => {
    await cleanupArtifacts([art("purchase", "9")], "u");
    expect(taskDelete).toHaveBeenCalledWith(9);
  });

  it("routes purchase_item line to purchasesApi.delete", async () => {
    await cleanupArtifacts([art("purchase_item", "7")], "u");
    expect(purchaseDelete).toHaveBeenCalledWith(7);
  });

  it("treats funding_string and category as no-ops", async () => {
    await cleanupArtifacts(
      [art("funding_string", "Grant#A"), art("category", "Demo folder")],
      "u",
    );
    expect(projectDelete).not.toHaveBeenCalled();
    expect(methodDelete).not.toHaveBeenCalled();
    expect(taskDelete).not.toHaveBeenCalled();
  });

  it("routes goal to goalsApi.delete", async () => {
    await cleanupArtifacts([art("goal", "3")], "u");
    expect(goalDelete).toHaveBeenCalledWith(3);
  });

  it("routes calendar_feed through the encoded id and deleteFeed", async () => {
    await cleanupArtifacts(
      [art("calendar_feed", "7:https://example.com/cal.ics")],
      "alice",
    );
    expect(deleteFeed).toHaveBeenCalledWith("alice", 7);
  });

  it("routes telegram_link to clearPairing", async () => {
    await cleanupArtifacts([art("telegram_link", "paired")], "alice");
    expect(clearPairing).toHaveBeenCalledWith("alice");
  });

  it("routes inbox-located telegram_image to inbox base", async () => {
    await cleanupArtifacts(
      [art("telegram_image", "photo.png:inbox")],
      "alice",
    );
    expect(deleteImageFromBase).toHaveBeenCalledWith(
      "users/alice/inbox",
      "photo.png",
    );
  });

  it("routes task-located telegram_image to the task's results base", async () => {
    tasksGet.mockResolvedValueOnce({
      id: 12,
      owner: "bob",
      name: "x",
    } as never);
    await cleanupArtifacts(
      [art("telegram_image", "photo.png:task-12")],
      "alice",
    );
    expect(tasksGet).toHaveBeenCalledWith(12);
    expect(deleteImageFromBase).toHaveBeenCalledWith(
      "users/bob/tasks/12/results",
      "photo.png",
    );
  });

  it("routes lab_user through usersApi.delete with confirmation step 2 + ack", async () => {
    await cleanupArtifacts([art("lab_user", "beakerbot")], "alice");
    expect(userDelete).toHaveBeenCalledWith("beakerbot", 2, true);
  });

  it("treats lab_task / variation_note / note_entry / hybrid_edit / notes_content / ai_helper_prompt_copied as no-ops", async () => {
    await cleanupArtifacts(
      [
        art("lab_task", "edit-demo:1"),
        art("variation_note", "exp-5"),
        art("note_entry", "n-1"),
        art("hybrid_edit", "note-5"),
        art("notes_content", "7"),
        art("ai_helper_prompt_copied", "minimal"),
      ],
      "alice",
    );
    expect(projectDelete).not.toHaveBeenCalled();
    expect(methodDelete).not.toHaveBeenCalled();
    expect(taskDelete).not.toHaveBeenCalled();
    expect(userDelete).not.toHaveBeenCalled();
  });

  it("routes inbox-located notes_image to the inbox base", async () => {
    await cleanupArtifacts(
      [art("notes_image", "selfie.png:inbox")],
      "alice",
    );
    expect(deleteImageFromBase).toHaveBeenCalledWith(
      "users/alice/inbox",
      "selfie.png",
    );
  });

  it("routes task-located notes_image to the task's notes base (NOT results)", async () => {
    tasksGet.mockResolvedValueOnce({
      id: 22,
      owner: "bob",
      name: "demo experiment",
    } as never);
    await cleanupArtifacts(
      [art("notes_image", "beakerbot-selfie.png:task-22")],
      "alice",
    );
    expect(tasksGet).toHaveBeenCalledWith(22);
    // taskNotesBase(...) is `users/bob/results/task-22/notes` — the
    // image lives inside that scoped folder so deleteImageFromBase
    // appends `/Images/...`.
    expect(deleteImageFromBase).toHaveBeenCalledWith(
      "users/bob/results/task-22/notes",
      "beakerbot-selfie.png",
    );
  });

  it("reverts settings_change(color) via patchUserSettings", async () => {
    await cleanupArtifacts(
      [art("settings_change", "color:#3b82f6→#10b981")],
      "alice",
    );
    expect(patchUserSettings).toHaveBeenCalledWith("alice", {
      color: "#3b82f6",
    });
  });

  it("returns a summary distinguishing successes from failures", async () => {
    projectDelete.mockRejectedValueOnce(new Error("boom"));
    const summary = await cleanupArtifacts(
      [art("project", "1"), art("goal", "2")],
      "alice",
    );
    expect(summary.attempted).toBe(2);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]).toMatchObject({ type: "project", id: "1" });
    expect(projectDelete).toHaveBeenCalledWith(1);
    expect(goalDelete).toHaveBeenCalledWith(2);
  });
});

describe("welcome notification sweep (v4 Phase 4 cleanup-completeness 2026-05-21)", () => {
  it("dismisses every Welcome-to-ResearchOS event_reminder before the artifact loop", async () => {
    getNotifications.mockResolvedValueOnce({
      notifications: [
        {
          id: "n-1",
          type: "event_reminder",
          event_title: "Welcome to ResearchOS",
        },
        {
          id: "n-2",
          type: "event_reminder",
          event_title: "Welcome to ResearchOS",
        },
        {
          id: "n-3",
          type: "event_reminder",
          event_title: "Unrelated reminder",
        },
        {
          id: "n-4",
          type: "task_shared",
          event_title: "Welcome to ResearchOS",
        },
      ],
    });
    await cleanupArtifacts([], "alice");
    expect(dismissNotification).toHaveBeenCalledTimes(2);
    expect(dismissNotification).toHaveBeenCalledWith("n-1");
    expect(dismissNotification).toHaveBeenCalledWith("n-2");
    expect(dismissNotification).not.toHaveBeenCalledWith("n-3");
    expect(dismissNotification).not.toHaveBeenCalledWith("n-4");
  });

  it("runs the sweep even when the artifact list is non-empty", async () => {
    getNotifications.mockResolvedValueOnce({
      notifications: [
        {
          id: "n-x",
          type: "event_reminder",
          event_title: "Welcome to ResearchOS",
        },
      ],
    });
    await cleanupArtifacts([art("project", "1")], "alice");
    expect(dismissNotification).toHaveBeenCalledWith("n-x");
    expect(projectDelete).toHaveBeenCalledWith(1);
  });

  it("swallows a getNotifications failure without breaking the artifact loop", async () => {
    getNotifications.mockRejectedValueOnce(new Error("inbox unreachable"));
    const summary = await cleanupArtifacts([art("goal", "9")], "alice");
    expect(summary.succeeded).toBe(1);
    expect(goalDelete).toHaveBeenCalledWith(9);
  });
});

describe("idempotency", () => {
  it("re-running the same input twice does not throw and reports both passes", async () => {
    const input: WizardArtifact[] = [
      art("project", "1"),
      art("method", "17:placeholder"),
      art("goal", "5"),
    ];
    const summary1 = await cleanupArtifacts(input, "alice");
    const summary2 = await cleanupArtifacts(input, "alice");
    expect(summary1.attempted).toBe(3);
    expect(summary2.attempted).toBe(3);
    // Both passes call through; the underlying APIs are idempotent on
    // their end (missing-id deletes are no-ops in the real stores).
    expect(projectDelete).toHaveBeenCalledTimes(2);
    expect(methodDelete).toHaveBeenCalledTimes(2);
    expect(goalDelete).toHaveBeenCalledTimes(2);
  });
});

describe("isCleanupExcluded", () => {
  it("returns false on a standard WizardArtifact without the flag", () => {
    expect(isCleanupExcluded(art("project", "1"))).toBe(false);
  });

  it("returns true when the artifact carries cleanup_excluded: true", () => {
    const flagged = {
      ...art("lab_task", "edit-demo:1"),
      cleanup_excluded: true,
    } as WizardArtifact;
    expect(isCleanupExcluded(flagged)).toBe(true);
  });

  it("returns false when cleanup_excluded is set to a non-true value", () => {
    const half = {
      ...art("lab_task", "edit-demo:1"),
      cleanup_excluded: "yes",
    } as unknown as WizardArtifact;
    expect(isCleanupExcluded(half)).toBe(false);
  });
});

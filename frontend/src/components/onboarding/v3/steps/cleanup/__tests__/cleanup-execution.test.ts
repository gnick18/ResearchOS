import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WizardArtifact } from "@/lib/onboarding/sidecar";

/**
 * cleanup-execution unit tests. Pure routing checks: each artifact
 * type should call its matching domain delete API with the expected
 * arguments, and failures inside one entry should not abort the rest
 * of the sweep.
 */

const {
  projectDelete,
  methodDelete,
  taskDelete,
  goalDelete,
  userDelete,
  deleteFeed,
  clearPairing,
  deleteImageFromBase,
  patchUserSettings,
  tasksGet,
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
}));

vi.mock("@/lib/local-api", () => ({
  projectsApi: { delete: projectDelete },
  methodsApi: { delete: methodDelete },
  tasksApi: { delete: taskDelete, get: tasksGet },
  goalsApi: { delete: goalDelete },
  usersApi: { delete: userDelete },
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

import { cleanupArtifacts } from "../cleanup-execution";

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
  deleteFeed.mockClear();
  clearPairing.mockClear();
  deleteImageFromBase.mockClear();
  patchUserSettings.mockClear();
  tasksGet.mockClear();
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

  it("routes experiment and purchase to tasksApi.delete", async () => {
    await cleanupArtifacts(
      [art("experiment", "5"), art("purchase", "9")],
      "u",
    );
    expect(taskDelete).toHaveBeenCalledTimes(2);
    expect(taskDelete).toHaveBeenCalledWith(5);
    expect(taskDelete).toHaveBeenCalledWith(9);
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

  it("treats lab_task and hybrid_edit as no-ops", async () => {
    await cleanupArtifacts(
      [
        art("lab_task", "edit-demo:1"),
        art("hybrid_edit", "note-5"),
      ],
      "alice",
    );
    expect(projectDelete).not.toHaveBeenCalled();
    expect(methodDelete).not.toHaveBeenCalled();
    expect(taskDelete).not.toHaveBeenCalled();
    expect(userDelete).not.toHaveBeenCalled();
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

  it("swallows per-artifact errors and continues with the next entry", async () => {
    projectDelete.mockRejectedValueOnce(new Error("boom"));
    await cleanupArtifacts(
      [art("project", "1"), art("goal", "2")],
      "alice",
    );
    expect(projectDelete).toHaveBeenCalledWith(1);
    expect(goalDelete).toHaveBeenCalledWith(2);
  });
});

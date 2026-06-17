// frontend/src/lib/shift-alerts.test.ts
//
// Tests for the cross-user shift-alert plumbing introduced for the
// "alex shifts → morgan sees a notification" flow. Covers:
//
//   1. Writer side: `tasksApi.move` appends `_shifted-alerts.json` entries
//      ONLY when affected tasks have `shared_with.length > 0`.
//   2. Receiver side: `sharingApi.scanShiftAlerts` reads the owner's
//      sidecar, mints a `ShiftAlertNotification` per matching alert into
//      the receiver's `_notifications.json`, and stamps the source UUID
//      into the receiver's `_seen-shift-alerts.json`.
//   3. Dedup: a second scan call with no new owner-side alerts is a no-op.
//   4. Self-shift filter: receiver doesn't mint a notification for an
//      alert whose `shifted_by_user` matches the current user.
//   5. Dismiss-marker idempotency: `sharingApi.dismissShiftAlert` adds the
//      source alert id to seen-list so re-scanning doesn't re-mint.
//
// Strategy: same in-memory fileService + indexeddb-store mock as
// `tasks-api-update.test.ts`. The current-user mock returns whatever the
// per-test setter has dialed in, and `clearCurrentUserCache` is called
// between user switches so `getCurrentUserCached` re-reads from the mock.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Task, ShiftedAlertsFile, SeenShiftAlertsFile, Notification } from "./types";

const memFs = new Map<string, unknown>();
let currentUserMock = "alex";

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
import { tasksApi, sharingApi } from "./local-api";
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
    name: "test task",
    start_date: "2026-05-14",
    duration_days: 1,
    end_date: "2026-05-14",
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
  setCurrentUser("alex");
});

describe("tasksApi.move — _shifted-alerts.json sidecar", () => {
  it("does NOT write a sidecar when the affected task has no shared_with", async () => {
    seedTask("alex", {
      id: 1,
      start_date: "2026-05-14",
      end_date: "2026-05-14",
      shared_with: [],
    });

    await tasksApi.move(1, { new_start_date: "2026-05-20" });

    const sidecar = memFs.get("users/alex/_shifted-alerts.json");
    expect(sidecar).toBeUndefined();
  });

  it("appends an entry for each shared affected task", async () => {
    seedTask("alex", {
      id: 1,
      start_date: "2026-05-14",
      end_date: "2026-05-14",
      shared_with: [{ username: "morgan", permission: "view" }],
    });

    // 2026-05-18 is a Monday — pick a weekday target so the weekend resolver
    // in `shiftTask` doesn't push us forward.
    await tasksApi.move(1, { new_start_date: "2026-05-18" });

    const sidecar = memFs.get(
      "users/alex/_shifted-alerts.json"
    ) as ShiftedAlertsFile;
    expect(sidecar).toBeDefined();
    expect(sidecar.alerts).toHaveLength(1);
    const alert = sidecar.alerts[0];
    expect(alert.task_id).toBe(1);
    expect(alert.task_key).toBe("alex:1");
    expect(alert.task_name).toBe("test task");
    expect(alert.shifted_by_user).toBe("alex");
    expect(alert.old_start).toBe("2026-05-14");
    expect(alert.new_start).toBe("2026-05-18");
    expect(alert.start_delta_days).toBe(4);
  });

  it("appends to an existing sidecar instead of overwriting it", async () => {
    // Seed an existing alert from a previous shift.
    memFs.set("users/alex/_shifted-alerts.json", {
      version: 1,
      alerts: [
        {
          id: "old-uuid",
          task_id: 99,
          task_key: "alex:99",
          task_name: "an older shift",
          start_delta_days: 1,
          end_delta_days: 1,
          old_start: "2026-05-10",
          old_end: "2026-05-10",
          new_start: "2026-05-11",
          new_end: "2026-05-11",
          shifted_at: "2026-06-15T00:00:00Z",
          shifted_by_user: "alex",
        },
      ],
    } satisfies ShiftedAlertsFile);

    seedTask("alex", {
      id: 1,
      start_date: "2026-05-14",
      end_date: "2026-05-14",
      shared_with: [{ username: "morgan", permission: "view" }],
    });

    await tasksApi.move(1, { new_start_date: "2026-05-15" });

    const sidecar = memFs.get(
      "users/alex/_shifted-alerts.json"
    ) as ShiftedAlertsFile;
    expect(sidecar.alerts).toHaveLength(2);
    expect(sidecar.alerts[0].id).toBe("old-uuid");
    expect(sidecar.alerts[1].task_id).toBe(1);
  });
});

describe("sharingApi.scanShiftAlerts — receiver-side mint + dedup", () => {
  function seedSharedWithMe(receiver: string, owner: string, taskId: number) {
    memFs.set(`users/${receiver}/_shared_with_me.json`, {
      version: 1,
      projects: [],
      tasks: [
        {
          id: taskId,
          owner,
          permission: "view",
          shared_at: "2026-05-13T00:00:00Z",
        },
      ],
      methods: [],
    });
  }

  function seedOwnerAlert(
    owner: string,
    alertId: string,
    taskId: number,
    shiftedBy: string,
    overrides: Partial<{
      old_start: string;
      new_start: string;
      old_end: string;
      new_end: string;
    }> = {}
  ) {
    const existing = (memFs.get(`users/${owner}/_shifted-alerts.json`) as
      | ShiftedAlertsFile
      | undefined) ?? { version: 1, alerts: [] };
    existing.alerts.push({
      id: alertId,
      task_id: taskId,
      task_key: `${owner}:${taskId}`,
      task_name: "shared task",
      start_delta_days: 2,
      end_delta_days: 2,
      old_start: overrides.old_start ?? "2026-05-14",
      old_end: overrides.old_end ?? "2026-05-14",
      new_start: overrides.new_start ?? "2026-05-16",
      new_end: overrides.new_end ?? "2026-05-16",
      shifted_at: "2026-05-14T10:00:00Z",
      shifted_by_user: shiftedBy,
    });
    memFs.set(`users/${owner}/_shifted-alerts.json`, existing);
  }

  it("mints a ShiftAlertNotification for a matching unseen owner alert", async () => {
    setCurrentUser("morgan");
    seedSharedWithMe("morgan", "alex", 1);
    seedOwnerAlert("alex", "alert-A", 1, "alex");

    const result = await sharingApi.scanShiftAlerts();

    expect(result.new_notification_count).toBe(1);
    const notifs = memFs.get("users/morgan/_notifications.json") as {
      version: 1;
      notifications: Notification[];
    };
    expect(notifs.notifications).toHaveLength(1);
    const n = notifs.notifications[0];
    expect(n.type).toBe("shift_alert");
    if (n.type !== "shift_alert") throw new Error("type-narrow");
    expect(n.from_user).toBe("alex");
    expect(n.item_id).toBe(1);
    expect(n.task_key).toBe("alex:1");
    expect(n.source_alert_id).toBe("alert-A");
    expect(n.read).toBe(false);

    // Seen-list now contains the source UUID.
    const seen = memFs.get(
      "users/morgan/_seen-shift-alerts.json"
    ) as SeenShiftAlertsFile;
    expect(seen.seen_ids).toContain("alert-A");
  });

  it("is idempotent: re-scanning without new alerts mints zero new entries", async () => {
    setCurrentUser("morgan");
    seedSharedWithMe("morgan", "alex", 1);
    seedOwnerAlert("alex", "alert-A", 1, "alex");

    const first = await sharingApi.scanShiftAlerts();
    expect(first.new_notification_count).toBe(1);

    const second = await sharingApi.scanShiftAlerts();
    expect(second.new_notification_count).toBe(0);

    const notifs = memFs.get("users/morgan/_notifications.json") as {
      version: 1;
      notifications: Notification[];
    };
    expect(notifs.notifications).toHaveLength(1);
  });

  it("does NOT mint a notification when the alert was authored by the current user", async () => {
    // morgan with edit permission shifts alex's task → alert lands in alex's
    // sidecar with shifted_by_user=morgan. When morgan herself next scans,
    // she should NOT see her own action as a notification.
    setCurrentUser("morgan");
    seedSharedWithMe("morgan", "alex", 1);
    seedOwnerAlert("alex", "alert-A", 1, "morgan");

    const result = await sharingApi.scanShiftAlerts();
    expect(result.new_notification_count).toBe(0);

    // Seen-list should still record the alert so we don't re-process it.
    const seen = memFs.get(
      "users/morgan/_seen-shift-alerts.json"
    ) as SeenShiftAlertsFile;
    expect(seen.seen_ids).toContain("alert-A");
  });

  it("scans the current user's own namespace too (owner sees co-editor shifts)", async () => {
    // morgan has edit permission on alex's task and shifts it. Now alex
    // (the owner) loads and should see the alert about her own task being
    // shifted by morgan. No _shared_with_me entry needed on alex's side
    // because the task is hers.
    setCurrentUser("alex");
    // alex has NO _shared_with_me entries.
    seedOwnerAlert("alex", "alert-A", 1, "morgan");

    const result = await sharingApi.scanShiftAlerts();
    expect(result.new_notification_count).toBe(1);

    const notifs = memFs.get("users/alex/_notifications.json") as {
      version: 1;
      notifications: Notification[];
    };
    expect(notifs.notifications).toHaveLength(1);
    const n = notifs.notifications[0];
    expect(n.type === "shift_alert" && n.from_user).toBe("morgan");
  });
});

describe("sharingApi.dismissShiftAlert — seen-marker idempotency", () => {
  it("removes the notification AND marks the source alert id as seen", async () => {
    setCurrentUser("morgan");
    memFs.set("users/morgan/_shared_with_me.json", {
      version: 1,
      projects: [],
      tasks: [
        {
          id: 1,
          owner: "alex",
          permission: "view",
          shared_at: "2026-05-13T00:00:00Z",
        },
      ],
      methods: [],
    });
    memFs.set("users/alex/_shifted-alerts.json", {
      version: 1,
      alerts: [
        {
          id: "alert-A",
          task_id: 1,
          task_key: "alex:1",
          task_name: "shared task",
          start_delta_days: 2,
          end_delta_days: 2,
          old_start: "2026-05-14",
          old_end: "2026-05-14",
          new_start: "2026-05-16",
          new_end: "2026-05-16",
          shifted_at: "2026-05-14T10:00:00Z",
          shifted_by_user: "alex",
        },
      ],
    } satisfies ShiftedAlertsFile);

    await sharingApi.scanShiftAlerts();
    const notifs = memFs.get("users/morgan/_notifications.json") as {
      version: 1;
      notifications: Notification[];
    };
    const notif = notifs.notifications[0];
    expect(notif.type).toBe("shift_alert");

    await sharingApi.dismissShiftAlert(notif.id);

    const after = memFs.get("users/morgan/_notifications.json") as {
      version: 1;
      notifications: Notification[];
    };
    expect(after.notifications).toHaveLength(0);

    const seen = memFs.get(
      "users/morgan/_seen-shift-alerts.json"
    ) as SeenShiftAlertsFile;
    expect(seen.seen_ids).toContain("alert-A");

    // A second scan must not re-mint.
    const result = await sharingApi.scanShiftAlerts();
    expect(result.new_notification_count).toBe(0);
  });
});

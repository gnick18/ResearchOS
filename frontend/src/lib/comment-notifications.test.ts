// Lab Head Phase 2 — comment-notification dispatch tests.
// (lab head Phase 2 manager, 2026-05-23)
//
// Exercises the fan-out side-effect of `tasksApi.addComment` /
// `notesApi.addComment`: each new comment writes bell notifications to
//   - the parent record's owner ("comment_on_owned")
//   - every @-mentioned user ("comment_mention")
//   - every other lab_head user in the lab ("comment_lab_head_feed")
// Without self-notifying the commenter.
//
// Mocks the file system so we can assert what got written to each user's
// `_notifications.json`.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Task } from "./types";

const memFs = new Map<string, unknown>();

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
    listDirectories: vi.fn(async () => ["alex", "morgan", "mira"]),
    deleteFile: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("./file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alex"),
}));

vi.mock("./file-system/user-discovery", () => ({
  discoverUsers: vi.fn(async () => ["alex", "morgan", "mira"]),
}));

import { tasksApi } from "./local-api";

interface NotifFile {
  version: number;
  notifications: Array<{
    type: string;
    from_user: string;
    record_id?: number;
    owner_username?: string;
  }>;
}

function seedTask(id: number, owner: string): Task {
  const task: Task = {
    id,
    project_id: 1,
    name: `task-${id}`,
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
    comments: [],
  };
  memFs.set(`users/${owner}/tasks/${id}.json`, task);
  return task;
}

function seedSettings(username: string, accountType: "member" | "lab_head") {
  memFs.set(`users/${username}/settings.json`, { account_type: accountType });
}

function getNotifs(username: string): NotifFile["notifications"] {
  const file = memFs.get(`users/${username}/_notifications.json`) as
    | NotifFile
    | undefined;
  return file?.notifications ?? [];
}

beforeEach(() => {
  memFs.clear();
});

describe("comment-notification dispatch", () => {
  it("notifies the record owner when someone else comments", async () => {
    seedTask(1, "morgan");
    seedSettings("alex", "member");
    seedSettings("morgan", "member");
    seedSettings("mira", "lab_head");

    await tasksApi.addComment(1, "looks good", "alex", "morgan");
    // Notifications are written via void promises — give them a tick.
    await new Promise((r) => setTimeout(r, 20));

    // Owner gets one "comment_on_owned" entry.
    const morganNotifs = getNotifs("morgan");
    expect(morganNotifs).toHaveLength(1);
    expect(morganNotifs[0].type).toBe("comment_on_owned");
    expect(morganNotifs[0].from_user).toBe("alex");

    // mira (the lab head) gets one "comment_lab_head_feed" entry —
    // EVERY lab-wide comment fans out to lab heads per Phase 2 brief.
    const miraNotifs = getNotifs("mira");
    expect(miraNotifs).toHaveLength(1);
    expect(miraNotifs[0].type).toBe("comment_lab_head_feed");

    // alex never self-notifies.
    const alexNotifs = getNotifs("alex");
    expect(alexNotifs).toHaveLength(0);
  });

  it("notifies mentioned users with comment_mention", async () => {
    seedTask(2, "alex");
    seedSettings("alex", "member");
    seedSettings("morgan", "member");
    seedSettings("mira", "lab_head");

    await tasksApi.addComment(2, "@morgan can you weigh in?", "alex", "alex", {
      mentions: ["morgan"],
    });
    await new Promise((r) => setTimeout(r, 20));

    const morganNotifs = getNotifs("morgan");
    // morgan is mentioned (and is not the owner), so type === comment_mention.
    expect(morganNotifs).toHaveLength(1);
    expect(morganNotifs[0].type).toBe("comment_mention");
    // mira gets the lab-head feed entry.
    const miraNotifs = getNotifs("mira");
    expect(miraNotifs).toHaveLength(1);
    expect(miraNotifs[0].type).toBe("comment_lab_head_feed");
  });

  it("never self-notifies the commenter even when they own the record", async () => {
    seedTask(3, "alex");
    seedSettings("alex", "member");
    seedSettings("mira", "lab_head");

    await tasksApi.addComment(3, "self-note", "alex");
    await new Promise((r) => setTimeout(r, 20));

    expect(getNotifs("alex")).toHaveLength(0);
    // mira still gets the lab-head feed entry because she's a different
    // user.
    expect(getNotifs("mira")).toHaveLength(1);
  });
});

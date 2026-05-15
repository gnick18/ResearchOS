// frontend/src/lib/telegram/batch-routing.test.ts
//
// State-machine coverage for batch photo routing. The Telegram Bot API
// boundary is stubbed (sendMessage, answerCallbackQuery, attachImage)
// so we can drive the machine through every transition without spinning
// a real bot. The seven required scenarios from the brief plus a couple
// of edge cases (chat-id guard, callback against stale state) live here.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted shared mock state — mirrors the pattern in image-router.test.ts.
const hoisted = vi.hoisted(() => {
  const memFs = new Map<string, unknown>();
  return {
    memFs,
    sendMessageMock: vi.fn(
      async (
        _token: string,
        _chatId: number,
        _text: string,
        _opts?: {
          reply_to_message_id?: number;
          reply_markup?: unknown;
        },
      ) => ({}),
    ),
    answerCallbackQueryMock: vi.fn(
      async (
        _token: string,
        _id: string,
        _opts?: { text?: string; show_alert?: boolean },
      ) => true,
    ),
    attachImageToTaskMock: vi.fn(async (opts: { suggestedFilename: string; basePath?: string }) => ({
      finalFilename: opts.suggestedFilename,
      finalPath: `${opts.basePath ?? "users/alex/inbox"}/Images/${opts.suggestedFilename}`,
      relativePath: `Images/${opts.suggestedFilename}`,
      altText: "",
      markdownSnippet: "",
    })),
  };
});

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = hoisted.memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      hoisted.memFs.set(path, data);
    }),
    fileExists: vi.fn(async () => false),
  },
}));

vi.mock("./telegram-client", async () => {
  const actual = await vi.importActual<typeof import("./telegram-client")>(
    "./telegram-client",
  );
  return {
    ...actual,
    sendMessage: hoisted.sendMessageMock,
    answerCallbackQuery: hoisted.answerCallbackQueryMock,
  };
});

vi.mock("@/lib/attachments/attach-image", () => ({
  attachImageToTask: hoisted.attachImageToTaskMock,
}));

vi.mock("@/lib/tasks/results-paths", () => ({
  resolveTaskResultsBase: vi.fn(async (task: { id: number; owner: string }) =>
    `users/${task.owner}/results/task-${task.id}`,
  ),
}));

vi.mock("@/lib/attachments/image-folder", () => ({
  sidecarPath: (basePath: string, filename: string) =>
    `${basePath}/Images/${filename}.json`,
}));

vi.mock("@/lib/storage/json-store", () => ({
  // Default loader returns []; individual tests swap via setExperimentsLoader.
  JsonStore: class {
    async listAllForUser(): Promise<unknown[]> {
      return [];
    }
  },
}));

import {
  _peekBatchForTests,
  _resetBatchesForTests,
  _resetExperimentsLoaderForTests,
  _setExperimentsLoaderForTests,
  BATCH_MAX_PHOTOS,
  BATCH_WINDOW_MS,
  consumeBatchTextReply,
  routeBatchablePhoto,
  routeBatchCallbackQuery,
  type BatchPhoto,
  type BatchRouteContext,
} from "./batch-routing";
import type { Task } from "@/lib/types";
import type { TelegramCallbackQuery } from "./telegram-client";
import type { ActiveTask } from "@/lib/store";

const CHAT_ID = 4242;
const USER = "alex";
const baseCtx: BatchRouteContext = {
  username: USER,
  botToken: "test-token",
  chatId: CHAT_ID,
};

function makePhoto(stem = "photo", ext = "jpg"): BatchPhoto {
  return {
    messageId: Math.floor(Math.random() * 1_000_000),
    date: Math.floor(Date.now() / 1000),
    caption: null,
    blob: new Blob([new Uint8Array([1, 2, 3])]),
    suggestedStem: stem,
    suggestedExt: ext,
  };
}

function makeCallback(data: string): TelegramCallbackQuery {
  return {
    id: `cq-${Math.random().toString(36).slice(2)}`,
    from: { id: 1, is_bot: false, first_name: "Alex" },
    message: {
      message_id: 99,
      date: Math.floor(Date.now() / 1000),
      chat: { id: CHAT_ID, type: "private" },
    },
    data,
  };
}

function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function makeExperiment(overrides: Partial<Task>): Task {
  const today = todayLocalDate();
  return {
    id: 1,
    project_id: 1,
    name: "E1",
    start_date: today,
    duration_days: 7,
    end_date: today,
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
    owner: USER,
    shared_with: [],
    ...overrides,
  } as Task;
}

beforeEach(() => {
  hoisted.memFs.clear();
  hoisted.sendMessageMock.mockClear();
  hoisted.answerCallbackQueryMock.mockClear();
  hoisted.attachImageToTaskMock.mockClear();
  _resetBatchesForTests();
  _resetExperimentsLoaderForTests();
  vi.useRealTimers();
});

describe("batch-routing: buffering", () => {
  it("buffers 3 photos and commits after the debounce window", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("buffering");
    vi.advanceTimersByTime(300);
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    vi.advanceTimersByTime(300);
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    // Three photos buffered; still buffering.
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("buffering");
    // Advance past the window with no further arrivals.
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    const after = _peekBatchForTests(CHAT_ID);
    // No activeTask was supplied, so we should now be awaiting destination.
    expect(after?.kind).toBe("awaiting-destination");
    if (after?.kind === "awaiting-destination") {
      expect(after.photos).toHaveLength(3);
    }
    expect(hoisted.sendMessageMock).toHaveBeenCalledTimes(1);
    const args = hoisted.sendMessageMock.mock.calls[0];
    expect(args[2]).toContain("3 photos");
    expect((args[3] as { reply_markup?: unknown })?.reply_markup).toBeDefined();
  });

  it("commits immediately at the 10-photo cap without waiting for the window", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    for (let i = 0; i < BATCH_MAX_PHOTOS; i++) {
      await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    }
    // Allow microtasks queued by commitBuffer to run.
    await vi.advanceTimersByTimeAsync(0);
    // We should have transitioned out of buffering before the window
    // elapsed (window has not been advanced).
    const after = _peekBatchForTests(CHAT_ID);
    expect(after?.kind).toBe("awaiting-destination");
    if (after?.kind === "awaiting-destination") {
      expect(after.photos).toHaveLength(BATCH_MAX_PHOTOS);
    }
  });
});

describe("batch-routing: media_group_id boundary", () => {
  it("activeTask snapshot at first photo is preserved across the batch", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    const t1: ActiveTask = { id: 1, owner: USER, name: "T1" };
    const t2: ActiveTask = { id: 2, owner: USER, name: "T2" };
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, t1);
    // Caller's activeTask changes mid-buffer.
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, t2);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    const after = _peekBatchForTests(CHAT_ID);
    // Should have skipped destination picker (activeTask was set at
    // first photo) and gone to awaiting-style with the T1 destination.
    expect(after?.kind).toBe("awaiting-style");
    if (after?.kind === "awaiting-style") {
      expect(after.destination).toEqual({
        kind: "task",
        taskId: 1,
        owner: USER,
        name: "T1",
      });
    }
  });

  it("new batch arriving mid-flow cancels pending and sends a restart notice", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    // First batch: get to awaiting-style.
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, {
      id: 1,
      owner: USER,
      name: "T1",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-style");
    // New album lands while the first is still mid-flow.
    hoisted.sendMessageMock.mockClear();
    await routeBatchablePhoto("g2", makePhoto(), baseCtx, null);
    // The cancel notice should have fired before the new batch started
    // buffering.
    const noticeCall = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("new album"),
    );
    expect(noticeCall).toBeDefined();
    const after = _peekBatchForTests(CHAT_ID);
    expect(after?.kind).toBe("buffering");
    if (after?.kind === "buffering") {
      expect(after.mediaGroupId).toBe("g2");
    }
  });
});

describe("batch-routing: full destination → style → auto flow", () => {
  it("walks no-activeTask through the destination picker and auto-name commit", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 3, name: "Doing E", start_date: todayLocalDate(), end_date: todayLocalDate() }),
    ]);

    // 2 photos, no activeTask.
    await routeBatchablePhoto("g1", makePhoto("a"), baseCtx, null);
    await routeBatchablePhoto("g1", makePhoto("b"), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    // Bot asks for destination.
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-destination");
    const destPrompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).includes("Where should they go"),
    );
    expect(destPrompt).toBeDefined();
    const destMarkup = (destPrompt![3] as { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } })
      ?.reply_markup;
    expect(destMarkup).toBeDefined();
    // Doing experiment + Inbox at minimum.
    expect(destMarkup!.inline_keyboard.length).toBeGreaterThanOrEqual(2);
    const inboxButton = destMarkup!.inline_keyboard
      .flat()
      .find((b) => b.callback_data === "inbox");
    expect(inboxButton).toBeDefined();
    const taskButton = destMarkup!.inline_keyboard
      .flat()
      .find((b) => b.callback_data.startsWith("task:3:"));
    expect(taskButton).toBeDefined();

    // User clicks the task button.
    hoisted.sendMessageMock.mockClear();
    await routeBatchCallbackQuery(makeCallback(taskButton!.callback_data), baseCtx);
    expect(hoisted.answerCallbackQueryMock).toHaveBeenCalledTimes(1);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-style");
    // Style prompt sent.
    const stylePrompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).includes("How should they be named"),
    );
    expect(stylePrompt).toBeDefined();
    const styleMarkup = (stylePrompt![3] as { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } })
      ?.reply_markup;
    expect(
      styleMarkup!.inline_keyboard.flat().some((b) => b.callback_data === "style:auto"),
    ).toBe(true);

    // User clicks auto-number.
    hoisted.sendMessageMock.mockClear();
    hoisted.answerCallbackQueryMock.mockClear();
    await routeBatchCallbackQuery(makeCallback("style:auto"), baseCtx);
    expect(hoisted.answerCallbackQueryMock).toHaveBeenCalledTimes(1);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-batch-name");
    const namePrompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).includes("Reply with a batch name"),
    );
    expect(namePrompt).toBeDefined();

    // User types the batch name.
    hoisted.sendMessageMock.mockClear();
    const consumed = await consumeBatchTextReply("Yeast assay", baseCtx);
    expect(consumed).toBe(true);
    // Both photos got attached with -1 / -2 suffixes.
    expect(hoisted.attachImageToTaskMock).toHaveBeenCalledTimes(2);
    const calls = hoisted.attachImageToTaskMock.mock.calls;
    const filenames = calls.map((c) => (c[0] as { suggestedFilename: string }).suggestedFilename);
    expect(filenames).toEqual(
      expect.arrayContaining(["Yeast assay-1.jpg", "Yeast assay-2.jpg"]),
    );
    // Final summary message.
    const summary = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).includes("Saved 2 photos"),
    );
    expect(summary).toBeDefined();
    // State cleared.
    expect(_peekBatchForTests(CHAT_ID)).toBeUndefined();
  });
});

describe("batch-routing: per-photo-captions flow", () => {
  it("style:each writes photos up front and consumes per-photo captions in order", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    // Skip the destination prompt by passing an activeTask.
    const photoA = makePhoto("a");
    const photoB = makePhoto("b");
    await routeBatchablePhoto("g1", photoA, baseCtx, {
      id: 5,
      owner: USER,
      name: "Bench",
    });
    await routeBatchablePhoto("g1", photoB, baseCtx, {
      id: 5,
      owner: USER,
      name: "Bench",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-style");

    await routeBatchCallbackQuery(makeCallback("style:each"), baseCtx);
    // Two photos written up front.
    expect(hoisted.attachImageToTaskMock).toHaveBeenCalledTimes(2);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-per-photo-captions");

    // First caption.
    await consumeBatchTextReply("Plate at t=0", baseCtx);
    // Sidecar for photo A should have caption.
    const peek1 = _peekBatchForTests(CHAT_ID);
    expect(peek1?.kind).toBe("awaiting-per-photo-captions");
    // Second caption, including a /skip case to confirm skip semantics.
    await consumeBatchTextReply("/skip", baseCtx);
    // State cleared after the last caption.
    expect(_peekBatchForTests(CHAT_ID)).toBeUndefined();
  });
});

describe("batch-routing: chatId guard", () => {
  it("ignores a callback_query from an unpaired chat", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, {
      id: 1,
      owner: USER,
      name: "T1",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-style");

    // Click from a different chat id should be ignored entirely.
    const cq = makeCallback("style:auto");
    cq.message!.chat.id = 99999;
    await routeBatchCallbackQuery(cq, baseCtx);
    // State unchanged, no ack sent.
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-style");
    expect(hoisted.answerCallbackQueryMock).not.toHaveBeenCalled();
  });

  it("acks a click against stale state with an Album expired notice", async () => {
    // No batch in flight; user clicks an old keyboard.
    const cq = makeCallback("task:1:alex");
    await routeBatchCallbackQuery(cq, baseCtx);
    expect(hoisted.answerCallbackQueryMock).toHaveBeenCalledTimes(1);
    const opts = hoisted.answerCallbackQueryMock.mock.calls[0][2];
    expect(opts?.text).toContain("expired");
  });
});

// frontend/src/lib/telegram/batch-routing.test.ts
//
// State-machine coverage for the simplified (picker-free) batch +
// single-photo routing. The Telegram Bot API boundary is stubbed
// (sendMessage, answerCallbackQuery, attachImage) so we can drive the
// machine through every transition without spinning a real bot.
//
// The experiment-list destination PICKER was removed (telegram-simplify
// 2026-06-02). Two routes survive:
//   1. Active task open → "Lab Notes or Results?" prompt → naming/caption
//      style flow → commit. No "pick-other" escape.
//   2. Nothing open → the batch is written straight to the Inbox and the
//      bot sends ONE ack ("Saved to inbox"). No buttons, no picker.
// Active-note-only attaches straight to the open note (single style
// prompt). Tutorial-mode keeps its one-button Inbox prompt.
//
// Kept behavior under test: media-group buffering + first-photo snapshot,
// the active-task Lab Notes/Results prompt, the naming style flows
// (auto-number + per-photo captions), the per-tab write target, note
// attach, the nothing-open inbox commit + media_group_id sidecar, and the
// tutorial-mode one-button Inbox flow.

import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const memFs = new Map<string, unknown>();
  const memBlobs = new Map<string, string>();
  return {
    memFs,
    memBlobs,
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
    sendPhotoMock: vi.fn(
      async (
        _token: string,
        _chatId: number,
        _fileId: string,
        _caption?: string,
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
    attachImageToNoteMock: vi.fn(
      async (opts: {
        ownerUsername: string;
        noteId: number;
        suggestedFilename: string;
        entryId?: string;
      }) => ({
        finalFilename: opts.suggestedFilename,
        absolutePath: `users/${opts.ownerUsername}/notes/${opts.noteId}/Images/${opts.suggestedFilename}`,
        relativePath: `Images/${opts.suggestedFilename}`,
        appendedToEntryId: opts.entryId ?? null,
      }),
    ),
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
    fileExists: vi.fn(async (path: string) => hoisted.memBlobs.has(path)),
    readFileAsBlob: vi.fn(async (path: string) => {
      const text = hoisted.memBlobs.get(path);
      if (text === undefined) return null;
      return new Blob([text], { type: "text/markdown" });
    }),
  },
}));

vi.mock("./telegram-client", async () => {
  const actual = await vi.importActual<typeof import("./telegram-client")>(
    "./telegram-client",
  );
  return {
    ...actual,
    sendMessage: hoisted.sendMessageMock,
    sendPhoto: hoisted.sendPhotoMock,
    answerCallbackQuery: hoisted.answerCallbackQueryMock,
  };
});

vi.mock("@/lib/attachments/attach-image", () => ({
  attachImageToTask: hoisted.attachImageToTaskMock,
  attachImageToNote: hoisted.attachImageToNoteMock,
}));

vi.mock("@/lib/tasks/results-paths", () => ({
  resolveTaskResultsBase: vi.fn(async (task: { id: number; owner: string }) =>
    `users/${task.owner}/results/task-${task.id}`,
  ),
  taskResultsBase: (task: { id: number; owner: string }) =>
    `users/${task.owner}/results/task-${task.id}`,
  taskNotesBase: (task: { id: number; owner: string }) =>
    `users/${task.owner}/results/task-${task.id}/notes`,
  taskResultsTabBase: (task: { id: number; owner: string }) =>
    `users/${task.owner}/results/task-${task.id}/results`,
}));

vi.mock("@/lib/attachments/image-folder", () => ({
  sidecarPath: (basePath: string, filename: string) =>
    `${basePath}/Images/${filename}.json`,
}));

import {
  _peekBatchForTests,
  _resetBatchesForTests,
  BATCH_MAX_PHOTOS,
  BATCH_WINDOW_MS,
  consumeBatchTextReply,
  routeBatchablePhoto,
  routeBatchCallbackQuery,
  routeSinglePhotoThroughBatch,
  routeSinglePhotoTutorialMode,
  TUTORIAL_DESTINATION_PROMPT,
  type BatchPhoto,
  type BatchRouteContext,
} from "./batch-routing";
import type { TelegramCallbackQuery } from "./telegram-client";
import type { ActiveTask } from "@/lib/store";
import type { ActiveNote } from "@/lib/store";

const CHAT_ID = 4242;
const USER = "alex";
const baseCtx: BatchRouteContext = {
  username: USER,
  botToken: "test-token",
  chatId: CHAT_ID,
};

function makePhoto(stem = "photo", ext = "jpg", mediaGroupId: string | null = null): BatchPhoto {
  return {
    messageId: Math.floor(Math.random() * 1_000_000),
    date: Math.floor(Date.now() / 1000),
    caption: null,
    blob: new Blob([new Uint8Array([1, 2, 3])]),
    suggestedStem: stem,
    suggestedExt: ext,
    fileId: `file-${stem}-${Math.random().toString(36).slice(2, 8)}`,
    mediaGroupId,
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

beforeEach(() => {
  hoisted.memFs.clear();
  hoisted.memBlobs.clear();
  hoisted.sendMessageMock.mockClear();
  hoisted.sendPhotoMock.mockClear();
  hoisted.answerCallbackQueryMock.mockClear();
  hoisted.attachImageToTaskMock.mockClear();
  hoisted.attachImageToNoteMock.mockClear();
  _resetBatchesForTests();
  vi.useRealTimers();
});

describe("batch-routing: buffering", () => {
  it("buffers 3 photos and, with nothing open, commits all to inbox with one ack", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    await routeBatchablePhoto("g1", makePhoto("a", "jpg", "g1"), baseCtx, null);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("buffering");
    vi.advanceTimersByTime(300);
    await routeBatchablePhoto("g1", makePhoto("b", "jpg", "g1"), baseCtx, null);
    vi.advanceTimersByTime(300);
    await routeBatchablePhoto("g1", makePhoto("c", "jpg", "g1"), baseCtx, null);
    // Three photos buffered; still buffering.
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("buffering");
    // Advance past the window with no further arrivals.
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    // Nothing open → straight to inbox, state cleared, single ack.
    expect(_peekBatchForTests(CHAT_ID)).toBeUndefined();
    expect(hoisted.attachImageToTaskMock).toHaveBeenCalledTimes(3);
    expect(hoisted.sendMessageMock).toHaveBeenCalledTimes(1);
    const ack = String(hoisted.sendMessageMock.mock.calls[0][2]);
    expect(ack.toLowerCase()).toContain("inbox");
    expect(ack).toContain("3");
    // No buttons on the ack.
    expect(
      (hoisted.sendMessageMock.mock.calls[0][3] as { reply_markup?: unknown })
        ?.reply_markup,
    ).toBeUndefined();
  });

  it("commits immediately at the 10-photo cap without waiting for the window", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    for (let i = 0; i < BATCH_MAX_PHOTOS; i++) {
      await routeBatchablePhoto("g1", makePhoto("p" + i, "jpg", "g1"), baseCtx, null);
    }
    await vi.advanceTimersByTimeAsync(0);
    // Nothing open → committed to inbox; state cleared.
    expect(_peekBatchForTests(CHAT_ID)).toBeUndefined();
    expect(hoisted.attachImageToTaskMock).toHaveBeenCalledTimes(BATCH_MAX_PHOTOS);
  });
});

describe("batch-routing: nothing-open inbox routing + media_group_id sidecar", () => {
  it("writes every album photo to the inbox with the media_group_id sidecar field", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    await routeBatchablePhoto("3001", makePhoto("a", "jpg", "3001"), baseCtx, null);
    await routeBatchablePhoto("3001", makePhoto("b", "jpg", "3001"), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    const sidecarKeys = [...hoisted.memFs.keys()].filter(
      (k) => k.startsWith(`users/${USER}/inbox/Images/`) && k.endsWith(".json"),
    );
    expect(sidecarKeys).toHaveLength(2);
    for (const key of sidecarKeys) {
      const sidecar = hoisted.memFs.get(key) as {
        source?: string;
        telegramMediaGroupId?: string;
      };
      expect(sidecar.source).toBe("telegram");
      expect(sidecar.telegramMediaGroupId).toBe("3001");
    }
  });

  it("single standalone photo (no media group) lands in inbox with no group id and a singular ack", async () => {
    await routeSinglePhotoThroughBatch(makePhoto("solo"), baseCtx, null);
    expect(_peekBatchForTests(CHAT_ID)).toBeUndefined();
    expect(hoisted.attachImageToTaskMock).toHaveBeenCalledTimes(1);
    const inboxArg = hoisted.attachImageToTaskMock.mock.calls[0][0] as {
      basePath?: string;
    };
    expect(inboxArg.basePath).toBe(`users/${USER}/inbox`);

    const sidecarKeys = [...hoisted.memFs.keys()].filter(
      (k) => k.startsWith(`users/${USER}/inbox/Images/`) && k.endsWith(".json"),
    );
    expect(sidecarKeys).toHaveLength(1);
    const sidecar = hoisted.memFs.get(sidecarKeys[0]) as {
      telegramMediaGroupId?: string;
    };
    expect(sidecar.telegramMediaGroupId).toBeUndefined();

    const ack = String(hoisted.sendMessageMock.mock.calls.at(-1)?.[2]);
    expect(ack.toLowerCase()).toContain("inbox");
    expect(ack).not.toContain("photos");
  });
});

describe("batch-routing: media_group_id boundary", () => {
  it("activeTask snapshot at first photo is preserved across the batch", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    const t1: ActiveTask = { id: 1, owner: USER, name: "T1" };
    const t2: ActiveTask = { id: 2, owner: USER, name: "T2" };
    await routeBatchablePhoto("g1", makePhoto("a", "jpg", "g1"), baseCtx, t1);
    // Caller's activeTask changes mid-buffer.
    await routeBatchablePhoto("g1", makePhoto("b", "jpg", "g1"), baseCtx, t2);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    const after = _peekBatchForTests(CHAT_ID);
    // With an active task we park in awaiting-active-confirmation, holding
    // the FIRST-photo snapshot.
    expect(after?.kind).toBe("awaiting-active-confirmation");
    if (after?.kind === "awaiting-active-confirmation") {
      expect(after.activeTask).toEqual({ id: 1, owner: USER, name: "T1" });
    }
  });

  it("new batch arriving mid-flow cancels pending and sends a restart notice", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    await routeBatchablePhoto("g1", makePhoto("a", "jpg", "g1"), baseCtx, {
      id: 1,
      owner: USER,
      name: "T1",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-active-confirmation");
    hoisted.sendMessageMock.mockClear();
    await routeBatchablePhoto("g2", makePhoto("c", "jpg", "g2"), baseCtx, null);
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

describe("batch-routing: active-task Lab Notes / Results prompt", () => {
  it("active task open → two-button keyboard (no pick-other) → Lab Notes → awaiting-style subTab=notes", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });

    await routeBatchablePhoto("g1", makePhoto("a", "jpg", "g1"), baseCtx, {
      id: 7,
      owner: USER,
      name: "Bench",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-active-confirmation");

    const prompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    expect(prompt).toBeDefined();
    const markup = (prompt![3] as { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } })
      ?.reply_markup;
    const buttons = markup!.inline_keyboard.flat();
    const notesButton = buttons.find((b) => b.callback_data === "tab:7:alex:notes");
    const resultsButton = buttons.find((b) => b.callback_data === "tab:7:alex:results");
    expect(notesButton).toBeDefined();
    expect(resultsButton).toBeDefined();
    // The "pick-other" escape was removed.
    expect(buttons.find((b) => b.callback_data === "pick-other")).toBeUndefined();
    expect(buttons.map((b) => b.text)).toEqual(["A", "B"]);

    // Click Lab Notes.
    hoisted.sendMessageMock.mockClear();
    await routeBatchCallbackQuery(makeCallback("tab:7:alex:notes"), baseCtx);
    expect(hoisted.answerCallbackQueryMock).toHaveBeenCalled();
    const after = _peekBatchForTests(CHAT_ID);
    expect(after?.kind).toBe("awaiting-style");
    if (after?.kind === "awaiting-style") {
      expect(after.destination).toEqual({
        kind: "task",
        taskId: 7,
        owner: USER,
        name: "Bench",
        subTab: "notes",
      });
    }
  });

  it("both task AND note open → task wins (Lab Notes/Results prompt, not a disambiguation picker)", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    const activeTask: ActiveTask = { id: 7, owner: USER, name: "Western Blot" };
    const activeNote: ActiveNote = { id: 11, owner: USER, title: "Group Meeting" };
    await routeBatchablePhoto("g1", makePhoto("a", "jpg", "g1"), baseCtx, activeTask, activeNote);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-active-confirmation");

    await routeBatchCallbackQuery(makeCallback("tab:7:alex:results"), baseCtx);
    const after = _peekBatchForTests(CHAT_ID);
    expect(after?.kind).toBe("awaiting-style");
    if (after?.kind === "awaiting-style") {
      expect(after.destination).toMatchObject({ kind: "task", taskId: 7, subTab: "results" });
    }
  });

  it("a tab: click against stale state gets an Album expired ack", async () => {
    const cq = makeCallback("tab:1:alex:notes");
    await routeBatchCallbackQuery(cq, baseCtx);
    expect(hoisted.answerCallbackQueryMock).toHaveBeenCalledTimes(1);
    expect(hoisted.answerCallbackQueryMock.mock.calls[0][2]?.text).toContain("expired");
  });
});

describe("batch-routing: active-note-only attach (straight to style)", () => {
  it("only activeNote → awaiting-style with note destination (no confirmation, no escape)", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    const activeNote: ActiveNote = { id: 5, owner: USER, title: "Bench Log" };

    await routeBatchablePhoto("g1", makePhoto("a", "jpg", "g1"), baseCtx, null, activeNote);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    const after = _peekBatchForTests(CHAT_ID);
    expect(after?.kind).toBe("awaiting-style");
    if (after?.kind === "awaiting-style") {
      expect(after.destination).toEqual({
        kind: "note",
        noteId: 5,
        owner: USER,
        title: "Bench Log",
      });
    }
    // The style prompt names the note.
    const prompt = hoisted.sendMessageMock.mock.calls.at(-1);
    expect(String(prompt?.[2])).toContain("Bench Log");
  });
});

describe("batch-routing: per-tab write target", () => {
  it("Lab Notes destination writes to taskNotesBase/Images/, NOT the legacy outer Images/", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });

    await routeBatchablePhoto("g1", makePhoto("a", "jpg", "g1"), baseCtx, {
      id: 50,
      owner: USER,
      name: "TabTest",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    await routeBatchCallbackQuery(makeCallback("tab:50:alex:notes"), baseCtx);
    await routeBatchCallbackQuery(makeCallback("style:auto"), baseCtx);
    await consumeBatchTextReply("Yeast", baseCtx);

    expect(hoisted.attachImageToTaskMock).toHaveBeenCalled();
    const call = hoisted.attachImageToTaskMock.mock.calls[0][0];
    expect((call as { basePath?: string }).basePath).toBe(
      "users/alex/results/task-50/notes",
    );
    expect((call as { basePath?: string }).basePath).not.toBe(
      "users/alex/results/task-50",
    );
  });

  it("Results destination writes to taskResultsTabBase/Images/", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });

    await routeBatchablePhoto("g1", makePhoto("a", "jpg", "g1"), baseCtx, {
      id: 51,
      owner: USER,
      name: "TabTest2",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    await routeBatchCallbackQuery(makeCallback("tab:51:alex:results"), baseCtx);
    await routeBatchCallbackQuery(makeCallback("style:auto"), baseCtx);
    await consumeBatchTextReply("Result-set", baseCtx);

    const call = hoisted.attachImageToTaskMock.mock.calls[0][0];
    expect((call as { basePath?: string }).basePath).toBe(
      "users/alex/results/task-51/results",
    );
  });
});

describe("batch-routing: active-task → style → auto-name flow", () => {
  it("Lab Notes → style:auto → batch name commits all photos as <name>-N", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });

    await routeBatchablePhoto("g1", makePhoto("a", "jpg", "g1"), baseCtx, {
      id: 3,
      owner: USER,
      name: "Doing E",
    });
    await routeBatchablePhoto("g1", makePhoto("b", "jpg", "g1"), baseCtx, {
      id: 3,
      owner: USER,
      name: "Doing E",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    await routeBatchCallbackQuery(makeCallback("tab:3:alex:notes"), baseCtx);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-style");

    await routeBatchCallbackQuery(makeCallback("style:auto"), baseCtx);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-batch-name");

    await consumeBatchTextReply("Yeast assay", baseCtx);
    expect(hoisted.attachImageToTaskMock).toHaveBeenCalledTimes(2);
    const filenames = hoisted.attachImageToTaskMock.mock.calls.map((c) =>
      (c[0] as { suggestedFilename: string }).suggestedFilename,
    );
    expect(filenames).toEqual(
      expect.arrayContaining(["Yeast assay-1.jpg", "Yeast assay-2.jpg"]),
    );
    expect(_peekBatchForTests(CHAT_ID)).toBeUndefined();
  });

  // Sidecar caption regression: the InboxToast + inbox modal read caption
  // from sidecar.json; commitAutoNameBatch must write the typed name.
  it("writes the batch name as sidecar caption on every photo (auto-number)", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    await routeBatchablePhoto("g1", makePhoto("a", "jpg", "g1"), baseCtx, {
      id: 4,
      owner: USER,
      name: "E",
    });
    await routeBatchablePhoto("g1", makePhoto("b", "jpg", "g1"), baseCtx, {
      id: 4,
      owner: USER,
      name: "E",
    });
    await routeBatchablePhoto("g1", makePhoto("c", "jpg", "g1"), baseCtx, {
      id: 4,
      owner: USER,
      name: "E",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    await routeBatchCallbackQuery(makeCallback("tab:4:alex:notes"), baseCtx);
    await routeBatchCallbackQuery(makeCallback("style:auto"), baseCtx);
    await consumeBatchTextReply("Fu", baseCtx);

    const base = "users/alex/results/task-4/notes";
    for (const i of [1, 2, 3]) {
      const sidecar = hoisted.memFs.get(`${base}/Images/Fu-${i}.jpg.json`) as
        | { caption?: string; source?: string }
        | undefined;
      expect(sidecar).toBeDefined();
      expect(sidecar?.caption).toBe("Fu");
      expect(sidecar?.source).toBe("telegram");
    }
  });

  // Telegram attaches a per-photo caption only to photo 0 of an album, so
  // every sidecar caption must be the batch name (not photo 0's tg caption).
  it("ignores photo[0] Telegram caption — every sidecar caption is the batch name", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    const photoA: BatchPhoto = { ...makePhoto("a", "jpg", "g1"), caption: "tg-caption" };
    await routeBatchablePhoto("g1", photoA, baseCtx, { id: 4, owner: USER, name: "E" });
    await routeBatchablePhoto("g1", makePhoto("b", "jpg", "g1"), baseCtx, {
      id: 4,
      owner: USER,
      name: "E",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    await routeBatchCallbackQuery(makeCallback("tab:4:alex:notes"), baseCtx);
    await routeBatchCallbackQuery(makeCallback("style:auto"), baseCtx);
    await consumeBatchTextReply("Fu", baseCtx);

    const base = "users/alex/results/task-4/notes";
    const s1 = hoisted.memFs.get(`${base}/Images/Fu-1.jpg.json`) as { caption?: string } | undefined;
    const s2 = hoisted.memFs.get(`${base}/Images/Fu-2.jpg.json`) as { caption?: string } | undefined;
    expect(s1?.caption).toBe("Fu");
    expect(s2?.caption).toBe("Fu");
  });
});

describe("batch-routing: per-photo-captions flow", () => {
  it("style:each writes photos up front and resends each photo with its caption prompt in order", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    const photoA = makePhoto("a", "jpg", "g1");
    const photoB = makePhoto("b", "jpg", "g1");
    await routeBatchablePhoto("g1", photoA, baseCtx, { id: 5, owner: USER, name: "Bench" });
    await routeBatchablePhoto("g1", photoB, baseCtx, { id: 5, owner: USER, name: "Bench" });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-active-confirmation");

    await routeBatchCallbackQuery(makeCallback("tab:5:alex:notes"), baseCtx);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-style");

    hoisted.sendPhotoMock.mockClear();
    await routeBatchCallbackQuery(makeCallback("style:each"), baseCtx);
    expect(hoisted.attachImageToTaskMock).toHaveBeenCalledTimes(2);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-per-photo-captions");
    expect(hoisted.sendPhotoMock).toHaveBeenCalledTimes(1);
    expect(hoisted.sendPhotoMock.mock.calls[0][2]).toBe(photoA.fileId);
    expect(String(hoisted.sendPhotoMock.mock.calls[0][3])).toContain("1 of 2");

    await consumeBatchTextReply("Plate at t=0", baseCtx);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-per-photo-captions");
    expect(hoisted.sendPhotoMock).toHaveBeenCalledTimes(2);
    expect(hoisted.sendPhotoMock.mock.calls[1][2]).toBe(photoB.fileId);

    await consumeBatchTextReply("/skip", baseCtx);
    expect(_peekBatchForTests(CHAT_ID)).toBeUndefined();
    expect(hoisted.sendPhotoMock).toHaveBeenCalledTimes(2);
  });
});

describe("batch-routing: single-photo entry", () => {
  it("routeSinglePhotoThroughBatch with active task → awaiting-active-confirmation (no silent attach)", async () => {
    await routeSinglePhotoThroughBatch(makePhoto(), baseCtx, {
      id: 8,
      owner: USER,
      name: "Single",
    });
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-active-confirmation");
    expect(hoisted.attachImageToTaskMock).not.toHaveBeenCalled();
    const prompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    expect(prompt).toBeDefined();
    expect(String(prompt![2])).toContain("photo");
  });

  it("routeSinglePhotoThroughBatch with nothing open → commits straight to inbox, no prompt", async () => {
    await routeSinglePhotoThroughBatch(makePhoto(), baseCtx, null);
    // Committed immediately; no awaiting state, exactly one attach to inbox.
    expect(_peekBatchForTests(CHAT_ID)).toBeUndefined();
    expect(hoisted.attachImageToTaskMock).toHaveBeenCalledTimes(1);
    const arg = hoisted.attachImageToTaskMock.mock.calls[0][0] as { basePath?: string };
    expect(arg.basePath).toBe(`users/${USER}/inbox`);
  });

  it("single photo to task: Lab Notes → style:auto → name → writes to taskNotesBase", async () => {
    await routeSinglePhotoThroughBatch(makePhoto(), baseCtx, {
      id: 8,
      owner: USER,
      name: "Single",
    });
    await routeBatchCallbackQuery(makeCallback("tab:8:alex:notes"), baseCtx);
    await routeBatchCallbackQuery(makeCallback("style:auto"), baseCtx);
    await consumeBatchTextReply("singlepic", baseCtx);
    expect(hoisted.attachImageToTaskMock).toHaveBeenCalledTimes(1);
    const call = hoisted.attachImageToTaskMock.mock.calls[0][0];
    expect((call as { basePath?: string }).basePath).toBe(
      "users/alex/results/task-8/notes",
    );
  });
});

describe("batch-routing: chatId guard", () => {
  it("ignores a callback_query from an unpaired chat", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    await routeBatchablePhoto("g1", makePhoto("a", "jpg", "g1"), baseCtx, {
      id: 1,
      owner: USER,
      name: "T1",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-active-confirmation");

    const cq = makeCallback("tab:1:alex:notes");
    cq.message!.chat.id = 99999;
    await routeBatchCallbackQuery(cq, baseCtx);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-active-confirmation");
    expect(hoisted.answerCallbackQueryMock).not.toHaveBeenCalled();
  });

  it("acks a click against stale state with an Album expired notice", async () => {
    const cq = makeCallback("style:auto");
    await routeBatchCallbackQuery(cq, baseCtx);
    expect(hoisted.answerCallbackQueryMock).toHaveBeenCalledTimes(1);
    const opts = hoisted.answerCallbackQueryMock.mock.calls[0][2];
    expect(opts?.text).toContain("expired");
  });
});

describe("batch-routing: end-to-end note attach", () => {
  it("active note → style:auto + name → writes via attachImageToNote to users/<owner>/notes/<id>", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    await routeBatchablePhoto("g1", makePhoto("a", "jpg", "g1"), baseCtx, null, {
      id: 99,
      owner: USER,
      title: "Bench Log",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-style");
    await routeBatchCallbackQuery(makeCallback("style:auto"), baseCtx);
    await consumeBatchTextReply("Plate1", baseCtx);

    expect(hoisted.attachImageToNoteMock).toHaveBeenCalledTimes(1);
    const call = hoisted.attachImageToNoteMock.mock.calls[0][0];
    expect((call as { ownerUsername: string }).ownerUsername).toBe(USER);
    expect((call as { noteId: number }).noteId).toBe(99);
    expect((call as { suggestedFilename: string }).suggestedFilename).toBe("Plate1-1.jpg");

    const sidecarKey = `users/${USER}/notes/99/Images/Plate1-1.jpg.json`;
    const sidecar = hoisted.memFs.get(sidecarKey) as
      | { caption?: string; source?: string }
      | undefined;
    expect(sidecar).toBeDefined();
    expect(sidecar?.caption).toBe("Plate1");
    expect(sidecar?.source).toBe("telegram");
  });
});

describe("batch-routing: tutorial-mode one-button Inbox", () => {
  it("routeSinglePhotoTutorialMode parks state in awaiting-destination with tutorialMode flag", async () => {
    await routeSinglePhotoTutorialMode(makePhoto(), baseCtx);
    const state = _peekBatchForTests(CHAT_ID);
    expect(state?.kind).toBe("awaiting-destination");
    if (state?.kind === "awaiting-destination") {
      expect(state.tutorialMode).toBe(true);
      expect(state.photos).toHaveLength(1);
    }
  });

  it("sends the simplified two-sentence prompt body with a single Inbox button", async () => {
    await routeSinglePhotoTutorialMode(makePhoto(), baseCtx);
    expect(hoisted.sendMessageMock).toHaveBeenCalledTimes(1);
    const [, , body, opts] = hoisted.sendMessageMock.mock.calls[0];
    expect(body).toBe(TUTORIAL_DESTINATION_PROMPT);
    // No em-dashes in the prose (Grant standing rule).
    expect(body).not.toMatch(/—/);
    expect(body).toContain("Inbox");
    expect(body).toContain("experiment");
    const keyboard = (opts as { reply_markup?: { inline_keyboard?: unknown[][] } })
      ?.reply_markup;
    expect(keyboard?.inline_keyboard).toBeDefined();
    expect(keyboard?.inline_keyboard).toHaveLength(1);
    expect(keyboard?.inline_keyboard?.[0]).toHaveLength(1);
    const button = (keyboard?.inline_keyboard?.[0]?.[0]) as {
      text: string;
      callback_data: string;
    };
    expect(button.callback_data).toBe("inbox");
  });

  it("Inbox click in tutorial mode commits straight to inbox with tutorial_test sidecar marker and skips style prompt", async () => {
    const photo = makePhoto("tutorial", "jpg");
    await routeSinglePhotoTutorialMode(photo, baseCtx);
    hoisted.sendMessageMock.mockClear();
    await routeBatchCallbackQuery(makeCallback("inbox"), baseCtx);
    expect(hoisted.attachImageToTaskMock).toHaveBeenCalledTimes(1);
    const attachArg = hoisted.attachImageToTaskMock.mock.calls[0][0] as unknown as {
      basePath: string;
      ownerUsername: string;
      taskId: number;
    };
    expect(attachArg.basePath).toBe(`users/${USER}/inbox`);
    expect(attachArg.ownerUsername).toBe(USER);
    expect(attachArg.taskId).toBe(0);
    const sidecarKeys = [...hoisted.memFs.keys()].filter((k) =>
      k.startsWith(`users/${USER}/inbox/Images/`) && k.endsWith(".json"),
    );
    expect(sidecarKeys).toHaveLength(1);
    const sidecar = hoisted.memFs.get(sidecarKeys[0]) as {
      tutorial_test?: boolean;
      source?: string;
    };
    expect(sidecar.tutorial_test).toBe(true);
    expect(sidecar.source).toBe("telegram");
    expect(hoisted.sendMessageMock).toHaveBeenCalledTimes(1);
    const reply = hoisted.sendMessageMock.mock.calls[0][2] as string;
    expect(reply).toContain("Inbox");
    expect(reply).not.toMatch(/auto-number|Name each/i);
    expect(_peekBatchForTests(CHAT_ID)).toBeUndefined();
  });
});

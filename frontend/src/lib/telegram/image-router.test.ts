// frontend/src/lib/telegram/image-router.test.ts
//
// Unit tests for the message-router slice of image-router.ts.
// Focused on the C-direction additions:
//
//   1. /tutorial text command broadcasts trigger-tutorial-modal on the
//      cross-tab channel AND replies with the tutorial-aware copy.
//   2. /start and /help commands send the dual-mode replies (regression
//      coverage for the Direction A copy rewrite).
//   3. Photo-arrival reply uses tutorial copy when the per-user
//      _telegram_tutorial.json sidecar has tutorial_active: true and
//      active_step: "first-photo".
//   4. Photo arrival broadcasts a photo-arrived signal on the cross-tab
//      channel so the demo tab's sequencer can advance.
//
// The full photo-routing path (download + attach + sidecar write) is
// stubbed out at the boundary modules so we don't have to wire up the
// entire attachment / file-system chain. The router's branching logic
// is what's worth testing here.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mock state. `vi.hoisted` runs before the `vi.mock` factories so
// the factories can close over these references without tripping
// vitest's "top-level variable inside vi.mock" guard.
const hoisted = vi.hoisted(() => {
  const memFs = new Map<string, unknown>();
  return {
    memFs,
    // Typed signatures so `mock.calls[i]` keeps proper tuple shape and
    // we can read `mock.calls[0][2]` without TS complaining the tuple
    // is empty.
    sendMessageMock: vi.fn(
      async (
        _token: string,
        _chatId: number,
        _text: string,
        _opts?: { reply_to_message_id?: number },
      ) => ({}),
    ),
    downloadFileMock: vi.fn(
      async (_token: string, _filePath: string) =>
        new Blob([new Uint8Array([1, 2, 3])]),
    ),
    getFileMock: vi.fn(async (_token: string, _fileId: string) => ({
      file_id: "f1",
      file_unique_id: "u1",
      file_path: "photos/file.jpg",
    })),
    attachImageToTaskMock: vi.fn(async (_opts: unknown) => ({
      finalFilename: "photo-final.jpg",
      finalPath: "users/alex/inbox/Images/photo-final.jpg",
      altText: "",
      markdownSnippet: "",
    })),
    activeTaskRef: { current: null as
      | { id: number; owner: string; name: string }
      | null },
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
    downloadFile: hoisted.downloadFileMock,
    getFile: hoisted.getFileMock,
    largestPhoto: actual.largestPhoto,
  };
});

vi.mock("@/lib/attachments/attach-image", () => ({
  attachImageToTask: hoisted.attachImageToTaskMock,
}));

vi.mock("@/lib/tasks/results-paths", () => ({
  resolveTaskResultsBase: vi.fn(async () => "users/alex/results/task-1"),
}));

vi.mock("@/lib/attachments/image-folder", () => ({
  sidecarPath: (basePath: string, filename: string) =>
    `${basePath}/Images/${filename}.json`,
}));

vi.mock("@/lib/attachments/image-events", () => ({
  imageEvents: {
    emitMetadataChanged: vi.fn(),
    emitAttached: vi.fn(),
  },
}));

vi.mock("@/lib/store", () => ({
  useAppStore: {
    getState: () => ({ activeTask: hoisted.activeTaskRef.current }),
  },
}));

// Spy on batch-routing so the tutorial-mode pass-through test can confirm
// `routeBatchablePhoto` is NOT invoked even when the photo has a
// media_group_id. `routeSinglePhotoThroughBatch` is the non-album entry
// for the redesigned ASK-always flow. `routeSinglePhotoTutorialMode` is
// the tutorial-mode entry that drives the simplified Inbox-only picker.
const batchSpy = vi.hoisted(() => ({
  routeBatchablePhotoMock: vi.fn(async (..._args: unknown[]) => {}),
  routeSinglePhotoThroughBatchMock: vi.fn(async (..._args: unknown[]) => {}),
  routeSinglePhotoTutorialModeMock: vi.fn(async (..._args: unknown[]) => {}),
  consumeBatchTextReplyMock: vi.fn(async () => false),
}));
vi.mock("./batch-routing", () => ({
  routeBatchablePhoto: batchSpy.routeBatchablePhotoMock,
  routeSinglePhotoThroughBatch: batchSpy.routeSinglePhotoThroughBatchMock,
  routeSinglePhotoTutorialMode: batchSpy.routeSinglePhotoTutorialModeMock,
  consumeBatchTextReply: batchSpy.consumeBatchTextReplyMock,
}));

import {
  routeTelegramMessage,
  START_REPLY,
  HELP_REPLY,
  TUTORIAL_REPLY,
  _resetTutorialCacheForTests,
} from "./image-router";
import { startTelegramTutorialStep } from "./tutorial-store";
import type { TelegramMessage } from "./telegram-client";

const CHAT_ID = 12345;
const USER = "alex";

const baseCtx = {
  username: USER,
  botToken: "test-token",
  chatId: CHAT_ID,
};

function textMessage(text: string): TelegramMessage {
  return {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: { id: CHAT_ID, type: "private" },
    text,
  };
}

function photoMessage(): TelegramMessage {
  return {
    message_id: 2,
    date: Math.floor(Date.now() / 1000),
    chat: { id: CHAT_ID, type: "private" },
    photo: [
      {
        file_id: "f1",
        file_unique_id: "u1",
        width: 100,
        height: 100,
        file_size: 1000,
      },
    ],
  };
}

beforeEach(() => {
  hoisted.memFs.clear();
  hoisted.sendMessageMock.mockClear();
  hoisted.downloadFileMock.mockClear();
  hoisted.getFileMock.mockClear();
  hoisted.attachImageToTaskMock.mockClear();
  batchSpy.routeBatchablePhotoMock.mockClear();
  batchSpy.routeSinglePhotoThroughBatchMock.mockClear();
  batchSpy.routeSinglePhotoTutorialModeMock.mockClear();
  batchSpy.consumeBatchTextReplyMock.mockClear();
  batchSpy.consumeBatchTextReplyMock.mockImplementation(async () => false);
  hoisted.activeTaskRef.current = null;
  _resetTutorialCacheForTests();
});

describe("image-router text commands", () => {
  it("/start replies with the dual-mode start copy", async () => {
    await routeTelegramMessage(textMessage("/start"), baseCtx);
    expect(hoisted.sendMessageMock).toHaveBeenCalledTimes(1);
    expect(hoisted.sendMessageMock.mock.calls[0][2]).toBe(START_REPLY);
  });

  it("/help replies with the dual-mode help copy", async () => {
    await routeTelegramMessage(textMessage("/help"), baseCtx);
    expect(hoisted.sendMessageMock).toHaveBeenCalledTimes(1);
    expect(hoisted.sendMessageMock.mock.calls[0][2]).toBe(HELP_REPLY);
  });

  it("/tutorial replies with tutorial-aware copy", async () => {
    // V3 cross-tab broadcast was removed with the V3 rip (Phase B
    // 2026-05-22); reply text is the surviving observable.
    await routeTelegramMessage(textMessage("/tutorial"), baseCtx);
    expect(hoisted.sendMessageMock).toHaveBeenCalledTimes(1);
    expect(hoisted.sendMessageMock.mock.calls[0][2]).toBe(TUTORIAL_REPLY);
  });

  it("unrecognized slash command stays quiet", async () => {
    await routeTelegramMessage(textMessage("/wat"), baseCtx);
    expect(hoisted.sendMessageMock).not.toHaveBeenCalled();
  });
});

describe("image-router photo handling, tutorial-mode simplified picker", () => {
  it("routes to routeSinglePhotoTutorialMode when the sidecar has first-photo active", async () => {
    await startTelegramTutorialStep(USER, "first-photo");
    // The router caches tutorial state for 1s; the freshly-written
    // sidecar is the first read so the cache picks it up.
    await routeTelegramMessage(photoMessage(), baseCtx);
    // Tutorial-mode entry is invoked exactly once.
    expect(batchSpy.routeSinglePhotoTutorialModeMock).toHaveBeenCalledTimes(1);
    // Non-tutorial entries are NOT invoked (the tutorial branch
    // short-circuits before the ASK-always single-photo path).
    expect(batchSpy.routeSinglePhotoThroughBatchMock).not.toHaveBeenCalled();
    expect(batchSpy.routeBatchablePhotoMock).not.toHaveBeenCalled();
    // image-router itself doesn't write the sidecar or reply for the
    // tutorial branch anymore — routeSinglePhotoTutorialMode owns both
    // (and routeSinglePhotoTutorialMode is mocked here, so memFs stays
    // empty + sendMessage is never called from the router).
    expect(hoisted.attachImageToTaskMock).not.toHaveBeenCalled();
    expect(hoisted.sendMessageMock).not.toHaveBeenCalled();
  });

  it("ignores the active task when tutorial is active (Inbox-only flow)", async () => {
    // Grant's UX call: even with an experiment popup open in the demo
    // tab, the walkthrough's first send should land in Inbox so the
    // user learns the simple flow first. routeSinglePhotoTutorialMode
    // takes no active-task arg — the router doesn't forward it.
    hoisted.activeTaskRef.current = {
      id: 7,
      owner: "alex",
      name: "Yeast transformation",
    };
    await startTelegramTutorialStep(USER, "first-photo");
    await routeTelegramMessage(photoMessage(), baseCtx);
    expect(batchSpy.routeSinglePhotoTutorialModeMock).toHaveBeenCalledTimes(1);
    const args = batchSpy.routeSinglePhotoTutorialModeMock.mock.calls[0];
    // Signature is (photo, ctx) — no third active-task arg.
    expect(args.length).toBe(2);
  });

  it("does NOT route to tutorial entry when tutorial is inactive", async () => {
    // Tutorial sidecar not started → tutorial.tutorial_active is false →
    // image-router delegates to routeSinglePhotoThroughBatch instead.
    await routeTelegramMessage(photoMessage(), baseCtx);
    expect(batchSpy.routeSinglePhotoTutorialModeMock).not.toHaveBeenCalled();
    expect(batchSpy.routeSinglePhotoThroughBatchMock).toHaveBeenCalledTimes(1);
  });

});

describe("image-router photo handling, non-tutorial → batch state machine", () => {
  it("non-tutorial single photo with NO active task routes through the batch state machine (no silent attach)", async () => {
    await routeTelegramMessage(photoMessage(), baseCtx);
    // Single-photo path delegates to routeSinglePhotoThroughBatch.
    expect(batchSpy.routeSinglePhotoThroughBatchMock).toHaveBeenCalledTimes(1);
    // No direct attach + reply from the router (ASK-always flow handles
    // both inside the batch state machine).
    expect(hoisted.attachImageToTaskMock).not.toHaveBeenCalled();
    expect(hoisted.sendMessageMock).not.toHaveBeenCalled();
  });

  it("non-tutorial single photo with active task open routes through the batch state machine (no silent attach)", async () => {
    hoisted.activeTaskRef.current = {
      id: 7,
      owner: "alex",
      name: "Yeast transformation",
    };
    await routeTelegramMessage(photoMessage(), baseCtx);
    expect(batchSpy.routeSinglePhotoThroughBatchMock).toHaveBeenCalledTimes(1);
    const args = batchSpy.routeSinglePhotoThroughBatchMock.mock.calls[0];
    // The active task is forwarded so the batch state machine can show
    // the active-task confirmation keyboard.
    expect(args[2]).toEqual({
      id: 7,
      owner: "alex",
      name: "Yeast transformation",
    });
    expect(hoisted.attachImageToTaskMock).not.toHaveBeenCalled();
    expect(hoisted.sendMessageMock).not.toHaveBeenCalled();
  });
});

describe("image-router photo handling, media_group_id branch", () => {
  function albumPhotoMessage(): TelegramMessage {
    return {
      message_id: 5,
      date: Math.floor(Date.now() / 1000),
      chat: { id: CHAT_ID, type: "private" },
      photo: [
        {
          file_id: "f-album",
          file_unique_id: "u-album",
          width: 100,
          height: 100,
          file_size: 1000,
        },
      ],
      media_group_id: "album-1",
    };
  }

  it("routes a media_group_id photo to batch-routing when tutorial is inactive", async () => {
    await routeTelegramMessage(albumPhotoMessage(), baseCtx);
    expect(batchSpy.routeBatchablePhotoMock).toHaveBeenCalledTimes(1);
    const args = batchSpy.routeBatchablePhotoMock.mock.calls[0];
    expect(args[0]).toBe("album-1");
    // The single-photo flow's attach + reply should NOT have run for an
    // album photo (batch-routing handles it).
    expect(hoisted.attachImageToTaskMock).not.toHaveBeenCalled();
    expect(hoisted.sendMessageMock).not.toHaveBeenCalled();
  });

  it("falls through to the tutorial-mode entry when tutorial is active, even with media_group_id", async () => {
    // Tutorial active → album batching is bypassed so the simplified
    // Inbox-only picker still drives the user's first send. Each photo
    // arrival routes through the tutorial entry. (The legacy silent-
    // auto-attach behavior was replaced 2026-05-27 with the explicit
    // one-button picker — Grant's UX call.)
    await startTelegramTutorialStep(USER, "first-photo");
    await routeTelegramMessage(albumPhotoMessage(), baseCtx);
    // Album batch routing skipped.
    expect(batchSpy.routeBatchablePhotoMock).not.toHaveBeenCalled();
    // Tutorial-mode entry ran.
    expect(batchSpy.routeSinglePhotoTutorialModeMock).toHaveBeenCalledTimes(1);
    // image-router itself no longer writes the sidecar or replies in
    // the tutorial branch.
    expect(hoisted.attachImageToTaskMock).not.toHaveBeenCalled();
    expect(hoisted.sendMessageMock).not.toHaveBeenCalled();
  });
});

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
    broadcastMock: vi.fn((_signal: unknown) => {}),
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

vi.mock("./tutorial-signal", () => ({
  broadcastTutorialSignal: (signal: unknown) => hoisted.broadcastMock(signal),
}));

// Spy on batch-routing so the tutorial-mode pass-through test can confirm
// `routeBatchablePhoto` is NOT invoked even when the photo has a
// media_group_id. `routeSinglePhotoThroughBatch` is the non-album entry
// for the redesigned ASK-always flow.
const batchSpy = vi.hoisted(() => ({
  routeBatchablePhotoMock: vi.fn(async (..._args: unknown[]) => {}),
  routeSinglePhotoThroughBatchMock: vi.fn(async (..._args: unknown[]) => {}),
  consumeBatchTextReplyMock: vi.fn(async () => false),
}));
vi.mock("./batch-routing", () => ({
  routeBatchablePhoto: batchSpy.routeBatchablePhotoMock,
  routeSinglePhotoThroughBatch: batchSpy.routeSinglePhotoThroughBatchMock,
  consumeBatchTextReply: batchSpy.consumeBatchTextReplyMock,
}));

import {
  routeTelegramMessage,
  START_REPLY,
  HELP_REPLY,
  TUTORIAL_REPLY,
  TEXT_WITHOUT_PHOTO_REPLY,
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
  hoisted.broadcastMock.mockClear();
  batchSpy.routeBatchablePhotoMock.mockClear();
  batchSpy.routeSinglePhotoThroughBatchMock.mockClear();
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
    // /start does not broadcast.
    expect(hoisted.broadcastMock).not.toHaveBeenCalled();
  });

  it("/help replies with the dual-mode help copy", async () => {
    await routeTelegramMessage(textMessage("/help"), baseCtx);
    expect(hoisted.sendMessageMock).toHaveBeenCalledTimes(1);
    expect(hoisted.sendMessageMock.mock.calls[0][2]).toBe(HELP_REPLY);
  });

  it("/tutorial broadcasts trigger-tutorial-modal AND replies with tutorial-aware copy", async () => {
    await routeTelegramMessage(textMessage("/tutorial"), baseCtx);
    // Reply text matches the canonical TUTORIAL_REPLY.
    expect(hoisted.sendMessageMock).toHaveBeenCalledTimes(1);
    expect(hoisted.sendMessageMock.mock.calls[0][2]).toBe(TUTORIAL_REPLY);
    // Cross-tab signal fires.
    expect(hoisted.broadcastMock).toHaveBeenCalledWith({
      type: "trigger-tutorial-modal",
    });
  });

  it("unsolicited text → fallback `send me a photo first` prompt (UX polish 2026-05-19)", async () => {
    await routeTelegramMessage(textMessage("hello?"), baseCtx);
    expect(hoisted.sendMessageMock).toHaveBeenCalledTimes(1);
    expect(hoisted.sendMessageMock.mock.calls[0][2]).toBe(TEXT_WITHOUT_PHOTO_REPLY);
    expect(hoisted.broadcastMock).not.toHaveBeenCalled();
  });

  it("unrecognized slash command also gets the fallback prompt", async () => {
    // `/wat` isn't a known command and isn't a caption reply, so it
    // falls into the unsolicited-text branch.
    await routeTelegramMessage(textMessage("/wat"), baseCtx);
    expect(hoisted.sendMessageMock).toHaveBeenCalledTimes(1);
    expect(hoisted.sendMessageMock.mock.calls[0][2]).toBe(TEXT_WITHOUT_PHOTO_REPLY);
  });

  it("pending caption is preserved — text writes through and does NOT fire the fallback", async () => {
    // Seed a pending caption via the tutorial pass-through (only place
    // image-router populates pendingCaptions today). First arrival:
    // photo with no caption → router stamps a sidecar + sets pending.
    await startTelegramTutorialStep(USER, "first-photo");
    await routeTelegramMessage(photoMessage(), baseCtx);
    hoisted.sendMessageMock.mockClear();
    // Now text arrives: should be written as the caption, NOT the
    // fallback prompt.
    await routeTelegramMessage(textMessage("Plate t=0"), baseCtx);
    expect(hoisted.sendMessageMock).toHaveBeenCalledTimes(1);
    const replyText = hoisted.sendMessageMock.mock.calls[0][2] as string;
    expect(replyText).toBe("Captioned. 👌");
    expect(replyText).not.toBe(TEXT_WITHOUT_PHOTO_REPLY);
    // Sidecar caption persisted.
    const sidecar = hoisted.memFs.get(
      "users/alex/inbox/Images/photo-final.jpg.json",
    ) as { caption?: string } | undefined;
    expect(sidecar?.caption).toBe("Plate t=0");
  });
});

describe("image-router photo handling, tutorial-aware reply", () => {
  it("uses the tutorial reply when the sidecar has first-photo active", async () => {
    await startTelegramTutorialStep(USER, "first-photo");
    // The router caches tutorial state for 1s; the freshly-written
    // sidecar is the first read so the cache picks it up.
    await routeTelegramMessage(photoMessage(), baseCtx);
    expect(hoisted.sendMessageMock).toHaveBeenCalled();
    const replyText = hoisted.sendMessageMock.mock.calls[0][2] as string;
    // Inbox path because activeTask is null. Tutorial-aware copy
    // begins with "Got it!" and mentions the user's real folder.
    expect(replyText).toMatch(/^Got it!/);
    expect(replyText).toContain("real folder");
  });

  it("tutorial photo-arrived broadcast still fires (silent-attach path)", async () => {
    await startTelegramTutorialStep(USER, "first-photo");
    await routeTelegramMessage(photoMessage(), baseCtx);
    expect(hoisted.broadcastMock).toHaveBeenCalledWith({
      type: "photo-arrived",
      taskId: null,
      fromInbox: true,
    });
  });

  it("stamps tutorial_test:true in the sidecar when the photo arrives in tutorial mode", async () => {
    await startTelegramTutorialStep(USER, "first-photo");
    await routeTelegramMessage(photoMessage(), baseCtx);
    // attachImageToTaskMock returns finalFilename "photo-final.jpg"; the
    // inbox base is users/alex/inbox (no active task in this test).
    const written = hoisted.memFs.get(
      "users/alex/inbox/Images/photo-final.jpg.json",
    ) as { tutorial_test?: boolean; source?: string } | undefined;
    expect(written).toBeDefined();
    expect(written?.tutorial_test).toBe(true);
    expect(written?.source).toBe("telegram");
  });

  it("does NOT stamp tutorial_test when tutorial is inactive (non-tutorial path delegates to batch)", async () => {
    // Tutorial sidecar not started → tutorial.tutorial_active is false →
    // image-router returns early at routeSinglePhotoThroughBatch before
    // the tutorial-mode writeSidecar block. No sidecar is written by the
    // router at all in this branch (batch-routing owns that write).
    await routeTelegramMessage(photoMessage(), baseCtx);
    expect(hoisted.memFs.get("users/alex/inbox/Images/photo-final.jpg.json")).toBeUndefined();
  });

  it("tutorial photo-arrived carries task id when active task is open", async () => {
    await startTelegramTutorialStep(USER, "first-photo");
    hoisted.activeTaskRef.current = {
      id: 7,
      owner: "alex",
      name: "Yeast transformation",
    };
    await routeTelegramMessage(photoMessage(), baseCtx);
    expect(hoisted.broadcastMock).toHaveBeenCalledWith({
      type: "photo-arrived",
      taskId: 7,
      fromInbox: false,
    });
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

  it("falls through to the per-photo flow when tutorial is active, even with media_group_id", async () => {
    // Tutorial active → batch flow short-circuits so the demo
    // sequencer's first-photo broadcast still fires per photo.
    await startTelegramTutorialStep(USER, "first-photo");
    await routeTelegramMessage(albumPhotoMessage(), baseCtx);
    // Batch routing skipped.
    expect(batchSpy.routeBatchablePhotoMock).not.toHaveBeenCalled();
    // Single-photo path ran: attach + tutorial-aware reply + broadcast.
    expect(hoisted.attachImageToTaskMock).toHaveBeenCalledTimes(1);
    expect(hoisted.sendMessageMock).toHaveBeenCalledTimes(1);
    expect(hoisted.broadcastMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "photo-arrived" }),
    );
  });
});

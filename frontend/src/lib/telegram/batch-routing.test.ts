// frontend/src/lib/telegram/batch-routing.test.ts
//
// State-machine coverage for the redesigned batch + single-photo
// routing. The Telegram Bot API boundary is stubbed (sendMessage,
// answerCallbackQuery, attachImage) so we can drive the machine through
// every transition without spinning a real bot.
//
// Redesign locks tested here:
//   1. ASK ALWAYS — even with an active task open, the bot prompts
//      first; no silent auto-attach.
//   2. Combined picker shape — active confirmation, then full task
//      picker, then sub-tab picker, then caption style.
//   3. "Pick another" filter — Doing-now + experiments-without-results
//      + Inbox; hides experiments that already have results written.
//   4. Lettered body-list + short-letter buttons — iOS Telegram clips
//      button text past ~12 chars even when single-line (the
//      `143ca77f` rich-label predecessor still showed two ellipses on
//      Grant's iPhone). The fix: the message body lists each option
//      with A/B/C lettering plus full task name + project + dates;
//      the inline keyboard carries only the letter selector. Body
//      text wraps naturally; never truncated.
//   5. Lab Notes vs Results write target — per-tab `Images/` subdir,
//      NOT the legacy outer base.

import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const memFs = new Map<string, unknown>();
  // memBlobs tracks string contents for paths read via readFileAsBlob
  // (results.md content checks).
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
  // Pass-through: per-tab helpers anchor at taskResultsBase, the legacy
  // migration helper resolves to the per-user path. We return canonical
  // paths so the write-target assertions can compare strings directly.
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

vi.mock("@/lib/storage/json-store", () => ({
  // Default loader returns []; individual tests swap via setExperimentsLoader
  // / setProjectsLoader.
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
  _resetProjectsLoaderForTests,
  _setExperimentsLoaderForTests,
  _setProjectsLoaderForTests,
  BATCH_MAX_PHOTOS,
  BATCH_WINDOW_MS,
  buildBodyOptionLine,
  consumeBatchTextReply,
  INBOX_LABEL,
  partitionPickerExperiments,
  PICKER_LETTERS,
  routeBatchablePhoto,
  routeBatchCallbackQuery,
  routeSinglePhotoThroughBatch,
  type BatchPhoto,
  type BatchRouteContext,
} from "./batch-routing";
import type { Task, Project } from "@/lib/types";
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
    fileId: `file-${stem}-${Math.random().toString(36).slice(2, 8)}`,
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

function makeProject(overrides: Partial<Project>): Project {
  return {
    id: 1,
    name: "Default Project",
    weekend_active: true,
    tags: null,
    color: null,
    created_at: "2026-01-01",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: USER,
    shared_with: [],
    ...overrides,
  } as Project;
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
  _resetExperimentsLoaderForTests();
  _resetProjectsLoaderForTests();
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
    await vi.advanceTimersByTimeAsync(0);
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
    // ASK-always reframe: with an active task, we now park in
    // awaiting-active-confirmation (not awaiting-style), and the active
    // task held there is the FIRST-photo snapshot.
    expect(after?.kind).toBe("awaiting-active-confirmation");
    if (after?.kind === "awaiting-active-confirmation") {
      expect(after.activeTask).toEqual({ id: 1, owner: USER, name: "T1" });
    }
  });

  it("new batch arriving mid-flow cancels pending and sends a restart notice", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, {
      id: 1,
      owner: USER,
      name: "T1",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-active-confirmation");
    hoisted.sendMessageMock.mockClear();
    await routeBatchablePhoto("g2", makePhoto(), baseCtx, null);
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

describe("batch-routing: active-task confirmation (Lock 1 + 2)", () => {
  it("active task open → confirmation keyboard → Lab Notes → awaiting-style with subTab=notes", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 7, name: "Bench" }),
    ]);
    _setProjectsLoaderForTests(async () => [makeProject({ id: 1, name: "ProjA" })]);

    await routeBatchablePhoto("g1", makePhoto("a"), baseCtx, {
      id: 7,
      owner: USER,
      name: "Bench",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-active-confirmation");

    // Confirmation keyboard: Lab Notes / Results / Pick another rows.
    const prompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    expect(prompt).toBeDefined();
    const markup = (prompt![3] as { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } })
      ?.reply_markup;
    const buttons = markup!.inline_keyboard.flat();
    const notesButton = buttons.find((b) => b.callback_data === "tab:7:alex:notes");
    const resultsButton = buttons.find((b) => b.callback_data === "tab:7:alex:results");
    const pickOther = buttons.find((b) => b.callback_data === "pick-other");
    expect(notesButton).toBeDefined();
    expect(resultsButton).toBeDefined();
    expect(pickOther).toBeDefined();

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

  it("Pick another → awaiting-destination → tab (Lab Notes inline) → awaiting-style", async () => {
    // Redesigned picker (telegram note-attach, 2026-05-26): each
    // experiment now exposes its Lab Notes + Results choices as TWO
    // letter buttons in the picker (callback `tab:<id>:<owner>:<subTab>`),
    // collapsing the prior separate sub-tab keyboard. The `task:` payload
    // is still recognized for backward-compat but the new picker doesn't
    // emit it.
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 7, name: "Bench" }),
      makeExperiment({ id: 9, name: "OtherExp" }),
    ]);
    _setProjectsLoaderForTests(async () => [makeProject({ id: 1, name: "ProjA" })]);

    await routeBatchablePhoto("g1", makePhoto(), baseCtx, {
      id: 7,
      owner: USER,
      name: "Bench",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-active-confirmation");

    // Click "Pick another".
    hoisted.sendMessageMock.mockClear();
    await routeBatchCallbackQuery(makeCallback("pick-other"), baseCtx);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-destination");
    // Picker keyboard sent.
    const pickerPrompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    expect(pickerPrompt).toBeDefined();
    const pickerMarkup = (pickerPrompt![3] as { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } })
      ?.reply_markup;
    // Each experiment exposes Lab Notes + Results inline.
    const labNotesBtn = pickerMarkup!.inline_keyboard.flat().find((b) =>
      b.callback_data === "tab:9:alex:notes",
    );
    const resultsBtn = pickerMarkup!.inline_keyboard.flat().find((b) =>
      b.callback_data === "tab:9:alex:results",
    );
    expect(labNotesBtn).toBeDefined();
    expect(resultsBtn).toBeDefined();

    // Click the Lab Notes letter → commit directly to awaiting-style.
    hoisted.sendMessageMock.mockClear();
    await routeBatchCallbackQuery(makeCallback(labNotesBtn!.callback_data), baseCtx);
    const final = _peekBatchForTests(CHAT_ID);
    expect(final?.kind).toBe("awaiting-style");
    if (final?.kind === "awaiting-style") {
      expect(final.destination).toEqual({
        kind: "task",
        taskId: 9,
        owner: USER,
        name: "OtherExp",
        subTab: "notes",
      });
    }
  });
});

describe("batch-routing: no-active-task → full picker (inline sub-tab) → style", () => {
  it("walks the full picker with inline Results button into awaiting-style", async () => {
    // Redesigned picker (telegram note-attach, 2026-05-26): each
    // experiment exposes Lab Notes + Results as separate buttons in the
    // picker, so the destination is committed in one tap (no separate
    // sub-tab keyboard).
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 3, name: "Doing E" }),
    ]);
    _setProjectsLoaderForTests(async () => [makeProject({ id: 1, name: "ProjA" })]);

    await routeBatchablePhoto("g1", makePhoto("a"), baseCtx, null);
    await routeBatchablePhoto("g1", makePhoto("b"), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-destination");
    const destPrompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    expect(destPrompt).toBeDefined();
    const destMarkup = (destPrompt![3] as { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } })
      ?.reply_markup;
    const inboxButton = destMarkup!.inline_keyboard
      .flat()
      .find((b) => b.callback_data === "inbox");
    expect(inboxButton).toBeDefined();
    const resultsButton = destMarkup!.inline_keyboard
      .flat()
      .find((b) => b.callback_data === "tab:3:alex:results");
    expect(resultsButton).toBeDefined();

    // User clicks the Results button → commit directly to awaiting-style.
    await routeBatchCallbackQuery(makeCallback(resultsButton!.callback_data), baseCtx);
    const after = _peekBatchForTests(CHAT_ID);
    expect(after?.kind).toBe("awaiting-style");
    if (after?.kind === "awaiting-style") {
      expect(after.destination).toEqual({
        kind: "task",
        taskId: 3,
        owner: USER,
        name: "Doing E",
        subTab: "results",
      });
    }
  });

  it("Inbox click skips the sub-tab keyboard", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-destination");

    await routeBatchCallbackQuery(makeCallback("inbox"), baseCtx);
    const after = _peekBatchForTests(CHAT_ID);
    expect(after?.kind).toBe("awaiting-style");
    if (after?.kind === "awaiting-style") {
      expect(after.destination).toEqual({ kind: "inbox" });
    }
  });
});

describe("batch-routing: experiments-without-results filter", () => {
  it("hides tasks whose results.md has user content; surfaces tasks with empty/stamp-only results", async () => {
    // Three tasks all outside the doing window (start_date in the past
    // AND end_date in the past) so they go to the "withoutResults"
    // section, where the filter is applied.
    const past = "2026-01-01";
    const taskEmpty = makeExperiment({
      id: 11,
      name: "Empty",
      start_date: past,
      end_date: past,
    });
    const taskStampOnly = makeExperiment({
      id: 12,
      name: "StampOnly",
      start_date: past,
      end_date: past,
    });
    const taskWithContent = makeExperiment({
      id: 13,
      name: "Written",
      start_date: past,
      end_date: past,
    });

    // taskEmpty: no results.md on disk at all.
    // taskStampOnly: results.md exists with only stamp + header.
    hoisted.memBlobs.set(
      `users/${USER}/results/task-12/results.md`,
      "<!-- stamp:start -->\n2026-01-01  \n12:00 PM  \nexperiment: StampOnly  \nproject folder: ProjA  \n<!-- stamp:end -->\n___\n# Results: StampOnly\n",
    );
    // taskWithContent: real body beyond the header.
    hoisted.memBlobs.set(
      `users/${USER}/results/task-13/results.md`,
      "<!-- stamp:start -->\n2026-01-01  \n12:00 PM  \nexperiment: Written  \nproject folder: ProjA  \n<!-- stamp:end -->\n___\n# Results: Written\n\nThe western blot showed a clean band at 50kDa.\n",
    );

    const { doing, withoutResults } = await partitionPickerExperiments([
      taskEmpty,
      taskStampOnly,
      taskWithContent,
    ]);
    expect(doing).toHaveLength(0);
    const ids = withoutResults.map((t) => t.id).sort();
    expect(ids).toEqual([11, 12]);
    expect(withoutResults.find((t) => t.id === 13)).toBeUndefined();
  });
});

describe("batch-routing: lettered body-list + short-letter buttons", () => {
  // iOS Telegram clips inline-button text past ~12 chars even when
  // single-line. The `143ca77f` rich-label predecessor packed
  // `<icon> <title> <suffix> · <project> · <dates>` into the button
  // and Grant's phone showed two ellipses
  // ("▶ Inoculate the A. nidulans ... · May 15 → M..."). The fix is
  // to move human-readable context into the message body and reduce
  // buttons to single-letter selectors that never truncate.

  it("buildBodyOptionLine renders the lettered 2-line block with full title + project + dates", () => {
    const line = buildBodyOptionLine(
      "A",
      "Inoculate the A. nidulans into shaker flasks",
      { start_date: "2026-05-15", end_date: "2026-05-22" },
      "Fungal Bacterial Co-Culturing",
    );
    expect(line).toBe(
      "A) Inoculate the A. nidulans into shaker flasks\n   Fungal Bacterial Co-Culturing · May 15 → May 22",
    );
  });

  it("Test 1 — picker body lists each option with A/B/C lettering + full context (no truncation)", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 1, name: "Make media", project_id: 1 }),
      makeExperiment({ id: 2, name: "Inoculate flasks", project_id: 1 }),
      makeExperiment({ id: 3, name: "Run gel", project_id: 1 }),
    ]);
    _setProjectsLoaderForTests(async () => [
      makeProject({ id: 1, name: "Aspergillus Study" }),
    ]);

    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    const prompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    expect(prompt).toBeDefined();
    const body = String(prompt![2]);
    expect(body).toContain("A) ");
    expect(body).toContain("B) ");
    expect(body).toContain("C) ");
    expect(body).toContain("Make media");
    expect(body).toContain("Inoculate flasks");
    expect(body).toContain("Run gel");
    expect(body).toContain("Aspergillus Study");
    // No ellipsis characters anywhere in the body (full strings).
    expect(body).not.toContain("…");
    expect(body).not.toContain("...");
  });

  it("Test 2 — letter overflow: 10 experiments × 2 subTabs use letters A-T, buttons are letter-only", async () => {
    // Redesigned picker (telegram note-attach, 2026-05-26): every
    // experiment exposes both Lab Notes + Results buttons inline, so 10
    // experiments → 20 letter buttons + 1 inbox = 21.
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    const today = todayLocalDate();
    const past = "2026-01-01";
    const experiments: Task[] = [];
    for (let i = 1; i <= 5; i++) {
      experiments.push(
        makeExperiment({
          id: i,
          name: `Doing ${i}`,
          start_date: today,
          end_date: today,
        }),
      );
    }
    for (let i = 6; i <= 10; i++) {
      experiments.push(
        makeExperiment({
          id: i,
          name: `Past ${i}`,
          start_date: past,
          end_date: past,
        }),
      );
    }
    _setExperimentsLoaderForTests(async () => experiments);
    _setProjectsLoaderForTests(async () => [makeProject({ id: 1, name: "P" })]);

    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    const prompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    const body = String(prompt![2]);
    const expectedLetters = [
      "A", "B", "C", "D", "E", "F", "G", "H", "I", "J",
      "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T",
    ];
    for (const letter of expectedLetters) {
      expect(body).toContain(`${letter}) `);
    }
    expect(body).toContain(`${INBOX_LABEL}) Save to Inbox`);

    const markup = (prompt![3] as { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } })
      ?.reply_markup;
    const buttons = markup!.inline_keyboard.flat();
    // 20 letter buttons + 1 inbox button.
    expect(buttons).toHaveLength(21);
    const letterButtons = buttons.filter((b) => b.text !== INBOX_LABEL);
    expect(letterButtons.map((b) => b.text).sort()).toEqual(
      [...expectedLetters].sort(),
    );
    // Every letter button is exactly one character.
    for (const b of letterButtons) {
      expect(b.text.length).toBe(1);
    }
    // Letter ordering matches PICKER_LETTERS prefix.
    expect(PICKER_LETTERS.slice(0, 20)).toEqual(letterButtons.map((b) => b.text));
  });

  it("Test 3 — active-task confirmation: body lists A/B/C with full title + project + dates; buttons are [A] [B] [C]", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({
        id: 7,
        name: "Inoculate the A. nidulans into shaker flasks",
        start_date: "2026-05-15",
        end_date: "2026-05-22",
        project_id: 4,
      }),
    ]);
    _setProjectsLoaderForTests(async () => [
      makeProject({ id: 4, name: "Fungal Bacterial Co-Culturing" }),
    ]);

    await routeBatchablePhoto("g1", makePhoto(), baseCtx, {
      id: 7,
      owner: USER,
      name: "Inoculate the A. nidulans into shaker flasks",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-active-confirmation");

    const prompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    const body = String(prompt![2]);
    expect(body).toContain("A) Inoculate the A. nidulans into shaker flasks — Lab Notes");
    expect(body).toContain("B) Inoculate the A. nidulans into shaker flasks — Results");
    expect(body).toContain("C) Pick another experiment");
    expect(body).toContain("Fungal Bacterial Co-Culturing · May 15 → May 22");
    // Full strings — no truncation marker.
    expect(body).not.toContain("…");
    expect(body).not.toContain("...");

    const markup = (prompt![3] as { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } })
      ?.reply_markup;
    const buttons = markup!.inline_keyboard.flat();
    expect(buttons.map((b) => b.text)).toEqual(["A", "B", "C"]);
    expect(buttons[0].callback_data).toBe("tab:7:alex:notes");
    expect(buttons[1].callback_data).toBe("tab:7:alex:results");
    expect(buttons[2].callback_data).toBe("pick-other");
  });

  it("Test 4 — section header format: em-dash separators with renamed labels, no 📋 emoji or old jargon", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    // Both sections populated: one in-window (active), one in the past
    // with no results.md (no results yet).
    const today = todayLocalDate();
    const past = "2026-01-01";
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 1, name: "Active task", start_date: today, end_date: today }),
      makeExperiment({ id: 2, name: "Past task", start_date: past, end_date: past }),
    ]);
    _setProjectsLoaderForTests(async () => [makeProject({ id: 1, name: "P" })]);

    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    const prompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    const body = String(prompt![2]);
    // New em-dash separator + renamed labels appear, exact strings.
    expect(body).toContain("——— Active ———");
    expect(body).toContain("——— No results yet ———");
    // Old emoji + jargon are gone.
    expect(body).not.toContain("📋");
    expect(body).not.toContain("Doing experiments");
    expect(body).not.toContain("Without results yet");
  });

  it("Test 4b — empty Active section: no `——— Active ———` header when doing is empty", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    const past = "2026-01-01";
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 1, name: "Past 1", start_date: past, end_date: past }),
    ]);
    _setProjectsLoaderForTests(async () => [makeProject({ id: 1, name: "P" })]);

    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    const prompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    const body = String(prompt![2]);
    expect(body).not.toContain("——— Active ———");
    expect(body).toContain("——— No results yet ———");
    expect(body).toContain("A) Past 1");
  });

  it("Test 4c — empty No-results section: no `——— No results yet ———` header when withoutResults is empty", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 1, name: "Doing 1" }),
    ]);
    _setProjectsLoaderForTests(async () => [makeProject({ id: 1, name: "P" })]);

    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    const prompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    const body = String(prompt![2]);
    expect(body).toContain("——— Active ———");
    expect(body).not.toContain("——— No results yet ———");
    expect(body).toContain("A) Doing 1");
  });

  it("Test 4d — both sections empty: only the Inbox line appears, no separators", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setExperimentsLoaderForTests(async () => []);
    _setProjectsLoaderForTests(async () => []);

    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    const prompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    const body = String(prompt![2]);
    expect(body).not.toContain("——— Active ———");
    expect(body).not.toContain("——— No results yet ———");
    expect(body).toContain(`${INBOX_LABEL}) Save to Inbox`);
    // Body part after the "Where should it go?\n\n" preamble should be
    // just the inbox line (single line, no surrounding letters).
    expect(body).not.toMatch(/[A-Z]\) /);
  });

  it("Test 4e — section blank-line invariant: exactly one blank line between sections, none doubled-up", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    const today = todayLocalDate();
    const past = "2026-01-01";
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 1, name: "Doing 1", start_date: today, end_date: today }),
      makeExperiment({ id: 2, name: "Doing 2", start_date: today, end_date: today }),
      makeExperiment({ id: 3, name: "Past 1", start_date: past, end_date: past }),
      makeExperiment({ id: 4, name: "Past 2", start_date: past, end_date: past }),
    ]);
    _setProjectsLoaderForTests(async () => [makeProject({ id: 1, name: "P" })]);

    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    const prompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    const body = String(prompt![2]);
    // Three blank lines in a row would mean two empty lines between sections —
    // we want at most one empty line anywhere in the body.
    expect(body).not.toMatch(/\n\n\n/);
    // And the two section headers should each appear exactly once.
    const activeMatches = body.match(/——— Active ———/g) ?? [];
    const norestlMatches = body.match(/——— No results yet ———/g) ?? [];
    expect(activeMatches).toHaveLength(1);
    expect(norestlMatches).toHaveLength(1);
  });

  it("Test 5 — inbox: keyboard carries `📥` button with `inbox` callback_data; body has `📥) Save to Inbox` line", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    const prompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    const body = String(prompt![2]);
    expect(body).toContain(`${INBOX_LABEL}) Save to Inbox`);

    const markup = (prompt![3] as { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } })
      ?.reply_markup;
    const inboxButton = markup!.inline_keyboard
      .flat()
      .find((b) => b.callback_data === "inbox");
    expect(inboxButton).toBeDefined();
    expect(inboxButton!.text).toBe(INBOX_LABEL);
  });

  it("Test 6 — no-truncation invariant: 50-char task name + 30-char project appear in full inside the body", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    const longName = "Run the NEBuilder on PKS and Justin's positive ctl"; // 50 chars
    const longProject = "Trichoderma asperellum isocyanide"; // 33 chars
    expect(longName.length).toBeGreaterThanOrEqual(50);
    expect(longProject.length).toBeGreaterThanOrEqual(30);
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({
        id: 1,
        name: longName,
        start_date: "2026-03-04",
        end_date: "2026-03-11",
        project_id: 9,
      }),
    ]);
    _setProjectsLoaderForTests(async () => [
      makeProject({ id: 9, name: longProject }),
    ]);

    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    const prompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    const body = String(prompt![2]);
    // The full untruncated strings must appear.
    expect(body).toContain(longName);
    expect(body).toContain(longProject);
    expect(body).toContain("Mar 4 → Mar 11");
    // No truncation marker.
    expect(body).not.toContain("…");
    expect(body).not.toContain("...");
  });

  it("Test 7 — button-text invariant: no newlines, letter-only (or emoji-only for inbox)", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 1, name: "x".repeat(100) }),
      makeExperiment({ id: 2, name: "y".repeat(100) }),
    ]);
    _setProjectsLoaderForTests(async () => [
      makeProject({ id: 1, name: "z".repeat(100) }),
    ]);

    // Full picker.
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    const pickerPrompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    const pickerMarkup = (pickerPrompt![3] as { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } })
      ?.reply_markup;
    for (const b of pickerMarkup!.inline_keyboard.flat()) {
      expect(b.text).not.toContain("\n");
      if (b.callback_data === "inbox") {
        expect(b.text).toBe(INBOX_LABEL);
      } else {
        // Letter buttons: exactly one character.
        expect(b.text.length).toBe(1);
      }
    }

    // Active confirmation.
    _resetBatchesForTests();
    hoisted.sendMessageMock.mockClear();
    await routeBatchablePhoto("g2", makePhoto(), baseCtx, {
      id: 1,
      owner: USER,
      name: "x".repeat(100),
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    const confirmPrompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    const confirmMarkup = (confirmPrompt![3] as { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } })
      ?.reply_markup;
    for (const b of confirmMarkup!.inline_keyboard.flat()) {
      expect(b.text).not.toContain("\n");
      expect(b.text.length).toBe(1);
    }
  });

  it("callback_data stays under the Telegram 64-byte cap", () => {
    // A 30-character username + a long-but-realistic id; subtab payload
    // is the longest of our callback shapes.
    const longUser = "a".repeat(30);
    const cb = `subtab:9999:${longUser}:results`;
    expect(new TextEncoder().encode(cb).length).toBeLessThan(64);
  });
});

describe("batch-routing: per-tab write target", () => {
  it("Lab Notes destination writes to taskNotesBase/Images/, NOT the legacy outer Images/", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 50, name: "TabTest" }),
    ]);

    await routeBatchablePhoto("g1", makePhoto("a"), baseCtx, {
      id: 50,
      owner: USER,
      name: "TabTest",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    // active-task confirmation → Lab Notes → style:auto → batch name.
    await routeBatchCallbackQuery(makeCallback("tab:50:alex:notes"), baseCtx);
    await routeBatchCallbackQuery(makeCallback("style:auto"), baseCtx);
    await consumeBatchTextReply("Yeast", baseCtx);

    expect(hoisted.attachImageToTaskMock).toHaveBeenCalled();
    const call = hoisted.attachImageToTaskMock.mock.calls[0][0];
    expect((call as { basePath?: string }).basePath).toBe(
      "users/alex/results/task-50/notes",
    );
    // Sanity: it's NOT the legacy outer base.
    expect((call as { basePath?: string }).basePath).not.toBe(
      "users/alex/results/task-50",
    );
  });

  it("Results destination writes to taskResultsTabBase/Images/", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 51, name: "TabTest2" }),
    ]);

    await routeBatchablePhoto("g1", makePhoto("a"), baseCtx, {
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

  it("Inbox destination writes to users/<owner>/inbox", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    await routeBatchCallbackQuery(makeCallback("inbox"), baseCtx);
    await routeBatchCallbackQuery(makeCallback("style:auto"), baseCtx);
    await consumeBatchTextReply("InboxBatch", baseCtx);
    const call = hoisted.attachImageToTaskMock.mock.calls[0][0];
    expect((call as { basePath?: string }).basePath).toBe("users/alex/inbox");
  });
});

describe("batch-routing: full destination → style → auto flow", () => {
  it("walks no-activeTask through picker → sub-tab → auto-name commit", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 3, name: "Doing E" }),
    ]);

    await routeBatchablePhoto("g1", makePhoto("a"), baseCtx, null);
    await routeBatchablePhoto("g1", makePhoto("b"), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    await routeBatchCallbackQuery(makeCallback("task:3:alex"), baseCtx);
    await routeBatchCallbackQuery(makeCallback("subtab:3:alex:notes"), baseCtx);
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

  // Sidecar caption regression: InboxToast and the inbox modal both read
  // caption from sidecar.json; if commitAutoNameBatch doesn't write one,
  // the toast falls back to "No caption" even when the user just typed
  // the name. Album-of-3 + Inbox so the assertions are simple paths.
  it("writes the batch name as sidecar caption on every photo (auto-number Inbox flow)", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    await routeBatchablePhoto("g1", makePhoto("a"), baseCtx, null);
    await routeBatchablePhoto("g1", makePhoto("b"), baseCtx, null);
    await routeBatchablePhoto("g1", makePhoto("c"), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    await routeBatchCallbackQuery(makeCallback("inbox"), baseCtx);
    await routeBatchCallbackQuery(makeCallback("style:auto"), baseCtx);
    await consumeBatchTextReply("Fu", baseCtx);

    const base = "users/alex/inbox";
    for (const i of [1, 2, 3]) {
      const sidecar = hoisted.memFs.get(`${base}/Images/Fu-${i}.jpg.json`) as
        | { caption?: string; source?: string }
        | undefined;
      expect(sidecar).toBeDefined();
      expect(sidecar?.caption).toBe("Fu");
      expect(sidecar?.source).toBe("telegram");
    }
  });

  // Telegram only attaches per-photo caption to photo 0 of an album, so
  // an earlier `photo.caption ?? name` shape would have left an anomalous
  // first-photo caption different from the rest. Lock in: every photo
  // gets the batch name even when photo 0 arrives with a Telegram
  // caption set.
  it("ignores photo[0] Telegram caption — every sidecar caption is the batch name", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    const photoA: BatchPhoto = { ...makePhoto("a"), caption: "tg-caption" };
    await routeBatchablePhoto("g1", photoA, baseCtx, null);
    await routeBatchablePhoto("g1", makePhoto("b"), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    await routeBatchCallbackQuery(makeCallback("inbox"), baseCtx);
    await routeBatchCallbackQuery(makeCallback("style:auto"), baseCtx);
    await consumeBatchTextReply("Fu", baseCtx);

    const base = "users/alex/inbox";
    const s1 = hoisted.memFs.get(`${base}/Images/Fu-1.jpg.json`) as
      | { caption?: string }
      | undefined;
    const s2 = hoisted.memFs.get(`${base}/Images/Fu-2.jpg.json`) as
      | { caption?: string }
      | undefined;
    expect(s1?.caption).toBe("Fu");
    expect(s2?.caption).toBe("Fu");
  });
});

describe("batch-routing: per-photo-captions flow", () => {
  it("style:each writes photos up front and resends each photo with its caption prompt in order", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 5, name: "Bench" }),
    ]);
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
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-active-confirmation");

    // Confirm active → Lab Notes → style:each.
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

describe("batch-routing: single-photo entry (Lock 1 — ASK ALWAYS, even for one photo)", () => {
  it("routeSinglePhotoThroughBatch with active task → awaiting-active-confirmation (not silent attach)", async () => {
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 8, name: "Single" }),
    ]);
    _setProjectsLoaderForTests(async () => [makeProject({ id: 1, name: "ProjA" })]);

    await routeSinglePhotoThroughBatch(makePhoto(), baseCtx, {
      id: 8,
      owner: USER,
      name: "Single",
    });
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-active-confirmation");
    // No silent attach happened.
    expect(hoisted.attachImageToTaskMock).not.toHaveBeenCalled();
    const prompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    expect(prompt).toBeDefined();
    expect(String(prompt![2])).toContain("photo");
  });

  it("routeSinglePhotoThroughBatch with no active task → awaiting-destination (full picker)", async () => {
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 8, name: "Single" }),
    ]);
    await routeSinglePhotoThroughBatch(makePhoto(), baseCtx, null);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-destination");
    expect(hoisted.attachImageToTaskMock).not.toHaveBeenCalled();
  });

  it("single photo flow can complete: Lab Notes → style:auto → name → writes to taskNotesBase", async () => {
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 8, name: "Single" }),
    ]);
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
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 1, name: "T1" }),
    ]);
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, {
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
    const cq = makeCallback("task:1:alex");
    await routeBatchCallbackQuery(cq, baseCtx);
    expect(hoisted.answerCallbackQueryMock).toHaveBeenCalledTimes(1);
    const opts = hoisted.answerCallbackQueryMock.mock.calls[0][2];
    expect(opts?.text).toContain("expired");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Note-attach extension (telegram note-attach manager, 2026-05-26):
// new states for active-note tracking + disambiguation + a Notes section
// in the full picker.
// ─────────────────────────────────────────────────────────────────────

import {
  _setNotesLoaderForTests,
  _resetNotesLoaderForTests,
  partitionPickerNotes,
  PICKER_NOTES_CAP,
} from "./batch-routing";
import type { Note } from "@/lib/types";
import type { ActiveNote } from "@/lib/store";

function makeNote(overrides: Partial<Note>): Note {
  return {
    id: 1,
    title: "Default Note",
    description: "",
    is_running_log: false,
    is_shared: false,
    entries: [],
    comments: [],
    username: USER,
    updated_at: "2026-05-15T10:00:00Z",
    created_at: "2026-05-01T10:00:00Z",
    shared_with: [],
    ...overrides,
  } as Note;
}

beforeEach(() => {
  _resetNotesLoaderForTests();
});

describe("batch-routing: active-note-only confirmation (Case C)", () => {
  it("only activeNote → awaiting-note-confirmation, then A commits to note destination", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    const activeNote: ActiveNote = { id: 5, owner: USER, title: "Bench Log" };

    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null, activeNote);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-note-confirmation");

    const prompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("attach"),
    );
    expect(prompt).toBeDefined();
    const body = String(prompt![2]);
    expect(body).toContain("Bench Log");
    expect(body).toContain("A) Attach to Bench Log");
    expect(body).toContain("B) Pick a different note or experiment");

    const markup = (prompt![3] as { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } })
      ?.reply_markup;
    const buttons = markup!.inline_keyboard.flat();
    expect(buttons.map((b) => b.text)).toEqual(["A", "B"]);
    expect(buttons[0].callback_data).toBe("note:5:alex");
    expect(buttons[1].callback_data).toBe("pick-other");

    // Click A → commits to awaiting-style with note destination.
    await routeBatchCallbackQuery(makeCallback("note:5:alex"), baseCtx);
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
  });

  it("only activeNote → B (pick-other) escapes to the full picker", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null, {
      id: 5,
      owner: USER,
      title: "Bench Log",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-note-confirmation");

    await routeBatchCallbackQuery(makeCallback("pick-other"), baseCtx);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-destination");
  });
});

describe("batch-routing: both-active disambiguation (Case A)", () => {
  it("both activeTask AND activeNote → awaiting-active-disambiguation prompt", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    const activeTask: ActiveTask = { id: 7, owner: USER, name: "Western Blot" };
    const activeNote: ActiveNote = { id: 11, owner: USER, title: "Group Meeting" };

    await routeBatchablePhoto("g1", makePhoto(), baseCtx, activeTask, activeNote);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-active-disambiguation");

    const prompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("both"),
    );
    expect(prompt).toBeDefined();
    const body = String(prompt![2]);
    expect(body).toContain("A) Western Blot (experiment)");
    expect(body).toContain("B) Group Meeting (note)");
    expect(body).toContain("C) Pick another experiment or note");

    const markup = (prompt![3] as { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } })
      ?.reply_markup;
    const buttons = markup!.inline_keyboard.flat();
    expect(buttons.map((b) => b.text)).toEqual(["A", "B", "C"]);
    expect(buttons[0].callback_data).toBe("task:7:alex");
    expect(buttons[1].callback_data).toBe("note:11:alex");
    expect(buttons[2].callback_data).toBe("pick-other");
  });

  it("both-active → A (experiment) → sub-tab picker → awaiting-style with task destination", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    await routeBatchablePhoto(
      "g1",
      makePhoto(),
      baseCtx,
      { id: 7, owner: USER, name: "Western Blot" },
      { id: 11, owner: USER, title: "Group Meeting" },
    );
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    // Click A (the experiment).
    await routeBatchCallbackQuery(makeCallback("task:7:alex"), baseCtx);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-subtab");
    // Sub-tab picker.
    await routeBatchCallbackQuery(makeCallback("subtab:7:alex:notes"), baseCtx);
    const after = _peekBatchForTests(CHAT_ID);
    expect(after?.kind).toBe("awaiting-style");
    if (after?.kind === "awaiting-style") {
      expect(after.destination).toEqual({
        kind: "task",
        taskId: 7,
        owner: USER,
        name: "Western Blot",
        subTab: "notes",
      });
    }
  });

  it("both-active → B (note) commits straight to awaiting-style", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    await routeBatchablePhoto(
      "g1",
      makePhoto(),
      baseCtx,
      { id: 7, owner: USER, name: "Western Blot" },
      { id: 11, owner: USER, title: "Group Meeting" },
    );
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    await routeBatchCallbackQuery(makeCallback("note:11:alex"), baseCtx);
    const after = _peekBatchForTests(CHAT_ID);
    expect(after?.kind).toBe("awaiting-style");
    if (after?.kind === "awaiting-style") {
      expect(after.destination).toEqual({
        kind: "note",
        noteId: 11,
        owner: USER,
        title: "Group Meeting",
      });
    }
  });

  it("both-active → C (pick-other) escapes to the full picker", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    await routeBatchablePhoto(
      "g1",
      makePhoto(),
      baseCtx,
      { id: 7, owner: USER, name: "Western Blot" },
      { id: 11, owner: USER, title: "Group Meeting" },
    );
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    await routeBatchCallbackQuery(makeCallback("pick-other"), baseCtx);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-destination");
  });
});

describe("batch-routing: full picker with Notes section (Case D)", () => {
  it("renders both Experiments and Notes sections", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 1, name: "ExpOne", project_id: 1 }),
    ]);
    _setProjectsLoaderForTests(async () => [makeProject({ id: 1, name: "P" })]);
    _setNotesLoaderForTests(async () => [
      makeNote({ id: 100, title: "Note One", updated_at: "2026-05-15T10:00:00Z" }),
      makeNote({ id: 101, title: "Note Two", updated_at: "2026-05-14T10:00:00Z" }),
    ]);

    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    const prompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    const body = String(prompt![2]);
    expect(body).toContain("——— Active ———");
    expect(body).toContain("——— Notes ———");
    expect(body).toContain("ExpOne — Lab Notes");
    expect(body).toContain("ExpOne — Results");
    expect(body).toContain("Note One");
    expect(body).toContain("Note Two");

    const markup = (prompt![3] as { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } })
      ?.reply_markup;
    const buttons = markup!.inline_keyboard.flat();
    // 2 experiment letter buttons + 2 note letter buttons + 1 inbox.
    expect(buttons).toHaveLength(5);
    const noteOneBtn = buttons.find((b) => b.callback_data === "note:100:alex");
    expect(noteOneBtn).toBeDefined();
    const noteTwoBtn = buttons.find((b) => b.callback_data === "note:101:alex");
    expect(noteTwoBtn).toBeDefined();
  });

  it("empty Notes section: header omitted, no note rows", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({ id: 1, name: "ExpOne" }),
    ]);
    _setNotesLoaderForTests(async () => []);
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    const prompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    const body = String(prompt![2]);
    expect(body).not.toContain("——— Notes ———");
    expect(body).toContain("——— Active ———");
  });

  it("picker note button → commits straight to awaiting-style with note destination", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setExperimentsLoaderForTests(async () => []);
    _setNotesLoaderForTests(async () => [
      makeNote({ id: 42, title: "Meeting" }),
    ]);
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);

    await routeBatchCallbackQuery(makeCallback("note:42:alex"), baseCtx);
    const after = _peekBatchForTests(CHAT_ID);
    expect(after?.kind).toBe("awaiting-style");
    if (after?.kind === "awaiting-style") {
      expect(after.destination).toEqual({
        kind: "note",
        noteId: 42,
        owner: USER,
        title: "Meeting",
      });
    }
  });
});

describe("batch-routing: partitionPickerNotes", () => {
  it("returns the most-recent-by-updated_at notes up to the cap", () => {
    const notes: Note[] = [
      makeNote({ id: 1, title: "Old", updated_at: "2026-01-01T00:00:00Z" }),
      makeNote({ id: 2, title: "Newest", updated_at: "2026-05-20T00:00:00Z" }),
      makeNote({ id: 3, title: "Mid", updated_at: "2026-03-15T00:00:00Z" }),
      makeNote({ id: 4, title: "Recent2", updated_at: "2026-05-10T00:00:00Z" }),
      makeNote({ id: 5, title: "Recent3", updated_at: "2026-04-20T00:00:00Z" }),
      makeNote({ id: 6, title: "Recent4", updated_at: "2026-04-15T00:00:00Z" }),
    ];
    const picked = partitionPickerNotes(notes);
    expect(picked).toHaveLength(PICKER_NOTES_CAP);
    expect(picked.map((n) => n.title)).toEqual(["Newest", "Recent2", "Recent3", "Recent4"]);
  });
});

describe("batch-routing: end-to-end note attach", () => {
  it("note destination + style:auto + name → writes to users/<owner>/notes/<id>/Images via attachImageToNote", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setNotesLoaderForTests(async () => [makeNote({ id: 99, title: "Bench Log" })]);

    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null, {
      id: 99,
      owner: USER,
      title: "Bench Log",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    await routeBatchCallbackQuery(makeCallback("note:99:alex"), baseCtx);
    await routeBatchCallbackQuery(makeCallback("style:auto"), baseCtx);
    await consumeBatchTextReply("Plate1", baseCtx);

    // Note destination routes through attachImageToNote (separate mock).
    expect(hoisted.attachImageToNoteMock).toHaveBeenCalledTimes(1);
    const call = hoisted.attachImageToNoteMock.mock.calls[0][0];
    expect((call as { ownerUsername: string }).ownerUsername).toBe(USER);
    expect((call as { noteId: number }).noteId).toBe(99);
    expect((call as { suggestedFilename: string }).suggestedFilename).toBe("Plate1-1.jpg");

    // Sidecar writes to users/<owner>/notes/<id>/Images/<file>.json.
    const sidecarPath = `users/${USER}/notes/99/Images/Plate1-1.jpg.json`;
    const sidecar = hoisted.memFs.get(sidecarPath) as
      | { caption?: string; source?: string }
      | undefined;
    expect(sidecar).toBeDefined();
    expect(sidecar?.caption).toBe("Plate1");
    expect(sidecar?.source).toBe("telegram");
  });
});

// --- Entry picker for multi-entry notes -----------------------------------
//
// Bug-fix coverage for note-attach R2 (2026-05-26). The prior chip routed
// every note-attach to the latest entry by `updated_at` with no
// disambiguation; running-log notes (e.g. weekly bench logs, recurring
// 1:1 meetings) can have many entries, and the user often wants the photo
// on an OLDER entry that matches the conversation it came from.
//
// The injected state is `awaiting-entry-pick`, sitting between the note
// callback and the style prompt. Single-entry notes skip the new state
// entirely (one-shot remains one-shot). The entry id is threaded through
// `awaiting-style` → `awaiting-batch-name` → `attachImageToNote.entryId`.
describe("batch-routing: entry picker for multi-entry notes", () => {
  it("single-entry note: skip the picker and go straight to style", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setNotesLoaderForTests(async () => [
      makeNote({
        id: 50,
        title: "Single Entry Note",
        entries: [
          {
            id: "e1",
            title: "Day 1",
            date: "2026-05-15",
            content: "",
            created_at: "2026-05-15T10:00:00Z",
            updated_at: "2026-05-15T10:00:00Z",
          },
        ],
      }),
    ]);
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null, {
      id: 50,
      owner: USER,
      title: "Single Entry Note",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    await routeBatchCallbackQuery(makeCallback(`note:50:${USER}`), baseCtx);
    // Single-entry note must NOT enter the entry-pick state.
    const next = _peekBatchForTests(CHAT_ID);
    expect(next?.kind).toBe("awaiting-style");
  });

  it("multi-entry note: routes through awaiting-entry-pick, then style", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setNotesLoaderForTests(async () => [
      makeNote({
        id: 60,
        title: "Multi Entry Note",
        entries: [
          {
            id: "older",
            title: "Older",
            date: "2026-05-01",
            content: "",
            created_at: "2026-05-01T10:00:00Z",
            updated_at: "2026-05-01T10:00:00Z",
          },
          {
            id: "newer",
            title: "Newer",
            date: "2026-05-15",
            content: "",
            created_at: "2026-05-15T10:00:00Z",
            updated_at: "2026-05-15T10:00:00Z",
          },
        ],
      }),
    ]);
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null, {
      id: 60,
      owner: USER,
      title: "Multi Entry Note",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    await routeBatchCallbackQuery(makeCallback(`note:60:${USER}`), baseCtx);

    // After the note pick, the bot is now asking which entry to attach to.
    const inPick = _peekBatchForTests(CHAT_ID);
    expect(inPick?.kind).toBe("awaiting-entry-pick");
    // The prompt body lists the entries (newest first) plus the "Latest"
    // shortcut. We sanity-check the latest message body.
    const lastCall = hoisted.sendMessageMock.mock.calls.at(-1);
    expect(lastCall?.[2]).toContain("Multi Entry Note");
    expect(lastCall?.[2]).toContain("Latest entry (default)");
  });

  it("multi-entry note + Latest sentinel: noteEntryId is undefined", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setNotesLoaderForTests(async () => [
      makeNote({
        id: 61,
        title: "Multi Latest",
        entries: [
          {
            id: "older",
            title: "Older",
            date: "2026-05-01",
            content: "",
            created_at: "2026-05-01T10:00:00Z",
            updated_at: "2026-05-01T10:00:00Z",
          },
          {
            id: "newer",
            title: "Newer",
            date: "2026-05-15",
            content: "",
            created_at: "2026-05-15T10:00:00Z",
            updated_at: "2026-05-15T10:00:00Z",
          },
        ],
      }),
    ]);
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null, {
      id: 61,
      owner: USER,
      title: "Multi Latest",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    await routeBatchCallbackQuery(makeCallback(`note:61:${USER}`), baseCtx);
    await routeBatchCallbackQuery(makeCallback("entry:latest"), baseCtx);
    await routeBatchCallbackQuery(makeCallback("style:auto"), baseCtx);
    await consumeBatchTextReply("Plate2", baseCtx);

    expect(hoisted.attachImageToNoteMock).toHaveBeenCalledTimes(1);
    const call = hoisted.attachImageToNoteMock.mock.calls[0][0];
    expect((call as { entryId?: string }).entryId).toBeUndefined();
  });

  it("multi-entry note + pick A (newest): entryId === sorted[0].id", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setNotesLoaderForTests(async () => [
      makeNote({
        id: 62,
        title: "Multi A",
        entries: [
          {
            id: "older",
            title: "Older",
            date: "2026-05-01",
            content: "",
            created_at: "2026-05-01T10:00:00Z",
            updated_at: "2026-05-01T10:00:00Z",
          },
          {
            id: "newer",
            title: "Newer",
            date: "2026-05-15",
            content: "",
            created_at: "2026-05-15T10:00:00Z",
            updated_at: "2026-05-15T10:00:00Z",
          },
        ],
      }),
    ]);
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null, {
      id: 62,
      owner: USER,
      title: "Multi A",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    await routeBatchCallbackQuery(makeCallback(`note:62:${USER}`), baseCtx);
    // Entries are sorted newest-first by updated_at, so A → "newer".
    await routeBatchCallbackQuery(makeCallback("entry:0"), baseCtx);
    await routeBatchCallbackQuery(makeCallback("style:auto"), baseCtx);
    await consumeBatchTextReply("Plate3", baseCtx);

    expect(hoisted.attachImageToNoteMock).toHaveBeenCalledTimes(1);
    const call = hoisted.attachImageToNoteMock.mock.calls[0][0];
    expect((call as { entryId?: string }).entryId).toBe("newer");
  });

  it("multi-entry note + pick B (older): entryId === sorted[1].id", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setNotesLoaderForTests(async () => [
      makeNote({
        id: 63,
        title: "Multi B",
        entries: [
          {
            id: "older",
            title: "Older",
            date: "2026-05-01",
            content: "",
            created_at: "2026-05-01T10:00:00Z",
            updated_at: "2026-05-01T10:00:00Z",
          },
          {
            id: "newer",
            title: "Newer",
            date: "2026-05-15",
            content: "",
            created_at: "2026-05-15T10:00:00Z",
            updated_at: "2026-05-15T10:00:00Z",
          },
        ],
      }),
    ]);
    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null, {
      id: 63,
      owner: USER,
      title: "Multi B",
    });
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    await routeBatchCallbackQuery(makeCallback(`note:63:${USER}`), baseCtx);
    await routeBatchCallbackQuery(makeCallback("entry:1"), baseCtx);
    await routeBatchCallbackQuery(makeCallback("style:auto"), baseCtx);
    await consumeBatchTextReply("Plate4", baseCtx);

    expect(hoisted.attachImageToNoteMock).toHaveBeenCalledTimes(1);
    const call = hoisted.attachImageToNoteMock.mock.calls[0][0];
    expect((call as { entryId?: string }).entryId).toBe("older");
  });
});

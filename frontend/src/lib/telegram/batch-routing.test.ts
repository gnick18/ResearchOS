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
//   4. Rich single-line button labels — title · project · dates joined
//      with middle-dot; callback_data stays under the 64-byte cap. iOS
//      Telegram collapses `\n` inside button text and appends ".."
//      truncation regardless of length, so labels must be single-line.
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
  buildExperimentLabel,
  consumeBatchTextReply,
  partitionPickerExperiments,
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

  it("Pick another → awaiting-destination → task → awaiting-subtab → sub-tab → awaiting-style", async () => {
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
    const taskBtn = pickerMarkup!.inline_keyboard.flat().find((b) =>
      b.callback_data.startsWith("task:9:"),
    );
    expect(taskBtn).toBeDefined();

    // Click a task.
    hoisted.sendMessageMock.mockClear();
    await routeBatchCallbackQuery(makeCallback(taskBtn!.callback_data), baseCtx);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-subtab");
    const subTabPrompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("lab notes or results"),
    );
    expect(subTabPrompt).toBeDefined();
    const subTabMarkup = (subTabPrompt![3] as { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } })
      ?.reply_markup;
    const notesSub = subTabMarkup!.inline_keyboard.flat().find((b) =>
      b.callback_data === "subtab:9:alex:notes",
    );
    expect(notesSub).toBeDefined();

    // Click Lab Notes sub-tab.
    await routeBatchCallbackQuery(makeCallback("subtab:9:alex:notes"), baseCtx);
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

describe("batch-routing: no-active-task → full picker → sub-tab → style", () => {
  it("walks the full picker through sub-tab into awaiting-style", async () => {
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
    const taskButton = destMarkup!.inline_keyboard
      .flat()
      .find((b) => b.callback_data.startsWith("task:3:"));
    expect(taskButton).toBeDefined();

    // User clicks the task button → awaiting-subtab.
    await routeBatchCallbackQuery(makeCallback(taskButton!.callback_data), baseCtx);
    expect(_peekBatchForTests(CHAT_ID)?.kind).toBe("awaiting-subtab");

    // User picks Results sub-tab → awaiting-style.
    await routeBatchCallbackQuery(makeCallback("subtab:3:alex:results"), baseCtx);
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

describe("batch-routing: rich button labels", () => {
  // iOS Telegram collapses `\n` inside button text and appends ".."
  // truncation regardless of length, so the redesign's 3-line `\n`
  // label rendered as `<title>..` with project + dates invisible on
  // mobile. The label is now a single line with " · " separators
  // (title · project · MMM D → MMM D), per-component capped at
  // TITLE_CAP=30 / PROJECT_CAP=18, with the project dropped when the
  // total exceeds 55 chars.
  it("buildExperimentLabel returns single-line ` · `-separated label in MMM D format", () => {
    const label = buildExperimentLabel(
      { name: "Make media", start_date: "2026-04-01", end_date: "2026-05-15" },
      "Aspergillus Study",
    );
    expect(label).toBe("Make media · Aspergillus Study · Apr 1 → May 15");
  });

  it("buildExperimentLabel truncates long titles with `…`, project + dates remain", () => {
    const longName = "x".repeat(50);
    const label = buildExperimentLabel(
      { name: longName, start_date: "2026-05-01", end_date: "2026-05-10" },
      "P",
    );
    const segments = label.split(" · ");
    expect(segments).toHaveLength(3);
    expect(segments[0].length).toBeLessThanOrEqual(30);
    expect(segments[0].endsWith("…")).toBe(true);
    expect(segments[1]).toBe("P");
    expect(segments[2]).toBe("May 1 → May 10");
  });

  it("buildExperimentLabel truncates long project names with `…`, title + dates remain", () => {
    const longProject = "y".repeat(50);
    const label = buildExperimentLabel(
      { name: "E", start_date: "2026-05-01", end_date: "2026-05-10" },
      longProject,
    );
    const segments = label.split(" · ");
    expect(segments).toHaveLength(3);
    expect(segments[0]).toBe("E");
    expect(segments[1].length).toBeLessThanOrEqual(18);
    expect(segments[1].endsWith("…")).toBe(true);
    expect(segments[2]).toBe("May 1 → May 10");
  });

  it("buildExperimentLabel drops project when total budget exceeded; title + dates survive", () => {
    // title at TITLE_CAP (30, with `…`) + project at PROJECT_CAP (18,
    // with `…`) + dates (~14) = ~71 chars total → drop project.
    const longName = "n".repeat(50);
    const longProject = "p".repeat(50);
    const label = buildExperimentLabel(
      { name: longName, start_date: "2026-05-01", end_date: "2026-05-10" },
      longProject,
    );
    const segments = label.split(" · ");
    expect(segments).toHaveLength(2);
    expect(segments[0].length).toBeLessThanOrEqual(30);
    expect(segments[0].endsWith("…")).toBe(true);
    expect(segments[1]).toBe("May 1 → May 10");
  });

  it("buildExperimentLabel respects icon + suffix and the combined title fits the cap", () => {
    const label = buildExperimentLabel(
      { name: "Plate", start_date: "2026-04-12", end_date: "2026-04-14" },
      "Fungal CoCult",
      { icon: "📝", suffix: "— Lab Notes" },
    );
    const segments = label.split(" · ");
    expect(segments[0].startsWith("📝 ")).toBe(true);
    expect(segments[0]).toContain("Plate");
    expect(segments[0]).toContain("Lab Notes");
    expect(segments[0].length).toBeLessThanOrEqual(30);
    expect(segments[segments.length - 1]).toBe("Apr 12 → Apr 14");
  });

  it("buildExperimentLabel truncates a too-long icon+name+suffix title segment as one unit", () => {
    const label = buildExperimentLabel(
      { name: "x".repeat(50), start_date: "2026-04-01", end_date: "2026-04-02" },
      "P",
      { icon: "📝", suffix: "— Lab Notes" },
    );
    const segments = label.split(" · ");
    expect(segments[0].startsWith("📝 ")).toBe(true);
    expect(segments[0].endsWith("…")).toBe(true);
    expect(segments[0].length).toBeLessThanOrEqual(30);
  });

  it("buildExperimentLabel output never contains `\\n` (iOS Telegram newline-collapse invariant)", () => {
    const cases = [
      buildExperimentLabel(
        { name: "Short", start_date: "2026-04-01", end_date: "2026-05-15" },
        "P",
      ),
      buildExperimentLabel(
        { name: "x".repeat(100), start_date: "2026-04-01", end_date: "2026-05-15" },
        "y".repeat(100),
      ),
      buildExperimentLabel(
        { name: "T", start_date: "2026-04-01", end_date: "2026-04-02" },
        "P",
        { icon: "▶︎" },
      ),
      buildExperimentLabel(
        { name: "T", start_date: "2026-04-01", end_date: "2026-04-02" },
        "P",
        { icon: "📝", suffix: "— Lab Notes" },
      ),
    ];
    for (const label of cases) {
      expect(label).not.toContain("\n");
    }
  });

  it("task-picker button text is single-line ` · `-separated and contains no `\\n`", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
    _setExperimentsLoaderForTests(async () => [
      makeExperiment({
        id: 21,
        name: "Yeast assay",
        start_date: "2026-05-01",
        end_date: "2026-05-10",
        project_id: 4,
      }),
    ]);
    _setProjectsLoaderForTests(async () => [
      makeProject({ id: 4, name: "Protein Res" }),
    ]);

    await routeBatchablePhoto("g1", makePhoto(), baseCtx, null);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS + 50);
    const prompt = hoisted.sendMessageMock.mock.calls.find((c) =>
      String(c[2]).toLowerCase().includes("where"),
    );
    const markup = (prompt![3] as { reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } })
      ?.reply_markup;
    const taskBtn = markup!.inline_keyboard
      .flat()
      .find((b) => b.callback_data.startsWith("task:21:"));
    expect(taskBtn).toBeDefined();
    expect(taskBtn!.text).not.toContain("\n");
    expect(taskBtn!.text).toContain(" · ");
    expect(taskBtn!.text).toContain("Yeast assay");
    expect(taskBtn!.text).toContain("Protein Res");
    expect(taskBtn!.text).toContain("May 1");
    expect(taskBtn!.text).toContain("May 10");
  });

  it("callback_data stays under the Telegram 64-byte cap", async () => {
    vi.useFakeTimers({ now: new Date("2026-05-15T10:00:00Z") });
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

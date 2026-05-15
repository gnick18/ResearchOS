/**
 * Batch-photo routing state machine.
 *
 * Telegram tags album photos (the "select multiple, send" gesture) with a
 * shared `media_group_id` and delivers each photo as its own `message`
 * update within ~1 second. Per-photo routing — the existing single-shot
 * flow in `image-router.ts` — would prompt the user 10 separate times for
 * "where should this go? what is this?", which is the bug surfaced by
 * Grant's manual testing. This module buffers media_group_id photos into
 * a single batch, asks at most twice ("where?" + "name pattern?"), then
 * commits the batch to disk.
 *
 * Lifecycle (per chat):
 *
 *   buffering ────────────── timer (1.2s no arrivals) OR 10 photos cap
 *      │                          │
 *      │                          │ activeTaskSnapshot != null?
 *      │                          ▼
 *      │                       awaiting-style ──── style click ──┬─► awaiting-batch-name ──► commit
 *      │                                                          │
 *      │                                                          └─► awaiting-per-photo-captions ──► commit
 *      │
 *      └─ no activeTask: awaiting-destination ── click ──► awaiting-style (same fork as above)
 *
 * Tutorial-mode pass-through: the image-router guards entry — when
 * `tutorial_active` is set, batchable photos go through the single-photo
 * flow individually so the tutorial sequencer's "first-photo" broadcast
 * still fires. Nothing in this module checks the flag directly.
 *
 * Single-tab assumption: the polling loop in `use-telegram-polling.ts`
 * holds a cross-tab lock, so there's only ever one routing tab. State
 * lives in a module-scope Map keyed by chatId, mirroring the existing
 * `pendingCaptions` pattern in `image-router.ts`. A tab close mid-batch
 * loses the in-flight decisions; on-disk writes are durable.
 */

import { fileService } from "@/lib/file-system/file-service";
import { attachImageToTask } from "@/lib/attachments/attach-image";
import {
  resolveTaskResultsBase,
  taskNotesBase,
  taskResultsBase,
  taskResultsTabBase,
} from "@/lib/tasks/results-paths";
import { sidecarPath, type ImageSidecar } from "@/lib/attachments/image-folder";
import { hasUserContent } from "@/lib/stamp-utils";
import { JsonStore } from "@/lib/storage/json-store";
import type { Project, Task } from "@/lib/types";
import type { ActiveTask } from "@/lib/store";
import {
  answerCallbackQuery,
  sendMessage,
  sendPhoto,
  type InlineKeyboardButton,
  type InlineKeyboardMarkup,
  type TelegramCallbackQuery,
} from "./telegram-client";

/** Window between photo arrivals before the batch is considered closed.
 *  Telegram delivers album photos within ~1s in practice; 1.2s is enough
 *  slack to absorb network jitter without keeping the user waiting. */
export const BATCH_WINDOW_MS = 1200;
/** Telegram caps an album at 10 photos. Once we've buffered 10 we can
 *  commit early instead of waiting another full window. */
export const BATCH_MAX_PHOTOS = 10;

/** Resolved target for a committed batch. Either an experiment with a
 *  per-tab sub-bucket (Lab Notes vs Results — both write into the
 *  matching `Images/` subdir under that tab's folder) or the user's
 *  inbox. Inbox has no sub-tabs; its `Images/` lives at the inbox root. */
export type BatchDestination =
  | {
      kind: "task";
      taskId: number;
      owner: string;
      name: string;
      subTab: "notes" | "results";
    }
  | { kind: "inbox" };

export interface BatchPhoto {
  /** Telegram message id of the photo (used for sidecar metadata). */
  messageId: number;
  /** Telegram-side send timestamp (epoch seconds). */
  date: number;
  /** Optional Telegram caption attached to the photo. */
  caption: string | null;
  /** Pre-downloaded image bytes. */
  blob: Blob;
  /** Filename stem hint from the source (e.g. "photo" for inline
   *  uploads, the original name for documents). */
  suggestedStem: string;
  /** File extension without the dot, lowercased. */
  suggestedExt: string;
  /** Telegram file_id of the largest photo size (or the document's
   *  file_id for image-documents). Re-used by `sendPhoto` so the
   *  per-photo-captions flow can resend each image alongside its
   *  prompt without re-uploading bytes. */
  fileId: string;
}

export interface BatchRouteContext {
  username: string;
  botToken: string;
  chatId: number;
}

type BatchState =
  | {
      kind: "buffering";
      chatId: number;
      mediaGroupId: string;
      ctx: BatchRouteContext;
      photos: BatchPhoto[];
      activeTaskSnapshot: ActiveTask | null;
      timerId: ReturnType<typeof setTimeout>;
    }
  | {
      kind: "awaiting-active-confirmation";
      chatId: number;
      mediaGroupId: string;
      ctx: BatchRouteContext;
      photos: BatchPhoto[];
      activeTask: ActiveTask;
    }
  | {
      kind: "awaiting-destination";
      chatId: number;
      mediaGroupId: string;
      ctx: BatchRouteContext;
      photos: BatchPhoto[];
    }
  | {
      kind: "awaiting-subtab";
      chatId: number;
      mediaGroupId: string;
      ctx: BatchRouteContext;
      photos: BatchPhoto[];
      /** Task the user picked. We hold id/owner/name here so the sub-tab
       *  click can graduate directly to `awaiting-style` without
       *  re-reading the experiments list. */
      task: { id: number; owner: string; name: string };
    }
  | {
      kind: "awaiting-style";
      chatId: number;
      mediaGroupId: string;
      ctx: BatchRouteContext;
      photos: BatchPhoto[];
      destination: BatchDestination;
    }
  | {
      kind: "awaiting-batch-name";
      chatId: number;
      mediaGroupId: string;
      ctx: BatchRouteContext;
      photos: BatchPhoto[];
      destination: BatchDestination;
    }
  | {
      kind: "awaiting-per-photo-captions";
      chatId: number;
      mediaGroupId: string;
      ctx: BatchRouteContext;
      destination: BatchDestination;
      /** Already-saved photos awaiting captions. Each carries the disk
       *  location of the sidecar (so a caption reply can write through)
       *  and the original Telegram file_id (so the bot can resend the
       *  photo alongside its caption prompt — text-only "What is photo
       *  3?" is hard to disambiguate inside a 5+ photo album). */
      written: { basePath: string; filename: string; fileId: string }[];
      /** Number of captions still expected. We caption in order
       *  (written[written.length - currentRemaining]). */
      currentRemaining: number;
    };

/** chatId to current batch state. Module-scope is fine because only one
 *  tab runs the polling loop (cross-tab lock in `use-telegram-polling`). */
const batches = new Map<number, BatchState>();

/** Test-only escape hatch. Vitest reuses the module across tests; this
 *  clears all in-flight batches between tests. */
export function _resetBatchesForTests(): void {
  for (const state of batches.values()) {
    if (state.kind === "buffering") clearTimeout(state.timerId);
  }
  batches.clear();
}

/** Test-only inspector. */
export function _peekBatchForTests(chatId: number): BatchState | undefined {
  return batches.get(chatId);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function timestampStem(prefix: string): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}-${prefix}`;
}

function inboxBase(username: string): string {
  return `users/${username}/inbox`;
}

async function writeSidecar(
  basePath: string,
  filename: string,
  updates: Partial<ImageSidecar>
): Promise<void> {
  const path = sidecarPath(basePath, filename);
  const existing = (await fileService.readJson<ImageSidecar>(path)) ?? {};
  const merged: ImageSidecar = { ...existing, ...updates };
  await fileService.writeJson(path, merged);
}

/** Today as YYYY-MM-DD (local), matching the Task.start_date / end_date
 *  string format. */
function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Lazy task fetch surface. Held as a thunk so the test suite can swap
 *  it via `_setExperimentsLoaderForTests`. The default implementation
 *  uses the same `JsonStore<Task>("tasks")` as `local-api.ts`. */
let experimentsLoader: (username: string) => Promise<Task[]> = async (
  username: string
) => {
  const store = new JsonStore<Task>("tasks");
  return store.listAllForUser(username);
};

export function _setExperimentsLoaderForTests(
  loader: (username: string) => Promise<Task[]> | null
): void {
  experimentsLoader = async (u: string) => (await loader(u)) ?? [];
}
export function _resetExperimentsLoaderForTests(): void {
  experimentsLoader = async (username: string) => {
    const store = new JsonStore<Task>("tasks");
    return store.listAllForUser(username);
  };
}

/** Lazy project fetch surface. Buttons need the project folder name in
 *  their 3-line label, so the picker resolves project_id → name once per
 *  build. Swappable for tests via `_setProjectsLoaderForTests`. */
let projectsLoader: (username: string) => Promise<Project[]> = async (
  username: string
) => {
  const store = new JsonStore<Project>("projects");
  return store.listAllForUser(username);
};

export function _setProjectsLoaderForTests(
  loader: (username: string) => Promise<Project[]> | null
): void {
  projectsLoader = async (u: string) => (await loader(u)) ?? [];
}
export function _resetProjectsLoaderForTests(): void {
  projectsLoader = async (username: string) => {
    const store = new JsonStore<Project>("projects");
    return store.listAllForUser(username);
  };
}

/** True when the task's `results.md` exists AND has user content beyond
 *  the stamp / header scaffolding. Used by the picker to hide
 *  experiments that already have results written so the user is nudged
 *  toward the not-yet-documented ones.
 *
 *  Stamp-only detection delegates to `hasUserContent` in stamp-utils,
 *  which strips every supported stamp format + the auto-generated
 *  "# Results: …" header before deciding. */
async function hasMeaningfulResults(
  task: Pick<Task, "id" | "owner">
): Promise<boolean> {
  const path = `${taskResultsBase(task)}/results.md`;
  if (!(await fileService.fileExists(path))) return false;
  const blob = await fileService.readFileAsBlob(path);
  if (!blob) return false;
  let text: string;
  try {
    text = await blob.text();
  } catch {
    return false;
  }
  return hasUserContent(text);
}

/** Truncate to `max` chars with an ellipsis suffix. Telegram button
 *  text wraps long single lines awkwardly; we cap titles and project
 *  folder names so each line of the 3-line label stays visually tidy.
 *
 *  Inner cap of ~60 leaves headroom for the optional " — Lab Notes"
 *  suffix on the active-task confirmation rows. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** Build the 3-line button text for an experiment row. Telegram supports
 *  `\n` inside button `text`, so each line renders on its own row in the
 *  client. The optional suffix appears on the title line (used by the
 *  active-task quick-pick rows to flag "— Lab Notes" / "— Results").
 *
 *  Format:
 *    <icon? + title (+ suffix)?>
 *    <project folder>
 *    <start_date → end_date>
 */
export function buildExperimentLabel(
  task: Pick<Task, "name" | "start_date" | "end_date">,
  projectFolder: string,
  opts: { suffix?: string; icon?: string } = {}
): string {
  const titleCap = 60;
  const projectCap = 60;
  const titleBase = truncate(task.name, titleCap);
  const titleLine = opts.icon
    ? `${opts.icon} ${titleBase}${opts.suffix ? ` ${opts.suffix}` : ""}`
    : `${titleBase}${opts.suffix ? ` ${opts.suffix}` : ""}`;
  const projectLine = truncate(projectFolder || "(no project)", projectCap);
  const dateLine = `${task.start_date} → ${task.end_date}`;
  return [titleLine, projectLine, dateLine].join("\n");
}

/** Lookup map from `project_id` → project name for a single owner's
 *  projects. Returns "" for any missing id so the label builder can
 *  fall back to "(no project)". */
async function loadProjectNameLookup(
  username: string
): Promise<Map<number, string>> {
  let projects: Project[];
  try {
    projects = await projectsLoader(username);
  } catch {
    projects = [];
  }
  const map = new Map<number, string>();
  for (const p of projects) map.set(p.id, p.name);
  return map;
}

/** Slice an experiment list into the two picker sections — doing-now vs
 *  experiments without results yet — applying today's date and the
 *  results.md content check. Each section is capped at `MAX_PER_SECTION`
 *  rows; overflow is silently dropped (most-recent-by-end-date wins).
 *
 *  Caller wraps with Inbox + (optionally) the active task confirmation
 *  rows. */
export const PICKER_MAX_PER_SECTION = 5;

export async function partitionPickerExperiments(
  experiments: Task[]
): Promise<{ doing: Task[]; withoutResults: Task[] }> {
  const today = todayLocalDate();
  const incomplete = experiments.filter(
    (t) => t.task_type === "experiment" && !t.is_complete
  );
  const doingAll = incomplete
    .filter((t) => t.start_date <= today && t.end_date >= today)
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  const doing = doingAll.slice(0, PICKER_MAX_PER_SECTION);

  // Experiments outside the doing-window that haven't had results
  // written yet. We check on-disk results.md content; a stamp-only file
  // counts as "no results yet" because it was auto-generated when the
  // task was created.
  const otherCandidates = incomplete.filter(
    (t) => !(t.start_date <= today && t.end_date >= today)
  );
  const withResultsFlags = await Promise.all(
    otherCandidates.map(async (t) => ({
      task: t,
      hasResults: await hasMeaningfulResults(t),
    }))
  );
  const withoutResults = withResultsFlags
    .filter((x) => !x.hasResults)
    .map((x) => x.task)
    .sort((a, b) => b.end_date.localeCompare(a.end_date))
    .slice(0, PICKER_MAX_PER_SECTION);

  return { doing, withoutResults };
}

/** Build the active-task confirmation keyboard. Shown first when an
 *  experiment popup is open in ResearchOS at routing time; gives the
 *  user a one-tap path to "this active task, Lab Notes" or
 *  "this active task, Results" while still allowing a switch to the
 *  full task picker via "Pick another". */
function buildActiveConfirmationKeyboard(
  activeTask: ActiveTask,
  projectName: string,
  task: Pick<Task, "start_date" | "end_date"> | null
): InlineKeyboardMarkup {
  // The 3-line label needs start/end dates; when we don't have a Task
  // record (e.g. shared task we couldn't resolve) we synthesise a single
  // line with just the name. This is a graceful-degrade path, not the
  // common one.
  const labelTask = {
    name: activeTask.name,
    start_date: task?.start_date ?? "",
    end_date: task?.end_date ?? "",
  };
  const datesPresent = !!(task?.start_date && task?.end_date);
  const notesText = datesPresent
    ? buildExperimentLabel(labelTask, projectName, {
        icon: "📝",
        suffix: "— Lab Notes",
      })
    : `📝 ${truncate(activeTask.name, 60)} — Lab Notes`;
  const resultsText = datesPresent
    ? buildExperimentLabel(labelTask, projectName, {
        icon: "📊",
        suffix: "— Results",
      })
    : `📊 ${truncate(activeTask.name, 60)} — Results`;
  return {
    inline_keyboard: [
      [
        {
          text: notesText,
          callback_data: encodeTabCallback(activeTask.id, activeTask.owner, "notes"),
        },
      ],
      [
        {
          text: resultsText,
          callback_data: encodeTabCallback(activeTask.id, activeTask.owner, "results"),
        },
      ],
      [{ text: "→ Pick another experiment…", callback_data: "pick-other" }],
    ],
  };
}

/** Build the full task-picker keyboard. Two sections (Doing now,
 *  experiments without results yet) plus Inbox. See
 *  `partitionPickerExperiments` for the filter rules. */
function buildDestinationKeyboard(
  doing: Task[],
  withoutResults: Task[],
  projectNames: Map<number, string>
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];
  for (const t of doing) {
    rows.push([
      {
        // The right-pointing triangle marks "active/doing" without a
        // separate header row (Telegram keyboards don't support
        // non-button rows).
        text: buildExperimentLabel(t, projectNames.get(t.project_id) ?? "", {
          icon: "▶︎",
        }),
        callback_data: encodeTaskCallback(t.id, t.owner),
      },
    ]);
  }
  for (const t of withoutResults) {
    rows.push([
      {
        text: buildExperimentLabel(t, projectNames.get(t.project_id) ?? ""),
        callback_data: encodeTaskCallback(t.id, t.owner),
      },
    ]);
  }
  rows.push([{ text: "📥 Inbox", callback_data: "inbox" }]);
  return { inline_keyboard: rows };
}

/** Build the sub-tab picker keyboard. Shown after the user picks a task
 *  from the full picker. Plain two-row "Lab Notes" / "Results"; we drop
 *  the 3-line context here since the user just selected the task. */
function buildSubTabKeyboard(
  task: { id: number; owner: string; name: string }
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: "📝 Lab Notes",
          callback_data: encodeSubTabCallback(task.id, task.owner, "notes"),
        },
      ],
      [
        {
          text: "📊 Results",
          callback_data: encodeSubTabCallback(task.id, task.owner, "results"),
        },
      ],
    ],
  };
}

function buildStyleKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "Batch name + auto-number", callback_data: "style:auto" }],
      [{ text: "Name each individually", callback_data: "style:each" }],
    ],
  };
}

/** Encode the chosen task into the 64-byte `callback_data` slot. Telegram
 *  enforces the 64-byte cap; we keep the encoding minimal (`task:<id>:<owner>`)
 *  so usernames up to ~50 chars fit alongside a numeric id. */
function encodeTaskCallback(taskId: number, owner: string): string {
  return `task:${taskId}:${owner}`;
}

/** Active-task confirmation row encoder. Format: `tab:<id>:<owner>:<subTab>`.
 *  Distinct prefix from `task:` so the callback router can dispatch with a
 *  simple prefix check. */
function encodeTabCallback(
  taskId: number,
  owner: string,
  subTab: "notes" | "results"
): string {
  return `tab:${taskId}:${owner}:${subTab}`;
}

/** Sub-tab pick (after the user picked a task from the full picker).
 *  Format: `subtab:<id>:<owner>:<subTab>`. */
function encodeSubTabCallback(
  taskId: number,
  owner: string,
  subTab: "notes" | "results"
): string {
  return `subtab:${taskId}:${owner}:${subTab}`;
}

/** Decode a callback from the task-picker row. Returns the bare task ref
 *  (no sub-tab yet — the user hasn't picked one). */
function decodeTaskCallback(
  data: string,
  experiments: Task[]
): { id: number; owner: string; name: string } | null {
  if (!data.startsWith("task:")) return null;
  const rest = data.slice("task:".length);
  const sep = rest.indexOf(":");
  if (sep < 0) return null;
  const idStr = rest.slice(0, sep);
  const owner = rest.slice(sep + 1);
  const taskId = Number.parseInt(idStr, 10);
  if (!Number.isFinite(taskId) || !owner) return null;
  const match = experiments.find((t) => t.id === taskId && t.owner === owner);
  return {
    id: taskId,
    owner,
    name: match?.name ?? `Experiment ${taskId}`,
  };
}

/** Decode a `tab:` or `subtab:` payload — both encode an experiment id +
 *  owner + sub-tab choice. Returns the parts plus the `kind` of click so
 *  the callback dispatcher knows which state it landed in. */
function decodeSubTabPayload(
  data: string
): {
  kind: "tab" | "subtab";
  taskId: number;
  owner: string;
  subTab: "notes" | "results";
} | null {
  let kind: "tab" | "subtab";
  let rest: string;
  if (data.startsWith("subtab:")) {
    kind = "subtab";
    rest = data.slice("subtab:".length);
  } else if (data.startsWith("tab:")) {
    kind = "tab";
    rest = data.slice("tab:".length);
  } else {
    return null;
  }
  const parts = rest.split(":");
  if (parts.length < 3) return null;
  const idStr = parts[0];
  // owner may contain extra `:` if usernames ever allowed colons; rejoin
  // the middle parts back into the owner, treating the last segment as
  // the subTab tag. In practice usernames don't contain colons, but the
  // rejoin is defensive.
  const subTabTag = parts[parts.length - 1];
  const owner = parts.slice(1, -1).join(":");
  const taskId = Number.parseInt(idStr, 10);
  if (!Number.isFinite(taskId) || !owner) return null;
  if (subTabTag !== "notes" && subTabTag !== "results") return null;
  return { kind, taskId, owner, subTab: subTabTag };
}

/** Lightweight filename sanitizer for user-typed batch names. Filesystem
 *  safety + a hyphen + a number suffix is all we need; full path-traversal
 *  defense isn't load-bearing here because the file-service write API
 *  scopes to the user's folder. */
function sanitizeBatchName(raw: string): string {
  const trimmed = raw.trim().replace(/[\\/]/g, "-").replace(/\s+/g, " ");
  if (!trimmed) return "batch";
  // Keep alphanumerics, spaces, hyphens, underscores, dots.
  return trimmed.replace(/[^\w \-.]/g, "_").slice(0, 60);
}

function clearBatch(chatId: number): void {
  const existing = batches.get(chatId);
  if (!existing) return;
  if (existing.kind === "buffering") clearTimeout(existing.timerId);
  batches.delete(chatId);
}

/** Send a brief notice that we dropped a previous in-flight batch. Best-
 *  effort: a failed send shouldn't block the new batch from starting. */
async function noticeReplaced(ctx: BatchRouteContext): Promise<void> {
  try {
    await sendMessage(
      ctx.botToken,
      ctx.chatId,
      "New album received — restarting batch flow."
    );
  } catch {
    /* swallow */
  }
}

/** Entry point: a photo with media_group_id has arrived and image-router
 *  has already downloaded the blob + read the source metadata. We either
 *  start a new batch buffer or append to an existing one for the same
 *  album. */
export async function routeBatchablePhoto(
  mediaGroupId: string,
  photo: BatchPhoto,
  ctx: BatchRouteContext,
  activeTask: ActiveTask | null
): Promise<void> {
  const existing = batches.get(ctx.chatId);

  if (existing && existing.kind === "buffering" && existing.mediaGroupId === mediaGroupId) {
    // Same album, still buffering: append and reset the debounce timer.
    existing.photos.push(photo);
    clearTimeout(existing.timerId);
    if (existing.photos.length >= BATCH_MAX_PHOTOS) {
      // Commit immediately on cap.
      void commitBuffer(ctx.chatId);
    } else {
      existing.timerId = setTimeout(() => {
        void commitBuffer(ctx.chatId);
      }, BATCH_WINDOW_MS);
    }
    return;
  }

  if (existing && (existing.kind !== "buffering" || existing.mediaGroupId !== mediaGroupId)) {
    // Different album OR same album that already committed past
    // buffering: this is a new batch arriving mid-flow. Drop the prior
    // state with a brief notice so the user knows their previous
    // pending input was swallowed.
    clearBatch(ctx.chatId);
    await noticeReplaced(ctx);
  }

  // New batch.
  const timerId = setTimeout(() => {
    void commitBuffer(ctx.chatId);
  }, BATCH_WINDOW_MS);
  batches.set(ctx.chatId, {
    kind: "buffering",
    chatId: ctx.chatId,
    mediaGroupId,
    ctx,
    photos: [photo],
    activeTaskSnapshot: activeTask,
    timerId,
  });
}

/** Single-photo entry point: a non-album photo arrived. The redesign
 *  (ASK ALWAYS) routes it through the same state machine as an album
 *  batch — just a "batch of one". We bypass buffering (no debounce; no
 *  album to wait for) and jump straight to the active-task confirmation
 *  or full picker prompt.
 *
 *  Synthetic mediaGroupId `single:<messageId>` keeps the state record
 *  shape consistent with album batches while remaining distinct from
 *  any real Telegram media_group_id (those are numeric strings). */
export async function routeSinglePhotoThroughBatch(
  photo: BatchPhoto,
  ctx: BatchRouteContext,
  activeTask: ActiveTask | null
): Promise<void> {
  // Mirror routeBatchablePhoto's "new batch cancels old" behavior so a
  // fresh single photo arriving mid-flow doesn't leave stale state.
  const existing = batches.get(ctx.chatId);
  if (existing) {
    clearBatch(ctx.chatId);
    await noticeReplaced(ctx);
  }
  const mediaGroupId = `single:${photo.messageId}`;
  // Park in `buffering` so commitBuffer can run the same prompt logic
  // as the album path. The timer is a no-op (immediately superseded);
  // we kick commitBuffer right after the state is set.
  const timerId = setTimeout(() => {
    /* no-op — commitBuffer fires directly below */
  }, 0);
  batches.set(ctx.chatId, {
    kind: "buffering",
    chatId: ctx.chatId,
    mediaGroupId,
    ctx,
    photos: [photo],
    activeTaskSnapshot: activeTask,
    timerId,
  });
  await commitBuffer(ctx.chatId);
}

/** Buffer-window expired or photo cap hit. Either prompt the user to
 *  confirm the open active task (when one was open at first-photo time)
 *  or jump straight to the full task picker. Either way, ASK first —
 *  no more silent auto-attach. */
async function commitBuffer(chatId: number): Promise<void> {
  const state = batches.get(chatId);
  if (!state || state.kind !== "buffering") return;
  clearTimeout(state.timerId);

  // activeTask snapshot was taken at the FIRST photo. Any change since
  // doesn't affect this batch.
  if (state.activeTaskSnapshot) {
    batches.set(chatId, {
      kind: "awaiting-active-confirmation",
      chatId,
      mediaGroupId: state.mediaGroupId,
      ctx: state.ctx,
      photos: state.photos,
      activeTask: state.activeTaskSnapshot,
    });
    await sendActiveConfirmationPrompt(
      state.ctx,
      state.photos.length,
      state.activeTaskSnapshot
    );
    return;
  }

  // No activeTask: send the full task picker.
  batches.set(chatId, {
    kind: "awaiting-destination",
    chatId,
    mediaGroupId: state.mediaGroupId,
    ctx: state.ctx,
    photos: state.photos,
  });
  await sendDestinationPrompt(state.ctx, state.photos.length);
}

/** Send the first keyboard for the active-task-open case: confirm "this
 *  active task — Lab Notes / Results" or escape to the full picker. */
async function sendActiveConfirmationPrompt(
  ctx: BatchRouteContext,
  count: number,
  activeTask: ActiveTask
): Promise<void> {
  const projectNames = await loadProjectNameLookup(ctx.username);
  // Look up the Task record so we can show start/end dates on the
  // confirmation rows. Tolerant of failure: we degrade to a single-line
  // label if the task isn't in the experiments list.
  let experiments: Task[];
  try {
    experiments = await experimentsLoader(ctx.username);
  } catch {
    experiments = [];
  }
  const taskRecord = experiments.find(
    (t) => t.id === activeTask.id && t.owner === activeTask.owner
  );
  const projectName = taskRecord
    ? projectNames.get(taskRecord.project_id) ?? ""
    : "";
  const keyboard = buildActiveConfirmationKeyboard(
    activeTask,
    projectName,
    taskRecord ?? null
  );
  const noun = count === 1 ? "photo" : `album of ${count} photos`;
  await sendMessage(
    ctx.botToken,
    ctx.chatId,
    `Got a ${noun}. Where should it go?`,
    { reply_markup: keyboard }
  );
}

/** Send the full task-picker keyboard. Used both when no active task is
 *  open at first-photo time AND when the user clicked "Pick another"
 *  from the active-confirmation step. */
async function sendDestinationPrompt(
  ctx: BatchRouteContext,
  count: number
): Promise<void> {
  let experiments: Task[];
  try {
    experiments = await experimentsLoader(ctx.username);
  } catch {
    experiments = [];
  }
  const projectNames = await loadProjectNameLookup(ctx.username);
  const { doing, withoutResults } = await partitionPickerExperiments(experiments);
  const keyboard = buildDestinationKeyboard(doing, withoutResults, projectNames);
  const noun = count === 1 ? "photo" : `album of ${count} photos`;
  await sendMessage(
    ctx.botToken,
    ctx.chatId,
    `Got a ${noun}. Where should it go?`,
    { reply_markup: keyboard }
  );
}

/** Send the sub-tab picker after the user picked a task from the full
 *  picker. */
async function sendSubTabPrompt(
  ctx: BatchRouteContext,
  task: { id: number; owner: string; name: string }
): Promise<void> {
  await sendMessage(
    ctx.botToken,
    ctx.chatId,
    `"${task.name}" — Lab Notes or Results?`,
    { reply_markup: buildSubTabKeyboard(task) }
  );
}

async function sendStylePrompt(
  ctx: BatchRouteContext,
  count: number,
  destination: BatchDestination
): Promise<void> {
  let target: string;
  if (destination.kind === "task") {
    const tab = destination.subTab === "notes" ? "Lab Notes" : "Results";
    target = `"${destination.name}" (${tab})`;
  } else {
    target = "your Inbox";
  }
  const noun = count === 1 ? "Photo" : `${count} photos`;
  await sendMessage(
    ctx.botToken,
    ctx.chatId,
    `${noun} will go to ${target}. How should ${count === 1 ? "it be" : "they be"} named?`,
    { reply_markup: buildStyleKeyboard() }
  );
}

/** Public entry point: a callback_query landed in the polling loop. We
 *  acknowledge regardless of whether the click is still relevant
 *  (clicks on stale prompts get a soft "Album expired" ack so the
 *  client UI clears its spinner). */
export async function routeBatchCallbackQuery(
  cq: TelegramCallbackQuery,
  ctx: BatchRouteContext
): Promise<void> {
  // Defensive: the bot is only paired with one chat, but a stray
  // callback from a different chat (e.g. the bot was added to a group
  // before we cared to check) should be ignored so its state can't
  // collide with the paired chat's in-flight batch.
  const cqChatId = cq.message?.chat.id;
  if (cqChatId !== undefined && cqChatId !== ctx.chatId) return;
  if (!cq.data) {
    await answerCallbackQuery(ctx.botToken, cq.id);
    return;
  }
  const state = batches.get(ctx.chatId);

  // Active-task quick-pick (`tab:<id>:<owner>:<subTab>`) — only valid
  // from the awaiting-active-confirmation state.
  if (cq.data.startsWith("tab:")) {
    if (!state || state.kind !== "awaiting-active-confirmation") {
      await answerCallbackQuery(ctx.botToken, cq.id, {
        text: "Album expired.",
      });
      return;
    }
    const decoded = decodeSubTabPayload(cq.data);
    if (!decoded || decoded.kind !== "tab") {
      await answerCallbackQuery(ctx.botToken, cq.id, { text: "Bad payload." });
      return;
    }
    await answerCallbackQuery(ctx.botToken, cq.id);
    const destination: BatchDestination = {
      kind: "task",
      taskId: decoded.taskId,
      owner: decoded.owner,
      name: state.activeTask.name,
      subTab: decoded.subTab,
    };
    batches.set(ctx.chatId, {
      kind: "awaiting-style",
      chatId: ctx.chatId,
      mediaGroupId: state.mediaGroupId,
      ctx: state.ctx,
      photos: state.photos,
      destination,
    });
    await sendStylePrompt(state.ctx, state.photos.length, destination);
    return;
  }

  // "Pick another experiment" escape hatch from active-confirmation.
  if (cq.data === "pick-other") {
    if (!state || state.kind !== "awaiting-active-confirmation") {
      await answerCallbackQuery(ctx.botToken, cq.id, {
        text: "Album expired.",
      });
      return;
    }
    await answerCallbackQuery(ctx.botToken, cq.id);
    batches.set(ctx.chatId, {
      kind: "awaiting-destination",
      chatId: ctx.chatId,
      mediaGroupId: state.mediaGroupId,
      ctx: state.ctx,
      photos: state.photos,
    });
    await sendDestinationPrompt(state.ctx, state.photos.length);
    return;
  }

  // Inbox click — short-circuits the sub-tab step (no per-tab folders).
  if (cq.data === "inbox") {
    if (!state || state.kind !== "awaiting-destination") {
      await answerCallbackQuery(ctx.botToken, cq.id, {
        text: "Album expired.",
      });
      return;
    }
    await answerCallbackQuery(ctx.botToken, cq.id);
    const destination: BatchDestination = { kind: "inbox" };
    batches.set(ctx.chatId, {
      kind: "awaiting-style",
      chatId: ctx.chatId,
      mediaGroupId: state.mediaGroupId,
      ctx: state.ctx,
      photos: state.photos,
      destination,
    });
    await sendStylePrompt(state.ctx, state.photos.length, destination);
    return;
  }

  // Task-picker click (`task:<id>:<owner>`) — graduates to the sub-tab
  // picker.
  if (cq.data.startsWith("task:")) {
    if (!state || state.kind !== "awaiting-destination") {
      await answerCallbackQuery(ctx.botToken, cq.id, {
        text: "Album expired.",
      });
      return;
    }
    // Re-load experiments so the bot reply can use the task name even
    // if the keyboard built it from a stale list (the data is on the
    // button regardless).
    let experiments: Task[];
    try {
      experiments = await experimentsLoader(ctx.username);
    } catch {
      experiments = [];
    }
    const task = decodeTaskCallback(cq.data, experiments);
    if (!task) {
      await answerCallbackQuery(ctx.botToken, cq.id, {
        text: "Bad destination.",
      });
      return;
    }
    await answerCallbackQuery(ctx.botToken, cq.id);
    batches.set(ctx.chatId, {
      kind: "awaiting-subtab",
      chatId: ctx.chatId,
      mediaGroupId: state.mediaGroupId,
      ctx: state.ctx,
      photos: state.photos,
      task,
    });
    await sendSubTabPrompt(state.ctx, task);
    return;
  }

  // Sub-tab click (`subtab:<id>:<owner>:<subTab>`).
  if (cq.data.startsWith("subtab:")) {
    if (!state || state.kind !== "awaiting-subtab") {
      await answerCallbackQuery(ctx.botToken, cq.id, {
        text: "Album expired.",
      });
      return;
    }
    const decoded = decodeSubTabPayload(cq.data);
    if (!decoded || decoded.kind !== "subtab") {
      await answerCallbackQuery(ctx.botToken, cq.id, { text: "Bad payload." });
      return;
    }
    await answerCallbackQuery(ctx.botToken, cq.id);
    const destination: BatchDestination = {
      kind: "task",
      taskId: decoded.taskId,
      owner: decoded.owner,
      name: state.task.name,
      subTab: decoded.subTab,
    };
    batches.set(ctx.chatId, {
      kind: "awaiting-style",
      chatId: ctx.chatId,
      mediaGroupId: state.mediaGroupId,
      ctx: state.ctx,
      photos: state.photos,
      destination,
    });
    await sendStylePrompt(state.ctx, state.photos.length, destination);
    return;
  }

  // Style click.
  if (cq.data === "style:auto" || cq.data === "style:each") {
    if (!state || state.kind !== "awaiting-style") {
      await answerCallbackQuery(ctx.botToken, cq.id, {
        text: "Album expired.",
      });
      return;
    }
    await answerCallbackQuery(ctx.botToken, cq.id);
    if (cq.data === "style:auto") {
      batches.set(ctx.chatId, {
        kind: "awaiting-batch-name",
        chatId: ctx.chatId,
        mediaGroupId: state.mediaGroupId,
        ctx: state.ctx,
        photos: state.photos,
        destination: state.destination,
      });
      const namePrompt =
        state.photos.length === 1
          ? "Reply with a name for the photo."
          : `Reply with a batch name. I'll save photos as <name>-1 through <name>-${state.photos.length}.`;
      await sendMessage(ctx.botToken, ctx.chatId, namePrompt);
      return;
    }
    // style:each — write all photos up front with timestamp names,
    // then ask captions one at a time.
    await commitIndividualStyle(state);
    return;
  }

  // Unknown payload — acknowledge to clear the spinner.
  await answerCallbackQuery(ctx.botToken, cq.id);
}

/** Write all photos to disk with timestamp-based names (no user
 *  caption yet); transition to per-photo-caption mode and prompt for
 *  the first one by resending the photo with the prompt as its caption
 *  (so the user sees which image is being asked about). */
async function commitIndividualStyle(state: BatchState & { kind: "awaiting-style" }): Promise<void> {
  const written: { basePath: string; filename: string; fileId: string }[] = [];
  for (const photo of state.photos) {
    const target = await resolveDestinationBase(state.destination, state.ctx.username);
    const stemPrefix =
      state.destination.kind === "task"
        ? `task${state.destination.taskId}-${photo.suggestedStem}`
        : `inbox-${photo.suggestedStem}`;
    const desired = `${timestampStem(stemPrefix)}.${photo.suggestedExt}`;
    const result = await attachImageToTask({
      ownerUsername: state.destination.kind === "task" ? state.destination.owner : state.ctx.username,
      taskId: state.destination.kind === "task" ? state.destination.taskId : 0,
      basePath: target,
      blob: photo.blob,
      suggestedFilename: desired,
      altText: photo.caption ?? "",
    });
    await writeSidecar(target, result.finalFilename, {
      caption: photo.caption ?? undefined,
      source: "telegram",
      receivedAt: new Date(photo.date * 1000).toISOString(),
      telegramMessageId: photo.messageId,
      telegramChatId: state.ctx.chatId,
    });
    written.push({
      basePath: target,
      filename: result.finalFilename,
      fileId: photo.fileId,
    });
  }
  batches.set(state.ctx.chatId, {
    kind: "awaiting-per-photo-captions",
    chatId: state.ctx.chatId,
    mediaGroupId: state.mediaGroupId,
    ctx: state.ctx,
    destination: state.destination,
    written,
    currentRemaining: written.length,
  });
  await sendPhoto(
    state.ctx.botToken,
    state.ctx.chatId,
    written[0].fileId,
    `Saved ${written.length} photos. What's this one? (1 of ${written.length}) Reply with a description, or send /skip to leave it blank.`
  );
}

async function resolveDestinationBase(
  destination: BatchDestination,
  username: string
): Promise<string> {
  if (destination.kind === "inbox") return inboxBase(username);
  // Touch resolveTaskResultsBase to ensure any legacy → per-user migration
  // happens before we write to the per-tab subdir. We don't use the
  // returned path directly — the per-tab helpers always anchor at
  // `taskResultsBase`, which `resolveTaskResultsBase` migrated INTO when
  // it returned. We DO write to the per-tab sub-bucket so the Lab Notes
  // tab's image strip / the Results tab's image strip actually see the
  // file, instead of landing at the legacy outer `Images/`.
  await resolveTaskResultsBase(
    { id: destination.taskId, owner: destination.owner },
    username
  );
  const taskRef = { id: destination.taskId, owner: destination.owner };
  return destination.subTab === "notes"
    ? taskNotesBase(taskRef)
    : taskResultsTabBase(taskRef);
}

/** Public entry point: text from the chat. Returns `true` if this
 *  module consumed the message (because a batch is awaiting input), so
 *  the image-router can short-circuit its normal text-handling flow. */
export async function consumeBatchTextReply(
  text: string,
  ctx: BatchRouteContext
): Promise<boolean> {
  const state = batches.get(ctx.chatId);
  if (!state) return false;

  if (state.kind === "awaiting-batch-name") {
    if (text === "/skip") {
      // Skip means "use the generic timestamp-named flow". We treat
      // /skip here as a request to fall back to individual captions
      // since a batch without any naming hint is just a bunch of
      // timestamped images — and the user still might want per-photo
      // notes. Most natural mapping: write timestamped + skip caption
      // round, return.
      await commitAutoNameSkipped(state);
      return true;
    }
    const name = sanitizeBatchName(text);
    await commitAutoNameBatch(state, name);
    return true;
  }

  if (state.kind === "awaiting-per-photo-captions") {
    const idx = state.written.length - state.currentRemaining;
    const target = state.written[idx];
    if (!target) {
      // Shouldn't happen; defensive clear.
      clearBatch(ctx.chatId);
      return true;
    }
    if (text !== "/skip") {
      await writeSidecar(target.basePath, target.filename, { caption: text });
    }
    const nextRemaining = state.currentRemaining - 1;
    if (nextRemaining <= 0) {
      await sendMessage(
        ctx.botToken,
        ctx.chatId,
        `All ${state.written.length} photos captioned.`
      );
      clearBatch(ctx.chatId);
      return true;
    }
    batches.set(ctx.chatId, { ...state, currentRemaining: nextRemaining });
    const nextIdx = state.written.length - nextRemaining;
    const nextEntry = state.written[nextIdx];
    await sendPhoto(
      ctx.botToken,
      ctx.chatId,
      nextEntry.fileId,
      `What's this one? (${nextIdx + 1} of ${state.written.length}) Reply with a description, or send /skip.`
    );
    return true;
  }

  // Buffering / awaiting-destination / awaiting-style: text is unrelated.
  // Let the caller's existing text-handling flow process it.
  return false;
}

/** auto-number flow: user gave us a batch name. Write all N photos with
 *  `<name>-1.ext` ... `<name>-N.ext`, send the one-line summary, clear. */
async function commitAutoNameBatch(
  state: BatchState & { kind: "awaiting-batch-name" },
  name: string
): Promise<void> {
  const target = await resolveDestinationBase(state.destination, state.ctx.username);
  for (let i = 0; i < state.photos.length; i++) {
    const photo = state.photos[i];
    const desired = `${name}-${i + 1}.${photo.suggestedExt}`;
    const result = await attachImageToTask({
      ownerUsername:
        state.destination.kind === "task"
          ? state.destination.owner
          : state.ctx.username,
      taskId: state.destination.kind === "task" ? state.destination.taskId : 0,
      basePath: target,
      blob: photo.blob,
      suggestedFilename: desired,
      altText: photo.caption ?? name,
    });
    await writeSidecar(target, result.finalFilename, {
      caption: photo.caption ?? name,
      source: "telegram",
      receivedAt: new Date(photo.date * 1000).toISOString(),
      telegramMessageId: photo.messageId,
      telegramChatId: state.ctx.chatId,
    });
  }
  await sendMessage(
    state.ctx.botToken,
    state.ctx.chatId,
    `Saved ${state.photos.length} photos as ${name}-1 through ${name}-${state.photos.length}.`
  );
  clearBatch(state.ctx.chatId);
}

/** /skip in awaiting-batch-name: treat as "fall through to timestamp
 *  names" — write with the same per-task timestamp stems the
 *  single-photo flow uses, then leave the user alone. */
async function commitAutoNameSkipped(
  state: BatchState & { kind: "awaiting-batch-name" }
): Promise<void> {
  const target = await resolveDestinationBase(state.destination, state.ctx.username);
  for (const photo of state.photos) {
    const stemPrefix =
      state.destination.kind === "task"
        ? `task${state.destination.taskId}-${photo.suggestedStem}`
        : `inbox-${photo.suggestedStem}`;
    const desired = `${timestampStem(stemPrefix)}.${photo.suggestedExt}`;
    const result = await attachImageToTask({
      ownerUsername:
        state.destination.kind === "task"
          ? state.destination.owner
          : state.ctx.username,
      taskId: state.destination.kind === "task" ? state.destination.taskId : 0,
      basePath: target,
      blob: photo.blob,
      suggestedFilename: desired,
      altText: photo.caption ?? "",
    });
    await writeSidecar(target, result.finalFilename, {
      caption: photo.caption ?? undefined,
      source: "telegram",
      receivedAt: new Date(photo.date * 1000).toISOString(),
      telegramMessageId: photo.messageId,
      telegramChatId: state.ctx.chatId,
    });
  }
  await sendMessage(
    state.ctx.botToken,
    state.ctx.chatId,
    `Saved ${state.photos.length} photos with auto-generated names.`
  );
  clearBatch(state.ctx.chatId);
}

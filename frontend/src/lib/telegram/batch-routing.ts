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
import { resolveTaskResultsBase } from "@/lib/tasks/results-paths";
import { sidecarPath, type ImageSidecar } from "@/lib/attachments/image-folder";
import { JsonStore } from "@/lib/storage/json-store";
import type { Task } from "@/lib/types";
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

/** Resolved target for a committed batch. Either an experiment or the
 *  user's inbox. */
export type BatchDestination =
  | { kind: "task"; taskId: number; owner: string; name: string }
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
      kind: "awaiting-destination";
      chatId: number;
      mediaGroupId: string;
      ctx: BatchRouteContext;
      photos: BatchPhoto[];
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

/** Build the inline keyboard for the destination prompt. Active "Doing"
 *  experiments float to the top (capped at 5 rows); other incomplete
 *  experiments follow (also capped at 5); Inbox is always last.
 *
 *  Brief calls for ≤5 + ≤5 + Inbox; we apply that bound here so a user
 *  with 40+ open experiments doesn't get an unscrollable keyboard. */
function buildDestinationKeyboard(experiments: Task[]): InlineKeyboardMarkup {
  const today = todayLocalDate();
  const incomplete = experiments.filter(
    (t) => t.task_type === "experiment" && !t.is_complete
  );
  const doing = incomplete
    .filter((t) => t.start_date <= today && t.end_date >= today)
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  const other = incomplete
    .filter((t) => !(t.start_date <= today && t.end_date >= today))
    .sort((a, b) => b.start_date.localeCompare(a.start_date));

  const rows: InlineKeyboardButton[][] = [];
  for (const t of doing.slice(0, 5)) {
    rows.push([
      {
        // The right-pointing triangle marks "active/doing" without a
        // separate header row (Telegram keyboards don't support
        // non-button rows).
        text: `▶︎ ${t.name}`,
        callback_data: encodeTaskCallback(t.id, t.owner),
      },
    ]);
  }
  for (const t of other.slice(0, 5)) {
    rows.push([
      { text: t.name, callback_data: encodeTaskCallback(t.id, t.owner) },
    ]);
  }
  rows.push([{ text: "Inbox", callback_data: "inbox" }]);
  return { inline_keyboard: rows };
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

function decodeDestinationCallback(
  data: string,
  experiments: Task[]
): BatchDestination | null {
  if (data === "inbox") return { kind: "inbox" };
  if (data.startsWith("task:")) {
    const rest = data.slice("task:".length);
    const sep = rest.indexOf(":");
    if (sep < 0) return null;
    const idStr = rest.slice(0, sep);
    const owner = rest.slice(sep + 1);
    const taskId = Number.parseInt(idStr, 10);
    if (!Number.isFinite(taskId) || !owner) return null;
    // Resolve the human-readable name from the same experiments list
    // we built the keyboard from. If the task vanished between the
    // prompt and the click, we still route by id+owner; the name is
    // cosmetic for the bot reply.
    const match = experiments.find(
      (t) => t.id === taskId && t.owner === owner
    );
    return {
      kind: "task",
      taskId,
      owner,
      name: match?.name ?? `Experiment ${taskId}`,
    };
  }
  return null;
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

/** Buffer-window expired or photo cap hit. Decide destination (auto vs
 *  picker) and advance the state machine. */
async function commitBuffer(chatId: number): Promise<void> {
  const state = batches.get(chatId);
  if (!state || state.kind !== "buffering") return;
  clearTimeout(state.timerId);

  // activeTask snapshot was taken at the FIRST photo. Any change since
  // doesn't affect this batch (per brief).
  if (state.activeTaskSnapshot) {
    const destination: BatchDestination = {
      kind: "task",
      taskId: state.activeTaskSnapshot.id,
      owner: state.activeTaskSnapshot.owner,
      name: state.activeTaskSnapshot.name,
    };
    batches.set(chatId, {
      kind: "awaiting-style",
      chatId,
      mediaGroupId: state.mediaGroupId,
      ctx: state.ctx,
      photos: state.photos,
      destination,
    });
    await sendStylePrompt(state.ctx, state.photos.length, destination);
    return;
  }

  // No activeTask: prompt the user for destination.
  batches.set(chatId, {
    kind: "awaiting-destination",
    chatId,
    mediaGroupId: state.mediaGroupId,
    ctx: state.ctx,
    photos: state.photos,
  });
  let experiments: Task[];
  try {
    experiments = await experimentsLoader(state.ctx.username);
  } catch {
    experiments = [];
  }
  const keyboard = buildDestinationKeyboard(experiments);
  await sendMessage(
    state.ctx.botToken,
    state.ctx.chatId,
    `Got an album of ${state.photos.length} photos. Where should they go?`,
    { reply_markup: keyboard }
  );
}

async function sendStylePrompt(
  ctx: BatchRouteContext,
  count: number,
  destination: BatchDestination
): Promise<void> {
  const target =
    destination.kind === "task"
      ? `"${destination.name}"`
      : "your Inbox";
  await sendMessage(
    ctx.botToken,
    ctx.chatId,
    `${count} photos will go to ${target}. How should they be named?`,
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

  // Destination click.
  if (cq.data === "inbox" || cq.data.startsWith("task:")) {
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
    const destination = decodeDestinationCallback(cq.data, experiments);
    if (!destination) {
      await answerCallbackQuery(ctx.botToken, cq.id, {
        text: "Bad destination.",
      });
      return;
    }
    await answerCallbackQuery(ctx.botToken, cq.id);
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
      await sendMessage(
        ctx.botToken,
        ctx.chatId,
        `Reply with a batch name. I'll save photos as <name>-1 through <name>-${state.photos.length}.`
      );
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
  return resolveTaskResultsBase(
    { id: destination.taskId, owner: destination.owner },
    username
  );
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

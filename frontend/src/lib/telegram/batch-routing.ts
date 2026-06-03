/**
 * Batch-photo routing state machine (simplified, picker-free).
 *
 * Telegram tags album photos (the "select multiple, send" gesture) with a
 * shared `media_group_id` and delivers each photo as its own `message`
 * update within ~1 second. Per-photo routing would prompt the user 10
 * separate times. This module buffers media_group_id photos into a single
 * batch, asks at most once for routing, then commits to disk.
 *
 * The Telegram destination PICKER (the "dozens of options" experiment list)
 * was ripped out 2026-06-02 (telegram-simplify). Sorting now lives in the
 * in-app Inbox panel. Inbound photos route exactly two ways:
 *
 *   1. An experiment popup is OPEN in ResearchOS (active task): the bot asks
 *      "Lab Notes or Results?" once per batch, then the naming/caption flow.
 *      A note popup open (and no task) attaches straight to that note.
 *   2. NOTHING is open: the photo(s) land in the Inbox and the bot replies
 *      with a single "Saved to inbox" ack. No buttons, no picker.
 *
 * Lifecycle (per chat):
 *
 *   buffering ── timer (1.2s no arrivals) OR 10 photos cap ──┐
 *                                                            ▼
 *      activeTask?  → awaiting-style (after Lab Notes/Results pick) → commit
 *      activeNote?  → awaiting-style (note destination) → commit
 *      neither?     → commit straight to inbox + "Saved to inbox" ack
 *
 * Tutorial-mode pass-through: the image-router guards entry — when
 * `tutorial_active` is set, batchable photos go through the single-photo
 * tutorial flow individually. Nothing in this module checks the flag.
 *
 * Single-tab assumption: the polling loop in `use-telegram-polling.ts`
 * holds a cross-tab lock, so there's only ever one routing tab. State
 * lives in a module-scope Map keyed by chatId, mirroring the existing
 * `pendingCaptions` pattern in `image-router.ts`.
 */

import { fileService } from "@/lib/file-system/file-service";
import {
  attachImageToNote,
  attachImageToTask,
} from "@/lib/attachments/attach-image";
import {
  resolveTaskResultsBase,
  taskNotesBase,
  taskResultsTabBase,
} from "@/lib/tasks/results-paths";
import { sidecarPath, type ImageSidecar } from "@/lib/attachments/image-folder";
import type { ActiveNote, ActiveTask } from "@/lib/store";
import {
  answerCallbackQuery,
  sendMessage,
  sendPhoto,
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

/** Resolved target for a committed batch. Three shapes:
 *  - `task`: an experiment with a per-tab sub-bucket (Lab Notes vs Results,
 *    both write into the matching `Images/` subdir under that tab's folder).
 *  - `note`: a meeting-style Note. No sub-tabs — a note is a single attach
 *    point. Images land at `users/<owner>/notes/<id>/Images/...` and a
 *    markdown link is appended to the note's latest entry.
 *  - `inbox`: the user's inbox. No sub-tabs; `Images/` lives at the inbox
 *    root. */
export type BatchDestination =
  | {
      kind: "task";
      taskId: number;
      owner: string;
      name: string;
      subTab: "notes" | "results";
    }
  | {
      kind: "note";
      noteId: number;
      owner: string;
      title: string;
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
  /** Telegram media_group_id this photo arrived under, or `null` for a
   *  standalone (non-album) photo. Persisted into the inbox sidecar so the
   *  InboxPanel can group an album that was filed-to-inbox together. */
  mediaGroupId: string | null;
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
      activeNoteSnapshot: ActiveNote | null;
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
      /** Always true here — the only surviving `awaiting-destination` use is
       *  the walkthrough tutorial-mode one-button Inbox prompt. The
       *  production experiment-list picker was removed (telegram-simplify
       *  2026-06-02). */
      tutorialMode: true;
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

/** Encode the chosen sub-tab into the 64-byte `callback_data` slot for the
 *  active-task Lab Notes / Results prompt. Format: `tab:<id>:<owner>:<subTab>`. */
function encodeTabCallback(
  taskId: number,
  owner: string,
  subTab: "notes" | "results"
): string {
  return `tab:${taskId}:${owner}:${subTab}`;
}

/** Decode a `tab:<id>:<owner>:<subTab>` payload from the active-task
 *  confirmation prompt. */
function decodeTabPayload(
  data: string
): { taskId: number; owner: string; subTab: "notes" | "results" } | null {
  if (!data.startsWith("tab:")) return null;
  const rest = data.slice("tab:".length);
  const parts = rest.split(":");
  if (parts.length < 3) return null;
  const idStr = parts[0];
  // owner may (defensively) contain extra `:`; the last segment is the
  // subTab tag, the middle rejoins into the owner.
  const subTabTag = parts[parts.length - 1];
  const owner = parts.slice(1, -1).join(":");
  const taskId = Number.parseInt(idStr, 10);
  if (!Number.isFinite(taskId) || !owner) return null;
  if (subTabTag !== "notes" && subTabTag !== "results") return null;
  return { taskId, owner, subTab: subTabTag };
}

/** Build the active-task confirmation prompt — two buttons: this task's Lab
 *  Notes or Results. Shown when an experiment popup is open in ResearchOS at
 *  routing time. The "Pick another experiment" escape to the full picker was
 *  removed with the picker rip (telegram-simplify 2026-06-02): photos that
 *  shouldn't go to the open experiment go to nothing-open inbox routing
 *  instead, and get sorted from the Inbox panel. */
function buildActiveConfirmationPrompt(activeTask: ActiveTask): {
  body: string;
  keyboard: InlineKeyboardMarkup;
} {
  const body =
    `A) ${activeTask.name} — Lab Notes\n` +
    `B) ${activeTask.name} — Results`;
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      [
        {
          text: "A",
          callback_data: encodeTabCallback(activeTask.id, activeTask.owner, "notes"),
        },
        {
          text: "B",
          callback_data: encodeTabCallback(activeTask.id, activeTask.owner, "results"),
        },
      ],
    ],
  };
  return { body, keyboard };
}

function buildStyleKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "Batch name + auto-number", callback_data: "style:auto" }],
      [{ text: "Name each individually", callback_data: "style:each" }],
    ],
  };
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
 *  album.
 *
 *  Both `activeTask` and `activeNote` are snapshotted at the FIRST photo of
 *  a batch. Either / both / neither can be set; the commit phase routes
 *  accordingly (task → Lab Notes/Results prompt; note → attach; neither →
 *  straight to inbox). */
export async function routeBatchablePhoto(
  mediaGroupId: string,
  photo: BatchPhoto,
  ctx: BatchRouteContext,
  activeTask: ActiveTask | null,
  activeNote: ActiveNote | null = null,
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
    activeNoteSnapshot: activeNote,
    timerId,
  });
}

/** Single-photo entry point: a non-album photo arrived. Routes it through
 *  the same state machine as an album batch — just a "batch of one". We
 *  bypass buffering (no debounce; no album to wait for) and jump straight
 *  to the commit decision (task prompt, note attach, or inbox ack).
 *
 *  Synthetic mediaGroupId `single:<messageId>` keeps the state record
 *  shape consistent with album batches while remaining distinct from
 *  any real Telegram media_group_id (those are numeric strings). */
export async function routeSinglePhotoThroughBatch(
  photo: BatchPhoto,
  ctx: BatchRouteContext,
  activeTask: ActiveTask | null,
  activeNote: ActiveNote | null = null,
): Promise<void> {
  // Mirror routeBatchablePhoto's "new batch cancels old" behavior so a
  // fresh single photo arriving mid-flow doesn't leave stale state.
  const existing = batches.get(ctx.chatId);
  if (existing) {
    clearBatch(ctx.chatId);
    await noticeReplaced(ctx);
  }
  const mediaGroupId = `single:${photo.messageId}`;
  // Park in `buffering` so commitBuffer can run the same routing logic
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
    activeNoteSnapshot: activeNote,
    timerId,
  });
  await commitBuffer(ctx.chatId);
}

/** Tutorial-mode entry: a single photo arrived while the user is in the
 *  v4 walkthrough's Telegram setup beat (`tutorial_active: true`,
 *  `active_step: "first-photo"` in `_telegram_tutorial.json`). Shows a
 *  one-button Inbox prompt with explanatory copy and commits straight to
 *  the inbox on click (with a `tutorial_test` sidecar marker for
 *  post-tutorial cleanup). Skips the style + caption prompts.
 *
 *  Why we still PROMPT instead of silent-auto-saving: Grant's UX call —
 *  the user needs to see the bot ask "where should this go?" so they learn
 *  the model. The simplification is the single button.
 *
 *  The full routing comes back the moment the user advances past this tour
 *  beat (tutorial sidecar flips off). */
export async function routeSinglePhotoTutorialMode(
  photo: BatchPhoto,
  ctx: BatchRouteContext,
): Promise<void> {
  // Same "new batch cancels old" guard as the non-tutorial entry, so a
  // photo arriving while a stale batch sits in awaiting-* state doesn't
  // confuse the callback dispatcher.
  const existing = batches.get(ctx.chatId);
  if (existing) {
    clearBatch(ctx.chatId);
    await noticeReplaced(ctx);
  }
  const mediaGroupId = `tutorial:${photo.messageId}`;
  batches.set(ctx.chatId, {
    kind: "awaiting-destination",
    chatId: ctx.chatId,
    mediaGroupId,
    ctx,
    photos: [photo],
    tutorialMode: true,
  });
  await sendTutorialDestinationPrompt(ctx);
}

/** Tutorial-mode picker copy. Two short sentences (Grant's wiki voice
 *  rule: concept-first, plus the heads-up about the post-tutorial
 *  default). No em-dashes; no emoji in the prose. */
const TUTORIAL_DESTINATION_PROMPT =
  "Got a photo. While you're getting set up, I'll keep things simple and drop it in your Inbox.\n\n" +
  "Later, when you have an experiment open or active, I'll ask if you want to attach it there instead.";

async function sendTutorialDestinationPrompt(
  ctx: BatchRouteContext,
): Promise<void> {
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [[{ text: "Place in Inbox", callback_data: "inbox" }]],
  };
  await sendMessage(ctx.botToken, ctx.chatId, TUTORIAL_DESTINATION_PROMPT, {
    reply_markup: keyboard,
  });
}

/** Re-export for tests + any in-app surface that wants to mirror the
 *  exact bot text without drift. */
export { TUTORIAL_DESTINATION_PROMPT };

/** Buffer-window expired or photo cap hit. Three exits:
 *   - active task open → ask "Lab Notes or Results?"
 *   - only a note open → attach straight to that note (single style prompt)
 *   - nothing open → commit the batch to the Inbox and send one ack
 *     ("Saved to inbox"). No buttons, no picker. */
async function commitBuffer(chatId: number): Promise<void> {
  const state = batches.get(chatId);
  if (!state || state.kind !== "buffering") return;
  clearTimeout(state.timerId);

  // activeTask + activeNote snapshots were taken at the FIRST photo. Any
  // change since doesn't affect this batch. Task wins over note when both
  // are open (the experiment is the primary surface).
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

  if (state.activeNoteSnapshot) {
    // Note has no sub-tabs — a single attach point. Go straight to the
    // naming/caption style prompt with the note destination resolved.
    const destination: BatchDestination = {
      kind: "note",
      noteId: state.activeNoteSnapshot.id,
      owner: state.activeNoteSnapshot.owner,
      title: state.activeNoteSnapshot.title,
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

  // Nothing open: straight to the Inbox with a single ack. No prompt.
  await commitInbox(state);
}

/** Send the active-task Lab Notes / Results prompt. */
async function sendActiveConfirmationPrompt(
  ctx: BatchRouteContext,
  count: number,
  activeTask: ActiveTask
): Promise<void> {
  const { body, keyboard } = buildActiveConfirmationPrompt(activeTask);
  const noun = count === 1 ? "photo" : `album of ${count} photos`;
  await sendMessage(
    ctx.botToken,
    ctx.chatId,
    `Got a ${noun}. Where should it go?\n\n${body}`,
    { reply_markup: keyboard }
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
  } else if (destination.kind === "note") {
    target = `note "${destination.title}"`;
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
 *  acknowledge regardless of whether the click is still relevant (clicks on
 *  stale prompts get a soft "Album expired" ack so the client UI clears its
 *  spinner). Surviving payloads: `tab:` (active-task Lab Notes/Results),
 *  `inbox` (tutorial one-button), `style:auto` / `style:each`. */
export async function routeBatchCallbackQuery(
  cq: TelegramCallbackQuery,
  ctx: BatchRouteContext
): Promise<void> {
  // Defensive: the bot is only paired with one chat, but a stray callback
  // from a different chat should be ignored so its state can't collide with
  // the paired chat's in-flight batch.
  const cqChatId = cq.message?.chat.id;
  if (cqChatId !== undefined && cqChatId !== ctx.chatId) return;
  if (!cq.data) {
    await answerCallbackQuery(ctx.botToken, cq.id);
    return;
  }
  const state = batches.get(ctx.chatId);

  // Active-task Lab Notes / Results click (`tab:<id>:<owner>:<subTab>`).
  if (cq.data.startsWith("tab:")) {
    if (!state || state.kind !== "awaiting-active-confirmation") {
      await answerCallbackQuery(ctx.botToken, cq.id, { text: "Album expired." });
      return;
    }
    const decoded = decodeTabPayload(cq.data);
    if (!decoded) {
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

  // Tutorial one-button Inbox click — terminal commit, no style prompt.
  if (cq.data === "inbox") {
    if (!state || state.kind !== "awaiting-destination" || !state.tutorialMode) {
      await answerCallbackQuery(ctx.botToken, cq.id, { text: "Album expired." });
      return;
    }
    await answerCallbackQuery(ctx.botToken, cq.id);
    await commitTutorialInbox(state);
    return;
  }

  // Style click.
  if (cq.data === "style:auto" || cq.data === "style:each") {
    if (!state || state.kind !== "awaiting-style") {
      await answerCallbackQuery(ctx.botToken, cq.id, { text: "Album expired." });
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

/** Nothing-open terminal commit. Write every buffered photo to the Inbox
 *  with timestamp filenames + the Telegram media_group_id sidecar (so the
 *  InboxPanel can group an album that arrived together), then send a single
 *  "Saved to inbox" ack. No style / caption round — sorting happens in the
 *  in-app Inbox panel. */
async function commitInbox(
  state: BatchState & { kind: "buffering" },
): Promise<void> {
  const target = inboxBase(state.ctx.username);
  for (const photo of state.photos) {
    const desired = `${timestampStem(`inbox-${photo.suggestedStem}`)}.${photo.suggestedExt}`;
    const result = await attachImageToTask({
      ownerUsername: state.ctx.username,
      taskId: 0,
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
      // Album-grouping key for the InboxPanel. Null for standalone photos;
      // a numeric string for real Telegram albums.
      telegramMediaGroupId: photo.mediaGroupId ?? undefined,
    });
  }
  clearBatch(state.ctx.chatId);
  const count = state.photos.length;
  const ack =
    count === 1
      ? "Saved to inbox."
      : `Saved ${count} photos to inbox.`;
  await sendMessage(state.ctx.botToken, state.ctx.chatId, ack);
}

/** Tutorial-mode terminal commit. The user clicked "Place in Inbox" from
 *  the simplified one-button prompt; write the single photo to inbox with a
 *  `tutorial_test: true` sidecar marker (so the post-tutorial cleanup pass
 *  in `tutorial-cleanup.ts` picks it up). */
async function commitTutorialInbox(
  state: BatchState & { kind: "awaiting-destination" },
): Promise<void> {
  const photo = state.photos[0];
  if (!photo) {
    clearBatch(state.ctx.chatId);
    return;
  }
  const target = inboxBase(state.ctx.username);
  const desired = `${timestampStem(`inbox-${photo.suggestedStem}`)}.${photo.suggestedExt}`;
  const result = await attachImageToTask({
    ownerUsername: state.ctx.username,
    taskId: 0,
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
    telegramMediaGroupId: photo.mediaGroupId ?? undefined,
    // Tutorial-cleanup marker. tutorial-cleanup.ts scans the inbox for
    // sidecars with this flag and deletes the file + sidecar on tour-end.
    tutorial_test: true,
  });
  clearBatch(state.ctx.chatId);
  await sendMessage(
    state.ctx.botToken,
    state.ctx.chatId,
    "Got it. The photo is in your Inbox in ResearchOS. Head back to the tour to see it.",
  );
}

/** Write all photos to disk with timestamp-based names (no user
 *  caption yet); transition to per-photo-caption mode and prompt for
 *  the first one by resending the photo with the prompt as its caption
 *  (so the user sees which image is being asked about). */
async function commitIndividualStyle(state: BatchState & { kind: "awaiting-style" }): Promise<void> {
  const written: { basePath: string; filename: string; fileId: string }[] = [];
  for (const photo of state.photos) {
    const desired = `${timestampStem(stemPrefixFor(state.destination, photo.suggestedStem))}.${photo.suggestedExt}`;
    const { basePath, finalFilename } = await attachOnePhoto(
      state.destination,
      photo,
      desired,
      photo.caption ?? "",
      state.ctx,
    );
    await writeSidecar(basePath, finalFilename, {
      caption: photo.caption ?? undefined,
      source: "telegram",
      receivedAt: new Date(photo.date * 1000).toISOString(),
      telegramMessageId: photo.messageId,
      telegramChatId: state.ctx.chatId,
    });
    written.push({
      basePath,
      filename: finalFilename,
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
  if (destination.kind === "note") {
    return `users/${destination.owner}/notes/${destination.noteId}`;
  }
  // Touch resolveTaskResultsBase to ensure any legacy → per-user migration
  // happens before we write to the per-tab subdir. We don't use the
  // returned path directly — the per-tab helpers always anchor at
  // `taskResultsBase`, which `resolveTaskResultsBase` migrated INTO when it
  // returned. We DO write to the per-tab sub-bucket so the Lab Notes tab's
  // image strip / the Results tab's image strip actually see the file,
  // instead of landing at the legacy outer `Images/`.
  await resolveTaskResultsBase(
    { id: destination.taskId, owner: destination.owner },
    username
  );
  const taskRef = { id: destination.taskId, owner: destination.owner };
  return destination.subTab === "notes"
    ? taskNotesBase(taskRef)
    : taskResultsTabBase(taskRef);
}

/** Single-photo commit helper used by every style flow (auto-name, skip,
 *  per-photo-caption). Dispatches on `destination.kind`:
 *   - "task" / "inbox" → `attachImageToTask` with a basePath override
 *   - "note" → `attachImageToNote`, which also appends the markdown link
 *
 *  Returns the resolved on-disk basePath + final filename so the caller
 *  can write the sidecar. */
async function attachOnePhoto(
  destination: BatchDestination,
  photo: BatchPhoto,
  desired: string,
  altText: string,
  ctx: BatchRouteContext,
): Promise<{ basePath: string; finalFilename: string }> {
  if (destination.kind === "note") {
    const result = await attachImageToNote({
      ownerUsername: destination.owner,
      noteId: destination.noteId,
      blob: photo.blob,
      suggestedFilename: desired,
      altText,
    });
    return {
      basePath: `users/${destination.owner}/notes/${destination.noteId}`,
      finalFilename: result.finalFilename,
    };
  }
  const target = await resolveDestinationBase(destination, ctx.username);
  const result = await attachImageToTask({
    ownerUsername:
      destination.kind === "task" ? destination.owner : ctx.username,
    taskId: destination.kind === "task" ? destination.taskId : 0,
    basePath: target,
    blob: photo.blob,
    suggestedFilename: desired,
    altText,
  });
  return { basePath: target, finalFilename: result.finalFilename };
}

function stemPrefixFor(
  destination: BatchDestination,
  photoStem: string,
): string {
  if (destination.kind === "task") {
    return `task${destination.taskId}-${photoStem}`;
  }
  if (destination.kind === "note") {
    return `note${destination.noteId}-${photoStem}`;
  }
  return `inbox-${photoStem}`;
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
      // Skip means "use the generic timestamp-named flow".
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
  for (let i = 0; i < state.photos.length; i++) {
    const photo = state.photos[i];
    const desired = `${name}-${i + 1}.${photo.suggestedExt}`;
    const { basePath, finalFilename } = await attachOnePhoto(
      state.destination,
      photo,
      desired,
      name,
      state.ctx,
    );
    // Caption = the batch name (the thing the user TYPED). Telegram only
    // attaches per-photo caption to the first photo of an album, so
    // `photo.caption ?? name` would leave a single anomalous caption on
    // photo 0 and the batch name on the rest — confusing. Batch name on
    // every photo keeps the album coherent; the per-photo index is already
    // preserved in the filename.
    await writeSidecar(basePath, finalFilename, {
      caption: name,
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
 *  names" — write with the same per-task timestamp stems the single-photo
 *  flow uses, then leave the user alone. */
async function commitAutoNameSkipped(
  state: BatchState & { kind: "awaiting-batch-name" }
): Promise<void> {
  for (const photo of state.photos) {
    const desired = `${timestampStem(stemPrefixFor(state.destination, photo.suggestedStem))}.${photo.suggestedExt}`;
    const { basePath, finalFilename } = await attachOnePhoto(
      state.destination,
      photo,
      desired,
      photo.caption ?? "",
      state.ctx,
    );
    await writeSidecar(basePath, finalFilename, {
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

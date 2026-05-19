import { fileService } from "@/lib/file-system/file-service";
import { attachImageToTask } from "@/lib/attachments/attach-image";
import { resolveTaskResultsBase } from "@/lib/tasks/results-paths";
import { sidecarPath, type ImageSidecar } from "@/lib/attachments/image-folder";
import { imageEvents } from "@/lib/attachments/image-events";
import { useAppStore } from "@/lib/store";
import {
  downloadFile,
  getFile,
  largestPhoto,
  sendMessage,
  type TelegramMessage,
} from "./telegram-client";
import {
  readTelegramTutorial,
  type TelegramTutorialState,
} from "./tutorial-store";
import { broadcastTutorialSignal } from "./tutorial-signal";
import {
  consumeBatchTextReply,
  routeBatchablePhoto,
  routeSinglePhotoThroughBatch,
  type BatchPhoto,
} from "./batch-routing";

interface PendingCaption {
  basePath: string;
  filename: string;
}

/** chatId to pending image awaiting a caption. Module-scope is fine because
 *  only one tab runs the polling loop at a time (see `use-telegram-polling`). */
const pendingCaptions = new Map<number, PendingCaption>();

interface RouteContext {
  username: string;
  botToken: string;
  chatId: number;
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

function extFromPath(filePath: string, fallback = "jpg"): string {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return fallback;
  const e = filePath.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(e) ? e : fallback;
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
  imageEvents.emitMetadataChanged({ basePath, filename });
}

/** Verbatim copy for `/start`. Explains BOTH branches up-front (the
 *  Phase-1 dual-mode rewrite, decision-locked 2026-05-15). Kept as a
 *  module-level const so the same body can be reused in tests + any
 *  future "show me what the bot says" surfacing without drift. */
const START_REPLY =
  "Hi, I'm your ResearchOS bot. Send me a photo and I'll route it two ways:\n\n" +
  "1. With an experiment popup OPEN in ResearchOS, the photo attaches to that experiment's image strip.\n" +
  "2. With nothing open, the photo lands in your Inbox (badge in the top bar) to file later.\n\n" +
  "After each photo I'll ask for a caption. Reply with a sentence, or send /skip.\n\n" +
  "Type /help any time for this refresher.";

/** Verbatim copy for `/help`. Same dual-mode framing as `/start`,
 *  with the caption / skip lifecycle made explicit. */
const HELP_REPLY =
  "Two routes for inbound photos:\n\n" +
  "1. Experiment popup OPEN in ResearchOS, the photo attaches there.\n" +
  "2. Nothing open, the photo lands in your Inbox (top-bar badge). File from there with \"Move to active\" or right-click \"Send to task...\".\n\n" +
  "Captions: reply to my \"What is this?\" prompt with text, or send /skip to leave a photo without one.";

/** Verbatim reply for `/tutorial`. The bot can't open a tab on the
 *  user's behalf, so the reply is honest about the cross-tab broadcast
 *  reaching only an already-open ResearchOS tab. */
const TUTORIAL_REPLY =
  "Trying to open the tutorial in your ResearchOS tab. If nothing happens, open ResearchOS, then text /tutorial again.";

async function handleTextCommand(text: string, ctx: RouteContext): Promise<boolean> {
  if (text === "/start") {
    await sendMessage(ctx.botToken, ctx.chatId, START_REPLY);
    return true;
  }
  if (text === "/help") {
    await sendMessage(ctx.botToken, ctx.chatId, HELP_REPLY);
    return true;
  }
  if (text === "/tutorial") {
    // Fire-and-forget cross-tab broadcast. No open ResearchOS tab means
    // the signal lands on no listener; the reply text covers that case.
    broadcastTutorialSignal({ type: "trigger-tutorial-modal" });
    await sendMessage(ctx.botToken, ctx.chatId, TUTORIAL_REPLY);
    return true;
  }
  return false;
}

/** Exported for tests + any in-app surface that wants to mirror the
 *  bot's reply text verbatim. */
export { START_REPLY, HELP_REPLY, TUTORIAL_REPLY };

/** Soft in-memory cache for `_telegram_tutorial.json` reads. The polling
 *  loop calls `routeTelegramMessage` on every inbound update; without a
 *  cache, a burst of photos would re-read the sidecar from disk each
 *  time. Cache window is 1 second, which is short enough that a freshly
 *  set tutorial flag (sequencer mounts the first-photo step, the user
 *  immediately texts a photo) is honored within ~1s, and long enough
 *  that a 5-photo burst reads disk once. */
const TUTORIAL_CACHE_TTL_MS = 1000;
interface TutorialCacheEntry {
  fetchedAt: number;
  state: TelegramTutorialState;
}
const tutorialCache = new Map<string, TutorialCacheEntry>();

async function readTutorialCached(
  username: string,
): Promise<TelegramTutorialState> {
  const now = Date.now();
  const hit = tutorialCache.get(username);
  if (hit && now - hit.fetchedAt < TUTORIAL_CACHE_TTL_MS) {
    return hit.state;
  }
  const state = await readTelegramTutorial(username);
  tutorialCache.set(username, { fetchedAt: now, state });
  return state;
}

/** Test-only escape hatch. Vitest reuses the module across tests; without
 *  this the cache holds whatever the last test wrote and pollutes the
 *  next test's read. */
export function _resetTutorialCacheForTests(): void {
  tutorialCache.clear();
}

export async function routeTelegramMessage(
  message: TelegramMessage,
  ctx: RouteContext
): Promise<void> {
  if (message.chat.id !== ctx.chatId) return;

  // Text-only message: either a slash command, a batch-routing prompt
  // reply (batch name or per-photo caption), or a caption reply for the
  // most recent single-photo arrival from this chat.
  if (message.text && !message.photo && !message.document) {
    const text = message.text.trim();
    if (await handleTextCommand(text, ctx)) return;

    // Batch-routing prompts are stricter about what's expected next, so
    // give them first crack. They return `true` when they consumed the
    // text, leaving normal single-photo caption handling for unrelated
    // typing.
    if (await consumeBatchTextReply(text, ctx)) return;

    const pending = pendingCaptions.get(ctx.chatId);
    if (text === "/skip") {
      if (pending) {
        pendingCaptions.delete(ctx.chatId);
        await sendMessage(ctx.botToken, ctx.chatId, "Skipped caption.");
      }
      return;
    }
    if (pending) {
      await writeSidecar(pending.basePath, pending.filename, { caption: text });
      pendingCaptions.delete(ctx.chatId);
      await sendMessage(ctx.botToken, ctx.chatId, "Captioned. 👌");
      return;
    }
    // Unsolicited text — stay quiet.
    return;
  }

  // Photo or image-document.
  let fileId: string | undefined;
  let suggestedStem = "photo";
  let suggestedExt = "jpg";
  if (message.photo?.length) {
    fileId = largestPhoto(message.photo)?.file_id;
  } else if (message.document) {
    const mime = message.document.mime_type ?? "";
    if (!mime.startsWith("image/")) return;
    fileId = message.document.file_id;
    if (message.document.file_name) {
      const dot = message.document.file_name.lastIndexOf(".");
      if (dot > 0) {
        suggestedStem = message.document.file_name.slice(0, dot);
        suggestedExt = message.document.file_name.slice(dot + 1).toLowerCase();
      } else {
        suggestedStem = message.document.file_name;
      }
    }
  }
  if (!fileId) return;

  const fileInfo = await getFile(ctx.botToken, fileId);
  if (!fileInfo.file_path) return;
  const blob = await downloadFile(ctx.botToken, fileInfo.file_path);
  if (!suggestedExt) suggestedExt = extFromPath(fileInfo.file_path);

  const active = useAppStore.getState().activeTask;
  // Read tutorial state once per route; cheap (in-memory cache) and lets
  // both the reply-copy branch and the broadcast branch agree on the
  // same snapshot.
  const tutorial = await readTutorialCached(ctx.username);

  // Album branch: photos sharing a `media_group_id` get buffered into a
  // single batch decision instead of prompting per-photo. Skipped when
  // the tutorial is active so the first-photo signal still fires once
  // per actual photo (the demo sequencer expects per-photo broadcasts;
  // batching would swallow them under the destination prompt).
  if (message.media_group_id && !tutorial.tutorial_active) {
    const batchPhoto: BatchPhoto = {
      messageId: message.message_id,
      date: message.date,
      caption: message.caption ?? null,
      blob,
      suggestedStem,
      suggestedExt,
      fileId,
    };
    await routeBatchablePhoto(message.media_group_id, batchPhoto, ctx, active);
    return;
  }

  // Non-album, non-tutorial: route through the same state machine as a
  // batch-of-one. ASK ALWAYS — even with an active task open in
  // ResearchOS, the bot prompts for destination before saving. This
  // replaces the previous silent auto-attach.
  if (!tutorial.tutorial_active) {
    const batchPhoto: BatchPhoto = {
      messageId: message.message_id,
      date: message.date,
      caption: message.caption ?? null,
      blob,
      suggestedStem,
      suggestedExt,
      fileId,
    };
    await routeSinglePhotoThroughBatch(batchPhoto, ctx, active);
    return;
  }

  // Tutorial-mode pass-through: keep the silent auto-attach path so the
  // demo sequencer's first-photo signal fires reliably on the first
  // photo sent during the guided tour. The user can still text /help
  // to see the same dual-mode framing as the production flow.
  let basePath: string;
  let savedFilename: string;
  let replyHint: string;

  if (active) {
    const resolved = await resolveTaskResultsBase(
      { id: active.id, owner: active.owner },
      ctx.username
    );
    const desired = `${timestampStem(`task${active.id}-${suggestedStem}`)}.${suggestedExt}`;
    const result = await attachImageToTask({
      ownerUsername: active.owner,
      taskId: active.id,
      basePath: resolved,
      blob,
      suggestedFilename: desired,
      altText: message.caption ?? "",
    });
    basePath = resolved;
    savedFilename = result.finalFilename;
    replyHint =
      tutorial.active_step === "first-photo"
        ? `Got it! Saved to Experiment ${active.id}, "${active.name}". Head back to ResearchOS to see it on the experiment.`
        : `Saved to Experiment ${active.id}, "${active.name}".`;
  } else {
    const base = inboxBase(ctx.username);
    const desired = `${timestampStem(`inbox-${suggestedStem}`)}.${suggestedExt}`;
    const result = await attachImageToTask({
      ownerUsername: ctx.username,
      taskId: 0, // unused, basePath override takes precedence
      basePath: base,
      blob,
      suggestedFilename: desired,
      altText: message.caption ?? "",
    });
    basePath = base;
    savedFilename = result.finalFilename;
    replyHint =
      tutorial.active_step === "first-photo"
        ? "Got it! Saved to your Inbox in your real folder. Head back to ResearchOS to see it on the experiment."
        : "No experiment open right now, so I dropped this in your Inbox (top-bar badge). Open it in ResearchOS to file with \"Move to active\" or right-click \"Send to task...\".";
  }

  await writeSidecar(basePath, savedFilename, {
    caption: message.caption,
    source: "telegram",
    receivedAt: new Date(message.date * 1000).toISOString(),
    telegramMessageId: message.message_id,
    telegramChatId: ctx.chatId,
    // Marker for the post-tutorial inbox cleanup pass. Only stamped when
    // the photo flowed through this tutorial pass-through branch (i.e.
    // tutorial.tutorial_active is true at this point — the non-tutorial
    // path returned earlier via routeSinglePhotoThroughBatch / batch).
    // See lib/telegram/tutorial-cleanup.ts.
    tutorial_test: true,
  });

  if (!message.caption) {
    pendingCaptions.set(ctx.chatId, { basePath, filename: savedFilename });
  } else {
    pendingCaptions.delete(ctx.chatId);
  }

  const captionPrompt = message.caption
    ? "Caption captured."
    : "What is this? Reply with a description, or send /skip.";
  try {
    await sendMessage(ctx.botToken, ctx.chatId, `${replyHint} ${captionPrompt}`, {
      reply_to_message_id: message.message_id,
    });
  } catch {
    /* best-effort */
  }

  // Cross-tab broadcast for the guided tour. The tutorial tab listens
  // and advances its sequencer past the first-photo step.
  broadcastTutorialSignal({
    type: "photo-arrived",
    taskId: active ? active.id : null,
    fromInbox: !active,
  });
}

import { fileService } from "@/lib/file-system/file-service";
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
import {
  consumeBatchTextReply,
  routeBatchablePhoto,
  routeSinglePhotoThroughBatch,
  routeSinglePhotoTutorialMode,
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

function extFromPath(filePath: string, fallback = "jpg"): string {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return fallback;
  const e = filePath.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(e) ? e : fallback;
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
  "1. With an experiment OPEN in ResearchOS, I'll ask Lab Notes or Results, then save it to that experiment.\n" +
  "2. With nothing open, the photo goes straight to your Inbox (badge in the top bar) and I'll just say so. Sort it from there in the app.\n\n" +
  "Send several photos at once and I'll handle the whole album together.\n\n" +
  "Type /help any time for this refresher.";

/** Verbatim copy for `/help`. Same dual-mode framing as `/start`,
 *  with the caption / skip lifecycle made explicit. */
const HELP_REPLY =
  "Two routes for inbound photos:\n\n" +
  "1. Experiment OPEN in ResearchOS: I ask Lab Notes or Results, then save it there.\n" +
  "2. Nothing open: the photo goes straight to your Inbox (top-bar badge). Sort it from there with \"Move to active\", right-click \"Send to task...\", or the bulk-assign action.\n\n" +
  "Albums: send several photos at once and I'll keep them together.";

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
    // V3 cross-tab broadcast removed with the V3 rip (Phase B 2026-05-22):
    // the V3 sequencer was the only consumer of tutorial-signal.ts and
    // it is gone. Reply text still works on its own.
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
  // Note popups expose themselves the same way TaskDetailPopup does; the
  // batch router's first prompt disambiguates when both are set.
  const activeNote = useAppStore.getState().activeNote;
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
      mediaGroupId: message.media_group_id,
    };
    await routeBatchablePhoto(message.media_group_id, batchPhoto, ctx, active, activeNote);
    return;
  }

  // Non-album, non-tutorial: route through the same state machine as a
  // batch-of-one. With an experiment open, the bot asks Lab Notes or
  // Results; with only a note open it attaches there; with nothing open
  // the photo goes straight to the Inbox with a single ack (no picker —
  // the experiment-list picker was removed, telegram-simplify 2026-06-02).
  if (!tutorial.tutorial_active) {
    const batchPhoto: BatchPhoto = {
      messageId: message.message_id,
      date: message.date,
      caption: message.caption ?? null,
      blob,
      suggestedStem,
      suggestedExt,
      fileId,
      mediaGroupId: null,
    };
    await routeSinglePhotoThroughBatch(batchPhoto, ctx, active, activeNote);
    return;
  }

  // Tutorial-mode pass-through (v4 walkthrough's Telegram setup beat):
  // route through the one-button Inbox prompt. Grant's UX call
  // (2026-05-27): the user needs to SEE the bot ask "where should this
  // go?" so they learn the routing model, but on their very first send we
  // show only an Inbox button + a two-sentence note. Active task is
  // intentionally ignored here so the tutorial flow is the same whether or
  // not an experiment popup is open in the demo tab. After the user
  // advances past the first-photo beat, `clearTelegramTutorial` flips the
  // sidecar off and the bot returns to its full routing.
  const batchPhoto: BatchPhoto = {
    messageId: message.message_id,
    date: message.date,
    caption: message.caption ?? null,
    blob,
    suggestedStem,
    suggestedExt,
    fileId,
    mediaGroupId: null,
  };
  await routeSinglePhotoTutorialMode(batchPhoto, ctx);
  // V3 cross-tab broadcast removed with the V3 rip (Phase B 2026-05-22):
  // the V3 sequencer was the only consumer; tutorial-signal.ts is gone.
}

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

interface PendingCaption {
  basePath: string;
  filename: string;
}

/** chatId → pending image awaiting a caption. Module-scope is fine because
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

async function handleTextCommand(text: string, ctx: RouteContext): Promise<boolean> {
  if (text === "/start") {
    await sendMessage(
      ctx.botToken,
      ctx.chatId,
      "Already paired. Open an experiment in ResearchOS and send a photo here — it'll appear in that experiment's image strip."
    );
    return true;
  }
  if (text === "/help") {
    await sendMessage(
      ctx.botToken,
      ctx.chatId,
      "Send a photo. While an experiment is open in ResearchOS, the image is linked to that experiment. Reply with a description after each photo, or send /skip to skip the caption."
    );
    return true;
  }
  return false;
}

export async function routeTelegramMessage(
  message: TelegramMessage,
  ctx: RouteContext
): Promise<void> {
  if (message.chat.id !== ctx.chatId) return;

  // Text-only message: either a slash command or a caption reply for the
  // most recent photo from this chat.
  if (message.text && !message.photo && !message.document) {
    const text = message.text.trim();
    if (await handleTextCommand(text, ctx)) return;

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
    replyHint = `Saved to Experiment ${active.id} (${active.name}).`;
  } else {
    const base = inboxBase(ctx.username);
    const desired = `${timestampStem(`inbox-${suggestedStem}`)}.${suggestedExt}`;
    const result = await attachImageToTask({
      ownerUsername: ctx.username,
      taskId: 0, // unused — basePath override takes precedence
      basePath: base,
      blob,
      suggestedFilename: desired,
      altText: message.caption ?? "",
    });
    basePath = base;
    savedFilename = result.finalFilename;
    replyHint = "Saved to your inbox — open an experiment in ResearchOS to file it.";
  }

  await writeSidecar(basePath, savedFilename, {
    caption: message.caption,
    source: "telegram",
    receivedAt: new Date(message.date * 1000).toISOString(),
    telegramMessageId: message.message_id,
    telegramChatId: ctx.chatId,
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
}

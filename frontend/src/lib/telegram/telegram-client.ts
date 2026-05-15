import { useAppStore } from "@/lib/store";

const BASE = "https://api.telegram.org";

export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username: string;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  thumb?: TelegramPhotoSize;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  /** Set by Telegram when the user sends an album (multiple photos as a
   *  single message in the client). Photos sharing this id arrive as
   *  separate Update objects within ~1s, in order. */
  media_group_id?: string;
}

/** Sent when the user clicks an inline-keyboard button. The Bot API
 *  requires us to acknowledge with `answerCallbackQuery` (otherwise the
 *  client shows a spinner until it times out). */
export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  /** The opaque token we set on the button (≤64 bytes). */
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

/** Inline keyboard markup shape. Telegram accepts this verbatim on
 *  `sendMessage` as `reply_markup`. Each inner array is one row. */
export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}
export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_path?: string;
  file_size?: number;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export class TelegramApiError extends Error {
  constructor(
    message: string,
    public code?: number
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

async function tg<T>(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  opts: { signal?: AbortSignal } = {}
): Promise<T> {
  const url = `${BASE}/bot${token}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: opts.signal,
  });
  const data = (await res.json()) as TelegramResponse<T>;
  if (!data.ok || data.result === undefined) {
    throw new TelegramApiError(
      data.description ?? `Telegram method ${method} failed`,
      data.error_code
    );
  }
  return data.result;
}

export async function getMe(token: string): Promise<TelegramBotInfo> {
  return tg<TelegramBotInfo>(token, "getMe");
}

export async function getUpdates(
  token: string,
  opts: { offset?: number; timeout?: number; signal?: AbortSignal } = {}
): Promise<TelegramUpdate[]> {
  return tg<TelegramUpdate[]>(
    token,
    "getUpdates",
    {
      offset: opts.offset,
      timeout: opts.timeout ?? 25,
      // `callback_query` rides the same long-poll so inline-keyboard
      // clicks (the batch-routing destination + style pickers) reach the
      // router with the same end-to-end latency as a text message.
      allowed_updates: ["message", "callback_query"],
    },
    { signal: opts.signal }
  );
}

export async function getFile(token: string, fileId: string): Promise<TelegramFile> {
  return tg<TelegramFile>(token, "getFile", { file_id: fileId });
}

export async function downloadFile(token: string, filePath: string): Promise<Blob> {
  // Offline-mode short-circuits before hitting the proxy. The Telegram polling
  // loop catches this and logs it — the inbox-image preview surfaces it as a
  // failed image. Direct polling against api.telegram.org continues either way.
  if (useAppStore.getState().offlineMode) {
    throw new TelegramApiError("Offline mode is on; Telegram file downloads are blocked.");
  }
  // Telegram's file CDN doesn't send CORS headers, so the browser refuses to
  // fetch it directly. Route through our own /api/telegram-file proxy
  // (Next.js API route, runs server-side) which forwards to Telegram and
  // streams the bytes back. The token rides in a header rather than the URL
  // so it doesn't appear in access logs.
  const url = `/api/telegram-file?path=${encodeURIComponent(filePath)}`;
  const res = await fetch(url, { headers: { "x-telegram-token": token } });
  if (!res.ok) throw new TelegramApiError(`downloadFile failed: ${res.status}`);
  return res.blob();
}

export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  opts: {
    reply_to_message_id?: number;
    /** Optional inline keyboard. Telegram limits 100 buttons total and
     *  64 bytes per `callback_data`; callers should keep keyboards
     *  small enough to scan on a phone (the batch-routing pickers cap
     *  at ~10 rows + Inbox). */
    reply_markup?: InlineKeyboardMarkup;
  } = {}
): Promise<TelegramMessage> {
  return tg<TelegramMessage>(token, "sendMessage", {
    chat_id: chatId,
    text,
    reply_to_message_id: opts.reply_to_message_id,
    reply_markup: opts.reply_markup,
  });
}

/** Resend a photo back to the chat by `file_id`. Used by the batch
 *  per-photo-captions flow so the user sees which image the bot is
 *  asking about — text-only "What is photo 2?" is hard to disambiguate
 *  inside a 5+ photo album. The caller passes the original upload's
 *  file_id (no re-upload cost). */
export async function sendPhoto(
  token: string,
  chatId: number,
  fileId: string,
  caption?: string,
  opts: {
    reply_to_message_id?: number;
    reply_markup?: InlineKeyboardMarkup;
  } = {},
): Promise<TelegramMessage> {
  return tg<TelegramMessage>(token, "sendPhoto", {
    chat_id: chatId,
    photo: fileId,
    ...(caption !== undefined ? { caption } : {}),
    reply_to_message_id: opts.reply_to_message_id,
    reply_markup: opts.reply_markup,
  });
}

/** Acknowledge an inline-keyboard click. Required by the Bot API —
 *  without it the client UI keeps a loading spinner on the tapped
 *  button until the request times out (~30s). Best-effort: errors here
 *  shouldn't block the actual state transition that the click drove. */
export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  opts: { text?: string; show_alert?: boolean } = {}
): Promise<true> {
  return tg<true>(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: opts.text,
    show_alert: opts.show_alert,
  });
}

/** Pick the largest entry from a `photo[]` array (Telegram sends multiple
 *  resolutions; the last is the largest). */
export function largestPhoto(photo: TelegramPhotoSize[]): TelegramPhotoSize | undefined {
  if (!photo.length) return undefined;
  return photo.reduce((largest, current) =>
    (current.file_size ?? 0) > (largest.file_size ?? 0) ? current : largest
  );
}

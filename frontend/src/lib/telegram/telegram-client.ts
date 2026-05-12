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
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
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
      allowed_updates: ["message"],
    },
    { signal: opts.signal }
  );
}

export async function getFile(token: string, fileId: string): Promise<TelegramFile> {
  return tg<TelegramFile>(token, "getFile", { file_id: fileId });
}

export async function downloadFile(token: string, filePath: string): Promise<Blob> {
  const res = await fetch(`${BASE}/file/bot${token}/${filePath}`);
  if (!res.ok) throw new TelegramApiError(`downloadFile failed: ${res.status}`);
  return res.blob();
}

export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  opts: { reply_to_message_id?: number } = {}
): Promise<TelegramMessage> {
  return tg<TelegramMessage>(token, "sendMessage", {
    chat_id: chatId,
    text,
    reply_to_message_id: opts.reply_to_message_id,
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

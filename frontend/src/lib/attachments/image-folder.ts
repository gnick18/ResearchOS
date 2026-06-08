import { fileService } from "@/lib/file-system/file-service";

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".avif",
  ".heic",
  ".heif",
]);

export interface ImageSidecar {
  caption?: string;
  description?: string;
  tags?: string[];
  receivedAt?: string;
  source?: "telegram" | "upload" | "import" | "relay";
  telegramMessageId?: number;
  telegramChatId?: number;
  /** Telegram media_group_id of the album this photo arrived in (a numeric
   *  string), when it landed in the Inbox as part of a multi-photo send.
   *  Additive, no migration: photos saved before this field existed simply
   *  aren't grouped. The InboxPanel groups inbox images that share a value.
   *  DATA-SHAPE addition (telegram-simplify 2026-06-02). */
  telegramMediaGroupId?: string;
  /** True when the photo arrived during the guided tutorial's first-photo
   *  step. Used by `lib/telegram/tutorial-cleanup.ts` to scan the inbox
   *  on tutorial-end and delete leftover test photos. */
  tutorial_test?: boolean;
}

export interface FolderImageEntry {
  /** Filename within the Images/ folder (e.g. `crystal-1.jpg`). */
  name: string;
  /** Sidecar data, if a matching `{name}.json` exists. */
  sidecar?: ImageSidecar;
}

export function hasImageExtension(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

/**
 * List image files inside `${basePath}/Images/`, returning each with its
 * sidecar metadata (if present). Non-image files (PDFs, .DS_Store, dotfiles)
 * and the sidecar `.json` files themselves are filtered out.
 */
export async function listImagesInFolder(basePath: string): Promise<FolderImageEntry[]> {
  const dir = `${basePath}/Images`;
  const all = await fileService.listFiles(dir);
  const images = all.filter((name) => !name.startsWith(".") && hasImageExtension(name));
  const entries: FolderImageEntry[] = [];
  for (const name of images) {
    const sidecar = await fileService.readJson<ImageSidecar>(`${dir}/${name}.json`);
    entries.push({ name, sidecar: sidecar ?? undefined });
  }
  return entries;
}

export function sidecarPath(basePath: string, imageName: string): string {
  return `${basePath}/Images/${imageName}.json`;
}

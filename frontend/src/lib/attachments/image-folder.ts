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
  source?: "upload" | "import" | "relay";
  /** True when the photo arrived during the guided tutorial's first-photo
   *  step. Used to scan the inbox on tutorial-end and delete leftover test
   *  photos. */
  tutorial_test?: boolean;
  /** Legacy Telegram sidecar fields. The Telegram integration was removed;
   *  old sidecars may still carry these. Readers ignore them. */
  telegramMessageId?: number;
  telegramChatId?: number;
  telegramMediaGroupId?: string;
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

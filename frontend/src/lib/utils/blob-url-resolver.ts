import { fileService } from "../file-system/file-service";

interface BlobUrlCache {
  [path: string]: string;
}

export class BlobUrlResolver {
  private cache: BlobUrlCache = {};

  /**
   * Resolve a markdown image src to a file-system path.
   *
   * Canonical convention: `Images/file.png` (and `Files/file.pdf`) are relative
   * to the markdown file's directory (e.g. `results/task-{id}/`). When `basePath`
   * is provided, those are joined; otherwise we fall back to the data root.
   *
   * Legacy `../../Images/{folder}/{file}` references are kept resolvable so
   * un-migrated content still renders during the migration window.
   */
  resolvePath(src: string, basePath?: string, ownerUsername?: string): string {
    if (src.startsWith("../../Images/")) {
      const rest = src.slice("../../Images/".length);
      return ownerUsername ? `users/${ownerUsername}/Images/${rest}` : `Images/${rest}`;
    }
    if (src.startsWith("../../Files/")) {
      const rest = src.slice("../../Files/".length);
      return ownerUsername ? `users/${ownerUsername}/Files/${rest}` : `Files/${rest}`;
    }
    if (src.startsWith("./Images/") || src.startsWith("./Files/")) {
      const rel = src.slice(2);
      return basePath ? `${basePath}/${rel}` : rel;
    }
    if (src.startsWith("Images/") || src.startsWith("Files/")) {
      return basePath ? `${basePath}/${src}` : src;
    }
    if (src.startsWith("./") && basePath) {
      return `${basePath}/${src.slice(2)}`;
    }
    return src;
  }

  isLocalPath(src: string): boolean {
    if (src.startsWith("http://") || src.startsWith("https://")) return false;
    if (src.startsWith("data:")) return false;
    if (src.startsWith("blob:")) return false;
    return true;
  }

  async getBlobUrl(path: string): Promise<string | null> {
    if (this.cache[path]) {
      return this.cache[path];
    }

    const blob = await fileService.readFileAsBlob(path);
    if (!blob) return null;

    const url = URL.createObjectURL(blob);
    this.cache[path] = url;
    return url;
  }

  revokeAll(): void {
    for (const url of Object.values(this.cache)) {
      URL.revokeObjectURL(url);
    }
    this.cache = {};
  }

  revokePath(path: string): void {
    const url = this.cache[path];
    if (url) {
      URL.revokeObjectURL(url);
      delete this.cache[path];
    }
  }

  hasCachedPath(path: string): boolean {
    return path in this.cache;
  }

  getCachedUrl(path: string): string | null {
    return this.cache[path] || null;
  }

  async preloadImages(paths: string[]): Promise<void> {
    await Promise.all(paths.map((path) => this.getBlobUrl(path)));
  }
}

export const blobUrlResolver = new BlobUrlResolver();

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
   *
   * Percent-encoding is decoded first. A markdown image URL with a space must
   * be percent-encoded (`Images/foo%20bar.jpg`) or CommonMark truncates the
   * destination at the space, so the snippet writers emit the encoded form.
   * The on-disk filename is the literal one (`foo bar.jpg`), so we decode here
   * before joining to the base, otherwise the FS read looks for a file named
   * `foo%20bar.jpg` that does not exist. `decodeURI` (not `decodeURIComponent`)
   * leaves the path separators intact and is a no-op for already-literal refs.
   */
  resolvePath(src: string, basePath?: string, ownerUsername?: string): string {
    try {
      src = decodeURI(src);
    } catch {
      // Malformed percent-encoding: fall back to the raw src so a stray `%`
      // in a filename can still resolve as a literal character.
    }
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

/**
 * Build a CommonMark-safe markdown reference path for a file that lives in an
 * `Images/` or `Files/` folder. Percent-encodes each path segment so spaces
 * and other reserved characters survive the CommonMark destination parser:
 * `![cap](Images/foo bar.jpg)` truncates at the space (react-markdown drops
 * the image entirely), while `![cap](Images/foo%20bar.jpg)` parses cleanly and
 * resolves back to the literal `foo bar.jpg` on disk via `resolvePath`'s
 * `decodeURI` step.
 *
 * The prefix (`Images`, `Files`) is left un-encoded since it never contains
 * reserved characters; only the filename segment is encoded. Mirrors the
 * `encodeURIComponent` the FileStrip already applied to `Files/` links.
 */
export function encodeAttachmentRefPath(prefix: "Images" | "Files", filename: string): string {
  return `${prefix}/${encodeURIComponent(filename)}`;
}

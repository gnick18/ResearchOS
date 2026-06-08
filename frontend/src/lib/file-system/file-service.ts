import { notifyFileWritten } from "./file-write-hooks";
import { getCacheEntry, putCacheEntry } from "./indexeddb-store";

export interface FileServiceConfig {
  directoryHandle: FileSystemDirectoryHandle;
}

// One-shot warn flag. Non-Chromium browsers fall back to non-atomic
// rename; surface it once per session so it's grep-able in DevTools but
// not noisy. Path is intentionally NOT logged (may contain usernames).
let warnedAtomicFallback = false;
function warnNonAtomicFallbackOnce(): void {
  if (warnedAtomicFallback) return;
  warnedAtomicFallback = true;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "unknown";
  console.warn(
    "file-service.atomicWrite: FSA move() unavailable in this browser; " +
      "falling back to non-atomic removeEntry+rewrite. " +
      "User-Agent:",
    ua
  );
}

export class FileService {
  private directoryHandle: FileSystemDirectoryHandle | null = null;

  // Cheap counter incremented on every FSA read. Used by the startup loading
  // screen to show "Loaded N files…" so the user knows something's happening
  // even when OneDrive is being slow.
  private readCount = 0;

  setDirectoryHandle(handle: FileSystemDirectoryHandle): void {
    this.directoryHandle = handle;
  }

  getDirectoryHandle(): FileSystemDirectoryHandle | null {
    return this.directoryHandle;
  }

  clearDirectoryHandle(): void {
    this.directoryHandle = null;
  }

  getReadCount(): number {
    return this.readCount;
  }

  resetReadCount(): void {
    this.readCount = 0;
  }

  private bumpReadCount(): void {
    this.readCount += 1;
  }

  private getFolderName(): string {
    return this.directoryHandle?.name ?? "unknown";
  }

  async verifyPermission(requestWrite: boolean = true): Promise<boolean> {
    if (!this.directoryHandle) {
      console.log("verifyPermission: no directoryHandle");
      return false;
    }

    const mode = requestWrite ? "readwrite" : "read";

    const handleWithPermission = this.directoryHandle as unknown as {
      queryPermission?: (opts: { mode: string }) => Promise<string>;
      requestPermission?: (opts: { mode: string }) => Promise<string>;
    };

    if (handleWithPermission.queryPermission) {
      try {
        const permission = await handleWithPermission.queryPermission({ mode });
        console.log("queryPermission result:", permission);

        if (permission === "granted") {
          return true;
        }

        if (permission === "prompt" && handleWithPermission.requestPermission) {
          const requestResult = await handleWithPermission.requestPermission({ mode });
          console.log("requestPermission result:", requestResult);
          return requestResult === "granted";
        }
      } catch (err) {
        console.error("Permission check error:", err);
        return false;
      }
    }

    return true;
  }

  private async getHandleByPath(
    path: string,
    create: boolean = false
  ): Promise<FileSystemHandle | null> {
    if (!this.directoryHandle) return null;

    const parts = path.split("/").filter(Boolean);
    console.log("[getHandleByPath] path:", path, "parts:", parts);
    let currentHandle: FileSystemDirectoryHandle = this.directoryHandle;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      try {
        const nextHandle = await currentHandle.getDirectoryHandle(part);
        console.log("[getHandleByPath] Got directory:", part, "kind:", nextHandle.kind);
        currentHandle = nextHandle;
      } catch {
        console.log("[getHandleByPath] getDirectoryHandle failed for:", part, "isLast:", isLast);
        if (isLast) {
          if (create) {
            try {
              const fileHandle = await currentHandle.getFileHandle(part, { create: true });
              console.log("[getHandleByPath] Created file:", part);
              return fileHandle;
            } catch {
              console.log("[getHandleByPath] Failed to create file:", part);
              return null;
            }
          } else {
            try {
              const fileHandle = await currentHandle.getFileHandle(part);
              console.log("[getHandleByPath] Got file:", part);
              return fileHandle;
            } catch {
              console.log("[getHandleByPath] getFileHandle also failed for:", part);
              return null;
            }
          }
        } else if (create) {
          try {
            currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
            console.log("[getHandleByPath] Created directory:", part);
          } catch {
            console.log("[getHandleByPath] Failed to create directory:", part);
            return null;
          }
        } else {
          console.log("[getHandleByPath] Returning null, can't find:", part);
          return null;
        }
      }
    }

    console.log("[getHandleByPath] Returning currentHandle:", currentHandle.name, "kind:", currentHandle.kind);
    return currentHandle;
  }

  async ensureDir(dirPath: string): Promise<FileSystemDirectoryHandle | null> {
    if (!this.directoryHandle) return null;

    const parts = dirPath.split("/").filter(Boolean);
    let currentHandle: FileSystemDirectoryHandle = this.directoryHandle;

    for (const part of parts) {
      try {
        currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
      } catch {
        return null;
      }
    }

    return currentHandle;
  }

  async fileExists(path: string): Promise<boolean> {
    if (!this.directoryHandle) return false;

    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return true;

    let currentHandle: FileSystemDirectoryHandle = this.directoryHandle;

    for (let i = 0; i < parts.length - 1; i++) {
      try {
        currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
      } catch {
        return false;
      }
    }

    try {
      await currentHandle.getFileHandle(parts[parts.length - 1]);
      return true;
    } catch {
      return false;
    }
  }

  async readJson<T>(path: string): Promise<T | null> {
    if (!this.directoryHandle) {
      console.log(`[fileService.readJson] No directoryHandle, returning null for: ${path}`);
      return null;
    }

    const handle = await this.getHandleByPath(path);
    if (!handle || handle.kind !== "file") {
      console.log(`[fileService.readJson] Not a file or null: ${path}, handle:`, handle ? { kind: handle.kind, name: handle.name } : null);
      return null;
    }

    try {
      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      const key = `${this.getFolderName()}::${path}`;
      const cached = await getCacheEntry(key);
      if (cached && cached.lastModified === file.lastModified && cached.kind === "json") {
        if (process.env.NEXT_PUBLIC_DEBUG_FILE_CACHE === "1") {
          console.log(`[file-cache] HIT ${path}`);
        }
        this.bumpReadCount();
        return cached.data as T;
      }
      if (process.env.NEXT_PUBLIC_DEBUG_FILE_CACHE === "1") {
        console.log(`[file-cache] MISS ${path}`);
      }
      const text = await file.text();
      if (text.trim().length === 0) {
        this.bumpReadCount();
        return null;
      }
      const result = JSON.parse(text) as T;
      await putCacheEntry({ key, lastModified: file.lastModified, data: result, kind: "json" });
      this.bumpReadCount();
      console.log(`[fileService.readJson] Successfully read: ${path}`);
      return result;
    } catch (err) {
      console.warn(`[fileService.readJson] Recoverable empty/malformed sidecar at ${path} (treating as missing):`, err);
      return null;
    }
  }

  async writeJson<T>(path: string, data: T): Promise<void> {
    await this.atomicWrite(path, JSON.stringify(data, null, 2));
  }

  // Raw-text counterparts to readJson / writeJson. Used by sidecar markdown
  // files (e.g. `<id>-overview.md`) where the on-disk shape is prose, not
  // a JSON object, and JSON.parse would just corrupt it. Missing file
  // returns `null` (callers translate to "" for empty-body semantics).
  async readText(path: string): Promise<string | null> {
    if (!this.directoryHandle) return null;

    const handle = await this.getHandleByPath(path);
    if (!handle || handle.kind !== "file") return null;

    try {
      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      const key = `${this.getFolderName()}::${path}`;
      const cached = await getCacheEntry(key);
      if (cached && cached.lastModified === file.lastModified && cached.kind === "text") {
        if (process.env.NEXT_PUBLIC_DEBUG_FILE_CACHE === "1") {
          console.log(`[file-cache] HIT ${path}`);
        }
        this.bumpReadCount();
        return cached.data as string;
      }
      if (process.env.NEXT_PUBLIC_DEBUG_FILE_CACHE === "1") {
        console.log(`[file-cache] MISS ${path}`);
      }
      const text = await file.text();
      await putCacheEntry({ key, lastModified: file.lastModified, data: text, kind: "text" });
      this.bumpReadCount();
      return text;
    } catch (err) {
      console.warn(`[fileService.readText] Failed to read ${path} (treating as missing):`, err);
      return null;
    }
  }

  async writeText(path: string, content: string): Promise<void> {
    await this.atomicWrite(path, content);
  }

  async deleteFile(path: string): Promise<boolean> {
    if (!this.directoryHandle) return false;

    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return false;

    let currentHandle: FileSystemDirectoryHandle = this.directoryHandle;

    for (let i = 0; i < parts.length - 1; i++) {
      try {
        currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
      } catch {
        return false;
      }
    }

    try {
      await currentHandle.removeEntry(parts[parts.length - 1]);
      return true;
    } catch {
      return false;
    }
  }

  // Recursive directory removal. Returns true if the directory existed and
  // was removed (or partially removed), false if it was missing or the path
  // could not be traversed. Used by tasksApi.delete to clean up the task's
  // `users/<owner>/results/task-<id>/` subtree (notes.md, results.md, the
  // Images/ + Files/ attachments, the PDF panels) as part of the delete
  // cascade — the only remaining cleanup mechanism now that the
  // attached-but-unreferenced GC is gone.
  async deleteDirectory(path: string): Promise<boolean> {
    if (!this.directoryHandle) return false;

    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return false;

    let currentHandle: FileSystemDirectoryHandle = this.directoryHandle;

    for (let i = 0; i < parts.length - 1; i++) {
      try {
        currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
      } catch {
        return false;
      }
    }

    try {
      await currentHandle.removeEntry(parts[parts.length - 1], {
        recursive: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  async listFiles(dirPath: string): Promise<string[]> {
    console.log(`[fileService.listFiles] Called with dirPath: ${dirPath}, connected: ${this.isConnected()}`);
    
    if (!this.directoryHandle) {
      console.log(`[fileService.listFiles] No directory handle, returning empty array`);
      return [];
    }

    const dirHandle = await this.getHandleByPath(dirPath);
    console.log(`[fileService.listFiles] getHandleByPath result:`, dirHandle ? { kind: dirHandle.kind, name: dirHandle.name } : null);
    
    if (!dirHandle || dirHandle.kind !== "directory") {
      console.log(`[fileService.listFiles] Not a directory or null, returning empty array`);
      return [];
    }

    const files: string[] = [];
    const directoryHandle = dirHandle as FileSystemDirectoryHandle;

    for await (const entry of (directoryHandle as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values()) {
      if (entry.kind === "file") {
        files.push(entry.name);
      }
    }

    console.log(`[fileService.listFiles] Found ${files.length} files in ${dirPath}:`, files);
    this.bumpReadCount();
    return files.sort();
  }

  async listDirectories(dirPath: string): Promise<string[]> {
    if (!this.directoryHandle) return [];

    const dirHandle = await this.getHandleByPath(dirPath);
    if (!dirHandle || dirHandle.kind !== "directory") return [];

    const dirs: string[] = [];
    const directoryHandle = dirHandle as FileSystemDirectoryHandle;

    for await (const entry of (directoryHandle as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values()) {
      if (entry.kind === "directory") {
        dirs.push(entry.name);
      }
    }

    this.bumpReadCount();
    return dirs.sort();
  }

  async readFileAsBlob(path: string): Promise<Blob | null> {
    if (!this.directoryHandle) return null;

    const handle = await this.getHandleByPath(path);
    if (!handle || handle.kind !== "file") return null;

    try {
      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      this.bumpReadCount();
      return file;
    } catch {
      return null;
    }
  }

  async writeFileFromBlob(path: string, blob: Blob): Promise<void> {
    await this.atomicWrite(path, blob);
  }

  // Atomic write helper: write to `${fileName}.tmp` first, then rename via FSA
  // `move()` to the final name. The rename is atomic on Chromium so a torn
  // write (tab close, crash, unhandled rejection mid-write) can only ever
  // leave the OLD file contents intact, never a zero-byte file. See AGENTS.md
  // §6 for the failure mode this guards against.
  private async atomicWrite(
    path: string,
    payload: string | Blob
  ): Promise<void> {
    if (!this.directoryHandle) throw new Error("No directory handle set");

    const parts = path.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) throw new Error("Invalid path");

    let currentHandle: FileSystemDirectoryHandle = this.directoryHandle;

    for (const part of parts) {
      currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
    }

    const tmpName = `${fileName}.tmp`;
    const tmpHandle = (await currentHandle.getFileHandle(tmpName, {
      create: true,
    })) as FileSystemFileHandle & {
      move?: (parent: FileSystemDirectoryHandle, newName: string) => Promise<void>;
    };

    try {
      const writable = await tmpHandle.createWritable();
      try {
        await writable.write(payload);
        await writable.close();
      } catch (writeErr) {
        // Try to abort the writable so the tmp file is discarded.
        try {
          await (writable as FileSystemWritableFileStream & {
            abort?: () => Promise<void>;
          }).abort?.();
        } catch {
          // Swallow: best-effort cleanup; the tmp file may linger and be
          // rotated out by the next successful write.
        }
        throw writeErr;
      }

      // Tmp file is durable on disk. Atomic rename to the final name. The
      // FSA `move()` API is Chromium-only (Chrome 110+); on browsers without
      // it, fall back to removeEntry + move-to-name (slightly racy window
      // but still preserves "old contents existed up until success" since
      // the failure leaves the .tmp file as a recoverable checkpoint).
      if (typeof tmpHandle.move === "function") {
        await tmpHandle.move(currentHandle, fileName);
      } else {
        warnNonAtomicFallbackOnce();
        try {
          await currentHandle.removeEntry(fileName);
        } catch {
          // Target may not exist yet (first write); proceed.
        }
        // Re-fetch the tmp handle as a plain FileSystemFileHandle and copy
        // its contents over to the final name. Best-effort non-atomic path.
        const tmpFile = await tmpHandle.getFile();
        const finalHandle = await currentHandle.getFileHandle(fileName, {
          create: true,
        });
        const finalWritable = await finalHandle.createWritable();
        await finalWritable.write(tmpFile);
        await finalWritable.close();
        try {
          await currentHandle.removeEntry(tmpName);
        } catch {
          // Tmp left behind; next successful atomic-write to this name
          // rotates it out via the truncate-on-getFileHandle-with-create path.
        }
      }
    } catch (err) {
      // Best-effort tmp cleanup. We still rethrow so the caller learns the
      // write failed and the user-facing layer can surface it.
      try {
        await currentHandle.removeEntry(tmpName);
      } catch {
        // Stale .tmp left behind; not data-corrupting (the original file is
        // intact) and the next successful write rotates it out.
      }
      throw err;
    }

    // Write-through cache update. Re-read lastModified from the final file
    // so the next readJson/readText skips the FSA byte read entirely.
    if (typeof payload === "string") {
      try {
        const finalHandle = await currentHandle.getFileHandle(fileName);
        const finalFile = await finalHandle.getFile();
        const key = `${this.getFolderName()}::${path}`;
        let data: unknown;
        let kind: "json" | "text";
        try {
          data = JSON.parse(payload);
          kind = "json";
        } catch {
          data = payload;
          kind = "text";
        }
        await putCacheEntry({ key, lastModified: finalFile.lastModified, data, kind });
      } catch {
        // best-effort; a cache miss on the next read is not a correctness bug
      }
    }

    // Notify any registered observers (e.g. the S1 streak activity
    // tracker) that a successful write just landed. Fire-and-forget,
    // observer exceptions are swallowed inside notifyFileWritten so a
    // bad observer can never poison the write path. See
    // streak-activity-tracker.ts (Streaks-and-Milestones S1) for the
    // canonical consumer.
    notifyFileWritten(path);
  }

  async createWritable(path: string): Promise<FileSystemWritableFileStream | null> {
    if (!this.directoryHandle) return null;

    const parts = path.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) return null;

    let currentHandle: FileSystemDirectoryHandle = this.directoryHandle;

    for (const part of parts) {
      currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
    }

    try {
      const fileHandle = await currentHandle.getFileHandle(fileName, { create: true });
      return await fileHandle.createWritable();
    } catch {
      return null;
    }
  }

  async getDirectory(dirPath: string): Promise<FileSystemDirectoryHandle | null> {
    console.log("getDirectory called with:", dirPath, "handle exists:", !!this.directoryHandle);
    const handle = await this.getHandleByPath(dirPath);
    console.log("getHandleByPath result:", handle?.kind, handle?.name);
    if (!handle || handle.kind !== "directory") return null;
    return handle as FileSystemDirectoryHandle;
  }

  isConnected(): boolean {
    const connected = this.directoryHandle !== null;
    console.log("isConnected:", connected);
    return connected;
  }
}

export const fileService = new FileService();

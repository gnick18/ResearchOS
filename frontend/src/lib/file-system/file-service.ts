import { notifyFileWritten } from "./file-write-hooks";
import { getCacheEntry, putCacheEntry, deleteCacheEntry, getManifestMtime, setManifestMtime, getBlobCacheEntry, putBlobCacheEntry, getBlobCacheBudget, setBlobCacheBudget, evictBlobCacheUntil } from "./indexeddb-store";

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
  private _manifestWritePending = false;
  private _manifestDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  setDirectoryHandle(handle: FileSystemDirectoryHandle): void {
    this.directoryHandle = handle;
    // Negative + in-flight state is keyed by raw path (not folder-scoped), so
    // it must not leak across a folder switch.
    this.negativeCache.clear();
    this.inFlightReads.clear();
  }

  getDirectoryHandle(): FileSystemDirectoryHandle | null {
    return this.directoryHandle;
  }

  clearDirectoryHandle(): void {
    this.directoryHandle = null;
    this.negativeCache.clear();
    this.inFlightReads.clear();
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

  // ── Negative cache ──────────────────────────────────────────────────────
  // Session-scoped set of file paths that resolved to "missing or empty" on a
  // recent read. Re-reading such a path otherwise re-attempts an FSA
  // getFileHandle lookup that throws NotFound — and on OneDrive a failed
  // lookup can still be a cloud round-trip. The dominant source is image
  // sidecars (`<img>.png.json`, `<img>.png.annot.json`) that usually don't
  // exist yet but are probed on every render. Entries expire after
  // NEGATIVE_TTL_MS so a file created out-of-band (a collaborator's write
  // surfaced via FileSystemObserver) becomes visible without an explicit
  // invalidation; local writes/deletes invalidate synchronously.
  private negativeCache = new Map<string, number>();
  private static readonly NEGATIVE_TTL_MS = 30_000;

  private isKnownMissing(path: string): boolean {
    const expiry = this.negativeCache.get(path);
    if (expiry === undefined) return false;
    if (Date.now() > expiry) {
      this.negativeCache.delete(path);
      return false;
    }
    return true;
  }

  private markMissing(path: string): void {
    this.negativeCache.set(path, Date.now() + FileService.NEGATIVE_TTL_MS);
  }

  private clearMissing(path: string): void {
    this.negativeCache.delete(path);
  }

  // ── In-flight read coalescing ───────────────────────────────────────────
  // With React Query staleTime:0, every component that mounts in one render
  // pass fires its own read for the same file (the log shows the same
  // sequence `.meta.json` read 5-6x back-to-back). Without coalescing each
  // pays a full FSA directory traversal + getFile + IndexedDB get. This
  // returns the SAME in-flight promise to concurrent callers and clears the
  // entry the moment it settles — so it only merges reads that overlap in
  // time and adds zero staleness (a read-after-write still runs fresh).
  // Keyed by "<reader>::<path>" so a JSON read and a blob read of one path
  // don't collide.
  private inFlightReads = new Map<string, Promise<unknown>>();

  private coalesceRead<T>(key: string, run: () => Promise<T>): Promise<T> {
    const existing = this.inFlightReads.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const pending = run().finally(() => {
      this.inFlightReads.delete(key);
    });
    this.inFlightReads.set(key, pending);
    return pending;
  }

  private getFolderName(): string {
    return this.directoryHandle?.name ?? "unknown";
  }

  async verifyPermission(requestWrite: boolean = true): Promise<boolean> {
    if (!this.directoryHandle) return false;

    const mode = requestWrite ? "readwrite" : "read";

    const handleWithPermission = this.directoryHandle as unknown as {
      queryPermission?: (opts: { mode: string }) => Promise<string>;
      requestPermission?: (opts: { mode: string }) => Promise<string>;
    };

    if (handleWithPermission.queryPermission) {
      try {
        const permission = await handleWithPermission.queryPermission({ mode });
        if (permission === "granted") return true;
        if (permission === "prompt" && handleWithPermission.requestPermission) {
          const requestResult = await handleWithPermission.requestPermission({ mode });
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
    let currentHandle: FileSystemDirectoryHandle = this.directoryHandle;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      try {
        const nextHandle = await currentHandle.getDirectoryHandle(part);
        currentHandle = nextHandle;
      } catch {
        if (isLast) {
          if (create) {
            try {
              return await currentHandle.getFileHandle(part, { create: true });
            } catch {
              return null;
            }
          } else {
            try {
              return await currentHandle.getFileHandle(part);
            } catch {
              return null;
            }
          }
        } else if (create) {
          try {
            currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
          } catch {
            return null;
          }
        } else {
          return null;
        }
      }
    }

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
    if (!this.directoryHandle) return null;
    if (this.isKnownMissing(path)) return null;
    return this.coalesceRead(`json::${path}`, () => this.readJsonInner<T>(path));
  }

  private async readJsonInner<T>(path: string): Promise<T | null> {
    const handle = await this.getHandleByPath(path);
    if (!handle || handle.kind !== "file") {
      this.markMissing(path);
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
        this.markMissing(path);
        this.bumpReadCount();
        return null;
      }
      const result = JSON.parse(text) as T;
      await putCacheEntry({ key, lastModified: file.lastModified, data: result, kind: "json" });
      this.bumpReadCount();
      return result;
    } catch (err) {
      console.warn(`[fileService.readJson] Recoverable empty/malformed sidecar at ${path} (treating as missing):`, err);
      this.markMissing(path);
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
    if (this.isKnownMissing(path)) return null;
    return this.coalesceRead(`text::${path}`, () => this.readTextInner(path));
  }

  private async readTextInner(path: string): Promise<string | null> {
    const handle = await this.getHandleByPath(path);
    if (!handle || handle.kind !== "file") {
      this.markMissing(path);
      return null;
    }

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
      this.markMissing(path);
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
      // The file is now genuinely gone: short-circuit future reads and evict
      // any stale positive cache entry so a re-read can't resurrect old bytes.
      this.markMissing(path);
      try {
        await deleteCacheEntry(`${this.getFolderName()}::${path}`);
      } catch {
        // best-effort; a stale positive entry is re-validated by lastModified
      }
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
    if (!this.directoryHandle) return [];

    const dirHandle = await this.getHandleByPath(dirPath);
    if (!dirHandle || dirHandle.kind !== "directory") return [];

    const files: string[] = [];
    const directoryHandle = dirHandle as FileSystemDirectoryHandle;

    for await (const entry of (directoryHandle as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values()) {
      if (entry.kind === "file") {
        files.push(entry.name);
      }
    }

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
    if (this.isKnownMissing(path)) return null;
    return this.coalesceRead(`blob::${path}`, () => this.readFileAsBlobInner(path));
  }

  private async readFileAsBlobInner(path: string): Promise<Blob | null> {
    const handle = await this.getHandleByPath(path);
    if (!handle || handle.kind !== "file") {
      this.markMissing(path);
      return null;
    }

    try {
      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      const key = `${this.getFolderName()}::${path}`;
      const cached = await getBlobCacheEntry(key);

      if (cached && cached.lastModified === file.lastModified) {
        if (process.env.NEXT_PUBLIC_DEBUG_FILE_CACHE === "1") {
          console.log(`[file-cache] BLOB HIT ${path}`);
        }
        this.bumpReadCount();
        return cached.blob;
      }

      if (process.env.NEXT_PUBLIC_DEBUG_FILE_CACHE === "1") {
        console.log(`[file-cache] BLOB MISS ${path}`);
      }

      const blob = new Blob([await file.arrayBuffer()], { type: file.type });
      this.bumpReadCount();

      const MAX_SINGLE_BLOB = 30 * 1024 * 1024;
      if (blob.size <= MAX_SINGLE_BLOB) {
        await this.storeBlobInCache(key, file.lastModified, blob);
      }

      return blob;
    } catch {
      this.markMissing(path);
      return null;
    }
  }

  private async storeBlobInCache(key: string, lastModified: number, blob: Blob): Promise<void> {
    const MAX_TOTAL = 150 * 1024 * 1024;
    const folderName = this.getFolderName();
    const current = await getBlobCacheBudget(folderName);
    const needed = current + blob.size;

    if (needed > MAX_TOTAL) {
      await evictBlobCacheUntil(folderName, needed - MAX_TOTAL);
    }

    await putBlobCacheEntry({
      key,
      lastModified,
      blob,
      size: blob.size,
      cachedAt: Date.now(),
    });
    await setBlobCacheBudget(folderName, Math.min(needed, MAX_TOTAL));
  }

  async writeFileFromBlob(path: string, blob: Blob): Promise<void> {
    await this.atomicWrite(path, blob);

    const MAX_SINGLE_BLOB = 30 * 1024 * 1024;
    if (blob.size <= MAX_SINGLE_BLOB) {
      try {
        const parts = path.split("/").filter(Boolean);
        const fileName = parts[parts.length - 1];
        const parentPath = parts.slice(0, -1).join("/");
        const parentHandle = await this.getDirectory(parentPath);
        if (parentHandle) {
          const finalHandle = await parentHandle.getFileHandle(fileName);
          const finalFile = await finalHandle.getFile();
          const key = `${this.getFolderName()}::${path}`;
          await this.storeBlobInCache(key, finalFile.lastModified, blob);
        }
      } catch {
        // best-effort
      }
    }
  }

  private scheduleManifestTouch(): void {
    if (this._manifestDebounceTimer) clearTimeout(this._manifestDebounceTimer);
    this._manifestDebounceTimer = setTimeout(() => {
      this._manifestDebounceTimer = null;
      this.touchManifest();
    }, 500);
  }

  private touchManifest(): void {
    if (!this.directoryHandle || this._manifestWritePending) return;
    this._manifestWritePending = true;
    this.atomicWrite(
      "_cache_manifest.json",
      JSON.stringify({ lastWrite: Date.now() })
    )
      .catch(() => { /* best-effort */ })
      .finally(() => { this._manifestWritePending = false; });
  }

  private static readonly ENTITY_DIRS = [
    "projects", "tasks", "notes", "methods", "dependencies",
    "goals", "pcr_protocols", "purchase_items", "sequences",
  ] as const;

  private static readonly USER_SINGLETONS = [
    "_counters.json", "_auth.json", "_shared_with_me.json",
    "_notifications.json", "_calendar-feeds.json",
    "_schema_migrations.json", "_shifted-alerts.json",
    "_seen-shift-alerts.json",
  ] as const;

  private static readonly ROOT_SINGLETONS = [
    "_user_metadata.json", "_global_counters.json",
  ] as const;

  async sweepAndInvalidate(knownUsers: string[]): Promise<void> {
    if (!this.directoryHandle) return;
    const folderName = this.getFolderName();

    const checkAndEvict = async (path: string, file: File) => {
      const key = `${folderName}::${path}`;
      const cached = await getCacheEntry(key);
      if (cached && cached.lastModified !== file.lastModified) {
        await deleteCacheEntry(key);
      }
    };

    for (const user of knownUsers) {
      for (const dir of FileService.ENTITY_DIRS) {
        const dirPath = `users/${user}/${dir}`;
        const dirHandle = await this.getDirectory(dirPath);
        if (!dirHandle) continue;
        for await (const entry of (dirHandle as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
          if (entry.kind !== "file") continue;
          try {
            const file = await (entry as FileSystemFileHandle).getFile();
            await checkAndEvict(`${dirPath}/${entry.name}`, file);
          } catch {
            // best-effort; a file that disappeared is fine
          }
        }
      }

      for (const name of FileService.USER_SINGLETONS) {
        const path = `users/${user}/${name}`;
        try {
          const handle = await this.getHandleByPath(path) as FileSystemFileHandle | null;
          if (!handle || handle.kind !== "file") continue;
          const file = await handle.getFile();
          await checkAndEvict(path, file);
        } catch {
          // missing singleton is fine
        }
      }
    }

    for (const name of FileService.ROOT_SINGLETONS) {
      try {
        const handle = await this.getHandleByPath(name) as FileSystemFileHandle | null;
        if (!handle || handle.kind !== "file") continue;
        const file = await handle.getFile();
        await checkAndEvict(name, file);
      } catch {
        // missing file is fine
      }
    }
  }

  async runConnectSweep(knownUsers: string[]): Promise<void> {
    if (!this.directoryHandle) return;
    const folderName = this.getFolderName();

    try {
      const manifestHandle = await this.getHandleByPath("_cache_manifest.json") as FileSystemFileHandle | null;
      if (manifestHandle && manifestHandle.kind === "file") {
        const manifestFile = await manifestHandle.getFile();
        const stored = await getManifestMtime(folderName);
        if (stored !== null && stored === manifestFile.lastModified) {
          if (process.env.NEXT_PUBLIC_DEBUG_FILE_CACHE === "1") {
            console.log("[file-cache] sweep SKIPPED (manifest fast-path)");
          }
          return;
        }
        await this.sweepAndInvalidate(knownUsers);
        await setManifestMtime(folderName, manifestFile.lastModified);
        return;
      }
    } catch {
      // manifest file missing or unreadable — fall through to sweep
    }

    await this.sweepAndInvalidate(knownUsers);
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

    // A successful write means this path is no longer missing/empty — drop any
    // negative-cache entry so the next read doesn't short-circuit to null.
    this.clearMissing(path);

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

    if (!this._manifestWritePending && path !== "_cache_manifest.json") {
      this.scheduleManifestTouch();
    }
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
    const handle = await this.getHandleByPath(dirPath);
    if (!handle || handle.kind !== "directory") return null;
    return handle as FileSystemDirectoryHandle;
  }

  isConnected(): boolean {
    return this.directoryHandle !== null;
  }
}

export const fileService = new FileService();

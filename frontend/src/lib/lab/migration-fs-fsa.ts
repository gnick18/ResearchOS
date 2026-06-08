// Lab-tier Phase 7a: production FSA-backed adapter for MigrationFs.
//
// Backs the migration executor's injectable MigrationFs interface with the
// real app fileService singleton (FileSystemAccess API, browser-only).
//
// The actual button / preview UI and the in-browser executor invocation are a
// later slice. This module is the adapter layer only.
//
// rename() has no native equivalent on fileService, so it is implemented as a
// recursive copy of the source subtree to the destination, followed by
// deletion of the source. The executor calls rename() only to move a whole
// users/<U>/ directory into the trash dir, so the directory branch is the hot
// path; the file branch exists for completeness and unit-test coverage.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { fileService } from "@/lib/file-system/file-service";
import type { MigrationFs, DirEntry } from "./migration-fs";

// ---------------------------------------------------------------------------
// createFsaMigrationFs
// ---------------------------------------------------------------------------

export function createFsaMigrationFs(): MigrationFs {
  // ── private helpers ────────────────────────────────────────────────────

  /**
   * Recursively copy the subtree rooted at `from` (a relative path that
   * resolves to a directory) into `to`. The destination directory is created
   * before any files are written into it.
   */
  async function copyTreeDir(from: string, to: string): Promise<void> {
    await fileService.ensureDir(to);

    const [subDirs, files] = await Promise.all([
      fileService.listDirectories(from),
      fileService.listFiles(from),
    ]);

    await Promise.all([
      ...subDirs.map((name) =>
        copyTreeDir(`${from}/${name}`, `${to}/${name}`)
      ),
      ...files.map(async (name) => {
        // Byte-exact via Blob so binary files (.loro, images, attachments)
        // survive intact. readText/writeText would corrupt them.
        const srcPath = `${from}/${name}`;
        const dstPath = `${to}/${name}`;
        const blob = await fileService.readFileAsBlob(srcPath);
        if (blob === null) {
          throw new Error(
            `migration-fs-fsa: copyTree could not read source file: ${srcPath}`
          );
        }
        await fileService.writeFileFromBlob(dstPath, blob);
      }),
    ]);
  }

  // ── MigrationFs implementation ─────────────────────────────────────────

  const mfs: MigrationFs = {
    async listDir(path: string): Promise<DirEntry[]> {
      const [dirs, files] = await Promise.all([
        fileService.listDirectories(path),
        fileService.listFiles(path),
      ]);
      const entries: DirEntry[] = [
        ...dirs.map((name): DirEntry => ({ name, kind: "dir" })),
        ...files.map((name): DirEntry => ({ name, kind: "file" })),
      ];
      return entries;
    },

    async readFile(path: string): Promise<string> {
      const t = await fileService.readText(path);
      if (t === null) {
        throw new Error(`migration-fs-fsa: file not found: ${path}`);
      }
      return t;
    },

    async writeFile(path: string, content: string): Promise<void> {
      await fileService.writeText(path, content);
    },

    async copyFile(from: string, to: string): Promise<void> {
      // Byte-exact via Blob: preserves binary content (.loro, images, attachments).
      const blob = await fileService.readFileAsBlob(from);
      if (blob === null) {
        throw new Error(`migration-fs-fsa: copyFile source not found: ${from}`);
      }
      await fileService.writeFileFromBlob(to, blob);
    },

    async mkdirp(path: string): Promise<void> {
      await fileService.ensureDir(path);
    },

    async exists(path: string): Promise<boolean> {
      return fileService.fileExists(path);
    },

    /**
     * Move `from` to `to` via recursive copy + delete.
     *
     * Detection strategy: try listDirectories/listFiles on `from`. A
     * non-empty result (or an ensureDir success when readText returns null)
     * indicates a directory. A successful readText indicates a plain file.
     * If both attempts are inconclusive the path is treated as absent and
     * the call is a no-op (consistent with the node adapter's rm --force).
     */
    async rename(from: string, to: string): Promise<void> {
      // Probe whether `from` is a directory by checking for any children.
      // listDirectories / listFiles return [] when the path does not exist
      // OR is not a directory, so we also probe with readText to distinguish
      // a plain file from a truly absent path.
      const [subDirs, files] = await Promise.all([
        fileService.listDirectories(from),
        fileService.listFiles(from),
      ]);

      const isDir = subDirs.length > 0 || files.length > 0;

      if (isDir) {
        // Directory branch (hot path for trash moves).
        await copyTreeDir(from, to);
        await fileService.deleteDirectory(from);
        return;
      }

      // May be an empty directory or a plain file. Try reading as a file
      // (byte-exact via Blob so binary files are not corrupted).
      const fileBlob = await fileService.readFileAsBlob(from);
      if (fileBlob !== null) {
        // Plain file.
        await fileService.writeFileFromBlob(to, fileBlob);
        await fileService.deleteFile(from);
        return;
      }

      // Possibly an empty directory. Attempt to copy it (ensureDir + deleteDirectory).
      // If `from` truly does not exist this is effectively a no-op (ensureDir creates
      // `to` and deleteDirectory on a missing path returns false).
      await fileService.ensureDir(to);
      await fileService.deleteDirectory(from);
    },
  };

  return mfs;
}

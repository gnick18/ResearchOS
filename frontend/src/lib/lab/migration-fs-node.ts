// Lab-tier Phase 7a: Node-fs adapter for MigrationFs.
//
// THIS FILE IS INTENTIONALLY SEPARATED from migration-fs.ts so the app
// bundle NEVER pulls in node:fs/promises. Only test files and the
// browser-free harness import this module.
//
// Usage:
//   import { createNodeMigrationFs } from "./migration-fs-node";
//   const fs = createNodeMigrationFs("/abs/path/to/folder-root");
//
// All MigrationFs paths are RELATIVE to rootAbsPath. The adapter joins them
// internally using node:path.
//
// rename() falls back to recursive-copy + rm if the OS rejects a cross-device
// atomic rename (common when src and dest are on different mount points, though
// in practice the folder root is one device, so the rename should always work).
//
// No emojis, no em-dashes, no mid-sentence colons.

import * as nodefs from "node:fs/promises";
import * as nodepath from "node:path";
import type { MigrationFs, DirEntry } from "./migration-fs";

// ---------------------------------------------------------------------------
// createNodeMigrationFs
// ---------------------------------------------------------------------------

export function createNodeMigrationFs(rootAbsPath: string): MigrationFs {
  /** Resolve a relative migration path to an absolute OS path. */
  function abs(rel: string): string {
    return nodepath.join(rootAbsPath, rel);
  }

  const mfs: MigrationFs = {
    async listDir(path: string): Promise<DirEntry[]> {
      try {
        const entries = await nodefs.readdir(abs(path), { withFileTypes: true });
        return entries.map((e): DirEntry => ({
          name: e.name,
          kind: e.isDirectory() ? "dir" : "file",
        }));
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") return [];
        throw err;
      }
    },

    async readFile(path: string): Promise<string> {
      return nodefs.readFile(abs(path), "utf8");
    },

    async writeFile(path: string, content: string): Promise<void> {
      await nodefs.writeFile(abs(path), content, "utf8");
    },

    async copyFile(from: string, to: string): Promise<void> {
      // Byte-exact: preserves binary content (.loro, images, attachments).
      await nodefs.copyFile(abs(from), abs(to));
    },

    async mkdirp(path: string): Promise<void> {
      await nodefs.mkdir(abs(path), { recursive: true });
    },

    async rename(from: string, to: string): Promise<void> {
      const src = abs(from);
      const dst = abs(to);
      try {
        await nodefs.rename(src, dst);
      } catch (err: unknown) {
        // EXDEV: cross-device rename. Fall back to copy+remove.
        if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
        await copyDirRecursive(src, dst);
        await nodefs.rm(src, { recursive: true, force: true });
      }
    },

    async exists(path: string): Promise<boolean> {
      try {
        await nodefs.access(abs(path));
        return true;
      } catch {
        return false;
      }
    },
  };

  return mfs;
}

// ---------------------------------------------------------------------------
// copyDirRecursive: used only as a rename() fallback above.
// ---------------------------------------------------------------------------

async function copyDirRecursive(src: string, dst: string): Promise<void> {
  await nodefs.mkdir(dst, { recursive: true });
  const entries = await nodefs.readdir(src, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const srcChild = nodepath.join(src, entry.name);
      const dstChild = nodepath.join(dst, entry.name);
      if (entry.isDirectory()) {
        await copyDirRecursive(srcChild, dstChild);
      } else {
        await nodefs.copyFile(srcChild, dstChild);
      }
    }),
  );
}

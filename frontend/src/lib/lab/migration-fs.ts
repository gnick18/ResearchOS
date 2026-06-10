// Lab-tier Phase 7a: injectable file-service interface for the migration executor.
//
// This module defines ONLY the MigrationFs interface. It has zero imports
// from node:fs (or any Node-only module), so it is safe for the app bundle
// (SSR, Turbopack, tree-shaking all work fine).
//
// The Node-fs adapter (createNodeMigrationFs) lives in the sibling file
// migration-fs-node.ts so that only test/harness code ever imports Node APIs.
// The production FSA (FileSystemAccess) adapter is a later slice.
//
// No emojis, no em-dashes, no mid-sentence colons.

// ---------------------------------------------------------------------------
// DirEntry: one item returned by listDir.
// ---------------------------------------------------------------------------

export interface DirEntry {
  name: string;
  kind: "file" | "dir";
}

// ---------------------------------------------------------------------------
// MigrationFs: the injectable file-service interface.
//
// All paths are RELATIVE to the folder root (e.g. "users/alice/tasks/1.json").
// Implementations are responsible for resolving them against their backing
// storage (a real directory, an FSA root handle, an in-memory map, etc.).
// ---------------------------------------------------------------------------

export interface MigrationFs {
  /**
   * List the immediate children of a directory.
   * Returns an empty array when the directory does not exist (never throws
   * ENOENT; callers treat an absent directory as empty).
   */
  listDir(path: string): Promise<DirEntry[]>;

  /**
   * Read a file's content as a UTF-8 string.
   * Throws if the file does not exist.
   */
  readFile(path: string): Promise<string>;

  /**
   * Write content to a file, overwriting any existing content.
   * Parent directories are NOT auto-created; call mkdirp first.
   *
   * NOTE: readFile/writeFile are UTF-8 string ops and MUST NOT be used to copy
   * arbitrary files (they corrupt binary content like .loro CRDT data, images,
   * and attachments). Use copyFile for byte-exact duplication.
   */
  writeFile(path: string, content: string): Promise<void>;

  /**
   * Byte-exact copy of a file, preserving binary content. Parent directories
   * are NOT auto-created; call mkdirp first. Used for bundle extraction and the
   * rename fallback so .loro / image / attachment bytes survive intact.
   */
  copyFile(from: string, to: string): Promise<void>;

  /**
   * Ensure a directory (and all ancestors) exists. Idempotent.
   */
  mkdirp(path: string): Promise<void>;

  /**
   * Move src to dest (for trash: moves users/<U>/ into the trash dir).
   * Implementations that cannot atomically rename across directories should
   * fall back to a recursive copy+remove. Both src and dest paths are
   * relative to the folder root.
   */
  rename(from: string, to: string): Promise<void>;

  /**
   * Return true when the path exists (either file or directory).
   */
  exists(path: string): Promise<boolean>;

  /**
   * Recursively remove a directory (and all contents). Idempotent: removing an
   * absent path is a no-op, never throws ENOENT. Used by the crash-safe resume
   * path to drop a leftover partial source once a COMPLETE trash copy exists.
   */
  removeDir(path: string): Promise<void>;
}

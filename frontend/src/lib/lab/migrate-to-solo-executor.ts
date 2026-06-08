// Lab-tier Phase 7a: migration executor (multiuser folder -> one-folder-one-user).
//
// This module consumes a MigrationPlan produced by planMigrationToSolo() and
// performs the actual file operations over an injectable MigrationFs, so it
// can run in the app (FSA-backed, a later slice) AND in a browser-free
// Node.js harness today.
//
// LOCKED decisions (Grant):
//   - Each non-primary user is EXTRACTED to a portable single-user bundle AND
//     the in-folder original is TRASHED (recoverable, not hard-deleted).
//   - Cross-owner shares are STRIPPED from the primary user's retained data.
//   - The primary user's data is otherwise UNTOUCHED.
//   - Special non-person dirs (public, lab, _no_user_) and files
//     (_global_counters.json, _user_metadata.json) are PRESERVED.
//
// NOTE: the production FSA adapter for MigrationFs is a later slice. This
// chunk delivers the logic + the Node-fs adapter for browser-free verification.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { MigrationFs } from "./migration-fs";
import type { MigrationPlan } from "./migrate-to-solo";

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

export interface MigrationExecOptions {
  fs: MigrationFs;
  plan: MigrationPlan;
  /**
   * Directory (relative to folder root) where portable single-user bundles
   * are written. Each bundle at `${bundlesDir}/<username>/users/<username>/`
   * is a valid connectable single-user folder for that person.
   * Default: "_migration_bundles".
   */
  bundlesDir?: string;
  /**
   * Directory (relative to folder root) where the in-folder originals are
   * moved (trashed, recoverable). Default: "_trash/migrated_users".
   */
  trashDir?: string;
}

export interface ShareStripRecord {
  /** Relative path of the file that was rewritten. */
  file: string;
  /** The usernames that were removed from this file's shared_with / participants fields. */
  removed: string[];
}

export interface MigrationExecResult {
  primaryUser: string;
  /** Usernames that were successfully bundled + trashed. */
  movedUsers: string[];
  /**
   * Map of username -> path of their portable bundle root
   * (e.g. "_migration_bundles/sharron").
   */
  bundlePaths: Record<string, string>;
  /**
   * Map of username -> path of their trashed original
   * (e.g. "_trash/migrated_users/sharron").
   */
  trashPaths: Record<string, string>;
  /**
   * Files in the primary user's tree where cross-owner share references
   * were removed.
   */
  sharesStripped: ShareStripRecord[];
}

// ---------------------------------------------------------------------------
// executeMigrationToSolo: the entry point.
// ---------------------------------------------------------------------------

/**
 * Execute a previously computed MigrationPlan over the given MigrationFs.
 *
 * Steps for each user U in plan.usersToMove:
 *   1. BUNDLE: recursively copy users/<U>/ into ${bundlesDir}/<U>/users/<U>/
 *      so the bundle is a connectable single-user folder for U.
 *   2. TRASH: move users/<U>/ to ${trashDir}/<U>/ (recoverable). Only done
 *      after the bundle copy succeeds.
 *
 * After all users are moved, the primary user's json files are walked to
 * STRIP cross-owner share references (shared_with arrays, shared-notebook
 * participant lists). Only files that actually change are rewritten.
 *
 * Idempotent-ish: if users/<U>/ is already gone (previously migrated), the
 * bundle step is skipped for that user and they are not re-trashed.
 *
 * Preserved (never touched): users/<primary>/ (except share-strip rewrites),
 * and the dirs/files: public, lab, _no_user_, _global_counters.json,
 * _user_metadata.json, and everything outside users/.
 */
export async function executeMigrationToSolo(
  opts: MigrationExecOptions,
): Promise<MigrationExecResult> {
  const {
    fs,
    plan,
    bundlesDir = "_migration_bundles",
    trashDir = "_trash/migrated_users",
  } = opts;

  // No-op fast path: folder is already solo.
  if (plan.alreadySolo) {
    return {
      primaryUser: plan.primaryUser,
      movedUsers: [],
      bundlePaths: {},
      trashPaths: {},
      sharesStripped: [],
    };
  }

  const movedUsers: string[] = [];
  const bundlePaths: Record<string, string> = {};
  const trashPaths: Record<string, string> = {};

  for (const userSummary of plan.usersToMove) {
    const username = userSummary.username;
    const srcPath = joinPath("users", username);

    // Idempotent: if the source directory is already gone, skip gracefully.
    const srcExists = await fs.exists(srcPath);
    if (!srcExists) {
      continue;
    }

    // 1. BUNDLE: copy users/<U>/ -> ${bundlesDir}/<U>/users/<U>/
    //    The bundle root is bundlesDir/<U> so that connecting it gives a valid
    //    single-user folder with users/<U>/ inside.
    const bundleRoot = joinPath(bundlesDir, username);
    const bundleDest = joinPath(bundleRoot, "users", username);
    await copyDirRecursiveMfs(fs, srcPath, bundleDest);
    bundlePaths[username] = bundleRoot;

    // 2. TRASH: move users/<U>/ -> ${trashDir}/<U>/
    //    Done AFTER a successful bundle copy to ensure recoverability.
    const trashDest = joinPath(trashDir, username);
    await fs.mkdirp(trashDir);
    await fs.rename(srcPath, trashDest);
    trashPaths[username] = trashDest;

    movedUsers.push(username);
  }

  // 3. STRIP cross-owner shares from the primary user's retained files.
  const movedUserSet = new Set(movedUsers);
  const sharesStripped = await stripSharesFromPrimary(
    fs,
    plan.primaryUser,
    movedUserSet,
  );

  return {
    primaryUser: plan.primaryUser,
    movedUsers,
    bundlePaths,
    trashPaths,
    sharesStripped,
  };
}

// ---------------------------------------------------------------------------
// copyDirRecursiveMfs: recursive directory copy over MigrationFs primitives.
// ---------------------------------------------------------------------------

/**
 * Recursively copy all files and subdirectories from srcDir to dstDir using
 * MigrationFs primitives (listDir, readFile, writeFile, mkdirp). Both paths
 * are relative to the folder root.
 *
 * Creates dstDir (and all ancestors) before writing. Empty source directories
 * are replicated as empty destination directories.
 */
export async function copyDirRecursiveMfs(
  fs: MigrationFs,
  srcDir: string,
  dstDir: string,
): Promise<void> {
  await fs.mkdirp(dstDir);
  const entries = await fs.listDir(srcDir);

  for (const entry of entries) {
    const srcChild = joinPath(srcDir, entry.name);
    const dstChild = joinPath(dstDir, entry.name);

    if (entry.kind === "dir") {
      await copyDirRecursiveMfs(fs, srcChild, dstChild);
    } else {
      // Byte-exact copy: readFile/writeFile would corrupt binary files
      // (.loro CRDT data, images, attachments) via a UTF-8 round-trip.
      await fs.copyFile(srcChild, dstChild);
    }
  }
}

// ---------------------------------------------------------------------------
// stripSharesFromPrimary: remove moved-user references from the primary's files.
// ---------------------------------------------------------------------------

/**
 * Walk every .json file under users/<primaryUser>/ and remove references to
 * any moved username from:
 *   (a) Any array field named "shared_with". Entries may be plain strings OR
 *       objects with a "username" or "user" field (both forms are handled).
 *   (b) shared_notebooks files: array fields named "participants", "members",
 *       or "usernames". Also nulls out a string "owner" or "sharedBy" field
 *       if it equals a moved username.
 *
 * Only rewrites a file if it actually changed. Skips files that are not valid
 * JSON or that have none of the relevant fields.
 *
 * Returns one ShareStripRecord per modified file.
 */
async function stripSharesFromPrimary(
  fs: MigrationFs,
  primaryUser: string,
  movedUsers: Set<string>,
): Promise<ShareStripRecord[]> {
  if (movedUsers.size === 0) return [];

  const primaryRoot = joinPath("users", primaryUser);
  const records: ShareStripRecord[] = [];
  await walkJsonFiles(fs, primaryRoot, async (relPath) => {
    let raw: string;
    try {
      raw = await fs.readFile(relPath);
    } catch {
      return; // unreadable file: skip
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // not valid JSON: skip
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return; // not an object: skip
    }

    const obj = parsed as Record<string, unknown>;
    const removed: string[] = [];

    // (a) shared_with arrays.
    if (Array.isArray(obj["shared_with"])) {
      const before = obj["shared_with"] as unknown[];
      const after = before.filter((entry) => !isMovedUser(entry, movedUsers));
      if (after.length !== before.length) {
        const removedHere = before
          .filter((e) => isMovedUser(e, movedUsers))
          .map((e) => resolveUsername(e));
        removed.push(...removedHere);
        obj["shared_with"] = after;
      }
    }

    // (b) Shared-notebook participant/member/usernames arrays.
    for (const field of ["participants", "members", "usernames"] as const) {
      if (Array.isArray(obj[field])) {
        const before = obj[field] as unknown[];
        const after = before.filter((entry) => !isMovedUser(entry, movedUsers));
        if (after.length !== before.length) {
          const removedHere = before
            .filter((e) => isMovedUser(e, movedUsers))
            .map((e) => resolveUsername(e));
          removed.push(...removedHere);
          obj[field] = after;
        }
      }
    }

    // (c) Null out owner/sharedBy if they point to a moved user.
    for (const field of ["owner", "sharedBy"] as const) {
      if (typeof obj[field] === "string" && movedUsers.has(obj[field] as string)) {
        removed.push(obj[field] as string);
        obj[field] = null;
      }
    }

    if (removed.length === 0) return; // no changes

    await fs.writeFile(relPath, JSON.stringify(obj, null, 2));
    records.push({ file: relPath, removed });
  });

  return records;
}

// ---------------------------------------------------------------------------
// walkJsonFiles: visit every .json file under a directory recursively.
// ---------------------------------------------------------------------------

async function walkJsonFiles(
  fs: MigrationFs,
  dir: string,
  visitor: (relPath: string) => Promise<void>,
): Promise<void> {
  let entries: Array<{ name: string; kind: "file" | "dir" }>;
  try {
    entries = await fs.listDir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const childPath = joinPath(dir, entry.name);
    if (entry.kind === "dir") {
      await walkJsonFiles(fs, childPath, visitor);
    } else if (entry.name.endsWith(".json")) {
      await visitor(childPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * Join path segments with "/" (used for relative MigrationFs paths).
 * Avoids importing node:path so this file is safe for the browser bundle.
 */
function joinPath(...segments: string[]): string {
  return segments
    .map((s, i) => (i === 0 ? s : s.replace(/^\/+/, "")))
    .join("/")
    .replace(/\/+/g, "/");
}

/**
 * Return true if a shared_with / participants entry refers to a moved user.
 * Handles both plain-string entries and object entries with a "username" or
 * "user" field.
 */
function isMovedUser(entry: unknown, movedUsers: Set<string>): boolean {
  if (typeof entry === "string") return movedUsers.has(entry);
  if (typeof entry === "object" && entry !== null) {
    const obj = entry as Record<string, unknown>;
    if (typeof obj["username"] === "string") return movedUsers.has(obj["username"]);
    if (typeof obj["user"] === "string") return movedUsers.has(obj["user"]);
  }
  return false;
}

/**
 * Extract the username string from a plain-string or object-form entry.
 * Used when building the list of removed usernames for ShareStripRecord.
 */
function resolveUsername(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && entry !== null) {
    const obj = entry as Record<string, unknown>;
    if (typeof obj["username"] === "string") return obj["username"];
    if (typeof obj["user"] === "string") return obj["user"];
  }
  return String(entry);
}

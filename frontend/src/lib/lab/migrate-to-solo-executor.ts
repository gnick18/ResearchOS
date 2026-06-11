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
import {
  SHARE_ARRAY_FIELDS,
  SCALAR_OWNER_FIELDS,
  SHARED_WITH_ME_ARRAYS,
  NOTIFICATION_OWNER_FIELDS,
  NOTIFICATIONS_ARRAY_FIELD,
  classifyFile,
  isMovedUser,
  isWildcard,
  resolveUsername,
} from "./migration-ref-policy";

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

  // Already down to one (or zero) users, so nothing moves. But converting to a
  // personal folder must still clear a leftover lab-head role: lab mode is
  // "two or more users OR any lab head", so a solo lab_head folder otherwise
  // re-triggers the migration gate on every launch and "Convert this folder to
  // mine" looks like it does nothing. Clamp the primary's account_type to member
  // first, then return, so the fast path is idempotent and actually solo-izes.
  if (plan.alreadySolo) {
    await clampSettingsToMember(
      fs,
      joinPath("users", plan.primaryUser, "settings.json"),
    );
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
    const r = await moveUserOut(fs, userSummary.username, bundlesDir, trashDir);
    if (r.moved) {
      bundlePaths[userSummary.username] = r.bundleRoot;
      trashPaths[userSummary.username] = r.trashDest;
      movedUsers.push(userSummary.username);
    }
  }

  // 3. STRIP cross-owner shares from the primary user's retained files.
  const movedUserSet = new Set(movedUsers);
  const sharesStripped = await stripSharesFromPrimary(
    fs,
    plan.primaryUser,
    movedUserSet,
  );

  // 4. A solo folder has no lab head. Clamp account_type to "member" so the
  //    result derives as solo (isLabModeFolder keys off a lab head) on BOTH
  //    sides: the primary's retained folder, AND every moved user's extracted
  //    bundle, so a moved-out PI's new one-person folder is not still a "lab".
  await clampSettingsToMember(fs, joinPath("users", plan.primaryUser, "settings.json"));
  for (const username of movedUsers) {
    await clampSettingsToMember(
      fs,
      joinPath(bundlePaths[username], "users", username, "settings.json"),
    );
  }

  return {
    primaryUser: plan.primaryUser,
    movedUsers,
    bundlePaths,
    trashPaths,
    sharesStripped,
  };
}

// ---------------------------------------------------------------------------
// moveUserOut: bundle + trash ONE user, crash-safe + resumable.
// ---------------------------------------------------------------------------

/**
 * Move one user out of the active folder: bundle users/<username>/ into a
 * portable single-user bundle, VERIFY it is complete, then move the original to
 * trash. Shared by executeMigrationToSolo (each non-primary user) and
 * executeSelfExport (just the departing user).
 *
 * CRASH-SAFE + RESUMABLE. The one irreversible step is deleting the source, and
 * it is never reached until a complete, verified bundle exists. Two facts make
 * the resume sound:
 *   (a) the trash move (rename) copies the whole subtree BEFORE deleting the
 *       source, so the source stays the complete copy until the very end.
 *   (b) we only ever rename AFTER bundling + verifying, so the mere existence of
 *       trashDest proves a COMPLETE bundle exists.
 *
 * Returns moved:false only when the user was already fully moved on a prior run
 * (an idempotent no-op).
 */
async function moveUserOut(
  fs: MigrationFs,
  username: string,
  bundlesDir: string,
  trashDir: string,
): Promise<{ moved: boolean; bundleRoot: string; trashDest: string }> {
  const srcPath = joinPath("users", username);
  const bundleRoot = joinPath(bundlesDir, username);
  const bundleDest = joinPath(bundleRoot, "users", username);
  const trashDest = joinPath(trashDir, username);

  const srcExists = await fs.exists(srcPath);
  const trashExists = await fs.exists(trashDest);

  // Source gone => the move finished on a prior run. Idempotent no-op.
  if (!srcExists) {
    return { moved: false, bundleRoot, trashDest };
  }

  // Source AND trash both present => a prior run crashed inside the trash move.
  // By fact (b) the bundle is the authoritative complete copy. Rebuild trash
  // from the BUNDLE (never from the possibly-partial source), then drop the
  // leftover source. No source file is read for data, so a partial source
  // cannot corrupt anything.
  if (trashExists) {
    if (!(await fs.exists(bundleDest))) {
      throw new Error(
        `migrate-to-solo: "${username}" is in an inconsistent partial state ` +
          `(trash present, bundle missing). No data has been deleted; recover ` +
          `the user's data from users/ or _trash before retrying.`,
      );
    }
    await fs.mkdirp(trashDir);
    await copyDirRecursiveMfs(fs, bundleDest, trashDest);
    if (!(await isTreeComplete(fs, bundleDest, trashDest))) {
      throw new Error(`migrate-to-solo: could not rebuild a complete trash copy for "${username}"; no data deleted.`);
    }
    await fs.removeDir(srcPath);
    return { moved: true, bundleRoot, trashDest };
  }

  // Normal path: source present, no trash yet => the source is authoritative.
  // 1. BUNDLE and VERIFY complete BEFORE touching the source.
  const bundleComplete =
    (await fs.exists(bundleDest)) && (await isTreeComplete(fs, srcPath, bundleDest));
  if (!bundleComplete) {
    await copyDirRecursiveMfs(fs, srcPath, bundleDest);
    if (!(await isTreeComplete(fs, srcPath, bundleDest))) {
      throw new Error(
        `migrate-to-solo: bundle for "${username}" is incomplete after copy. ` +
          `Aborting BEFORE any delete so no data is lost; re-run to resume.`,
      );
    }
  }
  // 2. TRASH (recoverable). Only reached once the bundle is verified complete.
  await fs.mkdirp(trashDir);
  await fs.rename(srcPath, trashDest);
  return { moved: true, bundleRoot, trashDest };
}

// ---------------------------------------------------------------------------
// executeSelfExport: a labmate takes their own data out, leaving the folder.
// ---------------------------------------------------------------------------

export interface SelfExportResult {
  /** The departing user. */
  username: string;
  /** Path of their portable bundle root (e.g. "_migration_bundles/sharron"). */
  bundlePath: string;
  /** Path of their trashed original (e.g. "_trash/migrated_users/sharron"). */
  trashPath: string;
  /** False when the user was already gone (idempotent no-op). */
  moved: boolean;
}

/**
 * Extract a single (non-owner) user from a shared folder into their own
 * portable single-user bundle and remove them from the folder, leaving EVERY
 * OTHER user untouched (the folder stays multi-user for the rest). This is the
 * labmate side of the role-aware migration: "take your data to your own folder".
 *
 * It deliberately does NOT strip the departing user from the other users' share
 * lists. Those references degrade gracefully to an archived user on read, and
 * rewriting other people's records from one member's action would be invasive.
 *
 * Recoverable (trash-not-delete) and crash-safe via moveUserOut.
 */
export async function executeSelfExport(opts: {
  fs: MigrationFs;
  username: string;
  bundlesDir?: string;
  trashDir?: string;
}): Promise<SelfExportResult> {
  const {
    fs,
    username,
    bundlesDir = "_migration_bundles",
    trashDir = "_trash/migrated_users",
  } = opts;
  const r = await moveUserOut(fs, username, bundlesDir, trashDir);
  return { username, bundlePath: r.bundleRoot, trashPath: r.trashDest, moved: r.moved };
}

/**
 * Clamp a settings.json file's account_type to "member". A solo folder has no
 * lab head, so this keeps useIsLabMode / isLabModeFolder deriving "solo" both
 * for the primary's retained folder AND for each moved user's extracted bundle
 * (a moved-out PI's new one-person folder must not still read as a lab). No-op
 * when the file is missing, unparseable, or already "member".
 */
async function clampSettingsToMember(fs: MigrationFs, settingsPath: string): Promise<void> {
  if (!(await fs.exists(settingsPath))) return;
  let raw: string;
  try {
    raw = await fs.readFile(settingsPath);
  } catch {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return;
  }
  const obj = parsed as Record<string, unknown>;
  // Only clamp an explicit lab head. Absent / "member" already derive solo, so
  // leave those files untouched (no needless rewrite).
  if (obj["account_type"] !== "lab_head") return;
  obj["account_type"] = "member";
  await fs.writeFile(settingsPath, JSON.stringify(obj, null, 2));
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

/**
 * Collect every FILE path under `dir`, relative to `dir`, recursively.
 * Used to verify a bundle copy covered the whole source before any delete.
 */
async function listTreeFiles(fs: MigrationFs, dir: string, prefix = ""): Promise<Set<string>> {
  const out = new Set<string>();
  const entries = await fs.listDir(dir);
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === "dir") {
      for (const f of await listTreeFiles(fs, joinPath(dir, entry.name), rel)) out.add(f);
    } else {
      out.add(rel);
    }
  }
  return out;
}

/**
 * True when `dst` contains (at least) every file present under `src`. A torn
 * FSA write leaves a file ABSENT (the atomic .tmp never moves), so a missing
 * file is exactly the failure this catches before the source is deleted.
 */
async function isTreeComplete(fs: MigrationFs, src: string, dst: string): Promise<boolean> {
  const srcFiles = await listTreeFiles(fs, src);
  const dstFiles = await listTreeFiles(fs, dst);
  for (const f of srcFiles) {
    if (!dstFiles.has(f)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// stripSharesFromPrimary: remove moved-user references from the primary's files.
// ---------------------------------------------------------------------------

/**
 * Walk every .json file under users/<primaryUser>/ and remove dangling
 * cross-owner references to any moved user, dispatching per file via
 * transformPrimaryFile (see migration-ref-policy.ts for the strip/prune/keep
 * contract). In short:
 *   - records: strip active grants (shared_with / members / "*" / is_shared),
 *     clear external_project whose owner left, rename former 1:1 notebooks.
 *   - _shared_with_me.json / _notifications.json / *-hosted.json: prune the
 *     array ENTRIES that point at a moved user's now-gone data.
 *   - attribution (assignee, comment author, last_edited_by, created_by) is
 *     intentionally KEPT (it gray-degrades to an archived user on read).
 *
 * Only rewrites a file if it actually changed. Files that are not valid JSON
 * are left byte-untouched. Returns one ShareStripRecord per modified file.
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

    const outcome = transformPrimaryFile(relPath, parsed, movedUsers);
    if (!outcome) return; // nothing to change in this file

    await fs.writeFile(relPath, JSON.stringify(outcome.value, null, 2));
    records.push({ file: relPath, removed: outcome.removed });
  });

  return records;
}

// ---------------------------------------------------------------------------
// transformPrimaryFile: file-aware strip / prune of one parsed json value.
// ---------------------------------------------------------------------------

/** True only for a non-null, non-array object. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Dispatch a single parsed primary-user file to the right transform based on
 * its filename. Returns the new value + a list of what was removed, or null if
 * nothing changed (so the caller leaves the file's bytes untouched).
 *
 * The three filename-gated sidecars (_shared_with_me.json, _notifications.json,
 * *-hosted.json) hold ARRAY ENTRIES that POINT AT a moved user's data; once
 * that data leaves the folder the entry is dead, so the whole entry is pruned.
 * Every other json is a "record" and gets the conservative field-level strip.
 */
function transformPrimaryFile(
  relPath: string,
  parsed: unknown,
  movedUsers: Set<string>,
): { value: unknown; removed: string[] } | null {
  switch (classifyFile(relPath)) {
    case "notifications":
      return pruneNotifications(parsed, movedUsers);
    case "shared_with_me":
      return pruneSharedWithMe(parsed, movedUsers);
    case "hosted":
      return pruneHostedManifest(parsed, movedUsers);
    default:
      return stripRecord(relPath, parsed, movedUsers);
  }
}

/**
 * _notifications.json is `{ version, notifications: [...] }` on disk (a legacy
 * root-array form is also tolerated). Drop every notification whose sender
 * (from_user) or referenced record owner (owner_username) is a moved user, as
 * it now points at a person / record that has left the folder.
 */
function pruneNotifications(
  parsed: unknown,
  movedUsers: Set<string>,
): { value: unknown; removed: string[] } | null {
  const removed: string[] = [];
  const prune = (list: unknown[]): unknown[] =>
    list.filter((entry) => {
      if (isPlainObject(entry)) {
        for (const f of NOTIFICATION_OWNER_FIELDS) {
          const val = entry[f];
          if (typeof val === "string" && movedUsers.has(val)) {
            removed.push(val);
            return false;
          }
        }
      }
      return true;
    });

  // Object-wrapped form: { version, notifications: [...] }.
  if (isPlainObject(parsed) && Array.isArray(parsed[NOTIFICATIONS_ARRAY_FIELD])) {
    const after = prune(parsed[NOTIFICATIONS_ARRAY_FIELD] as unknown[]);
    if (!removed.length) return null;
    return { value: { ...parsed, [NOTIFICATIONS_ARRAY_FIELD]: after }, removed };
  }
  // Legacy root-array form.
  if (Array.isArray(parsed)) {
    const after = prune(parsed);
    return removed.length ? { value: after, removed } : null;
  }
  return null;
}

/**
 * _shared_with_me.json indexes records OWNED BY OTHERS that the primary could
 * read. After those owners leave, the entries point at data that is gone, so
 * prune every tasks/projects/methods entry whose owner is a moved user.
 */
function pruneSharedWithMe(
  parsed: unknown,
  movedUsers: Set<string>,
): { value: unknown; removed: string[] } | null {
  if (!isPlainObject(parsed)) return null;
  const obj: Record<string, unknown> = { ...parsed };
  const removed: string[] = [];
  let changed = false;
  for (const arr of SHARED_WITH_ME_ARRAYS) {
    if (Array.isArray(obj[arr])) {
      const before = obj[arr] as unknown[];
      const after = before.filter((e) => {
        if (isPlainObject(e) && typeof e.owner === "string" && movedUsers.has(e.owner)) {
          removed.push(e.owner);
          return false;
        }
        return true;
      });
      if (after.length !== before.length) {
        obj[arr] = after;
        changed = true;
      }
    }
  }
  return changed ? { value: obj, removed } : null;
}

/**
 * projects/<id>-hosted.json lists tasks hosted INTO the primary's project from
 * other owners. Prune any entry whose owner or sharedBy is a moved user (its
 * task file has left with that user's bundle, so the entry is drift).
 */
function pruneHostedManifest(
  parsed: unknown,
  movedUsers: Set<string>,
): { value: unknown; removed: string[] } | null {
  if (!isPlainObject(parsed) || !Array.isArray(parsed.hostedTasks)) return null;
  const obj: Record<string, unknown> = { ...parsed };
  const removed: string[] = [];
  const before = obj.hostedTasks as unknown[];
  const after = before.filter((e) => {
    if (isPlainObject(e)) {
      const owner = e.owner;
      const sharedBy = e.sharedBy;
      if (
        (typeof owner === "string" && movedUsers.has(owner)) ||
        (typeof sharedBy === "string" && movedUsers.has(sharedBy))
      ) {
        removed.push(typeof owner === "string" ? owner : String(sharedBy));
        return false;
      }
    }
    return true;
  });
  if (after.length === before.length) return null;
  obj.hostedTasks = after;
  return { value: obj, removed };
}

/**
 * A normal record (task / project / method / note / goal / notebook / 1:1 /
 * purchase / etc). Conservatively strips only:
 *   - active access grants: shared_with / sharedWith / participants / members /
 *     usernames entries naming a moved user OR the "*" wildcard,
 *   - is_shared -> false,
 *   - a scalar owner / sharedBy / shared_by equal to a moved user (safety net),
 *   - external_project whose destination owner is gone (delete the ref),
 *   - the 1:1 notebook title rename.
 * It KEEPS attribution (assignee, comment author/mentions, last_edited_by,
 * created_by, approval / flag stamps) which gray-degrades to an archived user.
 * Array-rooted or scalar files are left byte-untouched.
 */
function stripRecord(
  relPath: string,
  parsed: unknown,
  movedUsers: Set<string>,
): { value: unknown; removed: string[] } | null {
  if (!isPlainObject(parsed)) return null;
  const obj = parsed;
  const removed: string[] = [];

  // Active access grants + "*" wildcard.
  for (const field of SHARE_ARRAY_FIELDS) {
    if (Array.isArray(obj[field])) {
      const before = obj[field] as unknown[];
      const after = before.filter((e) => !isMovedUser(e, movedUsers) && !isWildcard(e));
      if (after.length !== before.length) {
        for (const e of before) {
          if (isWildcard(e)) removed.push("*");
          else if (isMovedUser(e, movedUsers)) removed.push(resolveUsername(e));
        }
        obj[field] = after;
      }
    }
  }

  // Scalar owner-ish fields (safety net for malformed / legacy records).
  for (const field of SCALAR_OWNER_FIELDS) {
    if (typeof obj[field] === "string" && movedUsers.has(obj[field] as string)) {
      removed.push(obj[field] as string);
      obj[field] = null;
    }
  }

  // Cross-folder hosting ref whose destination owner has left.
  const ext = obj["external_project"];
  if (isPlainObject(ext) && typeof ext.owner === "string" && movedUsers.has(ext.owner)) {
    removed.push(`external_project:${ext.owner}`);
    delete obj["external_project"];
  }

  // A solo folder shares with no one.
  if (obj["is_shared"] === true) {
    obj["is_shared"] = false;
    removed.push("is_shared");
  }

  // Former 1:1 (mentoring) notebook: neutralize the now-meaningless title.
  if (
    relPath.includes("/shared_notebooks/") &&
    typeof obj["title"] === "string" &&
    /^1:1 with /i.test(obj["title"] as string)
  ) {
    obj["title"] = "Meeting notes";
    removed.push("(1:1-rename)");
  }

  return removed.length ? { value: obj, removed } : null;
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

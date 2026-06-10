// Lab-tier Phase 7a: single source of truth for which on-disk user references
// the multiuser -> solo migration STRIPS, PRUNES, or KEEPS.
//
// The executor (migrate-to-solo-executor.ts), the invariant checker
// (migration-invariants.ts), and the synthetic fixture generator
// (__tests__/migration-synth-fixtures.ts) all import from here so the three
// can never drift apart. Every shape below is verified against types.ts.
//
// DESIGN PRINCIPLE (conservative):
//   - STRIP active access grants and wildcards (shared_with, "*", is_shared):
//     a moved user must not retain access, and lab-wide sharing is meaningless
//     in a solo folder.
//   - PRUNE dead pointers to data that has LEFT the folder (index/manifest
//     entries owned by a moved user): _shared_with_me entries, *-hosted
//     manifest entries, notifications about a moved user. A nulled owner is
//     itself broken, so the whole entry is removed.
//   - CLEAR a cross-folder hosting ref (external_project) whose destination
//     owner is gone.
//   - KEEP attribution that gray-degrades to an "archived user" (assignee,
//     comment author + mentions, last_edited_by, created_by, PI approval /
//     flag stamps, audit logs). Removing these would be data loss with no
//     correctness benefit, since reads still resolve gracefully.
//
// No emojis, no em-dashes, no mid-sentence colons.

// ---------------------------------------------------------------------------
// Field sets.
// ---------------------------------------------------------------------------

/**
 * Array fields whose entries are STRIPPED when they name a moved user or the
 * "*" wildcard. Entries may be a plain username string OR an object with a
 * `username` / `user` field (both forms appear on disk). These are active
 * access grants, so a moved user must be removed.
 */
export const SHARE_ARRAY_FIELDS = [
  "shared_with",
  "sharedWith",
  "participants",
  "members",
  "usernames",
] as const;

/**
 * Top-level scalar string fields nulled when they equal a moved user. On the
 * primary's own records `owner` is the primary (never moved), so this is a
 * safety net for malformed / legacy records, not a routine rewrite.
 */
export const SCALAR_OWNER_FIELDS = ["owner", "sharedBy", "shared_by"] as const;

/**
 * The three FILENAME-gated sidecars whose ARRAY ENTRIES are pruned by owner.
 * Gating on filename (not field name) avoids false positives on a normal
 * record that happens to carry a `tasks` array.
 */
export const SHARED_WITH_ME_FILE = "_shared_with_me.json";
export const NOTIFICATIONS_FILE = "_notifications.json";
export const HOSTED_MANIFEST_SUFFIX = "-hosted.json";

/** Arrays inside `_shared_with_me.json` whose entries carry an `owner`. */
export const SHARED_WITH_ME_ARRAYS = ["tasks", "projects", "methods"] as const;

/** Owner-identifying fields on a `_notifications.json` entry. */
export const NOTIFICATION_OWNER_FIELDS = ["from_user", "owner_username"] as const;

/**
 * The on-disk `_notifications.json` is `{ version, notifications: [...] }`
 * (object-wrapped), not a root array. This is the array field to prune. A
 * legacy root-array form is also tolerated by the executor.
 */
export const NOTIFICATIONS_ARRAY_FIELD = "notifications";

/**
 * Fields the migration intentionally KEEPS (documented so the checker can
 * assert they were NOT stripped, and so the generator can seed them as
 * negative controls). These resolve to an archived user on read.
 */
export const KEEP_FIELDS = [
  "assignee",
  "author",
  "mentions",
  "last_edited_by",
  "created_by",
  "approved_by",
  "declined_by",
  "shifted_by_user",
  "actor",
  "target_user",
  "deleted_by",
  "restored_by",
] as const;

export const WILDCARD = "*";

// ---------------------------------------------------------------------------
// Predicates.
// ---------------------------------------------------------------------------

/** Extract the username string from a plain-string or object-form entry. */
export function resolveUsername(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const o = entry as Record<string, unknown>;
    if (typeof o.username === "string") return o.username;
    if (typeof o.user === "string") return o.user;
  }
  return String(entry);
}

/** True if a share-array entry refers to one of `movedUsers`. */
export function isMovedUser(entry: unknown, movedUsers: ReadonlySet<string>): boolean {
  if (typeof entry === "string") return movedUsers.has(entry);
  if (entry && typeof entry === "object") {
    const o = entry as Record<string, unknown>;
    if (typeof o.username === "string") return movedUsers.has(o.username);
    if (typeof o.user === "string") return movedUsers.has(o.user);
  }
  return false;
}

/** True if a share-array entry is the lab-wide "*" wildcard. */
export function isWildcard(entry: unknown): boolean {
  return resolveUsername(entry) === WILDCARD;
}

/** Classify a file by basename so callers can pick the right rule set. */
export function classifyFile(relPath: string): "shared_with_me" | "notifications" | "hosted" | "record" {
  if (relPath.endsWith(`/${SHARED_WITH_ME_FILE}`) || relPath === SHARED_WITH_ME_FILE) {
    return "shared_with_me";
  }
  if (relPath.endsWith(`/${NOTIFICATIONS_FILE}`) || relPath === NOTIFICATIONS_FILE) {
    return "notifications";
  }
  if (relPath.endsWith(HOSTED_MANIFEST_SUFFIX)) return "hosted";
  return "record";
}

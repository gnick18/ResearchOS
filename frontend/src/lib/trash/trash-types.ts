// VCP R1 trash MVP notes (2026-05-26): shared type definitions for the
// soft-delete surface introduced by the Version Control proposal §3a + §3b.
//
// This is the central data-shape file for the trash subsystem. Three
// public types:
//
//   - `TrashEntityType`   — narrow string union of the 8 entity types
//                           that can land in `_trash/<type>/`. R1 only
//                           writes "note" entries; R2 wires the rest.
//   - `TrashedEntity<T>`  — the on-disk record shape for a single
//                           trashed entity (the original record + a
//                           `_trash` metadata block).
//   - `TrashIndex` +
//     `TrashIndexEntry`   — the `_trash/_index.json` sidecar shape.
//
// Files live at:
//   users/<u>/_trash/<entity_type>/<id>-<slug>.json
//   users/<u>/_trash/_index.json
//
// The index is a read-time optimization (the directory scan is the
// ground truth). See `trash-index.ts` for the rebuild-from-disk path.

/** All entity types the trash subsystem knows how to soft-delete. R1
 *  exercises only "note"; the rest are reserved for R2. */
export type TrashEntityType =
  | "note"
  | "task"
  | "method"
  | "project"
  | "purchase_item"
  | "high_level_goal"
  | "lab_link"
  | "mass_spec_protocol";

/** Restore-metadata block on a trashed record. Captures the parent
 *  reference at the time of delete so cascading restore prompts can
 *  fire when both the child AND its parent sit in trash. R1 stubs the
 *  prompt; R2 lights it up once Projects can also be trashed. */
export interface TrashRestoreMetadata {
  /** Parent record's numeric id at the time of delete (e.g. project_id
   *  for a note). */
  parent_id?: number;
  /** Parent record's entity type. Only set when `parent_id` is. */
  parent_entity_type?: TrashEntityType;
  /** Parent's trash path if the parent is ALSO in trash. Resolved at
   *  delete-time, not lazily — if the parent gets restored before this
   *  child, the path goes stale (caller checks existence). */
  parent_trash_path?: string;
}

/** The `_trash` field block appended to every trashed record. */
export interface TrashFieldBlock {
  /** ISO 8601 timestamp at delete time. */
  deleted_at: string;
  /** Username of the actor who issued the delete. For an owner self-
   *  delete this is the owner; for a PI cross-owner delete this is the
   *  lab head. */
  deleted_by: string;
  /** When a PI deletes during a Phase 5 unlock, the session id from
   *  `edit-session.ts`. Lets the audit log + the trash entry share a
   *  group key. Absent for owner self-deletes. */
  deleted_during_session?: string;
  /** ISO 8601 timestamp when the trash-cleanup pass will hard-delete
   *  this entry. = `deleted_at` + the cleanup window from the deleting
   *  user's settings (or `Never` → far-future sentinel). */
  auto_expires_at: string;
  /** Live-disk path the record came from (e.g. `users/<u>/notes/47.json`).
   *  Restore writes back here. */
  original_path: string;
  /** Optional parent-reference block; see `TrashRestoreMetadata`. */
  restore_metadata?: TrashRestoreMetadata;
}

/** Generic shape for a trashed entity on disk: the original record T
 *  plus a `_trash` metadata block. Restore strips `_trash` before
 *  writing back. */
export type TrashedEntity<T> = T & {
  _trash: TrashFieldBlock;
};

/** A single index entry — one per trashed file on disk. */
export interface TrashIndexEntry {
  /** Original record id (numeric for every entity type R1/R2 cares about,
   *  but the sidecar stores it untouched for forward-compat with future
   *  string-id entities). */
  id: string | number;
  entity_type: TrashEntityType;
  /** File path relative to the user's directory.
   *  e.g. `_trash/notes/47-PCR-setup.json`. */
  trash_path: string;
  /** Live-disk path the record came from (mirrors `_trash.original_path`). */
  original_path: string;
  /** ISO 8601 timestamps copied out of the trashed record for the
   *  cleanup pass to consume without re-reading every file. */
  deleted_at: string;
  deleted_by: string;
  auto_expires_at: string;
  /** Optional parent-reference (mirrors `_trash.restore_metadata`). */
  parent_id?: number;
  parent_entity_type?: TrashEntityType;
  parent_trash_path?: string;
}

/** Shape of `_trash/_index.json`. */
export interface TrashIndex {
  version: 1;
  entries: TrashIndexEntry[];
  /** ISO 8601 timestamp of the last successful cleanup pass; null when
   *  the index has never been swept. */
  last_cleanup_at: string | null;
}

/** A far-future sentinel used when the user picked "Never" for cleanup
 *  window. Chosen to be well-formed ISO and beyond any reasonable
 *  cleanup horizon. Read paths just compare against `now()` so any
 *  value > now suffices. */
export const NEVER_EXPIRES_SENTINEL = "9999-12-31T23:59:59.999Z";

/** Default cleanup window. OQ1 locks this at 30 days. */
export const DEFAULT_CLEANUP_DAYS = 30;

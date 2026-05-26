// VCP R1 trash MVP notes (2026-05-26): deprecation shim.
//
// This module was the original Note-only soft-delete primitive (Lab head
// UX polish manager Bug 3, 2026-05-24). R1 of the Version Control proposal
// generalized the trash layout to `users/<u>/_trash/<entity_type>/` with
// an `_index.json` sidecar. The new authoritative layer lives at
// `@/lib/trash`.
//
// This file keeps the same public surface (`trashNote`, `restoreTrashedNote`,
// `TrashedNote`) so existing call sites in `local-api.ts` and the tests
// continue to compile. Each function delegates straight into the new
// layer. The TrashedNote interface keeps the legacy `deleted_at` field
// hoisted to the top level for backward-compat with old readers that
// haven't been updated yet (the new layer stores it inside `_trash`).
//
// REMOVE THIS SHIM in R2 once every note delete call site has been
// migrated to `trashEntity({ entityType: "note", ... })` directly.

import {
  trashEntity,
  restoreEntity,
  readTrashedEntity,
} from "@/lib/trash";
import type { Note } from "@/lib/types";

/** Legacy shape: original Note + a top-level `deleted_at`. The new
 *  layer stores the same timestamp inside `_trash.deleted_at`; we
 *  surface BOTH so legacy readers keep working through R1. */
export interface TrashedNote extends Note {
  deleted_at: string;
}

/** Soft-delete a note. Backwards-compatible signature; new call sites
 *  should pass `actor` + `sessionId` so the new layer can record
 *  attribution. When omitted, attribution falls back to `owner` (owner
 *  self-delete) with no session id.
 *
 *  Returns the trashed-record shape (with `deleted_at` hoisted to the
 *  top level) for backward compat, or null when the live note was
 *  missing. */
export async function trashNote(
  username: string,
  noteId: number,
  options?: {
    actor?: string;
    sessionId?: string | null;
  },
): Promise<TrashedNote | null> {
  const actor = options?.actor ?? username;
  const sessionId = options?.sessionId ?? null;
  // We need the title to slug the filename. Read it before the move.
  const writtenAt = new Date().toISOString();
  void writtenAt;
  const trashed = await trashEntity<Note>({
    owner: username,
    entityType: "note",
    id: noteId,
    deletedBy: actor,
    sessionId,
    nameForSlug: undefined, // Resolved inside trashEntity after live read.
    // R2 wires the project_id parent reference; R1 leaves it absent.
  });
  if (!trashed) return null;
  // Hoist `deleted_at` for backward compat.
  return {
    ...(trashed as Note),
    deleted_at: trashed._trash.deleted_at,
  } as TrashedNote;
}

/** Restore a previously-trashed note. Returns the live Note shape (no
 *  `deleted_at`, no `_trash`) on success, or null when no trash entry
 *  exists. */
export async function restoreTrashedNote(
  username: string,
  noteId: number,
): Promise<Note | null> {
  return await restoreEntity<Note>(username, "note", noteId);
}

/** Direct read of a trashed note. Used by the trash UI when it needs
 *  to render the full record (not just the index summary). */
export async function readTrashedNote(
  username: string,
  noteId: number,
): Promise<TrashedNote | null> {
  const trashed = await readTrashedEntity<Note>(username, "note", noteId);
  if (!trashed) return null;
  return {
    ...(trashed as Note),
    deleted_at: trashed._trash.deleted_at,
  } as TrashedNote;
}

// Lab head UX polish manager Bug 3 (2026-05-24): soft-delete + restore
// helpers for notes.
//
// File layout: a deleted note's JSON is moved from
//   users/<owner>/notes/<id>.json
// to
//   users/<owner>/notes_trash/<id>.json
// before being removed from the live notes directory. A `deleted_at`
// ISO timestamp is stamped onto the trashed copy so a future auto-purge
// can drop entries older than N days without re-reading the original
// file's mtime.
//
// We use a sibling directory (notes_trash) rather than a `_deleted/`
// subfolder inside `notes/` so the live `notesStore.listAll()` — which
// reads every `*.json` in `users/<owner>/notes/` — naturally excludes
// trashed entries without any "is this a trash file?" filter.
//
// The restore path is the inverse: read from `notes_trash/<id>.json`,
// strip the trash-only metadata, write back to `notes/<id>.json`, then
// delete the trash file. This keeps the note's id stable across the
// soft-delete round-trip — the same id the user saw before deletion is
// what comes back.

import { fileService } from "@/lib/file-system/file-service";
import type { Note } from "@/lib/types";

/** Folder name relative to a user's base path. */
const TRASH_DIRNAME = "notes_trash";

/** The trash record on disk = the original note plus a soft-delete timestamp. */
export interface TrashedNote extends Note {
  deleted_at: string;
}

function notesPath(username: string, id: number): string {
  return `users/${username}/notes/${id}.json`;
}

function trashPath(username: string, id: number): string {
  return `users/${username}/${TRASH_DIRNAME}/${id}.json`;
}

/**
 * Move a note's JSON into the trash directory. Returns `true` if the
 * note existed and was moved, `false` otherwise (missing source, write
 * failure, etc. — caller can treat both as "nothing to undo").
 *
 * Order of ops:
 *   1. Read the live note. If missing, return false.
 *   2. Write the trashed copy WITH `deleted_at`. If this fails (no
 *      permission, disk full), bail without touching the live file.
 *   3. Delete the live file.
 *
 * In the rare case where (3) fails after (2) succeeds, the next list
 * call will show the note as still present (live copy survives) AND
 * the trash will contain a stale entry — a benign duplicate that the
 * next legitimate delete will overwrite.
 */
export async function trashNote(
  username: string,
  noteId: number,
): Promise<TrashedNote | null> {
  const live = await fileService.readJson<Note>(notesPath(username, noteId));
  if (!live) return null;

  const trashed: TrashedNote = {
    ...live,
    deleted_at: new Date().toISOString(),
  };
  await fileService.ensureDir(`users/${username}/${TRASH_DIRNAME}`);
  try {
    await fileService.writeJson(trashPath(username, noteId), trashed);
  } catch (err) {
    console.warn("[notes-trash] failed to write trash copy", err);
    return null;
  }

  const removed = await fileService.deleteFile(notesPath(username, noteId));
  if (!removed) {
    console.warn(
      "[notes-trash] trashed copy written but live file delete failed; live copy still visible",
    );
  }
  return trashed;
}

/**
 * Restore a previously-trashed note. Returns the live Note on success,
 * or `null` if the trash entry was missing (e.g. already purged or
 * never existed). The trash file is removed on success; on failure to
 * write the live copy we keep the trash file in place so the user can
 * retry.
 */
export async function restoreTrashedNote(
  username: string,
  noteId: number,
): Promise<Note | null> {
  const trashed = await fileService.readJson<TrashedNote>(
    trashPath(username, noteId),
  );
  if (!trashed) return null;

  // Strip the trash-only field before writing back to the live store.
  const { deleted_at: _deleted_at, ...liveCopy } = trashed;

  await fileService.ensureDir(`users/${username}/notes`);
  try {
    await fileService.writeJson(notesPath(username, noteId), liveCopy as Note);
  } catch (err) {
    console.warn("[notes-trash] failed to restore live copy", err);
    return null;
  }

  const removed = await fileService.deleteFile(trashPath(username, noteId));
  if (!removed) {
    console.warn(
      "[notes-trash] live copy restored but trash file removal failed",
    );
  }
  return liveCopy as Note;
}

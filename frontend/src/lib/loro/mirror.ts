/**
 * Backend (a): the readable-mirror projector.
 *
 * The CRDT sidecar tracks a subset of Note fields. The mirror is the existing
 * users/<owner>/notes/<id>.json, written on every save so the folder stays
 * human-readable and rollback is "delete the sidecar."
 *
 * Tracked by the CRDT (and therefore overwritten from the doc on every save):
 *   meta:    title, description, is_running_log, created_at
 *   entries: id, title, date, created_at, updated_at, content
 *
 * NOT tracked (preserved from base verbatim):
 *   id (numeric), is_shared, comments, flagged, updated_at (note-level),
 *   username, shared_with, last_edited_by, last_edited_at,
 *   revert_undo_window, and any future additive fields.
 *
 * Callers: do not guard on LORO_PILOT_ENABLED here. The flag check is the
 * caller's job in chunk 5 (the store facade). These backends are pure I/O.
 */

import { LoroDoc } from "loro-crdt";
import { getMeta, listEntries } from "./note-doc";
import { fileService } from "@/lib/file-system/file-service";
import type { Note, NoteEntry } from "@/lib/types";

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * Project the CRDT state onto a Note record.
 *
 * Returns a new Note object where every CRDT-tracked field is taken from the
 * doc, and every untracked field is copied verbatim from `base`. This is the
 * single source of truth for "what the readable file looks like for a given
 * doc state."
 *
 * The entries list from the doc is in canonical id-sorted order (that is the
 * order the seed writes them, and the CRDT preserves insertion order).
 */
export function projectToNote(doc: LoroDoc, base: Note): Note {
  const meta = getMeta(doc);
  const rawEntries = listEntries(doc);

  const entries: NoteEntry[] = rawEntries.map((e) => ({
    id:         e.id,
    title:      e.title,
    date:       e.date,
    created_at: e.created_at,
    updated_at: e.updated_at,
    content:    e.content,
  }));

  return {
    // Preserve every field from base first so additive fields survive.
    ...base,
    // Overlay CRDT-tracked meta fields.
    title:          meta.title,
    description:    meta.description,
    is_running_log: meta.is_running_log,
    created_at:     meta.created_at,
    // Overlay CRDT-tracked entries.
    entries,
  };
}

// ---------------------------------------------------------------------------
// Mirror writer
// ---------------------------------------------------------------------------

/**
 * Write the readable mirror for a note.
 *
 * Thin wrapper: project the doc state into a Note and write it to the
 * canonical note JSON path. Uses fileService.writeJson for atomic I/O (same
 * guarantees as the existing notesApi write path).
 */
export async function writeMirror(
  owner: string,
  doc: LoroDoc,
  base: Note,
): Promise<void> {
  const path = `users/${owner}/notes/${base.id}.json`;
  await fileService.writeJson<Note>(path, projectToNote(doc, base));
}

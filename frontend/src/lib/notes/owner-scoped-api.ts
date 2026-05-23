// Lab Head Phase 5 R1 (lab head Phase 5 R1 manager, 2026-05-23): owner-scoped
// wrapper around `notesApi` mutations.
//
// Mirrors the pattern Phase 5 established for tasks at
// `lib/tasks/owner-scoped-api.ts`. When a PI is in an unlocked edit session
// editing a note owned by another member, every mutation needs to:
//   1. Route to the OWNER's `users/<owner>/notes/<id>.json` (so the change
//      is visible to the owner, not silently captured in the PI's folder).
//   2. Append per-field audit entries to `users/<owner>/_pi_audit.json` so
//      the audit log records who made each change and when.
//
// Plain own-note edits (or any non-PI-session view) pass `undefined` for
// the wrapper's session args and fall through to the unwrapped notesApi
// (no owner routing, no audit emission).
//
// Lives here (not inside NoteDetailPopup) so the shape matches the tasks
// wrapper and any future popup-internal component can import it without
// pulling in the popup itself.

import { notesApi as rawNotesApi } from "@/lib/local-api";
import type { NoteUpdate } from "@/lib/local-api";
import {
  appendAuditEntries,
  buildFieldDiffEntries,
  type PiAuditEntry,
} from "@/lib/lab/pi-audit";

/**
 * Args for the wrapper. When `targetOwner` / `actor` / `sessionId` are all
 * present, mutations are owner-routed AND emit audit entries. Any missing
 * field falls back to the unwrapped notesApi (current user's folder, no
 * audit). The all-or-nothing shape keeps the caller from accidentally
 * routing the write to the target user without an audit trail.
 */
export interface OwnerScopedNotesArgs {
  /** Username of the note owner — the user whose folder is the write target. */
  targetOwner: string | null | undefined;
  /** Username of the lab head doing the edit (the "actor" on each entry). */
  actor: string | null | undefined;
  /** Session id from `edit-session.startEditSession`. Ties all entries from
   *  one 5-min unlock window together. */
  sessionId: string | null | undefined;
}

/**
 * Build an owner-scoped `notesApi`. Returns the same shape as the underlying
 * `notesApi` (so consumers don't change call sites) but with each mutation
 * routed to the target owner's folder and per-field audit entries appended.
 *
 * The wrapper reads the pre-edit record before each write so the audit
 * entry can carry the OLD value verbatim. For nested updates (entry-level
 * writes inside the parent note), the diff is computed against the
 * matching entry pre/post — one audit entry per changed field of the
 * touched entry.
 */
export function ownerScopedNotesApi(args: OwnerScopedNotesArgs) {
  const { targetOwner, actor, sessionId } = args;
  // If any of the session args is missing, route everything through the
  // unwrapped API. This matches the Phase 5 TaskDetailPopup pattern.
  const active = !!targetOwner && !!actor && !!sessionId;

  if (!active) {
    return {
      ...rawNotesApi,
    };
  }

  // Narrowed types — TS doesn't follow the `active` boolean across closure
  // boundaries, so re-bind the asserted-non-null values here.
  const owner = targetOwner as string;
  const writer = actor as string;
  const session = sessionId as string;

  const writeAuditFromDiff = async (
    recordId: number,
    fieldPath: string,
    oldValue: unknown,
    newValue: unknown,
  ) => {
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return;
    try {
      await appendAuditEntries(owner, [
        {
          session_id: session,
          actor: writer,
          target_user: owner,
          record_type: "note",
          record_id: recordId,
          field_path: fieldPath,
          old_value: oldValue ?? null,
          new_value: newValue ?? null,
        },
      ]);
    } catch (err) {
      console.warn("[ownerScopedNotesApi] appendAuditEntries failed", err);
    }
  };

  const writeAuditEntries = async (
    entries: Array<Omit<PiAuditEntry, "id" | "timestamp">>,
  ) => {
    if (entries.length === 0) return;
    try {
      await appendAuditEntries(owner, entries);
    } catch (err) {
      console.warn("[ownerScopedNotesApi] appendAuditEntries failed", err);
    }
  };

  return {
    ...rawNotesApi,
    // get is the only read we override — so consumers that read-via-the-
    // wrapper see the target owner's record, not the PI's.
    get: (id: number) => rawNotesApi.get(id, owner),
    update: async (id: number, data: NoteUpdate) => {
      // Top-level note fields: title / description / is_shared / etc.
      // One audit entry per touched field that actually moved.
      const before = await rawNotesApi.get(id, owner);
      const updated = await rawNotesApi.update(id, data, owner);
      if (before && updated) {
        const entries = buildFieldDiffEntries({
          actor: writer,
          session_id: session,
          target_user: owner,
          record_type: "note",
          record_id: id,
          oldRecord: before as unknown as Record<string, unknown>,
          newRecord: updated as unknown as Record<string, unknown>,
          fieldPaths: Object.keys(data).filter((k) => k !== "updated_at"),
        });
        await writeAuditEntries(entries);
      }
      return updated;
    },
    addEntry: async (
      noteId: number,
      data: { title: string; date: string; content?: string },
    ) => {
      const updated = await rawNotesApi.addEntry(noteId, data, owner);
      if (updated) {
        // New entry — emit ONE audit entry capturing the addition. The
        // field_path encodes the new entry's id so the audit log reads as
        // "entries.<entry-id> added" rather than "entries changed".
        const newEntry = (updated.entries ?? []).at(-1);
        if (newEntry) {
          await writeAuditEntries([
            {
              session_id: session,
              actor: writer,
              target_user: owner,
              record_type: "note",
              record_id: noteId,
              field_path: `entries.${newEntry.id}`,
              old_value: null,
              new_value: {
                title: newEntry.title,
                date: newEntry.date,
                content: newEntry.content,
              },
            },
          ]);
        }
      }
      return updated;
    },
    updateEntry: async (
      noteId: number,
      entryId: string,
      data: { title?: string; date?: string; content?: string },
    ) => {
      // Diff at the entry level: one audit entry per touched entry field.
      const before = await rawNotesApi.get(noteId, owner);
      const beforeEntry = before?.entries?.find((e) => e.id === entryId);
      const updated = await rawNotesApi.updateEntry(noteId, entryId, data, owner);
      const afterEntry = updated?.entries?.find((e) => e.id === entryId);
      if (beforeEntry && afterEntry) {
        const beforeRec = beforeEntry as unknown as Record<string, unknown>;
        const afterRec = afterEntry as unknown as Record<string, unknown>;
        for (const fieldKey of Object.keys(data) as Array<keyof typeof data>) {
          const fieldPath = `entries.${entryId}.${fieldKey}`;
          await writeAuditFromDiff(
            noteId,
            fieldPath,
            beforeRec[fieldKey],
            afterRec[fieldKey],
          );
        }
      }
      return updated;
    },
    deleteEntry: async (noteId: number, entryId: string) => {
      const before = await rawNotesApi.get(noteId, owner);
      const removedEntry = before?.entries?.find((e) => e.id === entryId);
      const updated = await rawNotesApi.deleteEntry(noteId, entryId, owner);
      if (removedEntry) {
        await writeAuditEntries([
          {
            session_id: session,
            actor: writer,
            target_user: owner,
            record_type: "note",
            record_id: noteId,
            field_path: `entries.${entryId}`,
            old_value: {
              title: removedEntry.title,
              date: removedEntry.date,
              content: removedEntry.content,
            },
            new_value: null,
          },
        ]);
      }
      return updated;
    },
    // delete intentionally NOT owner-routed — destroying a note belongs to
    // the original owner. The PI's edit session covers IN-PLACE edits only.
  };
}

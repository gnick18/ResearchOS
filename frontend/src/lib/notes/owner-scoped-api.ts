// Owner-scoped wrapper around `notesApi` mutations.
//
// Two jobs, both for a lab head editing another member's note:
//   1. Route every mutation to the OWNER's `users/<owner>/notes/<id>.json` (so
//      the change is visible to the owner, not silently captured in the PI's
//      folder).
//   2. Append per-field audit entries to `users/<owner>/_pi_audit.json` so the
//      audit log records who changed what and when.
//
// PI capability revamp (2026-06-07): the audit branch is keyed on
// `targetOwner` + `actor` alone. There is NO password and NO timed session, the
// role-based PI edit (see `canWrite`) is the authorization, and the popups gate
// the first edit behind a once-per-session confirm. Audit entries carry a
// synthetic grouping label ("lab-head-edit") in place of the retired session id.
//
// Plain own-note edits (no targetOwner/actor) fall through to the unwrapped
// notesApi (current user's folder, no audit). A notebook PEER edit (the viewer
// holds an explicit edit-level share on the other member's notebook note) still
// owner-routes via `notebookPeerOwner` WITHOUT audit, peer editing is not a
// lab-head override.
//
// Lives here (not inside NoteDetailPopup) so the shape matches the tasks wrapper
// and any future popup-internal component can import it without pulling in the
// popup itself.

import { notesApi as rawNotesApi } from "@/lib/local-api";
import type { NoteUpdate } from "@/lib/local-api";
import type { HistoryEditKind } from "@/lib/history";
import {
  appendAuditEntries,
  buildFieldDiffEntries,
  type PiAuditEntry,
} from "@/lib/lab/pi-audit";

/** Synthetic audit grouping label for role-based PI content edits (the old
 *  5-minute edit-session id is gone). */
const LAB_HEAD_EDIT_SESSION = "lab-head-edit";

/**
 * Args for the wrapper. When `targetOwner` + `actor` are both present, mutations
 * are owner-routed AND emit audit entries. Missing either falls back to the
 * unwrapped notesApi (current user's folder, no audit). The all-or-nothing shape
 * keeps the caller from routing the write to the target user without an audit
 * trail.
 */
export interface OwnerScopedNotesArgs {
  /** Username of the note owner — the user whose folder is the write target. */
  targetOwner?: string | null | undefined;
  /** Username of the lab head doing the edit (the "actor" on each entry). */
  actor?: string | null | undefined;
  /**
   * Shared 1:1 notebooks: the note-owner folder for a PEER edit inside a shared
   * notebook. Both notebook members hold an explicit edit-level share, so either
   * may edit the other's notebook note. When set (and the PI args are NOT
   * active), mutations route to THIS owner's folder WITHOUT emitting audit
   * entries. Ignored when the PI audit branch is active (PI override owns the
   * audit trail). Absent / unset = current-user-folder behavior.
   */
  notebookPeerOwner?: string | null | undefined;
}

/**
 * Build an owner-scoped `notesApi`. Returns the same shape as the underlying
 * `notesApi` (so consumers don't change call sites) but with each mutation
 * routed to the target owner's folder and per-field audit entries appended.
 *
 * The wrapper reads the pre-edit record before each write so the audit entry
 * carries the OLD value verbatim. For nested updates (entry-level writes inside
 * the parent note), the diff is computed against the matching entry pre/post,
 * one audit entry per changed field of the touched entry.
 */
export function ownerScopedNotesApi(args: OwnerScopedNotesArgs) {
  const { targetOwner, actor, notebookPeerOwner } = args;
  const active = !!targetOwner && !!actor;

  if (!active) {
    // A notebook PEER edit routes to the owner's folder via the raw API's
    // `owner` param so the write lands where the owner reads it. No PI audit.
    // Empty string is treated as "no peer owner" so an own-note or missing
    // owner never misroutes.
    const peerOwner =
      typeof notebookPeerOwner === "string" && notebookPeerOwner.length > 0
        ? notebookPeerOwner
        : undefined;
    return {
      ...rawNotesApi,
      // VC Phase 2 (FLAG-5): the inactive wrapper exposes the SAME 3-arg
      // (id, data, historyMeta) update shape as the active branch so callers can
      // call `notesApi.update(id, payload, historyMeta)` unconditionally. The raw
      // API takes (id, data, owner, historyMeta); here `owner` is the notebook
      // peer owner (or undefined = current-user folder).
      update: (
        id: number,
        data: NoteUpdate,
        historyMeta: {
          kind: HistoryEditKind;
          revert_target_version?: number;
        } = { kind: "update" },
      ) => rawNotesApi.update(id, data, peerOwner, historyMeta),
      get: peerOwner
        ? (id: number, owner?: string) => rawNotesApi.get(id, owner ?? peerOwner)
        : rawNotesApi.get,
      addEntry: peerOwner
        ? (
            noteId: number,
            data: { title: string; date: string; content?: string },
          ) => rawNotesApi.addEntry(noteId, data, peerOwner)
        : rawNotesApi.addEntry,
      updateEntry: peerOwner
        ? (
            noteId: number,
            entryId: string,
            data: { title?: string; date?: string; content?: string },
          ) => rawNotesApi.updateEntry(noteId, entryId, data, peerOwner)
        : rawNotesApi.updateEntry,
      deleteEntry: peerOwner
        ? (noteId: number, entryId: string) =>
            rawNotesApi.deleteEntry(noteId, entryId, peerOwner)
        : rawNotesApi.deleteEntry,
    };
  }

  // Narrowed types — TS doesn't follow the `active` boolean across closure
  // boundaries, so re-bind the asserted-non-null values here.
  const owner = targetOwner as string;
  const writer = actor as string;

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
          session_id: LAB_HEAD_EDIT_SESSION,
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
    // get is the only read we override — consumers reading via the wrapper see
    // the target owner's record, not the PI's.
    get: (id: number) => rawNotesApi.get(id, owner),
    update: async (
      id: number,
      data: NoteUpdate,
      historyMeta: { kind: HistoryEditKind; revert_target_version?: number } = {
        kind: "update",
      },
    ) => {
      // Top-level note fields: one audit entry per touched field that moved.
      const before = await rawNotesApi.get(id, owner);
      const updated = await rawNotesApi.update(id, data, owner, historyMeta);
      if (before && updated) {
        const entries = buildFieldDiffEntries({
          actor: writer,
          session_id: LAB_HEAD_EDIT_SESSION,
          target_user: owner,
          record_type: "note",
          record_id: id,
          oldRecord: before as unknown as Record<string, unknown>,
          newRecord: updated as unknown as Record<string, unknown>,
          // `revert_undo_window` is a transient UI affordance (denylisted from
          // history), so it must not generate per-field audit churn either.
          fieldPaths: Object.keys(data).filter(
            (k) => k !== "updated_at" && k !== "revert_undo_window",
          ),
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
        // New entry — emit ONE audit entry capturing the addition.
        const newEntry = (updated.entries ?? []).at(-1);
        if (newEntry) {
          await writeAuditEntries([
            {
              session_id: LAB_HEAD_EDIT_SESSION,
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
            session_id: LAB_HEAD_EDIT_SESSION,
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
    // delete intentionally NOT owner-routed — destroying a note belongs to the
    // original owner. The PI's role-based edit covers IN-PLACE edits only.
  };
}

// PI capability revamp Phase 1 (2026-06-07): the shared content-edit helper a
// record popup uses when a lab head saves a MEMBER's record on the role alone.
//
// It wraps the kept `writeWithAudit` + `buildFieldDiffEntries` so the data
// write and the per-field audit append land as one serialized chain on the
// target owner's audit queue. The caller supplies the actual data write as a
// closure, so the persistence behavior is byte-identical to the non-PI path,
// the only addition is the audit trail.
//
// Why a helper and not just another owner-scoped API wrapper? Notes and tasks
// already route PI edits through `ownerScopedNotesApi` / `ownerScopedTasksApi`
// (each emits its own audit entries). Purchases have no such audited wrapper
// (the purchases owner-scoped wrapper is a passthrough), so the Purchase editor
// routes its member-edit save through this helper instead. The signature is
// generic so any popup can adopt it.
//
// This helper is ONLY ever invoked on the PI-edit branch (the popup gates it on
// `gate.isPiEdit`). Own-record / normal edit-share saves keep the plain API
// call and never reach here, so they stay completely unaudited and unchanged.

import { writeWithAudit, buildFieldDiffEntries } from "./pi-audit";

// Synthetic grouping label for sessionless PI CONTENT edits, matching the value
// the notes / tasks owner-scoped wrappers already stamp (lib/notes/owner-scoped-api.ts,
// lib/tasks/owner-scoped-api.ts). Content edits across all three record kinds
// share this label so the audit reader groups them together, distinct from the
// "lab-head-action" label pi-actions.ts uses for role actions (approve / decline /
// flag). No em-dashes, no emojis, no mid-sentence colons.
const LAB_HEAD_EDIT_SESSION = "lab-head-edit";

export interface SavePiRecordEditArgs<T> {
  /** The member whose folder hosts the record (the audit target). */
  targetOwner: string;
  /** The lab head doing the edit (the audit actor). */
  actor: string;
  /** Record kind for the audit row. Must be the AUDIT record_type, which is
   *  "purchase_item" for purchases (use auditRecordTypeFor from pi-record-menu)
   *  so one purchase's history is not split across "purchase" and
   *  "purchase_item". Tasks and notes are already their own audit type. */
  recordType: "note" | "task" | "purchase_item";
  /** Record id in the target owner's namespace. */
  recordId: number | string;
  /** Field paths this save touches; only the ones that actually moved are
   *  logged (see buildFieldDiffEntries). */
  fieldPaths: string[];
  /** The record BEFORE the edit. */
  oldRecord: Record<string, unknown>;
  /** The record AFTER the edit (the values being written). */
  newRecord: Record<string, unknown>;
  /** The data write. Must do the SAME persistence the popup does on the
   *  non-PI path (e.g. the existing api.update call), and resolve to whatever
   *  the caller wants returned. */
  dataWrite: () => Promise<T>;
}

/**
 * Run a PI member-record content edit with attribution + audit. The data write
 * runs first; then one audit entry per changed field is appended to the target
 * owner's `_pi_audit.json`, all stamped with `LAB_HEAD_EDIT_SESSION` so the
 * forensic log groups purchase content edits with the note / task content edits.
 */
export function savePiRecordEdit<T>(args: SavePiRecordEditArgs<T>): Promise<T> {
  return writeWithAudit<T>({
    targetUser: args.targetOwner,
    dataWrite: args.dataWrite,
    buildEntries: () =>
      buildFieldDiffEntries({
        actor: args.actor,
        session_id: LAB_HEAD_EDIT_SESSION,
        target_user: args.targetOwner,
        record_type: args.recordType,
        record_id: args.recordId,
        oldRecord: args.oldRecord,
        newRecord: args.newRecord,
        fieldPaths: args.fieldPaths,
      }),
  });
}

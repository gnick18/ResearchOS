# VC Phase 2 build-design: Restore-a-version + 24h undo-restore (Notes pilot)

Author: VC-Phase-2 design pass (for HR), 2026-05-30. Builds on the shipped Phase 0 engine + Phase 1 viewer. Data-mutating (writes the live record + history log), so it ships behind a default-off flag and waits for verification before merge.

## Core insight
Restore = a notesApi.update with the reverse-walked target state. recordNoteHistory already fires on every notesApi.update, and the PI audit + owner-routing already ride on ownerScopedNotesApi.update. So Phase 2 reuses the entire existing write path. The only new mechanics: (a) reconstruct the target via reverseWalkTo (Phase 0 primitive, already built+tested), (b) stamp the row kind "revert", (c) the revert_undo_window sidecar.

## Restore flow
1. Get HEAD canonical (reuse the sidebar projectionsRef cache, or reconstructState).
2. reverseWalkTo(rows, targetVersion, headCanonical) -> target canonical string. CATCH HistoryCompactedTargetError (Case C).
3. JSON.parse the target canonical -> a NoteUpdate payload writing the FULL tracked state (title/description/entries/is_shared/...; NOT the lossy projectNoteState projection).
4. notesApi.update(note.id, payload) -- the same ownerScopedNotesApi the popup uses (persists, routes cross-owner to the owner folder + emits _pi_audit.json, triggers recordNoteHistory).
5. Stamp the new row kind "revert" + revert_target_version via a new historyMeta param (see FLAG-5). Restore APPENDS one HEAD row, deletes nothing.

Button: "Restore this version" in a sticky sidebar footer, on the selected non-HEAD row. canRestore = !effectiveReadOnly && (isOwner || labHeadGate.unlocked), computed once in the popup. Inline confirm (not native confirm()). Tooltip, inline SVG, no emoji/em-dash.

## 24h undo-restore window
Field on the live Note: revert_undo_window { from_version, to_version, reverted_at, expires_at, reverted_by }, written atomically in the restore update.
"Undo restore" button in the popup HEADER (visible with the sidebar closed), gated on: field present + now < expires_at + canRestore. On click: reverseWalkTo to from_version, confirm if edits-since, notesApi.update with the pre-restore state + revert_undo_window cleared + historyMeta kind "undo-revert". Lazy expiry on read (the render gate checks expires_at; no background timer for v1). Case C on the undo walk -> clear the window + message.

## CRITICAL FLAG (canonicalize denylist)
revert_undo_window matches NONE of the current canonicalize VOLATILE_STAMP_DENYLIST patterns (updated_at/last_edited_*/_dirty/_local_only/*_hash/*_index/*_cache), so it WOULD be diffed into every delta AND make the restore row diff non-deterministic (its value is a timestamp). MANDATORY: add revert_undo_window to VOLATILE_STAMP_DENYLIST in canonicalize.ts, in the SAME change as the field. This edits a frozen on-disk contract.

## Case C (restore to a folded row)
Two defenses: (1) the sidebar already renders folded rows as a single non-selectable "Earlier versions (summarized)" group, so Restore is structurally unavailable there; (2) a stale UI that calls reverseWalkTo on a now-folded target gets HistoryCompactedTargetError -> offer the boundary fallback ("closest saved point is [day]; restore that?" -> reverseWalkTo(rows, 0) Case B).

## PI gate (already wired)
Owner: enabled, no passcode, unwrapped notesApi. PI with unlock: ownerScopedNotesApi routes to owner folder + emits audit automatically (no new audit code). PI no unlock: Restore DISABLED + Tooltip "Unlock edit mode (PI passcode) to restore". Read-only shared viewers: Restore HIDDEN. Undo follows the same three-way gate.

## Data-shape FLAGs
- FLAG-1: revert_undo_window on Note + NoteUpdate (types.ts).
- FLAG-2 (HEADLINE): revert_undo_window added to VOLATILE_STAMP_DENYLIST (canonicalize.ts). Mandatory; frozen-contract touch.
- FLAG-3: "undo-revert" added to HistoryEditKind union + isDeltaRow (history/types.ts). ("revert" already exists.)
- FLAG-4: revert_target_version?: number on DeltaRow (history/types.ts).
- FLAG-5: notesApi.update gains historyMeta?: { kind; revert_target_version? } (default {kind:"update"}); threaded through ownerScopedNotesApi + recordNoteHistory + appendEdit.
No other on-disk shape changes. BoundarySnapshotRow / GenesisRow / _pi_audit.json untouched.

## Build tasks
A (engine/schema, verify first): the 5 FLAGs + thread revert_target_version through appendEdit/recordNoteHistory/notesApi.update; unit tests (restore round-trip, undo round-trip, canonicalize ignores the window, Case C catchable).
B (UI sidebar): Restore button + confirm + Case-C boundary fallback; canRestore prop.
C (UI undo): header "Undo restore" + edits-since confirm + Case-C clear; PI-no-unlock disabled+Tooltip.
D (flag): RESTORE_ENABLED const (default false), flip after verification. Deferred follow-up: folder-connect expiry sweep (not needed for pilot correctness since the field is denylisted + render-gated).

## Flag posture + verification
Ship behind RESTORE_ENABLED=false (inert cherry-pick, like Phase 0->1). Verify before merge (data-mutating): Task-A unit suite + a verifier loop (mechanics: restore->revert row->undo->undo-revert row; spec; Case-C/compaction). PI cross-owner audit chain + the undo edits-since path are the highest-risk cases.

## Open UX decisions (gate the build)
1. Expiry sweep: lazy-only render-gate for the pilot (recommended; field lingers harmlessly, denylisted) vs build the folder-connect strip pass now.
2. After-restore focus: exit the sidebar to show the live restored note (recommended; surfaces Undo prominently) vs keep the sidebar open with HEAD selected.

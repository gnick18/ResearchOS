# VC Phase 3 design: version history + restore for ALL shareable entities

Author: VC-Phase-3 design pass (for HR), 2026-05-30. Rolls Phases 0/1/2 (Notes) out to the 8 shareable types. The engine is already entity-agnostic; Phase 3 = replicate a thin wiring layer per entity + generalize 2 components.

## What is Notes-specific today (all that Phase 3 replaces)
- notes-history.ts (recordNoteHistory + the flags + NOTES_ENTITY_TYPE), the save-path hook in notesApi.update, notes-viewer.ts (projectNoteState + summarizeChange), the sidebar ENTITY_TYPE const, and the popup-side restore controller (reconstructTarget/canonicalToPayload/handleRestore/handleUndoRestore). Everything else (engine, canonicalize, reconstruct, reverse-walk, compaction, the sidebar grouping/pagination/diff) is generic.

## Generalize 2 things (the prerequisite shared chip)
1. NoteVersionHistorySidebar -> EntityVersionHistorySidebar: replace the ENTITY_TYPE const + noteId with props {entityType, id, owner, adapter}. The adapter = { projectBody(canonical), summarize(before, after) }; each entity ships a ~40-line <entity>-viewer.ts. Grouping/pagination/compaction/keyboard/focus/restore-footer all move unchanged. Notes adapter already exists.
2. The popup restore controller -> a generic useVersionRestore({ entityType, id, owner, api, currentUser, onUpdate }) hook. reconstructTarget, the Case-C HistoryCompactedTargetError handling, the 24h revert_undo_window stamping, the undo edits-since guard all lift verbatim. canonicalToPayload becomes generic (drop per-entity immutable keys). Each entity's *Api.update grows the same optional 3rd historyMeta param (default {kind:"update"}, byte-for-byte back-compat).

## Flag posture: ONE global flag, not per-entity
The on-disk row shape is frozen + identical for every entity, so there is no per-entity schema risk to gate. Keep one HISTORY_ENGINE_ENABLED + one RESTORE_ENABLED (shared from a history-flags module). The real staging gate is SEQUENCING the per-entity wiring merges (a recordXHistory call site does not exist until its chip lands). Optional safety valve: a single HISTORY_ENTITY_DENYLIST Set inside the shared shim.

## The 4 REAL data-shape FLAGs (proposal 3g collapses post-R3)
R3 already landed last_edited_by/at on all 8, and the engine reads neither created_at/updated_at nor a real owner field (owner is a function arg). So:
1. FLAG-M (the only hard one): the Method markdown BODY lives in a separate methods/<slug>/<slug>.md file with NO *Api.update hook. Field edits get history; prose edits do not unless the body-write path is wired. Needs a body-write-hook micro-design. DO METHOD LAST.
2. FLAG-owner-resolution: PurchaseItem (inherited owner via parent Task), HighLevelGoal / MassSpecProtocol / LabLink (optional owner). The engine needs an owner arg; each shim resolves it the way that entity's trash writer already does (mirror softDeleteEntity).
3. FLAG-derived-cache denylist: end_date (Task), total_price (PurchaseItem), excerpt (Method) MUST be added to the canonicalize denylist or every save diffs a meaningless recompute.
4. FLAG-revert_undo_window field: add the field to each restorable entity interface (already GLOBALLY denylisted in canonicalize.ts, so no per-entity denylist work).

## Sequencing (recommended)
0. The shared-generalization chip (extract EntityVersionHistorySidebar + adapter + useVersionRestore; re-point Notes as the regression canary).
1. Task / Experiment (highest value: lab notes in deviation_log + per-method body_override/variation_notes; body on the record, no separate-file problem; TaskDetailPopup covers both; only gotcha = the end_date derived denylist).
2. Project. 3. HighLevelGoal. 4. PurchaseItem. 5. LabLink. 6. MassSpecProtocol + structured methods. 7. Method markdown body LAST (FLAG-M, the separate .md file).

## Per-entity chip (each self-contained)
(1) add revert_undo_window? + denylist any derived field; (2) add the optional historyMeta arg to <entity>Api.update + the prevState-read + post-persist recordXHistory (mirror notesApi.update); (3) write lib/history/<entity>-history.ts + <entity>-viewer.ts; (4) mount EntityVersionHistorySidebar + the version button at the popup header (VERSION_HISTORY_UI_DESIGN 2a); (5) wire useVersionRestore, gate on RESTORE_ENABLED && canWrite (+ PI passcode cross-owner); (6) tests (round-trip, reconstruct, restore + 24h undo, Case-C, derived-field-not-in-diff).

## Volume note
Method/MassSpec large boundary snapshots (R4-prep FU2, >1MB warn already in engine). Derived-cache denylist removes Task/PurchaseItem churn. No new compaction logic needed (500/100 window entity-agnostic).

## Open question for Grant
LabLink: proposal section 7 lists lab-global files as a non-goal, but LabLink is per-user-owned post-R1b, so the design reads it as IN scope. Confirm.

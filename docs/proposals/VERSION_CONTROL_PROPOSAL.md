# Version Control Proposal

**Author:** version control proposal drafter
**Date:** 2026-05-26
**Status:** Pre-implementation. No code yet. Open questions throughout, Grant locks in answers before any implementation chip fires.

---

## 0. TL;DR

Three pillars, one underlying primitive (per-entity append-only logs):

1. **Edit history with revert.** Every save on every record appends a row to a per-entity jsonl log. The Edit history tab on each popup renders the log; revert is a write that replays an older snapshot back into the live record (and itself becomes a new history row).
2. **Edit attribution.** Every record carries `last_edited_by` + `last_edited_at`. Inline chips in cards / popups show who touched it last. Full per-field actor history lives in the jsonl log.
3. **Soft delete via trash folder.** Deletes move records to `users/<u>/_trash/<entity_type>/<id>.json` with a sidecar index. Trash UI shows X days remaining; cleanup runs on folder-connect.

The proposal is sized for ~3 months of phased work (R1 through R6). Every phase ships value; none requires the next to be useful. R1 is the canary (trash for notes only) so the on-disk shape can stabilize before it goes everywhere.

This document does NOT implement anything. It locks the data model + UI + phasing, flags fifteen open questions for Grant, and enumerates eighteen edge cases the eventual implementation chips will own.

---

## 1. Motivation

Research data has a different relationship to time than consumer data. A note about a PCR run from eight months ago is not "old, who cares", it is the experimental record. The current ResearchOS guarantees around that record are weaker than they should be:

- **Accidental delete.** If a graduate student clicks the trash icon on the wrong note, the JSON is gone. Notes have a soft-delete primitive already (see §2 below), but every other entity type (Task, Method, PurchaseItem, Project, Experiment, HighLevelGoal, LabLink, MassSpecProtocol) hard-deletes. A misclick on a Method or a Project is irrecoverable.
- **Silent overwrites.** The hybrid markdown editor buffers per-blur. A labmate (or a Lab Head editing across owners) can overwrite a paragraph the original author wrote two weeks earlier and there is no record of what was there before. The PI audit log captures the pair, but it is PI-only; the ordinary user has no view into their own edit history.
- **Post-departure forensics.** When a grad student leaves the lab, their work goes with them, but their data stays in the folder. If the next year's student wonders "why does this note say 0.5 uM instead of 5 uM, was that a transcription error?", there is nothing to look at. Was it always 0.5? Was it 5 and someone fixed it? Was a Lab Head correcting a known error or introducing one?
- **IRB / regulatory audits.** Some labs receive grants (NIH, NSF, USDA) that require an immutable record of changes to experimental data. ResearchOS's local-first posture means the folder owner can always edit the JSON by hand on disk, so we can't promise immutability in the strict sense. But we can promise "if you only edit through the app, every edit is recorded." That is the contract most regulatory regimes actually ask for.
- **Lab head oversight.** Phase 5 of the Lab Head proposal lets a PI edit any record in any user's folder after entering the passcode. The PI audit log records this. But the audited user, the grad student whose record got edited, has no UI to inspect the history. They see only the post-edit value, with no signal that an edit happened.

### What is already in place

The existing surface is partial and uneven:

| Surface | Where it is | What it covers | Gap |
|---|---|---|---|
| **PI audit log** (`_pi_audit.json`) | `frontend/src/lib/lab/pi-audit.ts` | Per-field old/new diff for PI cross-owner edits during a Phase 5 unlock window. Append-only. | PI-only. Same-user edits not captured. No UI surface for the audited user. No revert. |
| **Note soft-delete** | `frontend/src/lib/notes/notes-trash.ts` | Notes move to `users/<u>/notes_trash/<id>.json` on delete. Undo restores the same id. | Notes only. No UI for browsing the trash. No auto-expire. Sidecar lookups are O(scan-dir). |
| **User tombstones** | `_user_metadata.json` `deleted_at` field | Deleted users keep a tombstone so OneDrive resurrection doesn't un-delete. See `frontend/src/lib/user-tombstone.test.ts`. | One-way. Tombstoned users can be hidden but not restored. |
| **Project activity feed** | `frontend/src/lib/project-activity/event-log.ts` | Append-on-mutation sidecar at `users/<projectOwner>/projects/<projectId>-activity.json`. Tracks task_completed, image_added, method_added. | Project-scoped only. Doesn't track field-level edits. No revert. |
| **Updated_at timestamps** | Scattered across `lib/local-api.ts` | Every entity carries `updated_at: string`. | No `updated_by`. No history of prior values. |
| **Value history (undo/redo)** | `frontend/src/lib/undo/value-history.ts` | In-memory past/future stacks for the markdown editor textarea. Cmd+Z works within one editing session. | In-memory only. Refresh the page, lose the stack. Per-editor, not per-record. |
| **Unified sharing primitive** | `frontend/src/lib/sharing/unified.ts` | `owner` + `shared_with: SharedUser[]` on every shareable record. | This is the foundation we extend, not a gap. |

The gap pattern is consistent: we have parts of every pillar, but no unified system. Notes have a trash directory; nothing else does. The PI has an audit log; the user does not. The editor has in-memory undo; the record has no persistent history.

This proposal threads those pieces into one model.

### Why now

Three signals from the past quarter point to this being the next wave:

1. The Lab Head Phase 5 audit log shipped and immediately surfaced the asymmetry: PIs see edit history, members don't.
2. The Hybrid editor migration to buffered-on-blur saves (HYBRID_EDITOR_V2) reduced edit frequency from "every keystroke" to "every focus change," which makes per-save history economically tractable for the first time.
3. The PI's "I want to know what my students changed without unlocking the passcode" Slack thread (2026-05-20) made it explicit that read-only history is a real PI need, not a hypothetical.

---

## 2. User-facing design

The three pillars surface in five places in the UI: a tab on every popup, attribution chips on every card, a trash route, an inline diff viewer, and a restore-with-dependencies prompt.

### 2a. Edit history tab on every popup

Every detail popup (NoteDetailPopup, TaskDetailPopup, ExperimentDetailPopup, MethodDetailPopup, ProjectDetailPopup, PurchaseItemPopup) grows a new "History" tab in the existing tab strip alongside "Details" / "Comments" / "Sharing" / "Activity." The tab opens to a vertical timeline:

```
┌─ History ──────────────────────────────────────────────────────┐
│                                                                │
│  Today, 2:14 PM        Alex edited "title"                     │
│  ┌────────────────────────────────────────────────────┐  [↶]   │
│  │ - PCR with primers P1/P2                           │        │
│  │ + PCR with primers P1/P2, replicate 2             │        │
│  └────────────────────────────────────────────────────┘        │
│                                                                │
│  Yesterday, 9:01 AM    Alex edited "entries[0].content"        │
│  ┌────────────────────────────────────────────────────┐  [↶]   │
│  │ - 25 uL master mix                                 │        │
│  │ + 25 uL master mix, 1 uL template                  │        │
│  └────────────────────────────────────────────────────┘        │
│                                                                │
│  May 18, 4:32 PM       Morgan (lab head) edited "tags"         │
│  ┌────────────────────────────────────────────────────┐  [↶]   │
│  │ - ["pcr"]                                          │        │
│  │ + ["pcr", "reviewed"]                              │        │
│  └────────────────────────────────────────────────────┘        │
│                                                                │
│  May 14, 11:00 AM      Alex created this note                  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

Each row carries:
- **Timestamp** (relative for recent edits, absolute for older).
- **Actor name** with a small chip if the actor was a different user than the owner ("Morgan (lab head)" or "Alex (shared)"). Owner self-edits show just the name.
- **Field path** in human-readable form ("title", "entries[0].content", "tags", "sub_tasks[2].is_complete"). The on-disk path uses dot notation; the UI prettifies on render.
- **Inline diff preview** (red strike for removed, green for added). Long values truncate with "show full" expand.
- **Revert chevron** at the right margin. Click → confirm modal ("Revert this field to its earlier value?") → write. The revert itself becomes a new history row ("Alex reverted 'title' to its May 14 value").

The "created this note" row at the bottom is the Genesis entry. Records that pre-date the version-control rollout get a synthetic Genesis row stamped on first read (see §3e). No field diff on Genesis.

The tab is scrollable. Default order is newest-first. Default page size is 50 rows; "Load older" button at the bottom appends another 50.

### 2b. Attribution chips inline

Two chip styles depending on real estate:

**Card view (Notes index, Tasks list, Methods library, Workbench):**

A small footer line under the card body, picking up the existing pattern from comment chips.

```
[N] PCR setup for compound C-217
    Last edited by Alex 2 days ago · 4 entries · 3 comments
```

When the last editor is someone other than the owner, the chip surfaces both:

```
[N] PCR setup for compound C-217
    Owned by Mira · Last edited by Morgan (lab head) 6 hours ago
```

**Popup header (every detail popup):**

A "stamps" row under the title, between the title and the tab strip:

```
PCR setup for compound C-217
Owned by Mira · Created May 14 · Last edited by Morgan 6h ago · [History →]
```

The `[History →]` link is a shortcut to the History tab (same as clicking the tab itself, but more discoverable from the stamps row).

Three text variants by actor:

- Owner self-edit: "Last edited by Alex"
- Shared user with edit access: "Last edited by Morgan (shared)"
- Lab Head via passcode: "Last edited by Morgan (lab head)"

The shared / lab head suffix is decoration only, the actor field on disk is just the username. The wrapper that builds the chip reads the viewer's account_type + the share-with entry to pick the right suffix at render time.

### 2c. Trash surface

A new top-nav route `/trash` (icon: trash can; positioned between Settings and the user avatar). The trash page lists every soft-deleted record in the current user's folder, grouped by entity type, sortable by deleted-at descending.

```
┌─ Trash ──────────────────────────────────────────────────────┐
│  Cleanup window: 30 days · [Configure...]                    │
│                                                              │
│  ▾ Notes (12)                                                │
│    ┌────────────────────────────────────────────────────┐    │
│    │ PCR setup, replicate 4                             │    │
│    │ Deleted by Alex · 3 days ago · 27 days remaining   │    │
│    │ [Restore] [Permanent delete]                       │    │
│    └────────────────────────────────────────────────────┘    │
│    ┌────────────────────────────────────────────────────┐    │
│    │ Sandbox note (untitled)                            │    │
│    │ Deleted by Alex · 28 days ago · 2 days remaining   │    │
│    │ [Restore] [Permanent delete]                       │    │
│    └────────────────────────────────────────────────────┘    │
│                                                              │
│  ▸ Tasks (3)                                                 │
│  ▸ Methods (1)                                               │
│  ▸ Projects (0)                                              │
│  ▸ Purchases (5)                                             │
│                                                              │
│  [Empty trash...]   ← permanent-delete everything            │
└──────────────────────────────────────────────────────────────┘
```

- **Restore** writes the record back into its live directory, removes the trash file, and appends a history row ("Alex restored from trash"). If the parent (a Project, a Task) was also deleted, the restore prompt asks "Restore parent too?" (see §2e).
- **Permanent delete** prompts a confirmation modal ("This cannot be undone. Type DELETE to confirm.") then removes the trash file. The record is now gone.
- **Empty trash** is a bulk permanent-delete with the same confirmation.
- **Configure cleanup window** opens a Settings page section (see OQ1).

Lab Head sees a top-of-page toggle "View as: me / Alex / Morgan / Mira" that scopes the trash list to the chosen user's folder. The PI's trash is empty unless they themselves deleted something while not in lab-head mode; cross-user deletes the PI made show up under each affected user's trash, not in the PI's.

### 2d. Inline diff viewer

The history-tab diff for short scalar fields (title, name, due_date) renders inline. For long fields (a markdown body, a long entries[i].content), the preview shows the first 80 chars of each side with "show full diff" that opens a modal full-screen viewer.

The modal full-screen viewer is a side-by-side diff (old left, new right) for prose and a structural diff (JSON-style indentation, line-prefix `+` / `-` / ` `) for arrays / objects. Implementation leans on a lightweight diff lib (jsdiff or similar, picked at implementation time, no hard dependency lock here).

### 2e. Restoration with dependencies

When a user restores a record whose parent is also deleted, the app needs to decide what to do. The decision is contextual:

- **Restore a Note whose Project is in trash.** Prompt: "The project 'PCR Replicates' that contains this note is also deleted. Restore it too?" Buttons: "Restore both" (default), "Just the note" (orphans it with `project_id` set to a soft-deleted project, falls back to the misc project), "Cancel."
- **Restore a Task whose Project is in trash.** Same prompt as above.
- **Restore a SubTask whose parent Task is hard-gone (not in trash).** Refuse: "The parent task no longer exists. Cannot restore this sub-task." Sub-tasks are a sub-record inside a Task, so they never go in trash standalone anyway, this case is hypothetical for now.
- **Restore a Method whose parent compound-method is gone.** Restore standalone (the compound-method reference becomes a dangling pointer, which the compound-graph normalizer already handles for archived methods).
- **Restore a PurchaseItem whose parent Task is in trash.** Prompt to restore the Task too (same as Note → Project).
- **Restore an Experiment (Task with task_type === "experiment").** Same as Task.
- **Restore an Image attachment (when the parent Note is in trash).** Images are not first-class trashable entities (see OQ7). They follow the parent Note.

Default behavior is restore-with-parent when the parent is also in trash and refuse-when-parent-is-hard-gone. The dialog is always shown so the user can override.

### 2f. Settings additions

A new Settings → "History & Trash" tab:

- **Cleanup window** (radio): 7 days / 30 days / 90 days / Never (manual cleanup only). Default: 30 days. Per-user setting, lives on `_user_settings.json`.
- **History tracking** (toggle): On / Off. Default: On. When Off, no jsonl writes happen on this user's records. Genesis entries still write on Off→On transition (see OQ8).
- **History storage cap** (radio): Last 100 / Last 500 / Last 2000 / All. Default: All until OQ3 lands. When a cap is set, old entries get rolled up into a "compacted" entry (see §3d).
- **Lab Head policy override**: A lab-head-only section that reads "When PIs edit your records, edit history is always recorded regardless of the toggle above. Your trash and history tracking settings apply only to your own edits." This is informational, the PI's audit log is mandatory; the user's toggle only affects their own edits.

### 2g. Empty state copy

Trash empty state: "Nothing in your trash. Deleted records stay here for [N] days before being permanently removed."

History tab empty state on a brand-new record: "This is a fresh record. Edit history starts on the next save."

History tab empty state on a record that pre-dates the version-control rollout: "This record was created before edit history was enabled. Future edits will appear here."

---

## 3. Data model

### 3a. Trash folder layout

Each user's folder grows a `_trash/` subdirectory:

```
users/
  <username>/
    _trash/
      _index.json
      notes/
        47-PCR-setup-for-compound-C-217.json
        88-Sandbox-note-untitled.json
      tasks/
        102-Run-PCR-replicate-3.json
      methods/
        12-Standard-PCR-2x-mix.json
      projects/
        4-Old-rotation-project.json
      purchase_items/
        301-Phusion-polymerase.json
        302-1M-Tris-HCl.json
      experiments/
        (empty, experiments are tasks; they live under tasks/)
      high_level_goals/
      lab_links/
      mass_spec_protocols/
```

The filename pattern is `<id>-<slug-of-name>.json` where the slug is the original record's name field, with non-alphanumerics replaced by hyphens and truncated to 60 chars. The slug is decorative (helps a user opening the trash directly on disk); only the `<id>` prefix is load-bearing.

Inside each trash file is the original record JSON with three additional fields:

```ts
interface TrashedEntity<T> {
  // ... all original fields of T, unchanged ...
  _trash: {
    deleted_at: string;          // ISO 8601 timestamp
    deleted_by: string;          // username of the actor who deleted
    deleted_during_session?: string;  // PI-edit session id if applicable
    auto_expires_at: string;     // deleted_at + cleanup_window from settings
    original_path: string;       // e.g. "users/Alex/notes/47.json"
    restore_metadata?: {
      parent_id?: number;        // e.g. project_id at time of delete
      parent_trash_path?: string; // if parent is also in trash
    };
  };
}
```

The `_trash` field is the only difference between a live record and a trashed record. Restore strips this field before writing back.

### 3b. Trash index sidecar

The directory scan can answer "what's in trash?" by reading every file, but two cases need an indexed view: the Lab Head's cross-user trash view (Phase R5 from Lab Head Phase 5; Lab Head sees every member's trash) and the auto-cleanup pass (which needs to find expired entries without reading every file).

The sidecar at `users/<u>/_trash/_index.json`:

```ts
interface TrashIndex {
  version: 1;
  entries: TrashIndexEntry[];
  last_cleanup_at: string | null;
}

interface TrashIndexEntry {
  id: string | number;
  entity_type: "note" | "task" | "method" | "project" | "purchase_item" | "high_level_goal" | "lab_link" | "mass_spec_protocol";
  trash_path: string;           // "_trash/notes/47-PCR-setup.json"
  original_path: string;        // "users/<u>/notes/47.json"
  deleted_at: string;
  deleted_by: string;
  auto_expires_at: string;
  parent_id?: number;
  parent_trash_path?: string;
}
```

Index is rebuildable from a directory scan if it gets out of sync (deleted, OneDrive merge conflict, manual file deletion on disk). On startup the trash service does a quick sanity check: count files in `_trash/<type>/` vs count entries in the index, rebuild if they diverge by more than 5%. The 5% threshold tolerates the racy case where the index write hasn't caught up with the file move.

The index is *not* authoritative for what's in trash, the files are. The index is a read-time optimization. This matches the `_pi_audit.json` philosophy: the files are the ground truth, the indices are cached reads.

### 3c. Edit history layout (design (a), chosen)

Per-entity append-only jsonl logs:

```
users/
  <username>/
    _history/
      notes/
        47.jsonl
        88.jsonl
      tasks/
        102.jsonl
      methods/
        12.jsonl
      ...
```

One file per record. Each line is one JSON object, one row per save. The schema:

```ts
interface HistoryRow {
  // Unique row id, UUID. Stable across reads.
  id: string;
  // ISO 8601 timestamp at write.
  ts: string;
  // Schema version of the row format. Currently 1.
  v: 1;
  // The user who performed the edit.
  actor: string;
  // The record owner at the time of the edit (= the folder this file lives in).
  // Redundantly stored so rows copied out of context stay self-describing.
  owner: string;
  // What kind of edit this is.
  kind: "create" | "update" | "delete" | "restore" | "revert" | "rename" | "genesis";
  // Per-field changes. Empty for "create" / "delete" / "genesis".
  fields?: HistoryFieldChange[];
  // For "revert" rows: the row id we reverted to.
  reverted_to?: string;
  // For PI cross-owner edits: the Phase 5 session id.
  session_id?: string;
  // Parent reference for cascading restores. Set on "delete" and "restore".
  parent?: { entity_type: string; id: string | number };
  // Hash of the post-edit record (sha256 of canonical JSON).
  // Lets readers verify the live record matches the latest history row's
  // expected state, and lets revert detect if a downstream edit landed
  // between the user opening the History tab and clicking revert.
  post_hash: string;
}

interface HistoryFieldChange {
  // Dot-path: "title", "entries[0].content", "sub_tasks[2].is_complete".
  // Free-form so new fields don't break the writer.
  field: string;
  // Pre-edit value. JSON-cloneable.
  old: unknown;
  // Post-edit value. JSON-cloneable.
  new: unknown;
}
```

Append-only: the writer does `fileService.appendLine(historyPath, JSON.stringify(row))`. A new helper `appendLine` is added to `file-service.ts` (it does not exist yet; the current writers all do read-modify-write). For OneDrive / Dropbox sync friendliness, the append is implemented as a read-modify-write on the file (read the whole file, concat the new line, write back via the atomic `.tmp` + move pattern) until/unless we adopt a real append-only primitive. Performance: at 50 edits per record per day across 100 records, the per-record file stays small enough that read-modify-write is fine for years. At 1000 edits per record (a pathological hybrid-editor-fires-per-keystroke regression), see §3d.

### 3d. History compaction

When a record's `_history/<type>/<id>.jsonl` exceeds N rows (default N = 500, configurable per OQ3), the writer triggers a compaction pass:

1. Read all rows.
2. Pick the oldest 80% (the keep-window).
3. For each consecutive group of rows that touch the same `field` within 10 minutes of each other, collapse into a single row with the earliest `old` value and the latest `new` value. Actor becomes a `,`-joined list if it spanned multiple users. ts is the latest ts.
4. Append a synthetic `kind: "compacted"` marker row to the end of the keep-window noting how many rows were collapsed.
5. Write the result back.
6. The newest 20% (the recent-window) is preserved verbatim, every row is intact for the most recent activity.

Compaction is lossy: a series of "title: A → B → C → D" edits becomes "title: A → D" with the intermediate values lost. The trade-off is bounded growth. OQ3 lets Grant turn this off and accept unbounded growth instead.

### 3e. Why design (a) over (b) and (c)

The brief asks to pick one of three:

- **(a) Per-entity jsonl files** (chosen): `_history/<type>/<id>.jsonl` per record.
- **(b) Centralized user jsonl**: `_history.jsonl` for the whole user.
- **(c) Per-write snapshot files**: `_history/<type>/<id>/<timestamp>.json` per save.

Trade-offs:

| Concern | (a) per-entity jsonl | (b) centralized jsonl | (c) per-write snapshots |
|---|---|---|---|
| Storage on disk | Medium. One file per record; rows are field-diffs. | Medium. One file total; same content. | Heavy. One file per save; whole-record snapshots are bigger than diffs. |
| Read perf for History tab | Fast. One small file read. | Slow. Scan the whole user log, filter by entity. | Fast. Glob the per-record dir. |
| Read perf for "lab-wide activity" | Medium. N file reads. | Fast. One file read. | Slow. Glob across many dirs. |
| Write perf | Fine. One read-modify-write per save. | Bad on busy users. Every save serializes on one file. | Good. New file per save, no contention. |
| OneDrive sync friendliness | Good. Small files, rare conflicts. | Bad. One large file = constant sync conflicts. | Bad. Many tiny files = OneDrive churn (the same anti-pattern that made us batch the `Files/` PNG writes). |
| Compaction | Per-record bounded growth. | Whole-user log grows forever. | Per-record file count grows forever (no compaction; each snapshot is whole). |
| Restore granularity | Field-level (we have the old/new pair). | Field-level. | Whole-record (snapshot is the whole entity). |
| Cross-user PI audit overlap | Easy. PI audit is a separate file, no integration needed. | Hard. Risk of duplicating the audit log. | Easy. |

**(a) wins on three axes that matter most for ResearchOS:** OneDrive sync friendliness, write performance under hybrid-editor-blur volume, and per-record compaction. The "lab-wide activity feed" use case (where (b) is faster) is already covered by the Project activity feed and the PI audit log; we don't need history to double as that surface.

**(c) is a fallback if (a) hits a wall** (e.g. read-modify-write under heavy load proves too slow). The migration from (a) to (c) is mechanical: split each `.jsonl` into a directory of files keyed by the `id` field.

**(b) is rejected.** OneDrive conflict storms on a single large file would surface as data loss, not just slow saves. Not worth the read perf gain on a non-critical surface.

### 3f. Attribution field additions

Every shareable entity grows two optional fields:

```ts
interface ShareableRecord {
  // Existing fields ...
  owner: string;
  shared_with: SharedUser[];

  // New (additive, optional on read):
  last_edited_by?: string;
  last_edited_at?: string;
}
```

Set at every `update` call site in `local-api.ts`. The Note interface already has `updated_at` (mandatory) and `username` (the original author); `username` doubles as the creator. The new `last_edited_by` covers the case where username !== last editor.

For records that already have a `created_by` (Method) or `username` (Note) field, those stay as the creator stamp. `last_edited_by` is purely the most-recent editor.

Migration: existing records without `last_edited_by` read as "unknown" in the UI. On the next save the field gets stamped. No backfill, the genesis row in the history log will eventually carry the creator if we want to retro-stamp it, but the live record's `last_edited_by` only fills in on the next write.

### 3g. Entity-by-entity audit

| Entity | Already has trash? | Has owner? | Has created_at? | Has updated_at? | Has author? | Gap |
|---|---|---|---|---|---|---|
| **Note** | YES (`notes_trash/`) | YES | optional | YES | `username` | Move trash to `_trash/notes/`. Add `last_edited_by`. |
| **Task** | NO | YES | NO | NO | NO | Soft-delete primitive + created_at + updated_at + last_edited_by + last_edited_at. (FLAG) |
| **Method** | NO | YES | NO | NO | `created_by` | Soft-delete + created_at + updated_at + last_edited_by + last_edited_at. (FLAG) |
| **Project** | NO (has `is_archived` instead) | YES | YES | NO | NO | Soft-delete + updated_at + last_edited_by. Reconcile with existing `is_archived` (see §3h). (FLAG) |
| **PurchaseItem** | NO | inherited from Task | NO | NO | NO | Soft-delete + created_at + updated_at + last_edited_by. (FLAG) |
| **HighLevelGoal** | NO | file-scoped | NO | NO | NO | Soft-delete + owner + created_at + updated_at + last_edited_by. (FLAG, this entity needs the most new fields) |
| **LabLink** | NO | NO (`shared_with: ["*"]` after sharing R1) | NO | NO | NO | Same as HighLevelGoal. (FLAG) |
| **MassSpecProtocol** | NO | optional `owner?` | NO | NO | NO | Soft-delete + standardize owner + created_at + updated_at + last_edited_by. (FLAG) |

The (FLAG) entries are the data-shape touches the brief asks me to surface in advance. All eight entity types need the four-field block (created_at, updated_at, last_edited_by, last_edited_at) for full coverage. The flag is BEFORE implementation, not after, Grant should decide whether we standardize all eight in R3 or keep the per-entity drift.

### 3h. Reconcile with existing `is_archived` on Project

Project has `is_archived: boolean` + `archived_at: string | null` today. Semantics: an archived project is hidden from default views but is NOT deleted. The user un-archives it by toggling the flag.

Trash is different: a trashed project is gone from every view including the archive list, sits in `_trash/projects/`, and auto-expires.

The two should coexist:

- Archive = "I am done with this project but keep it for reference."
- Trash = "I want this gone, with a recovery window."

The Project popup gets two buttons: "Archive" (toggles `is_archived`, stays where it is) and "Delete" (moves to trash, auto-expires). The current "Delete" button on Projects, which today hard-deletes, gets routed to the trash path.

### 3i. Sidecar schema version bump

The onboarding sidecar at `users/<u>/_onboarding.json` carries a `SCHEMA_VERSION`. The current version is 5 (Lab Head Phase 6 archive fields). This proposal bumps to **SCHEMA_VERSION: 6** for:

- The new `_user_settings.json` keys: `trash_cleanup_window_days`, `history_tracking_enabled`, `history_storage_cap`.
- The new `last_edited_by` / `last_edited_at` fields on every entity type.

The migration is purely additive, no destructive rewrites. Existing records without the new fields read as `undefined` and stay that way until next write. Records get backfilled on first edit.

### 3j. Migration: Genesis entries

For every existing record on disk at the time the version-control system first runs:

1. On first read of a record without a `_history/<type>/<id>.jsonl` file, the read path lazily writes a Genesis row:
   ```json
   {
     "id": "g-<uuid>",
     "ts": "<the record's created_at, or its updated_at if no created_at, or now>",
     "v": 1,
     "actor": "<the record's created_by / username, or 'unknown'>",
     "owner": "<the record's owner>",
     "kind": "genesis",
     "post_hash": "<sha256 of the record at first-read time>"
   }
   ```
2. This is a one-time write per record. Genesis rows have no `fields` array, they capture "this is the state at first observation, no diff available."
3. The lazy backfill is best-effort: if writing the Genesis row fails (disk full, OneDrive locked), the record reads fine but the History tab will show "No history available." The next save will write a `kind: "create"` row anachronistically, slightly weird but acceptable for one cycle.

This is the same lazy-backfill pattern as the unified sharing migration: on-read normalization, idempotent, no app-wide migration sweep.

### 3k. Integration with the PI audit log

Two append-only logs serving overlapping needs:

- **PI audit log** (`_pi_audit.json`): PI-only, cross-owner edits only, lab-head's session-id-scoped, JSON-array shape.
- **Version-control history** (`_history/<type>/<id>.jsonl`): all edits by all actors (PI included), jsonl shape.

The duplication is intentional, not a bug. The PI audit log is the regulatory / surveillance surface, it's read by lab heads as a single timeline, scoped to PI activity, and survives across record deletes (the record can be trashed while its `_pi_audit.json` entries persist). The version-control history is the per-record surface, used by the History tab on the record's popup.

Both get written on PI cross-owner edits. The write path:

```
PI edits Mira's note:
  1. ownerScopedNotesApi.update(...) is called.
  2. The wrapper writes the note + appends a row to:
     a. users/Mira/_pi_audit.json (existing path).
     b. users/Mira/_history/notes/47.jsonl (new path).
  3. Both writes are best-effort; failure of (b) does not roll back (a).
```

OQ6 covers whether the redundancy is OK long-term or whether one should subsume the other.

---

## 4. Phased implementation

### Phase R1, Trash MVP for Notes (canary)

**Goal:** prove the trash surface end-to-end on one entity type before extending to all eight.

Notes already have soft-delete (`notes_trash/`). R1 migrates that primitive to the new `_trash/notes/` layout, adds the `_index.json` sidecar, adds the `/trash` route, adds the cleanup-window setting, and runs the auto-cleanup pass.

Deliverables:
- Migrate `users/<u>/notes_trash/` → `users/<u>/_trash/notes/` (mechanical rename).
- Add `_trash` field block to trashed records; backfill on migration.
- Add `_trash/_index.json` sidecar; build from a directory scan on first read.
- New route `/trash` with the Notes-only tree.
- New Settings section "History & Trash" with cleanup-window radio.
- Auto-cleanup pass on folder-connect: scan `_index.json` for expired entries, hard-delete each.
- Tests: trash-restore round-trip; auto-expire after the configured window; index rebuild from disk; PI views Mira's trash.

Dependencies: none (sharing primitive is already shipped).

Scope: **medium.** Most of the work is the new UI route + the Settings section; the trash file primitive is mostly already there for Notes.

### Phase R2, Trash everywhere

Extend trash to Task / Method / Project / PurchaseItem / Experiment / HighLevelGoal / LabLink / MassSpecProtocol. Each entity's existing delete call site routes to the trash writer instead of hard-delete.

Deliverables:
- Per-entity trash writer + restore reader in each entity's lib directory (parallel to `notes-trash.ts`).
- Wire each existing `delete` call in `local-api.ts` through the trash writer.
- Each entity's index card / popup grows a "Restore from trash" hover state if the entity is in trash and the user opened it from a stale tab.
- Restore-with-dependencies prompt for Note → Project and Task → Project chains.
- Reconcile Project's `is_archived` with the new trash (see §3h).
- Trash route's tree grows the other entity types.

Dependencies: R1 (the `_trash/` layout + the trash route exist).

Scope: **large.** Eight entity types, each with their own existing delete path; testing surface is wide.

### Phase R3, Attribution stamps

Add `last_edited_by` + `last_edited_at` to every entity. Wire the existing `update*` call sites in `local-api.ts` to stamp them. Add the inline chips on cards and the stamps row on popups.

Deliverables:
- Schema bump to SCHEMA_VERSION 6.
- Field additions to all eight entity interfaces + their *Create / *Update shapes.
- `last_edited_by` / `last_edited_at` stamping in every `update*` function in `local-api.ts`.
- New component `<AttributionChip>` for the card footer and the popup stamps row.
- Update every card index (NotesIndex, WorkbenchList, ExperimentsGallery, MethodsLibrary, ProjectsHome, PurchaseTable) to render the chip.
- Update every detail popup to render the stamps row.
- Tests: stamping fires on every entity's update; chips render correctly across owner / shared / lab-head actor cases.

Dependencies: none for the data layer; R1+R2 are independent. The UI chip ships best after R2 so the trash entries also stamp correctly.

Scope: **medium-large.** Field additions are mechanical, but every card / popup needs the chip wired.

### Phase R4, Edit history MVP for Notes

The canary again. Per-record jsonl log + History tab on NoteDetailPopup. No revert yet, read-only history viewer.

Deliverables:
- New `frontend/src/lib/history/` directory with:
  - `history-writer.ts` (append-row primitive, build-diff helper).
  - `history-reader.ts` (read+parse jsonl, paginate, filter by field).
  - `history-types.ts` (interfaces).
- New `appendLine` helper in `file-service.ts`.
- Wire `notesApi.update` and `notesApi.create` to emit history rows.
- New History tab on `NoteDetailPopup` with the timeline UI from §2a (no revert button yet, just preview).
- Genesis backfill on first read of legacy notes.
- Tests: append + read round-trip; Genesis on legacy reads; field-diff computation matches existing `buildFieldDiffEntries` shape; compaction at 500 rows.

Dependencies: R3 (for the `last_edited_by` stamp that the History tab uses).

Scope: **large.** New library, new UI tab, new write hook in every Note mutation site, compaction logic.

### Phase R5, Edit history everywhere

Extend the history writer + History tab to Task / Method / Project / PurchaseItem / Experiment / HighLevelGoal / LabLink / MassSpecProtocol.

Deliverables:
- Wire each entity's `update` / `create` / `delete` / `restore` call sites to emit history rows.
- Add the History tab to TaskDetailPopup / MethodDetailPopup / ExperimentDetailPopup / ProjectDetailPopup / PurchaseItemPopup / (others as appropriate).
- Update the trash flow to emit a `kind: "delete"` row when trashing and a `kind: "restore"` row when restoring.
- Wire the PI audit log writers to also emit a history row alongside the audit entry (so cross-owner edits show up in both).
- Tests: each entity's history round-trip; PI cross-owner edits emit both audit + history.

Dependencies: R4 (the library is in place).

Scope: **large.** Same shape as R4 but multiplied by seven entity types.

### Phase R6, Revert UX

The "undo any edit any time" promise. A revert button on every History row, with the restore-with-dependencies prompt for edits that touched a parent field.

Deliverables:
- Revert button on every history row in the History tab.
- Revert handler:
  1. Read the row's `old` value.
  2. Re-read the live record (might have moved on since the History tab opened).
  3. If `post_hash` of the row's predecessor matches the current live record's hash on the target field, fast-path: write `old` back, append a `kind: "revert"` row referencing the original row's id.
  4. If the hash mismatches (another edit landed after the one we're reverting), prompt: "This field has been edited since. Reverting will overwrite the most recent value [show the value]. Proceed?"
- Revert across deletes: if you trash a record and want to revert the delete, the trash UI's "Restore" button is the answer (already there from R1). If you trash a record AND a downstream edit changed a sibling field, the History tab on the restored record shows both events and lets you revert each one independently.
- Tests: simple field revert; concurrent-edit-since-then prompt; revert-of-revert (the new revert row gets its own revert button); revert chain depth.

Dependencies: R5 (history-everywhere).

Scope: **medium.** The core logic is one function; the UX polish (confirm modal, hash mismatch handling) is the bulk.

### Optional Phase R7, Lab head history surface

A dashboard widget for lab heads to see "edits to your members' records this week", same shape as the Activity widget, but reading the history logs instead of the project-activity sidecar. This is a polish phase, optional, can ship later.

---

## 5. Edge cases

Eighteen, ordered by likelihood of biting us:

1. **Image attachments in trashed notes.** A note has `entries[i].content` referencing `Files/foo.png`. When the note moves to `_trash/notes/47.json`, the image stays in `Files/`. The History tab needs to know about this when rendering an old version. Solution: image references in trashed notes stay live (the file isn't deleted); on permanent delete of the note, the image's reference count drops to zero and the image is hard-deleted. Reference counting requires scanning live notes for `Files/foo.png` references on permanent-delete, slow, but rare. OQ7.
2. **Two users editing the same record.** User A opens the popup, types, blurs. Meanwhile User B (shared, edit access) blurs first. Their writes interleave. The history log captures both rows; the live record reflects last-write-wins. If A's row writes a field B never touched, no conflict. If both touched the same field, last-write-wins and the History tab shows both rows. No special conflict resolution, this is local-first; users coordinate out of band.
3. **Massive history files.** A record edited 50 times per day for a year is 18000 rows. Compaction at 500 rows keeps the file bounded; the recent 100 rows stay verbatim, the older 400 get collapsed to ~50 representative rows. OQ3 controls the cap.
4. **Restore conflicts.** User trashes Note id 47. The trash auto-expires it after 30 days. A new Note is created at the same id 47 (the id allocator reuses the slot). The user then restores from trash, the index has the trash file still, but the trash-cleanup pass should have already removed it. Defense: trash-cleanup runs on folder-connect AND on each restore attempt; restoring an expired entry surfaces "This trash entry expired and is gone." The id allocator does NOT reuse slots while there is a record in `_trash/<type>/<id>.json` (the trash scan is part of the id allocator's "next free" calculation).
5. **Trash auto-cleanup timing.** When does cleanup run? Options: folder-connect, daily background timer, user-triggered. Default is folder-connect (cheap, predictable). OQ1 covers the cleanup window choice.
6. **Lab head editing across users.** PI Morgan edits Mira's note. The history row's `actor` is "Morgan." The `owner` is "Mira." The popup chip says "Last edited by Morgan (lab head)." The PI audit log ALSO gets the entry. Both surfaces stay consistent.
7. **Cross-folder restore.** User moves their lab folder to a new location (FSA picker re-runs). Trash + history move with them automatically (they're inside `users/<u>/`). No special handling.
8. **Performance: history tab for a record with 1000+ edits.** The History tab paginates at 50 rows. The jsonl reader streams from the end (newest-first) and stops after 50 lines. Even at 18000 rows, the initial paint is fast. "Load older" reads the next 50.
9. **Sidecar tamper.** A user manually deletes `_trash/_index.json` from disk. On next read, the trash reader detects the missing index, rebuilds from a directory scan. No data lost.
10. **History tamper.** A user manually deletes `_history/notes/47.jsonl`. The History tab shows "No history available", same as a legacy record. The next save writes a fresh log starting from `kind: "create"`. No detection / no warning (we can't tell whether the user wanted it gone or it's an accident).
11. **Settings opt-out interaction with PI audit.** If User Alex toggles "History tracking: Off" and then a PI edits Alex's record, the PI audit log MUST still write (regulatory requirement). The history jsonl write is also forced on for PI cross-owner edits regardless of Alex's setting. The setting only governs Alex's own edits. OQ8.
12. **Schema version on the history format.** The `v: 1` field on each row lets us evolve. If a v2 row format ships, readers handle both shapes. No big-bang migration; we just write new rows in the new format.
13. **PI audit log overlap with history.** A PI cross-owner edit writes both `_pi_audit.json` and `_history/<type>/<id>.jsonl`. The two logs disagree if one write fails. OQ6 covers whether to unify or accept the duplication.
14. **Restore a record whose owner has been archived.** Mira is archived. Her notes are still on disk (Phase 6 archive doesn't trash data). If Alex (shared edit access) tries to restore one of Mira's notes from trash, the restore writes to `users/Mira/notes/<id>.json` even though Mira can't log in. The note appears in lab-overview shared views; Mira's account stays archived. Acceptable.
15. **Hybrid editor noise on history.** The hybrid editor buffers on blur, so most history rows correspond to a real blur event, not a keystroke. But a "focus the field, type one character, blur" still fires. If a user blurs after every typed letter, we get 100 rows per minute. OQ2 covers whether to debounce history writes (only emit a row if the diff is non-trivial) or to accept the noise and lean on compaction.
16. **OneDrive sync churn on `_history/` files.** Each save touches one file. The write pattern is atomic (.tmp + move). OneDrive sees one delta per save, same as any other JSON write. Should be fine; the file count is bounded by record count, not by save count.
17. **Long fields in diffs.** A 5000-word markdown body that changes by one word. The history row's `old` and `new` are the full 5000 words each, 10000 words on disk per row. At 500 rows, that's 5MB per file. Could matter for image-heavy notes. OQ10 covers whether to store a true text-diff (deltas only) instead of full old/new pairs.
18. **PI viewing another user's history.** Per the lab-head implicit view-all rule, the PI sees every user's records, should they also see every user's history? Yes (the history tab works for any record the viewer can read). No special UI; the History tab is just a read on the jsonl.

---

## 6. Open questions for Grant

Fifteen items. Numbered `OQ#` per the existing proposal convention. Each is one question plus a brief trade-off note.

**OQ1, Trash cleanup window default.**
Should new users default to 7 / 30 / 90 days, or never-with-manual-only? 30 days mirrors most consumer apps (Google Drive, Apple Mail). 7 is aggressive (forces faster cleanup, freeing disk). Never is safest but risks the trash growing forever in noisy labs. Recommend 30. Per-user override always available in Settings.

**OQ2, History granularity: per-save / per-blur / per-explicit-version-commit.**
The hybrid editor fires saves on blur. Per-save means every blur is a history row; in a busy session that's noisy but accurate. Per-blur is the same as per-save right now. Per-explicit-version-commit would require a "commit" UI affordance (like git) that most users will never use. Recommend per-save with compaction handling the noise. Alternative: debounce so consecutive saves on the same field within 30 seconds collapse into one row at write time (cheaper than compaction).

**OQ3, History storage cap.**
Truncate (compact) at 500 rows, 2000 rows, or never? Truncation at 500 hits real records that are heavily edited but lossy on intermediate states. Never means unbounded files. Recommend 500 with the recent 100 verbatim. Per-user setting can override.

**OQ4, Restore-with-dependencies semantics.**
When restoring a Note whose Project is in trash, the default UI shows "Restore both" / "Just the note." Should we make restore-both the default, or restore-just-this-record the default? Trade-off: restoring the parent without consent surprises the user; not restoring it orphans the child. Recommend restore-both as the default with a "Just this record" override.

**OQ5, Lab-mode session vs target-user attribution.**
When PI Morgan edits Mira's note, the actor on the history row is "Morgan" (the human). Should it also carry a "session_id" tying it to the Phase 5 unlock window? Yes (we have the session_id from the PI audit log). Should the chip in the UI distinguish "Morgan typed this directly" from "Morgan typed this during a lab-head session"? The label "Morgan (lab head)" covers it. No further granularity needed unless Grant disagrees.

**OQ6, Recursion: history of the audit log itself.**
The PI audit log is append-only. Should it also have a history log? In theory yes (someone could tamper with `_pi_audit.json`). In practice no (the file is local; tampering is detectable by the missing entries, not by an immutable history). Recommend skipping history on `_pi_audit.json` and on `_history/*.jsonl` themselves (don't track edits to the edit log).

**OQ7, Image / attachment lifecycle in trashed records.**
When a note in trash references an image, the image file stays put. On permanent delete of the note, do we hard-delete the image? Only if no other live record references it. Reference counting requires a scan; expensive but rare. Alternative: orphan the image (leave it on disk indefinitely) and surface an "orphaned files" cleanup in Settings. Recommend orphan + cleanup-tool to start; revisit if disk usage becomes a problem.

**OQ8, Settings opt-out for history tracking.**
Some labs (privacy-conscious, anti-surveillance) may not want full per-edit logging. We let users toggle history off. But PI cross-owner edits MUST always write to both the PI audit log AND the history log (regulatory). Is that the right line? Trade-off: users who toggle off lose self-revert ability but keep their own-edit privacy. Recommend the proposed split (opt-out applies to own edits only) but flag for Grant's IRB-grounded perspective.

**OQ9, Trash visibility across shared records.**
If Alex shares a Note with Morgan (edit access) and Morgan deletes it, the trash file lands in Alex's `_trash/notes/`. Does Morgan see it in their own trash page too? Three options:
- (i) Trash is owner-only: Morgan deletes, file goes to Alex's trash, Morgan doesn't see it again.
- (ii) Trash shows shared trash too: Morgan sees Alex's trash entries they can restore.
- (iii) Morgan can't delete records they don't own: edit-access means "edit fields," not "delete the record." Owner-only delete.
Recommend (iii), only the owner can delete a record. PIs can delete via Phase 5 unlock (with audit). Edit-access users see no delete button. This avoids the asymmetric trash entirely.

**OQ10, Long-field diff storage.**
For markdown bodies and other long string fields, do we store full old/new pairs or compute a text-diff (delta)? Full old/new is simpler to write and read; deltas save disk but require a diff library at write AND read time. Recommend full old/new for v1; revisit at OQ3's compaction boundary.

**OQ11, Revert behavior for fields that don't exist anymore.**
You revert a field that was removed from the schema in a later release. The old value's type doesn't match the current schema. Recommend: log a warning, refuse the revert with a "schema mismatch, manual fix needed" message. Edge case but real if we add / remove fields on entities.

**OQ12, Lab head password gate for revert.**
If a PI uses revert across owners (Morgan reverts an edit Mira made), should that require the Phase 5 unlock? Today, Morgan can edit Mira's record under the unlock. Should revert count as an edit and require the same gate? Recommend yes, revert IS an edit and goes through the same `canWrite` check + audit.

**OQ13, Cross-folder version sync.**
If a user disconnects their folder and reconnects it on another device, the history files come along (they're in `users/<u>/_history/`). No special handling needed. Out of scope: a cloud-backed merged history across devices.

**OQ14, History tab on records the viewer can't edit.**
A user with read-only sharing access to a Note. They can see the note. Can they see the History tab? Yes, read access includes history read. Revert buttons are hidden for them (only edit-access users see revert).

**OQ15, Default ordering on the trash page.**
Newest-deleted first, or oldest-deleted-first (urgent-cleanup-first)? Newest-deleted-first matches user expectations ("the thing I just deleted should be at top to restore"). Oldest-deleted-first surfaces what's about to auto-expire. Recommend newest-first as default with a sort toggle.

### Highest-stakes (Grant locks in before R1)

- **OQ1** (cleanup window default), sets the baseline expectation for every user.
- **OQ8** (opt-out semantics), touches privacy / regulatory posture, hardest to change later.
- **OQ9** (delete permissions for shared records), wiring this wrong means rethinking the trash data model.

The rest are valuable lock-ins but can ship with conservative defaults and be tuned during R6.

---

## 7. Non-goals

Explicitly out of scope. Listed so future scope-creep conversations can refer back here.

- **Full git-style branching.** No branches, no merges, no rebase. The history is linear per record.
- **Multi-user real-time collaboration.** Two users editing the same record at the same time get last-write-wins on the live record; both writes appear as separate history rows. No OT / CRDT.
- **Remote backup / cloud history.** History lives in the user's folder, same as everything else. OneDrive / iCloud sync the folder; we don't run a separate cloud history service.
- **Cross-folder version sync.** Switching folders means picking up the history that's in the new folder; the old folder's history doesn't follow.
- **Audit log replacement.** We add the version-control history alongside the PI audit log, not in place of it. The PI audit log keeps its current shape.
- **Edit history for read-only computed fields.** `end_date` is computed from `start_date + duration_days`. We don't write history rows for computed values. Only persisted fields are tracked.
- **History UI on comments.** Comments have their own append-only thread shape; they don't need a revert per comment. Editing a comment is the existing flow.
- **History on `_user_settings.json` or `_onboarding.json`.** These are user-config files, not records. No history.
- **History on lab-global files (`labLinks.json`, `_lab_audit.jsonl`, lab roster).** Lab-global records can grow their own audit eventually; v1 covers per-user records only.
- **A "Diff two arbitrary versions" comparison view.** Each history row is its own diff. Comparing row X to row Y (skipping intermediates) requires reconstruction logic that's a Phase R7 thing.
- **Permanent-delete recovery (a "trash for trash").** Once trash is permanently deleted, it's gone. No second-level recycle bin.
- **Pre-edit confirmation gates.** Editing is the same UX as today, type and blur. We don't gate edits behind "are you sure?" prompts.

---

## 8. Risks

### 8a. Storage growth on noisy edits

The hybrid editor's onChange-per-keystroke regression (caught in HYBRID_EDITOR_V2) showed us that an undisciplined save path can fire thousands of times per minute. The buffered-on-blur fix reduces this to one save per blur, but a user who tabs through fields can still emit dozens of saves per minute. With history rows per save, a busy session could write hundreds of jsonl rows in an hour.

**Mitigations:**
- Compaction at 500 rows (OQ3 covers the threshold).
- Optional debounce: collapse consecutive same-field saves within 30 seconds into one row at write time.
- File-size monitoring in dev mode: warn if any `_history/<type>/<id>.jsonl` exceeds 1MB.

**Residual risk:** a pathological session in production could still bloat a single file. The user can manually delete the jsonl if it becomes a problem; we don't lose the live record.

### 8b. User confusion: revert undoes more than expected

The History tab shows per-field rows. Reverting one field doesn't roll back the others. A user expecting "revert this whole record to last week" might revert one field and be surprised the rest of the record didn't change.

**Mitigations:**
- The revert confirm modal makes the field path explicit: "Revert 'title' to its May 14 value? Other fields will not change."
- A bulk-revert affordance ("Revert all changes since [date]") could ship in R7 if the per-field one isn't enough.

### 8c. OneDrive sync churn

Every save writes the live record file AND appends to `_history/<type>/<id>.jsonl`. OneDrive sees two delta events per save instead of one. At high edit rates this could double the OneDrive bandwidth.

**Mitigations:**
- Same atomic-write pattern (`.tmp` + move) for both files; OneDrive merges deltas smoothly.
- If the history append becomes a problem, batch the append (queue in memory, flush every 10 seconds). The trade-off is that a tab close mid-edit loses the unflushed rows.

### 8d. Lab head password unlock semantics for revert

A PI reverts a Mira edit. The revert is an edit. It MUST go through the Phase 5 unlock (per OQ12). If a PI's unlock window expires between opening the History tab and clicking revert, the revert fails. The UI needs a clear "Unlock expired, re-enter passcode to revert" prompt, not a silent no-op.

**Mitigations:**
- The revert button is disabled (with a tooltip) when the PI is viewing across owners without an active unlock.
- The unlock-expired prompt is identical to the existing Phase 5 prompt, no new UX.

### 8e. IRB / compliance fit

Some labs want version control because their grant requires it. Selling them on the feature means we need to be clear about what we promise:

- **We promise:** every edit through the app is recorded in the history log. Revert is recorded. Delete is soft (with a 30-day default window) and recorded.
- **We do NOT promise:** the log is tamper-proof. The user can edit the jsonl on disk. The log is forensically useful, not legally binding.

The wiki page for History & Trash should make this distinction explicit. Labs that need stronger guarantees need a separate cloud-backed audit service (out of scope here).

---

## 9. Files referenced from current codebase

For the implementation chips to ground in what's already there, these are the relevant files inspected during this proposal:

**Existing partial coverage:**
- `frontend/src/lib/notes/notes-trash.ts`, the existing Note soft-delete primitive. R1 generalizes this.
- `frontend/src/lib/lab/pi-audit.ts`, the PI audit log. R4 sits alongside it; OQ6 covers whether to unify.
- `frontend/src/lib/sharing/unified.ts`, `canRead` / `canWrite` / `Viewer` / `ShareableRecord`. The version-control system extends `ShareableRecord` with the new attribution fields.
- `frontend/src/lib/owner-scoped/index.ts`, the owner-scoped wrapper layer. R4/R5 hooks into the existing audit emission here.
- `frontend/src/lib/undo/value-history.ts`, the in-memory undo stack for the editor. Unrelated to the persistent history; flagged here so future contributors don't confuse the two.
- `frontend/src/lib/project-activity/event-log.ts`, the project-scoped activity feed. R7's lab-head dashboard widget reuses the rollup shape.
- `frontend/src/lib/onboarding/sidecar.ts`, `SCHEMA_VERSION: 5` today; R3 bumps to 6.

**Entity interfaces (all in `frontend/src/lib/types.ts`):**
- Project (line 291), Task (line 406), Method (line 689), PurchaseItem (line 1457), Note (line 1818). Each gets `last_edited_by` + `last_edited_at` in R3.

**Trash UI sibling routes (for the new `/trash` route's design language):**
- `frontend/src/app/lab-overview/page.tsx`, the renamed Lab Inbox, gives us the "tabbed page under top-nav" pattern.
- `frontend/src/app/purchases/page.tsx`, gives us the "grouped list with sort + filter" pattern.

**Settings extension point:**
- `frontend/src/app/settings/page.tsx`, the existing Settings tabs. R1 adds the "History & Trash" tab here.

**Existing migration patterns to mirror:**
- `frontend/src/lib/sharing/migrate-unified.ts`, the lazy on-read migration that the unified sharing primitive uses. R3's `last_edited_by` backfill mirrors this.
- `frontend/src/lib/user-tombstone.test.ts`, the tombstone test surface; R1's trash tests mirror the shape (soft-delete + restore + auto-expire).

---

## 10. Acknowledgment and handoff

This proposal is ready for the master orchestrator to:

1. Drive Grant through the OQ1 / OQ8 / OQ9 lock-in (the three highest-stakes items).
2. Dispatch R1 as the first implementation chip once OQ1 + OQ9 are locked.
3. Stage R2 through R6 as separate role-brief documents derived from this proposal.

Estimated total scope: 3 person-months at one role manager dispatching chips sequentially. R1 + R2 (trash) and R3 (attribution) can fan out in parallel; R4 + R5 (history) need R3 first; R6 (revert) needs R5.

The biggest unresolved uncertainty is OQ8 (opt-out semantics), the answer reshapes Settings and the lab-head policy override copy. If Grant wants to remove the opt-out entirely (history is always on), R3 simplifies; if Grant wants opt-out at the per-record level (not just per-user), R3 grows.

Signed: **version control proposal drafter**, 2026-05-26

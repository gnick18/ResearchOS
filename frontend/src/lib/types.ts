// The canonical sequence figure-style spec lives in a neutral leaf module so this
// declarations file stays cycle-free (figure-style imports nothing).
import type { SequenceMapStyle } from "./sequences/figure-style";

// ── Shared Access Types ─────────────────────────────────────────────────────

/**
 * Lab Mode retirement R1 (R1 unified sharing manager, 2026-05-23): the
 * canonical share entry. One unified shape across every shareable record
 * type (Task, Note, Method, Project, Link, Goal, MassSpecProtocol, etc.).
 *
 *   - `username` is a real lab member's username OR the "*" sentinel
 *     meaning "every current lab member" (expanded at read time).
 *   - `level` replaces the old `permission` field. "read" reads more
 *     naturally in callsites than "view". The legacy `permission` field
 *     is kept as optional alongside `level` so on-disk records that
 *     predate the unified migration still parse — the read path
 *     normalizes either to `level` via `normalizeSharedWith` in
 *     `lib/sharing/unified.ts`. Migration rewrites the field on next
 *     save.
 *
 * Default for new records: shared_with: [] (owner-only). Records missing
 * the field entirely also default to [] on read.
 */
export interface SharedUser {
  username: string;
  /** Unified field — preferred. Optional during the R1 migration window
   *  so older callsites that still hand-build with `permission` continue
   *  to compile. New code MUST always set `level`. The
   *  `normalizeSharedWith` helper in `lib/sharing/unified.ts` resolves
   *  whichever field is present (`level` wins; otherwise `permission`
   *  is mapped: "view"→"read", "edit"→"edit"). */
  level?: "read" | "edit";
  /** @deprecated Legacy field, present only on pre-R1 records and
   *  un-migrated callsites. Read paths normalize via
   *  `normalizeSharedWith`. Migration in `lib/sharing/migrate-unified.ts`
   *  rewrites every on-disk record to use `level` and drops this
   *  field. New code should NOT write this. */
  permission?: "view" | "edit";
}

export interface ShareRequest {
  username: string;
  /** Preferred — matches SharedUser.level. */
  level?: "read" | "edit";
  /** @deprecated Use `level`. Kept for callers that still pass `permission`. */
  permission?: "view" | "edit";
  include_chain?: boolean;  // For tasks: share entire dependency chain
}

export interface SharedItemEntry {
  id: number;
  owner: string;
  permission: string;
  shared_at: string;
}

export interface SharedItemNotification {
  id: string;
  type: "task_shared" | "method_shared" | "project_shared";
  from_user: string;
  item_type: "task" | "method" | "project";
  item_id: number;
  item_name: string;
  permission: string;
  created_at: string;
  read: boolean;
}

export interface EventReminderNotification {
  id: string;
  type: "event_reminder";
  /** String form so we can carry both numeric (native) and string (external)
   *  event ids without dual fields. */
  event_id: string;
  event_kind: "native" | "external";
  event_title: string;
  /** ISO local-datetime string for the event's start (e.g. "2026-05-13T14:30:00"). */
  event_start_iso: string;
  /** Local YYYY-MM-DD — used to deep-link back to the day view. */
  event_date: string;
  event_location: string | null;
  /** Minutes-before-start when this reminder fired (display label). */
  offset_minutes: number;
  created_at: string;
  read: boolean;
}

/**
 * Receiver-facing notification telling Morgan that Alex shifted a task Alex
 * shared with her. Generated locally on Morgan's side at load time from
 * polling Alex's `users/<owner>/_shifted-alerts.json` sidecar — it is NOT
 * written across user boundaries. See `sharingApi.scanShiftAlerts`.
 */
export interface ShiftAlertNotification {
  id: string;
  type: "shift_alert";
  /** Username of the task's owner (= shifter). Same convention as
   *  `SharedItemNotification.from_user`. */
  from_user: string;
  /** Numeric task id in the owner's namespace. Combine with `from_user` to
   *  uniquely identify the task. */
  item_id: number;
  /** Composite "<owner>:<id>" key — matches `taskKey(task)` for the
   *  shared-in view. */
  task_key: string;
  /** Denormalized task name at the time of the shift. */
  item_name: string;
  /** UUID of the source alert in the owner's `_shifted-alerts.json`. Used
   *  to dedup against `_seen-shift-alerts.json`. */
  source_alert_id: string;
  /** Shift deltas, in days. Positive = pushed later. */
  start_delta_days: number;
  end_delta_days: number;
  /** ISO YYYY-MM-DD before and after the shift. */
  old_start: string;
  old_end: string;
  new_start: string;
  new_end: string;
  /** When the alert was minted on Morgan's side (not when Alex shifted). */
  created_at: string;
  read: boolean;
}

/**
 * Lab Head Phase 2 (lab head Phase 2 manager, 2026-05-23): bell notification
 * fired when a new comment is left on a record the receiver owns, OR when
 * the receiver is @-mentioned in a comment anywhere. Lab heads also receive
 * one of these for EVERY new comment in the lab (cross-lab visibility per
 * the Phase 2 brief — "so they don't miss anything").
 *
 * The notification points back at the source surface (task or note) via
 * (`record_type`, `record_id`, `owner_username`) so the Lab Inbox feed +
 * NotificationPopup can render an "Open" link that navigates to the record.
 *
 * Storage: written to the receiver's `_notifications.json` by `addComment`
 * on the commenter's side — same cross-user write pattern as
 * `addReceiverShare`. The receiver discovers it on the next bell-popup
 * load via `sharingApi.getNotifications`.
 */
export interface LabCommentNotification {
  id: string;
  // Discriminated union tag. Two flavors:
  //   - "comment_mention": the receiver was @-mentioned in `text`
  //   - "comment_on_owned": the receiver owns the parent record
  //   - "comment_lab_head_feed": the receiver is a lab head and sees every
  //     comment lab-wide (no direct ownership / mention)
  type: "comment_mention" | "comment_on_owned" | "comment_lab_head_feed";
  // The author of the comment that triggered the notification.
  from_user: string;
  // The parent record's owner username (= directory the record file lives
  // in). Combine with record_type + record_id to deep-link.
  owner_username: string;
  // Which surface the comment was posted on.
  record_type: "task" | "note";
  record_id: number;
  // Denormalized record name so the popup row has something to show without
  // a second fetch (mirrors `SharedItemNotification.item_name`).
  record_name: string;
  // The comment's own id, so the Lab Inbox feed row can highlight a single
  // entry within a long thread.
  comment_id: string;
  // Short preview of the comment body (~120 chars, no formatting). For
  // long comments the renderer adds an ellipsis.
  preview: string;
  created_at: string;
  read: boolean;
}

/**
 * Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23): bell
 * notification fan-out for the PI soft-write action quartet.
 *
 * Four discriminated subtypes (one per action surface):
 *   - "lab_announcement"        — PI posted a lab-wide announcement
 *   - "lab_task_assignment"     — PI assigned a task to the receiver
 *   - "lab_purchase_approval"   — PI approved the receiver's purchase
 *   - "lab_flag_for_review"     — PI flagged a record for the receiver
 *
 * All four carry `from_user` (the PI), `created_at`, `read` like the
 * existing types. Subject-specific fields differ per kind. The receiver
 * is implicit (file owner of `_notifications.json`). Storage mirrors
 * `LabCommentNotification` — written cross-user by the PI's session.
 */
export interface LabAnnouncementNotification {
  id: string;
  type: "lab_announcement";
  from_user: string;
  /** Server-generated announcement id (matches AnnouncementEntry.id). */
  announcement_id: string;
  /** Denormalized excerpt (~120 chars) for the bell row. */
  preview: string;
  created_at: string;
  read: boolean;
}

export interface LabTaskAssignmentNotification {
  id: string;
  type: "lab_task_assignment";
  from_user: string;
  /** Username of the task's owner — combine with task_id to deep-link. */
  owner_username: string;
  task_id: number;
  /** Denormalized task name for the bell row. */
  task_name: string;
  /** Optional note the PI attached when assigning. */
  note: string | null;
  created_at: string;
  read: boolean;
}

export interface LabPurchaseApprovalNotification {
  id: string;
  type: "lab_purchase_approval";
  from_user: string;
  /** Username of the purchase-item owner (= the receiver). */
  owner_username: string;
  /** Numeric purchase_item id in the owner's namespace. */
  purchase_item_id: number;
  /** Denormalized item name for the bell row. */
  item_name: string;
  created_at: string;
  read: boolean;
}

export interface LabFlagForReviewNotification {
  id: string;
  type: "lab_flag_for_review";
  from_user: string;
  /** Username of the flagged record's owner (= the receiver). */
  owner_username: string;
  /** Which surface the flag landed on. */
  record_type: "task" | "note" | "purchase_item";
  /** Numeric id in the owner's namespace. */
  record_id: number;
  /** Denormalized record name for the bell row. */
  record_name: string;
  /** Optional reason text from the PI. */
  reason: string | null;
  created_at: string;
  read: boolean;
}

/**
 * Lab-manager ordering workflow (purchases-assignee fix, 2026-05-29):
 * bell notifications for the trainee -> lab-member ordering handoff. Two
 * directions:
 *   - "purchase_assignment" — a requester asked the receiver to place
 *     an order (the receiver is the assignee).
 *   - "purchase_ordered"    — a supply the receiver requested was marked
 *     ordered (the receiver is the original requester / item owner).
 *
 * Both carry `from_user` (the other party), `created_at`, `read` like the
 * existing lab notification types. The receiver is implicit (the file
 * owner of `_notifications.json`). Cross-user writes are best-effort and
 * scoped to lab-folder members, mirroring the PI soft-write fan-out.
 */
export interface PurchaseAssignmentNotification {
  id: string;
  type: "purchase_assignment";
  /** Username of the requester who assigned the item. */
  from_user: string;
  /** Username of the purchase-item owner (the requester's data folder). */
  owner_username: string;
  /** Numeric purchase_item id in the owner's namespace. */
  purchase_item_id: number;
  /** Numeric parent purchase task id (for deep-linking). */
  task_id: number;
  /** Denormalized item name for the bell row. */
  item_name: string;
  created_at: string;
  read: boolean;
}

export interface PurchaseOrderedNotification {
  id: string;
  type: "purchase_ordered";
  /** Username of the person who marked the order ordered (the assignee
   *  or whoever flipped the order to complete). */
  from_user: string;
  /** Username of the purchase-item owner (= the receiver / requester). */
  owner_username: string;
  /** Numeric purchase_item id in the owner's namespace. */
  purchase_item_id: number;
  /** Numeric parent purchase task id (for deep-linking). */
  task_id: number;
  /** Denormalized item name for the bell row. */
  item_name: string;
  created_at: string;
  read: boolean;
}

export type Notification =
  | SharedItemNotification
  | EventReminderNotification
  | ShiftAlertNotification
  | LabCommentNotification
  | LabAnnouncementNotification
  | LabTaskAssignmentNotification
  | LabPurchaseApprovalNotification
  | LabFlagForReviewNotification
  | PurchaseAssignmentNotification
  | PurchaseOrderedNotification;

/**
 * On-disk sidecar at `users/<owner>/_shifted-alerts.json`. Append-only on
 * the writer (owner) side; the receiver never writes back here. Receivers
 * keep their own `_seen-shift-alerts.json` for dedup. Owners may prune
 * entries older than N days as housekeeping but the receiver-side seen-list
 * is authoritative for "I've already handled this".
 */
export interface ShiftedAlertEntry {
  /** UUID — stable across reads; receivers dedup on this. */
  id: string;
  task_id: number;
  /** "<owner>:<id>" — owner is the writer's own username. */
  task_key: string;
  task_name: string;
  start_delta_days: number;
  end_delta_days: number;
  old_start: string;
  old_end: string;
  new_start: string;
  new_end: string;
  shifted_at: string;
  shifted_by_user: string;
}

export interface ShiftedAlertsFile {
  version: 1;
  alerts: ShiftedAlertEntry[];
}

export interface SeenShiftAlertsFile {
  version: 1;
  /** Alert UUIDs the receiver has acted on or dismissed. */
  seen_ids: string[];
}

export interface DependencyChainResponse {
  task_id: number;
  chain_task_ids: number[];
  chain_count: number;
}

export interface Project {
  id: number;
  name: string;
  weekend_active: boolean;
  tags: string[] | null;
  color: string | null;
  created_at: string;
  sort_order: number;
  is_archived: boolean;
  archived_at: string | null;
  owner: string;
  shared_with: SharedUser[];
  // Hidden flag: when true, the project is filtered out of every surface
  // by default (Home grid, Workbench, Gantt, project pickers). Currently
  // only set for the per-user auto-created `_misc_purchases` project that
  // backs the "Miscellaneous" purchases category — that project surfaces
  // ONLY on /purchases, which opts in via `fetchAllProjectsIncludingShared
  // ({ includeHidden: true })`. Mirrors the `is_archived` shape: persisted
  // through projectsStore writes, optional on read for backwards-compat
  // with older project files that predate this flag.
  is_hidden?: boolean;
  // Read-time overlay fields — set by fetchAllProjectsIncludingShared when
  // the receiver of a shared project loads it. Never persisted to disk.
  is_shared_with_me?: boolean;
  shared_permission?: "view" | "edit";
  // VCP R3 attribution stamps (VCP R3 attribution stamps, 2026-05-26):
  // most-recent editor + when. Stamped on every `projectsApi.update`
  // path. Optional on read for pre-R3 records; back-fills on next
  // write.
  last_edited_by?: string;
  last_edited_at?: string;
  // Project -> grant link (metadata implementation bot, 2026-05-28). Points
  // at a FundingAccount.id (the existing Purchases & Funding structure).
  // null / undefined = unlinked (the current behavior). Single grant per
  // project for v1 (no multi-grant). Optional + additive: project files
  // written before this slice load unchanged, and `projectsStore.update`'s
  // spread-merge filters `undefined` so partial updates preserve it.
  funding_account_id?: number | null;
  // VC Phase 3 (FLAG-revert_undo_window, Project): the 24h undo-restore window.
  // Present only between a restore and either its undo or the window's expiry.
  // Globally denylisted in canonicalize.ts (FLAG-2) so it never pollutes a
  // delta. Absent on every project that was never restored. Mirrors Task / Note.
  revert_undo_window?: RevertUndoWindow;
  // Cross-boundary PROJECT sharing (v1, 2026-06-04): provenance stamp written
  // when this project was materialized from a received project bundle. ALWAYS-NEW
  // import lands a shared project as a FRESH project with remapped ids and this
  // marker, so the UI can show "Imported from alex@lab on 2026-06-04" without
  // inventing a live sharing relationship. Optional + additive: every project
  // created the ordinary way (and every project written before this slice) omits
  // it. It is the cheap seed a future merge-into-existing (P3) needs.
  imported_from?: ProjectImportedFrom;
  // Phase 6a portable identity (phase6a-foundation bot, 2026-06-12): a stable
  // cross-user identity for this record minted once at create time using
  // crypto.randomUUID(). OPTIONAL + ADDITIVE: records written before Phase 6a
  // simply lack this field; a lazy backfill in the read-boundary normalizer mints
  // one and persists it the first time such a record is read (write-through,
  // fire-and-forget). Never renames, never removes, never requires a hard cutover.
  // Used by the Phase 6 share-with-dependencies bundle to resolve embedded objects
  // by content identity instead of the sender's local numeric id. Natural-key
  // types (molecule: InChIKey, sequence: content fingerprint) do NOT carry this
  // field and are excluded from source_uuid handling.
  source_uuid?: string;
}

/**
 * Provenance for a project that arrived via cross-boundary sharing. Set once at
 * import time and never edited. `sender` is the recipient's best-known label for
 * the sender (the verified email when the relay bundle carried one, else a short
 * key-hash label). `source_project_name` preserves the sender's original project
 * name even after the local copy is renamed to dodge a collision. `source_grant`
 * carries the source funding-account NAME for reference (the grant LINK itself is
 * dropped on share, design Q4), null/undefined when the source had none.
 */
export interface ProjectImportedFrom {
  sender: string;
  imported_at: string; // ISO timestamp
  source_project_name: string;
  source_grant?: string | null;
}

export interface ProjectCreate {
  name: string;
  weekend_active?: boolean;
  tags?: string[];
  color?: string;
  // Only used by the misc-purchases bootstrap (lib/purchases/misc-project.ts);
  // ordinary user-created projects leave this off.
  is_hidden?: boolean;
  sort_order?: number;
  // Project -> grant link — see Project.funding_account_id.
  funding_account_id?: number | null;
  // Cross-boundary PROJECT sharing (v1): provenance stamp for a project
  // materialized from a received bundle. Only the project-import path sets it;
  // ordinary creates leave it off (absent = not imported). See
  // Project.imported_from.
  imported_from?: ProjectImportedFrom;
}

export interface ProjectUpdate {
  name?: string;
  weekend_active?: boolean;
  tags?: string[];
  color?: string;
  sort_order?: number;
  is_archived?: boolean;
  archived_at?: string | null;
  is_hidden?: boolean;
  // VCP R3 — optional; auto-stamped by `projectsApi.update`. Callers
  // usually omit; the write path overwrites whatever is supplied.
  last_edited_by?: string;
  last_edited_at?: string;
  // Project -> grant link — see Project.funding_account_id. `null` clears
  // the link; a number sets it.
  funding_account_id?: number | null;
  // VC Phase 3 (FLAG-revert_undo_window, Project): the undo-restore window. Set
  // (object) on a restore; CLEARED (`null`) on an undo. `projectsApi.update`
  // deletes the key on `null` so the live project carries no lingering field.
  // Denylisted (FLAG-2). Mirrors TaskUpdate / NoteUpdate exactly.
  revert_undo_window?: RevertUndoWindow | null;
}

/**
 * VC Phase 3 (FLAG-revert_undo_window, Project): the full-tracked-state payload
 * a restore / undo writes. Superset of ProjectUpdate with every structural field
 * the canonical tracks, so `projectsApi.update` overwrites the live project to
 * exactly the target version. Distinct type (not a ProjectUpdate widening)
 * mirroring TaskRestorePayload / NoteRestorePayload: the restore handler
 * assembles this from the reconstructed canonical and passes it through
 * projectsApi.update; the partial-merge store keys on the runtime object so the
 * structural fields persist. Field types match ProjectUpdate (no widening) so
 * the override is assignable; the actual runtime values flow in through the
 * generic `Record<string, unknown>` restore payload, which may carry the on-disk
 * `tags: null` / `color: null` shapes the partial-merge store accepts verbatim.
 */
export interface ProjectRestorePayload extends ProjectUpdate {
  name?: string;
  weekend_active?: boolean;
  tags?: string[];
  color?: string;
  sort_order?: number;
  is_archived?: boolean;
  archived_at?: string | null;
  is_hidden?: boolean;
  funding_account_id?: number | null;
}

// ── Sub-Tasks ─────────────────────────────────────────────────────────────────

export interface SubTask {
  id: string;
  text: string;
  is_complete: boolean;
}

// ── Task Method Attachments ───────────────────────────────────────────────────

// Gathered-reagent checklist state, synced from the companion phone read mode.
// `checks` is keyed by `${stepIndex}:${checkIndex}` (the phone's parsed reagent
// checklist), so the count is authoritative even though the laptop does not
// re-parse the method into the same checks. `total` is how many checks the
// method has, for a "gatheredCount of total" display.
export interface MethodGatheredChecks {
  checks: Record<string, boolean>;
  gatheredCount: number;
  total: number;
  at: string; // ISO timestamp of the last phone sync
}

export interface TaskMethodAttachment {
  method_id: number;
  // Explicit owner of the referenced method. `null` = same user as the task
  // (legacy / locally-owned attachments). Non-null disambiguates against
  // per-user id collisions: e.g. `method_id: 2, owner: "public"` references
  // the public method even when the current user also has a private method
  // with id 2. Required for cross-user public/shared method attachments.
  owner: string | null;
  // PCR method copy fields - stored as JSON strings (only for PCR methods)
  pcr_gradient: string | null;  // JSON string of PCRGradient
  pcr_ingredients: string | null;  // JSON string of PCRIngredient[]
  // LC gradient snapshot - JSON string of LCGradientProtocol (only for LC methods).
  // Mirrors pcr_gradient: edits on the experiment page write to this snapshot,
  // not back to the source protocol record.
  lc_gradient: string | null;
  // Markdown body override (only meaningful when method.method_type === "markdown").
  // When non-null AND the attached method is markdown, the experiment-page renderer
  // treats this string as the active body and diffs it against the source method's
  // on-disk body. When null, the renderer reads the source markdown directly and
  // behaves as it did before per-task overrides existed. Edits on the experiment
  // page write here, never back to the source `.md` file — so the source method
  // remains the canonical reusable protocol while each task can capture its own
  // documented variation.
  body_override: string | null;
  // Plate annotation snapshot - JSON string of `{ wells: {...} }` (only for
  // plate methods). Mirrors lc_gradient: per-well painting on the experiment
  // page lands here, not back on the source PlateProtocol's region_labels.
  plate_annotation: string | null;
  // Cell culture per-task instance snapshot — JSON string of CellCultureScheduleInstance
  // (only for cell_culture methods). Carries the planned_events copy plus
  // mid-execution actual_events (what was actually fed/split/observed) so the
  // passage-history annotation lives on the task, not the source schedule.
  cell_culture_schedule: string | null;
  // Variation notes - markdown content documenting method variations for this experiment
  variation_notes: string | null;  // Markdown string with timestamped entries
  // Gathered-reagent checklist state synced from the companion phone. The phone
  // ticks reagents off as they are gathered at the bench and syncs the FULL map
  // (last-write-wins), so this is overwritten, never merged. Lives on the
  // attachment like the other per-experiment snapshots, never on the source
  // method. Optional so existing attachments without it read as "nothing
  // gathered yet". See MethodGatheredChecks.
  gathered_checks?: MethodGatheredChecks | null;
  // Compound method per-child snapshot bundle - JSON string of
  // CompoundSnapshotPayload (only meaningful when the attached method's
  // method_type === "compound"). Bundles per-child snapshot blobs keyed by
  // the child method's id. Each child's blob shape matches the per-type
  // snapshot field it would otherwise occupy on a standalone attachment
  // (e.g. a plate child's blob mirrors plate_annotation, an lc child's
  // blob mirrors lc_gradient). Position deliberately last so Phase 1's
  // qpcr_analysis field can land before this one without mid-interface
  // merge conflicts.
  compound_snapshots: string | null;
  // qPCR analysis per-task instance snapshot — JSON string of
  // QPCRAnalysisSnapshot (only meaningful for `method_type === "qpcr_analysis"`
  // methods). Carries the actual measured Cq values per target, optional
  // melt-curve Tm readouts, and per-experiment notes. Source method record
  // stays untouched (it carries the protocol template — references list,
  // standard-curve points, melt-curve config, ΔΔCq toggle); per-task
  // experimental data lands here. Positioned after compound_snapshots so
  // Phase 1's append-only contract holds against Phase 0b.
  qpcr_analysis: string | null;
}

export interface Task {
  id: number;
  project_id: number;
  name: string;
  start_date: string; // ISO date string YYYY-MM-DD
  duration_days: number;
  // Derived/cached: computeEndDate(start_date, duration_days, false). Stored
  // on disk for cache friendliness but always validated/recomputed at the
  // local-api boundary — never trust it as the source of truth.
  end_date: string;
  is_high_level: boolean;
  is_complete: boolean;
  task_type: "experiment" | "purchase" | "list";
  weekend_override: boolean | null;
  method_ids: number[];  // List of method IDs attached to this task
  deviation_log: string | null;
  tags: string[] | null;
  sort_order: number;
  experiment_color: string | null;
  sub_tasks: SubTask[] | null;
  // Per-method PCR data lives on each TaskMethodAttachment below.
  method_attachments: TaskMethodAttachment[];
  // Sharing fields
  owner: string;
  shared_with: SharedUser[];
  inherited_from_project?: number | null;
  is_shared_with_me?: boolean;  // True if this task is shared WITH the current user (not owned by them)
  shared_permission?: "view" | "edit";  // Only set when is_shared_with_me=true; the level the receiver was granted
  /**
   * Cross-owner project host — null/undefined means the task only appears in
   * `project_id` (its native project, in its own owner's namespace). When set,
   * the task ALSO appears in the destination owner's project Gantt/timeline.
   * The task file itself stays in this task's owner directory; only the
   * destination project's `<id>-hosted.json` manifest changes on share.
   * See `frontend/src/lib/sharing/project-hosting.ts` for the contract.
   */
  external_project?: ExternalProjectRef | null;
  // Lab-mode comment thread, mirror of `Note.comments`. Optional for backward
  // compat — `normalizeTaskRecord` in local-api.ts defaults missing values to
  // [] on read so callers never see `undefined`.
  comments?: TaskComment[];
  // Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23): optional PI
  // assignee. When set + !== owner, lists/popups render a small "assigned
  // to X" chip alongside the owner badge. Defaults to null = unassigned
  // (display falls back to owner). Additive — old records normalize fine.
  assignee?: string | null;
  // Lab Head Phase 3 — PI flag-for-review. Null/undefined = not flagged.
  // When set, lists show a red flag icon and the popup surfaces a banner
  // the owner can clear. See `lib/lab/pi-actions.ts` for the writer.
  flagged?: PiFlag | null;
  // VCP R3 attribution stamps (VCP R3 attribution stamps, 2026-05-26):
  // most-recent editor + when. Stamped on every `tasksApi.update` path
  // including PI cross-owner edits. Optional on read for pre-R3 records;
  // back-fills on next write.
  last_edited_by?: string;
  last_edited_at?: string;
  // VC Phase 3 (FLAG-revert_undo_window, Task): the 24h undo-restore window.
  // Present only between a restore and either its undo or the window's expiry.
  // Globally denylisted in canonicalize.ts (FLAG-2) so it never pollutes a
  // delta. Absent on every task that was never restored. Mirrors Note's field.
  revert_undo_window?: RevertUndoWindow;
  // Cross-boundary EXPERIMENT sharing (provenance, 2026-06-04): verified-sender
  // marker stamped ONLY on an experiment (task) imported from a received bundle,
  // the same pattern as Note.received_from. Lets the experiment detail show
  // "Received from {email}, verified" on the entity itself, not just at receive
  // time, so a recipient can always tell a foreign experiment from their own.
  // All three are OPTIONAL and additive, absent on every locally created task,
  // on every locally file-imported experiment, and on every pre-existing record
  // (graceful degradation, no migration). The cross-boundary receive path stamps
  // them; the local export/import path never does. The send (collect) path does
  // NOT carry them, so a re-shared experiment never leaks the importer's
  // provenance back out.
  received_from?: string;             // sender canonical email, set only on imported experiments
  received_from_fingerprint?: string; // sender key fingerprint
  received_at?: string;               // ISO 8601 timestamp of import
  // Experiment-collab chunk 1 (FLAG: new Task field): the collab doc id for the
  // experiment's Lab Notes document. Mirrors Note.collab_doc_id exactly. Written
  // to the JSON record on import so the recipient's LabNotesTab can seed the
  // Loro meta map with the correct id and auto-join the shared doc's relay room.
  // ADDITIVE and backward-compatible: absent on every locally created task and
  // every unshared experiment. The Loro sidecar (meta map collab_doc_id key) is
  // the authoritative store; this JSON field is the bootstrap bridge for a
  // freshly-imported experiment before its sidecar is written for the first time.
  collab_doc_id?: string;
  // Experiment-collab chunk 2 (FLAG: new Task field): the collab doc id for the
  // experiment's Results document. A SEPARATE doc + relay room from Lab Notes,
  // so it gets its own flat field rather than overloading collab_doc_id. Written
  // to the JSON record on import so the recipient's ResultsTab can seed the
  // Results Loro meta map with the correct id and auto-join that doc's relay
  // room. ADDITIVE and backward-compatible: absent on every locally created task
  // and every unshared experiment. The Results Loro sidecar (its own meta map
  // collab_doc_id key) is the authoritative store; this JSON field is the
  // bootstrap bridge for a freshly-imported experiment before its Results
  // sidecar is written for the first time.
  results_collab_doc_id?: string;
  // Check-ins revamp Phase 2 (checkins-phase2 bot, 2026-06-12). See
  // docs/proposals/checkins-revamp.md "Phase 2 build spec". The back-link from
  // a D4-synced task to the check-in action item that spawned it. Present ONLY
  // on a task materialized by the action-item -> Task sync; absent on every
  // normal task. ADDITIVE + back-compat: `normalizeTaskRecord` defaults a
  // missing value to undefined gracefully (it is read-only metadata, never
  // user-edited). Denylisted in canonicalize.ts so it never pollutes a VC
  // delta, mirroring `revert_undo_window`.
  // Check-ins Phase 3 (checkins-phase3 bot, 2026-06-12) extends the union with
  // the `idp_action` kind, the back-link from a Task materialized by an IDP
  // action-plan row (D4-style sync, but the trainee owns BOTH the IDP and the
  // task, so no cross-user write). Same field name, so the `source` denylist in
  // canonicalize.ts still covers it without change.
  source?:
    | {
        kind: "checkin_action_item";
        one_on_one_id: string;
        action_item_id: string;
      }
    | {
        kind: "idp_action";
        idp_id: string;
        row_id: string;
      }
    | null;
  // Phase 6a portable identity (phase6a-foundation bot, 2026-06-12): see
  // Project.source_uuid for the full contract. Experiments and list tasks share
  // this field via the Task interface. Minted at create time; lazy-backfilled on
  // read; never removed or renamed. ADDITIVE + back-compat.
  source_uuid?: string;
}

/**
 * Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23): a PI flag on
 * a Task / Note / PurchaseItem. Optional reason text the PI types when
 * flagging — surfaced to the owner alongside the flag icon.
 */
export interface PiFlag {
  /** Lab-head username that set the flag. */
  by: string;
  /** ISO 8601 timestamp when the flag was set. */
  at: string;
  /** Optional free-form reason. Null when the PI flagged without typing. */
  reason?: string | null;
}

// Mirror of `NoteComment`. Same shape so the shared `CommentsThread`
// component can render either kind without a discriminated union.
//
// Lab Head Phase 2 (lab head Phase 2 manager, 2026-05-23): added optional
// `parent_id` (threading — 1 level deep) and `mentions` (denormalized
// @-mention list extracted from `text` at compose time). Both fields are
// optional / additive — pre-Phase-2 comments on disk just don't carry them
// and the renderer treats them as top-level / un-mentioning. No migration
// needed.
export interface TaskComment {
  id: string;
  author: string;       // username of the commenter (the real user, not "lab")
  text: string;
  created_at: string;
  // Phase 2: id of the comment this is a reply to. Null / undefined / "" =
  // top-level. Only 1 level of nesting is supported — replies to replies
  // collapse onto the same parent at the renderer.
  parent_id?: string | null;
  // Phase 2: denormalized @-mention usernames extracted at compose time.
  // The source of truth is still the inline `@username` tokens in `text`;
  // this field exists so notification dispatch + the Lab Inbox feed can
  // surface mentions without re-parsing the text on every render.
  mentions?: string[];
}

/**
 * Cross-owner "hosted" association on a task. When alex's task is shared
 * INTO morgan's project (Option C / Option 3, AGENTS.md §8), the task file
 * stays in alex's directory but carries this composite ref. The destination
 * project also gets a `<projectId>-hosted.json` manifest entry — both sides
 * must agree.
 *
 * Singular for v1. If a task ever needs to be hosted in multiple foreign
 * projects, widen `Task.external_project` to `ExternalProjectRef[]`.
 */
export interface ExternalProjectRef {
  /** Username of the destination project's owner. */
  owner: string;
  /** Numeric project id in the destination owner's namespace. */
  id: number;
  /** ISO timestamp of when the share landed. */
  sharedAt: string;
}

/**
 * One hosted-from-others entry on a project. The manifest of tasks hosted
 * INTO `users/<projectOwner>/projects/<projectId>.json` lives at the
 * sidecar `users/<projectOwner>/projects/<projectId>-hosted.json`.
 *
 * Drift contract: an entry here is only valid if the referenced
 * `users/<owner>/tasks/<taskId>.json` exists AND its `external_project`
 * points back to (projectOwner, projectId). Anything else is drift and the
 * read-time normalizer drops it.
 */
export interface ProjectHostedTaskEntry {
  /** Username of the task's owner (where the task file actually lives). */
  owner: string;
  /** Numeric task id in the task owner's namespace. */
  taskId: number;
  /** ISO timestamp of when the share landed. Mirrors `external_project.sharedAt`. */
  sharedAt: string;
  /** Who initiated the share. Today this is always the task owner, but
   *  carrying it explicitly keeps the door open for delegated-action audits. */
  sharedBy: string;
}

/** On-disk shape of `users/<projectOwner>/projects/<projectId>-hosted.json`. */
export interface ProjectHostedManifest {
  version: 1;
  hostedTasks: ProjectHostedTaskEntry[];
}

// Each user has its own auto-incrementing id space, so `task.id` alone is not
// unique across the merged view returned by `fetchAllTasksIncludingShared`.
// Use `taskKey(task)` whenever a task needs a stable, collision-free identifier
// in memory: React keys, Map<…, …> by-task lookups, store/selection state, and
// React Query keys. The on-disk format is unchanged; the composite key only
// exists at the UI layer.
export function taskKey(task: Pick<Task, "id" | "owner" | "is_shared_with_me">): string {
  const ns = task.is_shared_with_me ? (task.owner || "shared") : "self";
  return `${ns}:${task.id}`;
}

export interface TaskCreate {
  project_id?: number | null;
  name: string;
  start_date: string;
  duration_days: number;
  is_high_level?: boolean;
  task_type?: "experiment" | "purchase" | "list";
  weekend_override?: boolean | null;
  method_ids?: number[];  // List of method IDs to attach
  tags?: string[];
  sort_order?: number;
  experiment_color?: string | null;
  sub_tasks?: SubTask[];
  method_attachments?: TaskMethodAttachment[];
}

export interface TaskUpdate {
  // `null` clears the project assignment (i.e. "no project"). The underlying
  // JsonStore writer accepts whatever the caller provides (it only filters
  // `undefined`), and the ELN-import bulk-sort screen relies on this to move
  // a task back to the unfiled column. Keep `null` explicit in the type so
  // callers don't have to cast through `Partial<Task>` to do it.
  project_id?: number | null;
  name?: string;
  start_date?: string;
  duration_days?: number;
  is_high_level?: boolean;
  is_complete?: boolean;
  task_type?: "experiment" | "purchase" | "list";
  weekend_override?: boolean | null;
  method_ids?: number[];  // List of method IDs to attach
  deviation_log?: string | null;
  tags?: string[];
  sort_order?: number;
  experiment_color?: string | null;
  sub_tasks?: SubTask[];
  method_attachments?: TaskMethodAttachment[];
  /** Cross-owner host. `null` clears (unshare); an object sets/replaces. */
  external_project?: ExternalProjectRef | null;
  /** Lab Head Phase 3 — PI assignee (`null` clears, string sets). */
  assignee?: string | null;
  /** Lab Head Phase 3 — PI flag (object sets, `null` clears). */
  flagged?: PiFlag | null;
  // VCP R3 — optional; auto-stamped by `tasksApi.update`. Callers
  // usually omit; the write path overwrites whatever is supplied.
  last_edited_by?: string;
  last_edited_at?: string;
  // VC Phase 3 (FLAG-revert_undo_window, Task): the undo-restore window. Set
  // (object) on a restore; CLEARED (`null`) on an undo. `tasksApi.update`
  // deletes the key on `null` so the live task carries no lingering field.
  // Denylisted (FLAG-2). Mirrors NoteUpdate's field exactly.
  revert_undo_window?: RevertUndoWindow | null;
}

/**
 * VC Phase 3 (FLAG-revert_undo_window, Task): the full-tracked-state payload a
 * restore / undo writes. Superset of TaskUpdate with every structural field the
 * canonical tracks, so `tasksApi.update` overwrites the live task to exactly the
 * target version. Distinct type (not a TaskUpdate widening) mirroring
 * NoteRestorePayload: the restore handler assembles this from the reconstructed
 * canonical and passes it through tasksApi.update; the partial-merge store keys
 * on the runtime object so the structural fields persist.
 */
export interface TaskRestorePayload extends TaskUpdate {
  name?: string;
  start_date?: string;
  duration_days?: number;
  is_high_level?: boolean;
  is_complete?: boolean;
  task_type?: "experiment" | "purchase" | "list";
  weekend_override?: boolean | null;
  method_ids?: number[];
  deviation_log?: string | null;
  tags?: string[];
  sort_order?: number;
  experiment_color?: string | null;
  sub_tasks?: SubTask[];
  method_attachments?: TaskMethodAttachment[];
  external_project?: ExternalProjectRef | null;
  assignee?: string | null;
  flagged?: PiFlag | null;
}

export interface TaskMoveRequest {
  new_start_date: string;
  confirmed?: boolean;
}

export interface Dependency {
  id: number;
  parent_id: number;
  child_id: number;
  dep_type: "FS" | "SS" | "SF";
}

export interface DependencyCreate {
  parent_id: number;
  child_id: number;
  dep_type: "FS" | "SS" | "SF";
}

export interface ShiftedTask {
  task_id: number;
  name: string;
  old_start: string;
  new_start: string;
  old_end: string;
  new_end: string;
}

export interface ShiftWarning {
  task_id: number;
  name: string;
  message: string;
}

export interface ShiftResult {
  affected_tasks: ShiftedTask[];
  warnings: ShiftWarning[];
  requires_confirmation: boolean;
}

// ── High-Level Goals ─────────────────────────────────────────────────────────

export interface SmartGoal {
  id: string;
  text: string;
  is_complete: boolean;
}

export interface HighLevelGoal {
  id: number;
  project_id: number | null;  // null for personal goals
  name: string;
  start_date: string;
  end_date: string;
  color: string | null;
  smart_goals: SmartGoal[];
  is_complete: boolean;
  created_at: string;
  // Lab Mode retirement R1b (R1b sharing completion manager, 2026-05-23):
  // unified sharing surface. Optional during the migration window —
  // pre-R1b goals have neither field and render as owner-only (which
  // is the current behavior since `hide_goals_from_lab` was the only
  // visibility control). Migration backfills `owner` from the goal's
  // owning user folder on next save.
  owner?: string;
  shared_with?: SharedUser[];
  // VCP R3 attribution stamps (VCP R3 attribution stamps, 2026-05-26):
  // most-recent editor + when. Stamped on every `goalsApi.update` path.
  // Optional on read for pre-R3 records; back-fills on next write.
  last_edited_by?: string;
  last_edited_at?: string;
}

export interface HighLevelGoalCreate {
  project_id: number | null;  // null for personal goals
  name: string;
  start_date: string;
  end_date: string;
  color?: string | null;
  smart_goals?: SmartGoal[];
}

export interface HighLevelGoalUpdate {
  name?: string;
  start_date?: string;
  end_date?: string;
  color?: string | null;
  smart_goals?: SmartGoal[];
  is_complete?: boolean;
  // VCP R3 — optional; auto-stamped by `goalsApi.update`.
  last_edited_by?: string;
  last_edited_at?: string;
}

// ── UI Types ─────────────────────────────────────────────────────────────────

// ── Methods ──────────────────────────────────────────────────────────────────

export interface Method {
  id: number;
  name: string;
  source_path: string | null;
  // Optional path to a BUNDLED source PDF copied alongside a structured method
  // when it was instantiated from a "kit" catalog template (Kit Phase 1). The
  // structured `source_path` is unchanged; this is a best-effort attachment
  // pointing at `methods/<slug>/source-<vendorFilename>.pdf` under the
  // connected folder, decoded + rendered by the existing pdf-method viewer.
  // Null / absent for every method not instantiated from a bundled-PDF kit.
  source_pdf_path?: string | null;
  method_type: "markdown" | "pdf" | "pcr" | "lc_gradient" | "plate" | "cell_culture" | "mass_spec" | "compound" | "coding_workflow" | "qpcr_analysis" | null;
  folder_path: string | null;
  parent_method_id: number | null;
  tags: string[] | null;
  is_public: boolean;
  created_by: string | null;
  // Sharing fields
  owner: string;
  shared_with: SharedUser[];
  // Read-time overlay fields — set by fetchAllMethodsIncludingShared when
  // the receiver of a shared method loads it. Never persisted to disk.
  is_shared_with_me?: boolean;
  shared_permission?: "view" | "edit";
  // Only meaningful when `method_type === "compound"`. Null/empty for every
  // other method type. Each entry references a child method by id + owner;
  // the renderer walks the array in `ordering` order. See
  // `frontend/src/lib/methods/compound-graph.ts` for cycle / depth /
  // orphan validation.
  components?: CompoundComponent[];
  // Method Picker FLAG B (excerpt-field sub-bot of HR, 2026-05-30): short
  // plain-text preview (<= 140 chars), stamped at save time so the picker
  // card hero renders without a per-card file read. Derived from the
  // markdown body via `deriveExcerptFromMarkdown` (lib/methods/excerpt.ts)
  // for markdown methods, or the type-registry one-line summary for
  // structured types; unset for PDF / compound. Optional + additive:
  // records written before this field load unchanged and render the lazy
  // file-read / registry-description fallback until their next save (lazy
  // backfill, no migration). JsonStore writes unknown fields verbatim.
  excerpt?: string;
  // VCP R3 attribution stamps (VCP R3 attribution stamps, 2026-05-26):
  // most-recent editor + when. `created_by` stays the original author
  // stamp; `last_edited_by` is purely the latest editor. Optional on
  // read for pre-R3 records; back-fills on next write.
  last_edited_by?: string;
  last_edited_at?: string;
  // Cross-boundary METHOD sharing (provenance, 2026-06-04): verified-sender
  // marker stamped ONLY on a method imported from a received bundle, the same
  // pattern as Note.received_from / Task.received_from. Lets the method viewer
  // show "Received from {email}, verified" on the entity itself, not just at
  // receive time. All three are OPTIONAL and additive, absent on every locally
  // created method, on every locally file-imported method, and on every
  // pre-existing record (graceful degradation, no migration). Only the
  // cross-boundary receive path stamps them; the send (collect) path does not
  // carry them, so a re-shared method never leaks the importer's provenance out.
  received_from?: string;             // sender canonical email, set only on imported methods
  received_from_fingerprint?: string; // sender key fingerprint
  received_at?: string;               // ISO 8601 timestamp of import
  // Phase 6a portable identity (phase6a-foundation bot, 2026-06-12): see
  // Project.source_uuid for the full contract. Minted at create time; lazy-backfilled
  // on read; never removed or renamed. ADDITIVE + back-compat.
  source_uuid?: string;
}

export interface MethodCreate {
  name: string;
  source_path?: string | null;
  // Kit Phase 1: optional bundled source-PDF path attached to a structured
  // method instantiated from a kit template. Threads through
  // `methodsApi.create` (which spreads the create payload onto the stored
  // record). Omit / null for non-kit creates.
  source_pdf_path?: string | null;
  method_type?: "markdown" | "pdf" | "pcr" | "lc_gradient" | "plate" | "cell_culture" | "mass_spec" | "compound" | "coding_workflow" | "qpcr_analysis";
  folder_path?: string | null;
  parent_method_id?: number | null;
  tags?: string[];
  /**
   * R1d unified sharing primitive. Pass
   * `[{ username: "*", level: "read" }]` to create the method in the
   * whole-lab (public) namespace; pass `[]` (or omit) for a private
   * method. The "*" sentinel is expanded at read time by `canRead` /
   * `isWholeLabShared`. See `frontend/src/lib/sharing/unified.ts`.
   */
  shared_with?: SharedUser[];
  /**
   * @deprecated Pass `shared_with: [{ username: "*", level: "read" }]`
   *   instead. Will be removed after one release of back-compat (R1
   *   schema rip phase, post-R1d). Still honored by `methodsApi.create`
   *   for transitional callers, with a one-shot runtime warning when it
   *   is the only sharing signal supplied.
   */
  is_public?: boolean;
  components?: CompoundComponent[];
  // Method Picker FLAG B — stamped excerpt preview (see Method.excerpt).
  // Spread onto the stored record by `methodsApi.create`. Set by the
  // markdown create site (derived from the body) and the structured
  // create branches (the type-registry summary); omitted for PDF / compound.
  excerpt?: string;
}

export interface MethodUpdate {
  name?: string;
  source_path?: string | null;
  // Kit Phase 1: optional bundled source-PDF path (see Method.source_pdf_path).
  source_pdf_path?: string | null;
  method_type?: "markdown" | "pdf" | "pcr" | "lc_gradient" | "plate" | "cell_culture" | "mass_spec" | "compound" | "coding_workflow" | "qpcr_analysis" | null;
  folder_path?: string | null;
  parent_method_id?: number | null;
  tags?: string[];
  is_public?: boolean;
  components?: CompoundComponent[];
  // Method Picker FLAG B — re-stamped excerpt preview (see Method.excerpt).
  // Set by the markdown source-body edit/save site so the picker hero stays
  // current with the latest body. Spread onto the record by
  // `methodsApi.update` (which only filters `undefined`).
  excerpt?: string;
  // VCP R3 — optional; auto-stamped by `methodsApi.update`.
  last_edited_by?: string;
  last_edited_at?: string;
}

// ── Inventory (v1 data layer) ────────────────────────────────────────────────
//
// Inventory chunk 1 (inventory-chunk1 sub-bot of HR, 2026-06-07). The catalog
// item / stock-instance split from `plans/INVENTORY_DESIGN.md` (v2, decisions
// resolved 2026-06-07). Two records ship in v1: `InventoryItem` (what a thing
// IS) and `InventoryStock` (the physical containers of it). `StorageNode` (v2),
// the registry blobs (v3), and `InventoryConsumption` (v4) are deferred and NOT
// declared here.
//
// The design's heart (design §2) is maintenance realism: the spine is a COUNT
// of containers (`container_count`), not a volume ledger. `amount_per_container`
// / `unit` are optional and inert unless `track_consumption` is on. The
// low-stock signal is count-based (`low_at_count`). `status` is derived-and-
// persisted (design §5.2), recomputed on every write by `deriveInventoryStatus`.
//
// FLAGs landing here: FLAG-1 / FLAG-2 / FLAG-3 (entities, paths, types),
// FLAG-5 (the count-first / status-first / opt-in fields), and the barcode
// FLAG-B1 (`product_barcode`) / FLAG-B2 (`container_code`). All signed off in
// design §11 + §15.7. Every field is additive; legacy / absent fields lazy-
// normalize on read via `normalizeInventoryItemRecord` /
// `normalizeInventoryStockRecord` in `local-api.ts`.

export type InventoryCategory =
  | "reagent" // generic chemical / consumable (default)
  | "antibody" // registry-extended (v3)
  | "plasmid" // registry-extended (v3)
  | "enzyme"
  | "primer"
  | "cell_line"
  | "strain"
  | "kit"
  | "equipment" // v3+; instances are single, no count semantics
  | "other";

/** Coarse one-tap-or-derived stock status (design §5.2). */
export type InventoryStockStatus = "in_stock" | "low" | "empty" | "expired";

/**
 * `PlasmidRegistry` — the typed fields for a `category: "plasmid"` item
 * (design §7.1). All fields optional/nullable so a freshly-typed plasmid (or a
 * legacy plasmid with no registry) stays valid. The sequence file is a path
 * string only in v3 (no attach / download / map UI; that is the sequence
 * editor's territory).
 */
export interface PlasmidRegistry {
  backbone?: string | null; // "pUC19", "pET-28a"
  insert?: string | null; // gene / fragment cloned in
  resistance?: string | null; // "Ampicillin", "Kanamycin"
  bacterial_host?: string | null; // "DH5-alpha"
  size_bp?: number | null;
  source?: string | null; // Addgene #, collaborator, "in-house"
  addgene_id?: string | null;
  sequence_file_path?: string | null; // path to a .gb/.fasta/.dna in the data folder
  map_notes?: string | null; // free-text feature list as a stopgap
}

/**
 * `AntibodyRegistry` — the typed fields for a `category: "antibody"` item
 * (design §7.2). All fields optional/nullable. `applications` is the multi-pick
 * WB/IF/IHC/FACS set, `rrid` + dilution feed the planned Western blot / IHC
 * method types later.
 */
export interface AntibodyRegistry {
  target?: string | null; // antigen, "beta-actin"
  host_species?: string | null; // "Rabbit", "Mouse"
  clonality?: "monoclonal" | "polyclonal" | null;
  clone?: string | null; // clone id for monoclonals
  conjugate?: string | null; // "HRP", "AlexaFluor-488", "unconjugated"
  isotype?: string | null; // "IgG1"
  reactivity?: string | null; // species reactivity "Human, Mouse"
  applications?: string[] | null; // ["WB", "IF", "IHC", "FACS"]
  rrid?: string | null; // antibody RRID for reproducibility
  recommended_dilution?: string | null; // "1:1000 (WB)"
}

/** The category-specific structured blob hung off an `InventoryItem.registry`
 *  (design §7). v3 ships Plasmid + Antibody; later registries are new shapes. */
export type InventoryRegistry = PlasmidRegistry | AntibodyRegistry;

/**
 * `InventoryItem` — the catalog item: what a thing IS (design §5.1).
 *
 * Shares the shareable shape (`owner` / `shared_with`) and the VCP attribution
 * stamps with Method / Task / Note. New records default `shared_with` to
 * whole-lab edit (`[{ username: "*", level: "edit" }]`) per design §6.1.
 */
export interface InventoryItem {
  id: number;
  name: string; // "Q5 High-Fidelity DNA Polymerase"
  category: InventoryCategory; // drives which extra fields render (v3)
  catalog_number: string | null;
  vendor: string | null;
  cas: string | null; // chemicals; reuse the Purchases field name
  url: string | null; // product page (mirrors PurchaseItem.link)
  container_label: string | null; // display word for the count: "vial" | "tube" | "bottle" | "plate" | "box". Default "container".
  // Chemical-safety + EHS reporting fields (audit fix, additive-fields).
  // Manual entry only, no auto-lookup. `storage_class` is the hazard /
  // storage category (free text, e.g. "Flammable", "Corrosive"); `hazard_note`
  // is a short handling reminder; `sds_url` links the safety data sheet.
  // All additive + optional: legacy records normalize to null on read.
  storage_class: string | null;
  hazard_note: string | null;
  sds_url: string | null;
  notes: string | null;

  // Low-stock policy is COUNT-BASED by default (design §2.3). Flags low when the
  // summed container_count across this item's stocks drops below low_at_count.
  low_at_count: number | null; // null = no auto low-stock flag; unit is "containers"

  // OPT-IN precise consumption (design §2.6). Default false. When true, this
  // item's stocks expose the volume/amount field and the deduct workflow (v4).
  track_consumption?: boolean; // default false

  // Manufacturer UPC / EAN / GTIN, shared by every container of this product
  // (design §15.1, FLAG-B1). Drives scan-to-identify. Optional.
  product_barcode: string | null;

  // Optional category-specific structured blob (design §7). v3. Holds a
  // PlasmidRegistry (category "plasmid") or AntibodyRegistry (category
  // "antibody"); null / absent for every other category. Optional so legacy
  // items with no registry stay valid; lazy-normalized to null on read.
  registry?: InventoryRegistry | null;

  // Sharing + attribution (identical to Method).
  owner: string;
  shared_with: SharedUser[];
  created_by: string | null;
  last_edited_by?: string;
  last_edited_at?: string;
  is_shared_with_me?: boolean; // read-time overlay, never persisted
  shared_permission?: "view" | "edit";

  tags?: string[] | null;
}

export interface InventoryItemCreate {
  name: string;
  category?: InventoryCategory; // default "reagent"
  catalog_number?: string | null;
  vendor?: string | null;
  cas?: string | null;
  url?: string | null;
  container_label?: string | null;
  // Chemical-safety + EHS reporting fields (audit fix, additive-fields).
  storage_class?: string | null;
  hazard_note?: string | null;
  sds_url?: string | null;
  notes?: string | null;
  low_at_count?: number | null;
  track_consumption?: boolean;
  product_barcode?: string | null;
  registry?: InventoryRegistry | null;
  tags?: string[] | null;
  /** New records default to whole-lab edit when omitted (design §6.1). Pass
   *  `[]` for a private item, or an explicit list. */
  shared_with?: SharedUser[];
  created_by?: string | null;
}

export interface InventoryItemUpdate {
  name?: string;
  category?: InventoryCategory;
  catalog_number?: string | null;
  vendor?: string | null;
  cas?: string | null;
  url?: string | null;
  container_label?: string | null;
  // Chemical-safety + EHS reporting fields (audit fix, additive-fields).
  storage_class?: string | null;
  hazard_note?: string | null;
  sds_url?: string | null;
  notes?: string | null;
  low_at_count?: number | null;
  track_consumption?: boolean;
  product_barcode?: string | null;
  registry?: InventoryRegistry | null;
  tags?: string[] | null;
  shared_with?: SharedUser[];
  // Auto-stamped by `inventoryItemsApi.update`.
  last_edited_by?: string;
  last_edited_at?: string;
}

/**
 * `InventoryStock` — the stock: the physical containers of one item
 * (design §5.2). One `InventoryItem` has many `InventoryStock`. This is where
 * the maintenance-realism reframe is concentrated: `container_count` is the
 * spine; `amount_per_container` / `unit` are optional and inert; `status` is
 * derived-and-persisted by `deriveInventoryStatus`.
 */
export interface InventoryStock {
  id: number;
  item_id: number; // FK -> InventoryItem.id (same owner)
  lot_number: string | null;

  // --- PRIMARY quantity: a COUNT of physical containers (design §2.2) ---
  container_count: number; // e.g. 3 (vials). Changed only when a container is finished or arrives.

  // --- COARSE status, one-tap or auto-flipped (design §2.3, derived-and-persisted) ---
  status: InventoryStockStatus;

  // --- ZERO-UPKEEP date signals (design §2.4) ---
  received_date: string | null; // ISO; auto-stamped at Purchases-receive
  expiration_date: string | null; // ISO; drives "expiring soon" forever, entered once
  opened_date: string | null; // some reagents expire N days after opening
  last_touched_at: string | null; // ISO; auto-stamped on any edit; drives "stale" signal

  // --- OPTIONAL precise amount, NEVER required, NEVER the default low-stock basis ---
  // A label on each container ("1 mL", "100 ug"), not a ledger. Only surfaced /
  // decremented when item.track_consumption === true (design §2.6, v4).
  amount_per_container: number | null;
  unit: string | null; // "uL", "mg", "vial", "rxn"; null when count-only
  concentration: string | null; // free text "10 uM", "5 mg/mL"

  // --- Location: one stock sits in at most one box position (or unplaced) ---
  location_text: string | null; // v1 stopgap free-text "-80 door, left"
  location_node_id: number | null; // v2+: FK -> StorageNode.id (the box), null = unplaced
  position: string | null; // v2+: "A1" cell id inside that box

  // --- Provenance back to the order ledger (design §8.1) ---
  purchase_item_id: number | null; // FK -> PurchaseItem.id when received from an order

  // Per-container code: a lab-applied label or generated QR id identifying THIS
  // specific container set / lot (design §15.1, FLAG-B2). Optional.
  container_code: string | null;

  // --- UNITS-PER-SCAN ledger (scan-manager, 2026-06-08) ---
  // When `units_per_scan` is set, a single barcode scan deducts `units_per_scan`
  // from `units_remaining` instead of decrementing `container_count` by 1.
  // When `units_per_scan` is absent, the existing container-count path is used
  // unchanged so all legacy stocks behave exactly as before.
  //
  // `units_per_scan` — how many discrete units (reactions, mL, etc.) one scan
  //   consumes from this stock. Must be a positive integer when set.
  // `units_remaining` — the live ledger of units left. Initialized to the total
  //   units in the box when the lab registers the stock for tracked scanning via
  //   `registerTrackedBarcode`. Clamped at 0; never goes negative. Status
  //   derivation treats 0 units_remaining as empty, and units_remaining below
  //   the item's low_at_count threshold (in units) as low.
  units_per_scan?: number;
  units_remaining?: number;

  // FLAG (scan-manager web sub-bot, 2026-06-08): NEW ADDITIVE FIELD.
  // `scan_unit_label` is the human label for the unit consumed per scan
  // (e.g. "tip", "rxn", "mL", "tablet"). It is distinct from `unit`
  // (which is the amount-per-container label like "uL" or "mg" and belongs
  // to the precise-consumption ledger) and from `container_label` on
  // InventoryItem (which labels the container TYPE, not what each scan
  // deducts). The mobile deduct UI shows this label next to the remaining
  // count: "47 tips remaining". Optional and additive: absent on every
  // pre-existing stock record (lazy-normalize to null). Written by the
  // mobile "register tracker" flow via the mark-arrived action handler.
  scan_unit_label?: string | null;

  notes: string | null;

  owner: string; // always equals the parent item's owner
  shared_with: SharedUser[]; // inherits the item's sharing (kept in sync)
  created_by: string | null;
  last_edited_by?: string;
  last_edited_at?: string;
  is_shared_with_me?: boolean; // read-time overlay, never persisted
  shared_permission?: "view" | "edit";
}

export interface InventoryStockCreate {
  item_id: number;
  lot_number?: string | null;
  container_count?: number; // default 1 (design §13 Q2: status-only stocks allowed)
  /** Optional override; normally derived by `deriveInventoryStatus` on write.
   *  Pass `"low"` / `"empty"` to record a manual tap (design §5.2). */
  status?: InventoryStockStatus;
  received_date?: string | null;
  expiration_date?: string | null;
  opened_date?: string | null;
  last_touched_at?: string | null;
  amount_per_container?: number | null;
  unit?: string | null;
  concentration?: string | null;
  location_text?: string | null;
  location_node_id?: number | null;
  position?: string | null;
  purchase_item_id?: number | null;
  container_code?: string | null;
  units_per_scan?: number;
  units_remaining?: number;
  // See InventoryStock.scan_unit_label for the full FLAG note.
  scan_unit_label?: string | null;
  notes?: string | null;
  /** Defaults to the parent item's `shared_with` when omitted (design §5.2:
   *  a stock inherits the item's sharing). Falls back to whole-lab edit. */
  shared_with?: SharedUser[];
  created_by?: string | null;
}

export interface InventoryStockUpdate {
  item_id?: number;
  lot_number?: string | null;
  container_count?: number;
  /** A directly-tapped status (design §5.2). `"low"` / `"empty"` are honored
   *  as a manual tap and NOT clobbered by an `in_stock` recompute. */
  status?: InventoryStockStatus;
  received_date?: string | null;
  expiration_date?: string | null;
  opened_date?: string | null;
  last_touched_at?: string | null;
  amount_per_container?: number | null;
  unit?: string | null;
  concentration?: string | null;
  location_text?: string | null;
  location_node_id?: number | null;
  position?: string | null;
  purchase_item_id?: number | null;
  container_code?: string | null;
  units_per_scan?: number;
  units_remaining?: number;
  // See InventoryStock.scan_unit_label for the full FLAG note.
  scan_unit_label?: string | null;
  notes?: string | null;
  shared_with?: SharedUser[];
  // Auto-stamped by `inventoryStocksApi.update`.
  last_edited_by?: string;
  last_edited_at?: string;
}

/**
 * `StorageNodeKind` — the label on a generic container node (design §5.3).
 * Mirrors eLabNext's "any unit type, any depth": we do NOT hard-code a fixed
 * freezer/shelf/rack schema; a node carries a `kind` for display and only
 * `box` nodes carry grid dims.
 */
export type StorageNodeKind =
  | "room"
  | "freezer"
  | "fridge"
  | "ln2"
  | "cabinet"
  | "shelf"
  | "rack"
  | "drawer"
  | "tower"
  | "box"
  | "other";

/**
 * `StorageNode` — the location tree (design §5.3). A single recursive
 * container model (room -> freezer -> ... -> box). The tree is just
 * `parent_id` links; depth is unbounded. Only `box` nodes carry `box_rows` /
 * `box_cols` for the box map; positions are NOT stored on the node (an
 * `InventoryStock` owns its `location_node_id` + `position`). Sharing +
 * attribution mirror `InventoryItem` exactly; the location tree is typically
 * whole-lab shared.
 */
export interface StorageNode {
  id: number;
  name: string; // "-80 #2", "Shelf 3", "Box: Q5 enzymes"
  kind: StorageNodeKind;
  parent_id: number | null; // null = top-level (a room or standalone freezer)
  temperature: string | null; // "-80 C", "4 C", "RT" — free text, display only

  // ONLY meaningful when kind === "box": the grid dims for the box map.
  box_rows: number | null; // e.g. 9
  box_cols: number | null; // e.g. 9

  notes: string | null;

  /**
   * Marks a location that lives OUTSIDE the scanned/drawn room (a closet, a cold
   * room down the hall, a shared facility). External locations are never pinned
   * on the room map; they show in an "External storage" list section instead.
   * Inherited by descendants. Defaults to false.
   */
  is_external?: boolean;

  owner: string;
  shared_with: SharedUser[]; // the location tree is typically whole-lab shared
  created_by: string | null;
  last_edited_by?: string;
  last_edited_at?: string;
  is_shared_with_me?: boolean; // read-time overlay, never persisted
  shared_permission?: "view" | "edit";
}

export interface StorageNodeCreate {
  name: string;
  kind?: StorageNodeKind; // default "other"
  parent_id?: number | null;
  temperature?: string | null;
  box_rows?: number | null;
  box_cols?: number | null;
  notes?: string | null;
  is_external?: boolean;
  /** Defaults to whole-lab edit when omitted (design §6.1). */
  shared_with?: SharedUser[];
  created_by?: string | null;
}

export interface StorageNodeUpdate {
  name?: string;
  kind?: StorageNodeKind;
  parent_id?: number | null;
  temperature?: string | null;
  box_rows?: number | null;
  box_cols?: number | null;
  notes?: string | null;
  is_external?: boolean;
  shared_with?: SharedUser[];
  // Auto-stamped by `storageNodesApi.update`.
  last_edited_by?: string;
  last_edited_at?: string;
}

// ── Lab map (2D spatial floorplan, spatial inventory Phase C) ─────────────────
/**
 * `LabMapPin` — one marker on the 2D room map. `nodeId` links it to a StorageNode
 * (so "where is item X" resolves item -> stock -> its node -> that node's pin on
 * the map), or is null for a free-standing label pin. `x`/`y` are normalized
 * 0..1 across the plan area, so a pin survives any display size or export scale.
 */
export interface LabMapPin {
  id: string; // stable client-generated id (keying + edits)
  nodeId: number | null; // a StorageNode this pin marks, or null for a free label
  label: string | null; // free label (when nodeId is null) or a display override
  x: number; // 0..1 across the plan width
  y: number; // 0..1 across the plan height
  /** Optional photo of this physical spot (a downscaled raster data URL), shown
   *  next to the pin when someone locates an item ("show me where it is"). Doubles
   *  as the slot for a future RoomPlan-derived render. Null when none. */
  image: string | null;
}

/**
 * `LabMapPlan` — the floorplan backdrop the pins sit on. `"blank"` is a plain
 * gridded canvas (drop pins, draw nothing); `"image"` shows an uploaded or
 * RoomPlan-derived floorplan at `imagePath`. `aspect` = width / height of the
 * plan area so the canvas keeps shape across devices.
 */
export interface LabMapPlan {
  kind: "blank" | "image";
  imagePath: string | null;
  /** The floor plan as inline SVG markup (vector floor plans, v1). Rendered as
   *  the Room map backdrop on laptop + phone; published in the inventory snapshot.
   *  Null = a blank gridded canvas. Raster import is a later enhancement. */
  imageData: string | null;
  aspect: number; // width / height, default 1.5
}

/**
 * `LabMap` — the lab's 2D spatial map. One per lab, whole-lab shared. The
 * canonical `{ plan, pins }` object every capture method (manual drop now, a
 * RoomPlan flatten later) feeds; the phone renders it read-only. Sharing +
 * attribution mirror `StorageNode`.
 */
export interface LabMap {
  id: number;
  name: string;
  plan: LabMapPlan;
  pins: LabMapPin[];
  owner: string;
  shared_with: SharedUser[];
  created_by: string | null;
  last_edited_by?: string;
  last_edited_at?: string;
  is_shared_with_me?: boolean; // read-time overlay, never persisted
  shared_permission?: "view" | "edit";
}

export interface LabMapCreate {
  name?: string;
  plan?: LabMapPlan;
  pins?: LabMapPin[];
  shared_with?: SharedUser[];
  created_by?: string | null;
}

export interface LabMapUpdate {
  name?: string;
  plan?: LabMapPlan;
  pins?: LabMapPin[];
  shared_with?: SharedUser[];
  last_edited_by?: string;
  last_edited_at?: string;
}

// ── PCR Methods ──────────────────────────────────────────────────────────────

export interface PCRStep {
  name: string;
  temperature: number;
  duration: string; // e.g. "2 min", "20 sec", "Indef."
}

export interface PCRCycle {
  repeats: number;
  steps: PCRStep[];
}

export interface PCRGradient {
  initial: PCRStep[];       // Steps before any cycles
  cycles: PCRCycle[];       // Multiple repeating cycles (e.g., denaturation -> annealing -> extension)
  final: PCRStep[];         // Steps after all cycles
  hold: PCRStep | null;     // Final hold step
}

export interface PCRIngredient {
  id: string;
  name: string;
  concentration: string;
  amount_per_reaction: string; // in uL
  checked?: boolean; // For lab checklist feature
}

export interface PCRProtocol {
  id: number;
  name: string;
  gradient: PCRGradient;
  ingredients: PCRIngredient[];
  notes: string | null;
  is_public: boolean;
  created_by: string | null;
}

export interface PCRProtocolCreate {
  name: string;
  gradient: PCRGradient;
  ingredients: PCRIngredient[];
  notes?: string | null;
  folder_path?: string | null;
  is_public?: boolean;
}

export interface PCRProtocolUpdate {
  name?: string;
  gradient?: PCRGradient;
  ingredients?: PCRIngredient[];
  notes?: string | null;
  is_public?: boolean;
}

// ── LC Gradient ──────────────────────────────────────────────────────────────

export interface LCGradientStep {
  /** Time in minutes from the start of the run. */
  time_min: number;
  /** Percent solvent A at this time point (0–100). Together with percent_b
   *  should sum to 100 for a typical binary gradient; left to the user since
   *  ternary/quaternary methods exist in the wild. */
  percent_a: number;
  /** Percent solvent B at this time point (0–100). */
  percent_b: number;
  /** Flow rate in mL/min at this time point. */
  flow_ml_min: number;
}

export interface LCGradientColumn {
  manufacturer?: string | null;
  model?: string | null;
  /** Column length in mm. */
  length_mm?: number | null;
  /** Inner diameter in mm. */
  inner_diameter_mm?: number | null;
  /** Particle size in µm. */
  particle_size_um?: number | null;
}

/** What role this ingredient plays in the mobile/stationary phase setup. */
export type LCIngredientRole = "solvent_a" | "solvent_b" | "buffer" | "additive";

export interface LCIngredient {
  id: string;
  name: string;
  role: LCIngredientRole;
  /** Free-form concentration (e.g. "0.1%", "10 mM", "—"). */
  concentration?: string;
  notes?: string;
}

export interface LCGradientProtocol {
  id: number;
  name: string;
  description?: string | null;
  is_public: boolean;
  created_at?: string;
  updated_at?: string;
  created_by: string | null;
  gradient_steps: LCGradientStep[];
  column: LCGradientColumn;
  /** Detection wavelength in nm (UV-Vis / PDA). */
  detection_wavelength_nm?: number | null;
  ingredients: LCIngredient[];
}

export interface LCGradientProtocolCreate {
  name: string;
  description?: string | null;
  is_public?: boolean;
  gradient_steps: LCGradientStep[];
  column: LCGradientColumn;
  detection_wavelength_nm?: number | null;
  ingredients: LCIngredient[];
  folder_path?: string | null;
}

export type LCGradientProtocolUpdate = Partial<{
  name: string;
  description: string | null;
  is_public: boolean;
  gradient_steps: LCGradientStep[];
  column: LCGradientColumn;
  detection_wavelength_nm: number | null;
  ingredients: LCIngredient[];
}>;

// ── Plate layout ─────────────────────────────────────────────────────────────
//
// Generic well-plate annotation widget that covers every plate-based workflow:
// bacterial plating, transformation, transfection, growth curves, dose-response,
// ELISA, etc. Deliberately decoupled from any one assay type — the "method"
// (PlateProtocol) carries the plate size + optional region labels for pre-
// labeled zones; the per-task `plate_annotation` snapshot carries the actual
// well-by-well annotations.

/** Plate sizes supported. 12/24/48/96-well plus high-density 384-well
 *  (16 rows A-P x 24 columns). */
export type PlateSize = 12 | 24 | 48 | 96 | 384;

/** Role of a well or region. "custom" pairs with `custom_label` for free-text
 *  brushes (e.g. "Strain ΔADE2"). */
export type PlateWellRole = "blank" | "sample" | "control" | "na" | "custom";

/** A rectangular region of pre-labeled wells on a plate protocol. Rows and
 *  columns are 0-indexed (row 0 = "A", col 0 = column "1") and inclusive on
 *  both ends — `{ row_start: 0, row_end: 0, col_start: 0, col_end: 11 }` is
 *  the entire first row of a 96-well plate. */
export interface PlateRegionLabel {
  row_start: number;
  row_end: number;
  col_start: number;
  col_end: number;
  role: PlateWellRole;
  custom_label?: string;
  notes?: string;
}

export interface PlateProtocol {
  id: number;
  name: string;
  description?: string | null;
  is_public: boolean;
  created_at?: string;
  updated_at?: string;
  created_by: string | null;
  plate_size: PlateSize;
  /** Optional pre-labeled regions baked into the method. Per-task overrides
   *  go on `TaskMethodAttachment.plate_annotation` and supersede these. */
  region_labels?: PlateRegionLabel[];
}

export interface PlateProtocolCreate {
  name: string;
  description?: string | null;
  is_public?: boolean;
  plate_size: PlateSize;
  region_labels?: PlateRegionLabel[];
  folder_path?: string | null;
}

export type PlateProtocolUpdate = Partial<{
  name: string;
  description: string | null;
  is_public: boolean;
  plate_size: PlateSize;
  region_labels: PlateRegionLabel[];
}>;

/** Per-well annotation written by the experiment-page editor. */
export interface PlateWellAnnotation {
  role: PlateWellRole;
  /** Free-text sample identifier (e.g. "Sample 5 @ 10 µM"). Only meaningful
   *  for `role === "sample"` but kept on the well so role-changes don't
   *  silently drop the text. */
  sample_label?: string;
  /** Free-text label for `role === "custom"` brushes. */
  custom_label?: string;
  /** Optional replicate index, used when the same sample is painted across
   *  multiple wells (e.g. 1/2/3 for technical triplicates). */
  replicate_index?: number;
  notes?: string;
}

/** Shape persisted as the JSON-stringified body of
 *  `TaskMethodAttachment.plate_annotation`. Well ids are "A1", "A2", …
 *  using letter-row + 1-indexed-column. */
export interface PlateAnnotationSnapshot {
  wells: Record<string, PlateWellAnnotation>;
}

// ── Cell culture passaging ───────────────────────────────────────────────────

/** What the user planned/did at a particular point in the passage timeline. */
export type CellCultureEventType = "feed" | "split" | "observe" | "harvest";

/** Cell-line metadata — fluff at the top of a passaging schedule. */
export interface CellCultureCellLine {
  name?: string | null;
  species?: string | null;
  tissue?: string | null;
  notes?: string | null;
}

/** A single media supplement (e.g. PenStrep, L-glutamine). */
export interface CellCultureSupplement {
  name: string;
  concentration: string;
  units: string;
}

/** Composition of the growth medium used across the schedule. */
export interface CellCultureMedia {
  base_medium?: string | null;
  serum_percent?: number | null;
  supplements?: CellCultureSupplement[];
}

/** One planned event in the cadence: day-offset from start, what to do that day. */
export interface CellCulturePlannedEvent {
  /** Day offset from start of the schedule. Day 0 = seed day. */
  day_offset: number;
  event_type: CellCultureEventType;
  /** Required when event_type === "split" (e.g. "1:5"); free-form. */
  split_ratio?: string;
  notes?: string;
}

/** Source-side passaging schedule template. The Method record references this
 *  via `source_path: "cell_culture://protocol/{id}"` — mirrors PCR/LC. */
export interface CellCultureSchedule {
  id: number;
  name: string;
  description?: string | null;
  is_public: boolean;
  created_at?: string;
  updated_at?: string;
  created_by: string | null;
  cell_line: CellCultureCellLine;
  media: CellCultureMedia;
  planned_events: CellCulturePlannedEvent[];
}

export interface CellCultureScheduleCreate {
  name: string;
  description?: string | null;
  is_public?: boolean;
  cell_line: CellCultureCellLine;
  media: CellCultureMedia;
  planned_events: CellCulturePlannedEvent[];
  folder_path?: string | null;
}

export type CellCultureScheduleUpdate = Partial<{
  name: string;
  description: string | null;
  is_public: boolean;
  cell_line: CellCultureCellLine;
  media: CellCultureMedia;
  planned_events: CellCulturePlannedEvent[];
}>;

/** One actual event logged mid-execution on the task instance. The unique
 *  per-task feature of cell-culture passaging: passage history is documented
 *  as it happens (fed Monday, looking 80% confluent Wednesday, split 1:5
 *  Thursday). The snapshot below carries the array. */
export interface CellCultureActualEvent {
  /** ISO timestamp when the user logged the event. */
  timestamp: string;
  event_type: CellCultureEventType;
  /** Set when event_type === "split". Free-form (e.g. "1:5"). */
  split_ratio?: string;
  observation_text?: string;
  confluence_percent?: number;
  photo_attachment_path?: string;
}

/** Shape of `TaskMethodAttachment.cell_culture_schedule` once parsed. The
 *  per-task snapshot carries a copy of the planned events (so edits stay
 *  scoped to the experiment) plus the actual events log. */
export interface CellCultureScheduleInstance {
  planned_events: CellCulturePlannedEvent[];
  actual_events: CellCultureActualEvent[];
  /** Per-planned-index free-text notes layered on the planned schedule. Keyed
   *  by the index into `planned_events`. */
  notes_per_event?: Record<number, string>;
  cell_line?: CellCultureCellLine;
  media?: CellCultureMedia;
  description?: string | null;
}

// ── Coding workflows ─────────────────────────────────────────────────────────
//
// Reusable scripts and Jupyter notebooks attached as method-typed records.
// The method record carries the (optional) embedded code body inline; an
// optional `external_path` points at a file on the user's machine for the
// "open in your editor" handoff. Q-B4 lock: no per-task state — coding
// workflows are static reference templates. Q-B5 lock: read-only preview
// only, no Monaco/CodeMirror. See METHODS_EXPANSION_V2_PROPOSAL.md §3.

/** Curated languages with first-class icons + syntax-highlighter profiles.
 *  "other" pairs with `language_label` for freeform fallback. Matches the
 *  highlight.js default language set so rehype-highlight covers all curated
 *  options without bundle-weight additions. */
export type CodingWorkflowLanguage =
  | "python"
  | "r"
  | "bash"
  | "sql"
  | "julia"
  | "matlab"
  | "javascript"
  | "other";

/** Drives the inline preview component:
 *   - "syntax-highlight": embedded_code rendered via rehype-highlight
 *   - "ipynb"            : embedded_code parsed as nbformat JSON + cells
 *                          rendered with static outputs
 *   - null                : no inline preview (external-only) */
export type CodingWorkflowOutputRenderer = "syntax-highlight" | "ipynb" | null;

export interface CodingWorkflowProtocol {
  id: number;
  name: string;
  description?: string | null;
  is_public: boolean;
  created_at?: string;
  updated_at?: string;
  created_by: string | null;
  language: CodingWorkflowLanguage;
  /** Free-form label shown next to the icon when `language === "other"`. */
  language_label?: string | null;
  /** Embedded code body. Null when the workflow is external-only
   *  (`external_path` set without `embedded_code`). */
  embedded_code: string | null;
  /** Optional path on the user's machine for the "open in your editor"
   *  handoff. Stored as a free-text string; the app does not resolve or
   *  open it directly (FSA limitations). Null when the workflow is
   *  embed-only. */
  external_path: string | null;
  output_renderer: CodingWorkflowOutputRenderer;
}

export interface CodingWorkflowProtocolCreate {
  name: string;
  description?: string | null;
  is_public?: boolean;
  language: CodingWorkflowLanguage;
  language_label?: string | null;
  embedded_code?: string | null;
  external_path?: string | null;
  output_renderer?: CodingWorkflowOutputRenderer;
  folder_path?: string | null;
}

export type CodingWorkflowProtocolUpdate = Partial<{
  name: string;
  description: string | null;
  is_public: boolean;
  language: CodingWorkflowLanguage;
  language_label: string | null;
  embedded_code: string | null;
  external_path: string | null;
  output_renderer: CodingWorkflowOutputRenderer;
}>;

// ── qPCR analysis ────────────────────────────────────────────────────────────
//
// qPCR enters v2 as an analysis-only method type composed with PCR via the
// composition primitive. The PCR method type handles the cycling/recipe;
// qPCR analysis carries the layer above (per-target Cq, melt curves, standard
// curves, ΔΔCq fold-change). Users build a "qPCR full kit" compound bundling
// a PCR cycling method with a qPCR analysis method to get the full workflow.
// See METHODS_EXPANSION_V2_PROPOSAL.md §5 for the locked design.

export type QPCRChemistry = "sybr" | "taqman" | "evagreen" | "other";

/** One target/reference dye-channel pairing in a relative-quantitation
 *  analysis. The references list doubles as the target list — flagging one
 *  row `is_reference: true` makes it the housekeeping baseline for ΔΔCq. */
export interface QPCRReference {
  id: string;
  /** Gene/target name (e.g. "flbA", "ACT1"). */
  target: string;
  /** Dye/channel ("FAM", "ROX", "VIC", …). Free-text; instruments vary. */
  channel: string;
  /** Treated as the reference housekeeping for ΔΔCq calculations. At most
   *  one row should carry true; the editor enforces this in the UI but
   *  on-disk records may carry multiple — the calc uses the first. */
  is_reference: boolean;
  /** Optional expected Cq (informational only, not used in the calc). */
  expected_cq?: number | null;
}

/** One point on the dilution-series standard curve used to derive primer
 *  efficiency. Empty / single-point lists silently disable the efficiency
 *  readout in the viz. */
export interface QPCRStandardCurvePoint {
  /** Log10(quantity), e.g. 5 = 10⁵ copies. */
  log_quantity: number;
  /** Cq value at this quantity. */
  cq: number;
  /** Optional replicate count for averaging. */
  replicate_n?: number | null;
}

/** Melt-curve sweep parameters. Per-target Tm readouts come from the
 *  per-task snapshot, not the method record (the method only captures the
 *  sweep config; the readouts are experiment-time data). */
export interface QPCRMeltCurveConfig {
  /** Initial temperature in °C (e.g. 60). */
  start_c: number;
  /** Final temperature in °C (e.g. 95). */
  end_c: number;
  /** Ramp rate in °C/sec (e.g. 0.1). */
  ramp_rate_c_per_sec: number;
}

/** Source-side qPCR analysis method. Reference template captured at method-
 *  creation time; per-task experimental readouts live on
 *  `TaskMethodAttachment.qpcr_analysis` as a `QPCRAnalysisSnapshot`. */
export interface QPCRAnalysisProtocol {
  id: number;
  name: string;
  description?: string | null;
  is_public: boolean;
  created_at?: string;
  updated_at?: string;
  created_by: string | null;
  chemistry: QPCRChemistry;
  /** Free-text chemistry label when `chemistry === "other"`. */
  chemistry_label?: string | null;
  references: QPCRReference[];
  standard_curve: QPCRStandardCurvePoint[];
  melt_curve?: QPCRMeltCurveConfig | null;
  /** ΔΔCq calculation enabled. When true and the references list carries
   *  an `is_reference: true` row, the experiment-page viewer computes
   *  fold-change relative to the reference and displays it. */
  use_delta_delta_cq: boolean;
}

export interface QPCRAnalysisProtocolCreate {
  name: string;
  description?: string | null;
  is_public?: boolean;
  chemistry: QPCRChemistry;
  chemistry_label?: string | null;
  references: QPCRReference[];
  standard_curve: QPCRStandardCurvePoint[];
  melt_curve?: QPCRMeltCurveConfig | null;
  use_delta_delta_cq: boolean;
  folder_path?: string | null;
}

export type QPCRAnalysisProtocolUpdate = Partial<{
  name: string;
  description: string | null;
  is_public: boolean;
  chemistry: QPCRChemistry;
  chemistry_label: string | null;
  references: QPCRReference[];
  standard_curve: QPCRStandardCurvePoint[];
  melt_curve: QPCRMeltCurveConfig | null;
  use_delta_delta_cq: boolean;
}>;

/** Shape persisted as the JSON-stringified body of
 *  `TaskMethodAttachment.qpcr_analysis`. Per-target readouts are keyed by
 *  `QPCRReference.id` so renaming a target on the source method doesn't
 *  silently break the experiment data. */
export interface QPCRAnalysisSnapshot {
  /** Per-target Cq readouts. Keyed by QPCRReference.id. */
  cqs: Record<string, {
    /** Mean Cq across replicates (or single-point Cq when no replicates). */
    cq: number;
    /** Per-replicate Cq values (when entered). */
    replicates?: number[];
    /** Free-text per-target notes (e.g. "off-scale", "primer-dimer detected"). */
    notes?: string | null;
  }>;
  /** Melt-curve Tm readouts per target, keyed by QPCRReference.id. v2 ships
   *  entering Tm values manually; raw -dF/dT visualization is a v2.1 punt. */
  melt_tms?: Record<string, number>;
  /** Free-text per-experiment notes. */
  notes?: string | null;
}

// ── Mass spec ────────────────────────────────────────────────────────────────
//
// Standalone mass spectrometry method type. Pairs with LC via the compound
// primitive for LC-MS workflows; works alone for MALDI / direct infusion /
// GC-MS / etc. The discriminator `ionization_mode` drives smart-per-mode
// rendering in the editor — source-param fields not relevant to the
// selected ionization mode are hidden unless "Show all fields" is checked.
// Per proposal §4.5: no per-task snapshot (static template).

export type IonizationMode =
  | "esi_pos"
  | "esi_neg"
  | "esi_switching"
  | "apci_pos"
  | "apci_neg"
  | "ei"
  | "maldi"
  | "other";

export interface MassSpecSourceParams {
  /** Source temperature in °C. ESI / APCI / EI all use; MALDI usually does not. */
  source_temp_c?: number | null;
  /** Capillary voltage in kV (ESI / APCI). */
  capillary_kv?: number | null;
  /** Nebulizer gas flow in L/min (ESI / APCI). */
  nebulizer_gas_lpm?: number | null;
  /** Drying gas flow in L/min (ESI / APCI). */
  drying_gas_lpm?: number | null;
  /** Drying gas temperature in °C (ESI / APCI). */
  drying_gas_temp_c?: number | null;
  /** Electron ionization energy in eV (EI only). */
  ei_energy_ev?: number | null;
  /** MALDI laser wavelength in nm. */
  maldi_laser_nm?: number | null;
  /** MALDI laser energy (instrument-specific units; free text). */
  maldi_laser_energy?: string | null;
  /** MALDI matrix (free text: "CHCA", "DHB", "SA"). */
  maldi_matrix?: string | null;
  /** Free-text catch-all for instrument-specific params not modeled. */
  other_notes?: string | null;
}

export interface MassSpecScanParams {
  /** Lower m/z bound. */
  scan_mz_low?: number | null;
  /** Upper m/z bound. */
  scan_mz_high?: number | null;
  /** Scan rate in scans/sec (or Hz; user labels). */
  scan_rate_hz?: number | null;
  /** Mass resolving power (R; full-width-half-max). */
  resolution_r?: number | null;
  /** True for MS/MS workflows; false for MS-only. */
  is_msms: boolean;
  /** MS/MS isolation window in m/z (only meaningful when is_msms=true). */
  msms_isolation_window_mz?: number | null;
  /** MS/MS collision energy in eV (only meaningful when is_msms=true). */
  msms_collision_energy_ev?: number | null;
}

export interface MassSpecCalibration {
  /** Reference standard ("sodium formate", "MRFA", "Calmix"): free text. */
  reference_standard?: string | null;
  /** ISO date the calibration was last performed. */
  calibration_date?: string | null;
  /** Expected mass accuracy in ppm. */
  expected_accuracy_ppm?: number | null;
  /** Free-text notes. */
  notes?: string | null;
}

export interface MassSpecProtocol {
  id: number;
  name: string;
  description?: string | null;
  is_public: boolean;
  created_at?: string;
  updated_at?: string;
  created_by: string | null;
  /** Owner of this protocol record. Mirrors LCGradientProtocol's owner
   *  field at write time (set by JsonStore) — kept loose in the type
   *  since the JsonStore writes it implicitly. */
  owner?: string;
  shared_with?: SharedUser[];
  /** The discriminator that drives smart-per-mode field rendering in the editor. */
  ionization_mode: IonizationMode;
  /** Free-text label when `ionization_mode === "other"`. */
  ionization_label?: string | null;
  /** Instrument identifier: "Thermo Q-Exactive", "Bruker timsTOF Pro 2", etc. */
  instrument?: string | null;
  source: MassSpecSourceParams;
  scan: MassSpecScanParams;
  calibration: MassSpecCalibration;
  // VCP R3 attribution stamps (VCP R3 attribution stamps, 2026-05-26):
  // most-recent editor + when. Distinct from `created_by` (original
  // author) and `updated_at` (kept as the canonical write-time field
  // for sorts; `last_edited_at` mirrors it on writes through
  // `massSpecApi.update`). Optional on read for pre-R3 records;
  // back-fills on next write.
  last_edited_by?: string;
  last_edited_at?: string;
}

export interface MassSpecProtocolCreate {
  name: string;
  description?: string | null;
  is_public?: boolean;
  ionization_mode: IonizationMode;
  ionization_label?: string | null;
  instrument?: string | null;
  source: MassSpecSourceParams;
  scan: MassSpecScanParams;
  calibration: MassSpecCalibration;
  folder_path?: string | null;
}

export type MassSpecProtocolUpdate = Partial<{
  name: string;
  description: string | null;
  is_public: boolean;
  ionization_mode: IonizationMode;
  ionization_label: string | null;
  instrument: string | null;
  source: MassSpecSourceParams;
  scan: MassSpecScanParams;
  calibration: MassSpecCalibration;
  // VCP R3 — optional; auto-stamped by `massSpecApi.update`.
  last_edited_by: string;
  last_edited_at: string;
}>;

// ── Compound Methods ─────────────────────────────────────────────────────────

/**
 * A single child reference inside a compound method's `components` array.
 * The compound's renderer fans out across these in `ordering` order,
 * resolving each `(method_id, owner)` pair into a child Method row and
 * its per-type protocol record.
 */
export interface CompoundComponent {
  /** Id of the child method in its owner's namespace. */
  method_id: number;
  /** Explicit owner of the child method. Mirrors `TaskMethodAttachment.owner`
   *  for the same disambiguation reasons: per-user id collisions force every
   *  cross-method reference to carry an owner. `null` = same user as the
   *  compound. */
  owner: string | null;
  /** Stable insertion order within the compound. The renderer sorts by this;
   *  reordering rewrites the array, never mutates indices in place. */
  ordering: number;
  /** Optional label override. When unset, the renderer uses the child's
   *  `Method.name`. Allows "Day 1 plate" / "Day 2 plate" labels on two
   *  copies of the same plate template inside one kit. */
  label?: string;
}

/**
 * Per-child snapshot entry inside a compound's `compound_snapshots` payload.
 * The `snapshot` shape is determined by the child method's `method_type`;
 * readers narrow on the child Method's discriminator before unpacking.
 */
export interface CompoundChildSnapshotEntry {
  schema_version: 1;
  /** Type-specific snapshot blob. Shape mirrors the standalone-attachment
   *  field for the child's type (e.g. an LC child's snapshot is an
   *  LCGradientProtocol; a plate child's is a PlateAnnotationSnapshot;
   *  a markdown child's is `{ body_override: string }`; a nested compound
   *  child's is a recursive CompoundSnapshotPayload). */
  snapshot:
    | PCRSnapshotPayload
    | LCGradientProtocol
    | PlateAnnotationSnapshot
    | CellCultureScheduleInstance
    | QPCRAnalysisSnapshot
    | { body_override: string }
    | CompoundSnapshotPayload
    | null;
}

/** Parsed shape of `TaskMethodAttachment.compound_snapshots`. The outer
 *  `version` field is a forward-compatibility hedge for v2.1 compound-level
 *  fields; readers gate on it. */
export interface CompoundSnapshotPayload {
  version: 1;
  /** Keyed by stringified child `CompoundComponent.method_id`. Absent key =
   *  child renders against its source template only (no per-task overlay). */
  children: Record<string, CompoundChildSnapshotEntry>;
}

/** PCR's standalone-attachment shape carries gradient and ingredients as two
 *  separate JSON-string fields; inside a compound child snapshot they bundle
 *  into one object so the per-child entry stays a single value. */
export interface PCRSnapshotPayload {
  pcr_gradient: PCRGradient;
  pcr_ingredients: PCRIngredient[];
}

export interface MethodForkRequest {
  new_name: string;
  new_source_path: string;
  deviations: string;
}

export interface DeviationSaveRequest {
  task_id: number;
  deviations: string;
}

// ── Purchases ────────────────────────────────────────────────────────────────

/**
 * Per-item ordering status (purchases-ordered-stage, 2026-05-29). The real
 * ordering stage of a purchase line item. The default is "needs_ordering";
 * the field is optional on `PurchaseItem` so pre-existing records (which
 * never carried it) normalize cleanly via `normalizeOrderStatus`.
 */
export type PurchaseOrderStatus = "needs_ordering" | "ordered" | "received";

/** The default stage for a freshly-created or pre-feature line item. */
export const DEFAULT_PURCHASE_ORDER_STATUS: PurchaseOrderStatus =
  "needs_ordering";

/**
 * Coerce an arbitrary on-disk `order_status` value into a known
 * `PurchaseOrderStatus`. Old records (no field) and any unexpected string
 * fall back to "needs_ordering" so callers can treat the result as always
 * present. Centralized so the list mappers, UI grouping, and the
 * setOrderStatus transition all agree on the same normalization.
 */
export function normalizeOrderStatus(
  value: PurchaseOrderStatus | string | null | undefined,
): PurchaseOrderStatus {
  if (value === "ordered" || value === "received") return value;
  return DEFAULT_PURCHASE_ORDER_STATUS;
}

/** Human-facing label for each ordering stage (drives chips + filters). */
export const PURCHASE_ORDER_STATUS_LABEL: Record<
  PurchaseOrderStatus,
  string
> = {
  needs_ordering: "Needs ordering",
  ordered: "Ordered",
  received: "Received",
};

// Purchase document attachments (PURCHASE_DOCS_AND_ROUTING.md, 2026-06-10). A
// PDF (order form / invoice / receipt) attached to a purchase for grant-audit
// documentation. The bytes live local-first as a real file in the connected
// folder under `users/<owner>/purchase_items/<id>/`; this record is the on-record
// reference. `kind` groups documents for the audit packet and the future
// department-routing module.
export type PurchaseAttachmentKind =
  | "order_form"
  | "invoice"
  | "receipt"
  | "quote"
  | "other";

export interface PurchaseAttachment {
  /** Stable id for dedup + deletion, distinct from the file path. */
  id: string;
  /** Display name (the original uploaded filename). */
  filename: string;
  /** Relative path under the data folder where the file bytes live. */
  path: string;
  /** Document kind, for audit grouping + future routing. */
  kind: PurchaseAttachmentKind;
  /** ISO timestamp of when it was attached. */
  uploaded_at: string;
  /** File size in bytes, for display. */
  file_size: number;
}

export interface PurchaseItem {
  id: number;
  task_id: number;
  item_name: string;
  quantity: number;
  link: string | null;
  cas: string | null;
  price_per_unit: number;
  shipping_fees: number;
  total_price: number;
  notes: string | null;
  // Funding link. `funding_account_id` is the AUTHORITATIVE foreign key to a
  // FundingAccount.id (funding-rework, 2026-06-08). `funding_string` is kept as
  // a denormalized display label (the account name at write time) for legacy
  // records and quick rendering, but matching / spend rollups resolve by the id.
  // Additive + optional: pre-rework records have no `funding_account_id`. The
  // read mappers in local-api normalize it to `null`, so a value loaded through
  // the API is always `number | null`; the raw on-disk record may omit it until
  // the auto-migration backfills it by matching `funding_string` to an account
  // name. Optional here (not bare `number | null`) so the many existing
  // PurchaseItem fixtures / reconstructions stay valid, mirroring the other
  // additive fields below (order_status, assigned_to, ...).
  funding_account_id?: number | null;
  funding_string: string | null;
  vendor: string | null;
  // Vendor ordering / catalog number (audit fix, additive-fields). The
  // reorder identifier a user types back into the vendor site, distinct from
  // `cas` (the chemical identity). Additive + optional: old records without it
  // normalize to null on read (purchasesApi.create + the Loro field map seed a
  // null default).
  catalog_number: string | null;
  // Supplies v2 unified page (SUPPLIES_V2_UNIFIED.md, chunk 1). Optional link to
  // the InventoryItem this purchase line is "on order" for, so the unified
  // Supplies view can attach this open order to the right supply BEFORE receipt
  // (the post-receipt direction is InventoryStock.purchase_item_id). Stamped by
  // "Reorder" from a supply; null for ad-hoc purchases (resolved by identity
  // match at view time) and for order-only things (flights/services). Additive +
  // optional: old records normalize to null on read.
  inventory_item_id?: number | null;
  category: string | null;
  // Lab-manager ordering workflow (purchases-assignee fix, 2026-05-29):
  // username of the lab member who was asked to actually place this order.
  // null / undefined = unassigned (the item's owner orders it themselves).
  // Mirrors the Task.assignee pattern: when set and !== the item owner,
  // lists render a small "assigned to X" chip. Additive — old records
  // without it normalize as unassigned.
  assigned_to?: string | null;
  // Per-item ordering status (purchases-ordered-stage, 2026-05-29). The real
  // ordering stage of a single line item, replacing the stopgap where the
  // parent task's complete-toggle stood in for "ordered". Three stages:
  //   "needs_ordering" : the default — nobody has placed this order yet
  //   "ordered"        : someone (often the assignee) has placed the order
  //   "received"       : the supply arrived
  // Additive + optional: old records without the field normalize to
  // "needs_ordering" on read (see `normalizeOrderStatus` + the purchasesApi
  // list mappers). The "needs_ordering" -> "ordered" transition is what
  // fires the `purchase_ordered` bell to the requester (purchasesApi
  // .setOrderStatus), NOT the parent complete-toggle anymore.
  order_status?: PurchaseOrderStatus;
  // Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23): PI approval
  // (informational only, NOT a blocking gate per the brief). All three
  // additive — old records without them behave as if unapproved.
  approved?: boolean;
  approved_by?: string | null;
  approved_at?: string | null;
  // Lab Head Phase 3 — PI flag-for-review; same shape as on Task / Note.
  flagged?: PiFlag | null;
  // PiActions follow-up (PiActions follow-up manager, 2026-05-23):
  // persisted decline state. Falsy `declined_at` means "not declined"
  // (treat as pending unless `approved === true`); a populated
  // `declined_at` means the PI explicitly turned it down. Approve always
  // clears both. State machine:
  //   pending   : !approved && !declined_at
  //   approved  : approved === true
  //   declined  : approved === false && declined_at != null
  // Old records without either field behave as "pending".
  declined_at?: string | null;
  declined_by?: string | null;
  // VCP R3 attribution stamps (VCP R3 attribution stamps, 2026-05-26):
  // most-recent editor + when. Distinct from `approved_by` /
  // `declined_by` (PI approval-state stamps) and from `flagged.by` (PI
  // flag stamp); `last_edited_by` captures any editor of any field.
  // Optional on read for pre-R3 records; back-fills on next write.
  last_edited_by?: string;
  last_edited_at?: string;
  // Purchase documents (PURCHASE_DOCS_AND_ROUTING.md, 2026-06-10). Attached PDFs
  // (order form / invoice / receipt) for grant-audit documentation. Additive +
  // optional: old records without it normalize to an empty array on read (the
  // Loro field map + purchasesApi.create seed []).
  attachments?: PurchaseAttachment[];
}

/** Pending = waiting for the lab head's approval. Approved and declined
 *  are both terminal states (declined can be re-approved via
 *  declinePurchase / setPurchaseApproval flips, but at any given moment
 *  an item is exactly one of pending / approved / declined).
 *  Centralizing this predicate prevents the `!approved` drift that
 *  leaked declined items into the Pending tab pre-db53d92e. */
export function isPurchasePending(item: PurchaseItem): boolean {
  return !item.approved && !item.declined_at;
}

export interface PurchaseItemCreate {
  task_id: number;
  item_name: string;
  quantity: number;
  link?: string | null;
  cas?: string | null;
  price_per_unit?: number;
  shipping_fees?: number;
  notes?: string | null;
  // Funding link (funding-rework, 2026-06-08). Prefer setting
  // `funding_account_id` (authoritative FK); `funding_string` is the
  // denormalized display label. See PurchaseItem.
  funding_account_id?: number | null;
  funding_string?: string | null;
  vendor?: string | null;
  // Vendor ordering / catalog number (audit fix, additive-fields). Optional;
  // omitted records default null in purchasesApi.create.
  catalog_number?: string | null;
  // Supplies v2 link FK (SUPPLIES_V2_UNIFIED.md, chunk 1). Optional; set by
  // "Reorder" from a supply, omitted otherwise.
  inventory_item_id?: number | null;
  category?: string | null;
  // Lab-manager ordering workflow (purchases-assignee fix, 2026-05-29).
  assigned_to?: string | null;
  // Per-item ordering status (purchases-ordered-stage, 2026-05-29). Omit to
  // let `purchasesApi.create` default it to "needs_ordering".
  order_status?: PurchaseOrderStatus;
  // Purchase documents (PURCHASE_DOCS_AND_ROUTING.md). Optional; omitted records
  // default to an empty array in purchasesApi.create.
  attachments?: PurchaseAttachment[];
}

export interface PurchaseItemUpdate {
  item_name?: string;
  quantity?: number;
  link?: string | null;
  cas?: string | null;
  price_per_unit?: number;
  shipping_fees?: number;
  notes?: string | null;
  /** Funding link (funding-rework, 2026-06-08). `funding_account_id` is the
   *  authoritative FK; `funding_string` rides along as the display label.
   *  Either may be `null` to clear. See PurchaseItem. */
  funding_account_id?: number | null;
  funding_string?: string | null;
  vendor?: string | null;
  // Vendor ordering / catalog number (audit fix, additive-fields). Optional.
  catalog_number?: string | null;
  category?: string | null;
  /** Lab-manager ordering workflow (purchases-assignee fix, 2026-05-29):
   *  username to assign (or `null` to clear). The writer that flips this
   *  to a non-owner user posts a `purchase_assignment` bell to the
   *  assignee. */
  assigned_to?: string | null;
  /** Per-item ordering status (purchases-ordered-stage, 2026-05-29). Prefer
   *  `purchasesApi.setOrderStatus` over a raw `update` so the
   *  `needs_ordering` -> `ordered` transition fires the `purchase_ordered`
   *  bell. A direct `update({ order_status })` persists the field but is
   *  silent (used by tests / migrations). */
  order_status?: PurchaseOrderStatus;
  /** Lab Head Phase 3 — PI approval. The writer that flips this also
   *  stamps `approved_by` + `approved_at`. */
  approved?: boolean;
  approved_by?: string | null;
  approved_at?: string | null;
  /** Lab Head Phase 3 — PI flag (object sets, `null` clears). */
  flagged?: PiFlag | null;
  /** PiActions follow-up — persisted decline state. Approve clears both
   *  to null; decline sets them. See PurchaseItem doc for state machine. */
  declined_at?: string | null;
  declined_by?: string | null;
  // VCP R3 — optional; auto-stamped by `purchasesApi.update`.
  last_edited_by?: string;
  last_edited_at?: string;
  // Purchase documents (PURCHASE_DOCS_AND_ROUTING.md). Set to replace the list,
  // or omit to leave unchanged. Serialized into the Loro field map like flagged.
  attachments?: PurchaseAttachment[];
}

export interface CatalogItem {
  id: number;
  item_name: string;
  link: string | null;
  cas: string | null;
  // Vendor ordering / catalog number (audit fix, additive-fields). Lets a
  // catalog suggestion prefill the new purchase row's catalog_number on
  // select. Optional on read; legacy catalog entries normalize to null.
  catalog_number?: string | null;
  price_per_unit: number;
}

// ── Funding Accounts ──────────────────────────────────────────────────────────

/**
 * Structured-research-metadata foundation (metadata implementation bot,
 * 2026-05-28). Identifier scheme for a funder, mirroring DataCite's
 * `funderIdentifierType` controlled vocabulary so a later DOI deposit can
 * copy the value straight across. "Other" / null cover funders whose id
 * scheme we don't model. Kept as a string union (not an enum) to stay
 * consistent with the rest of types.ts.
 */
export type FunderIdType =
  | "Crossref Funder ID"
  | "ROR"
  | "GRID"
  | "ISNI"
  | "Other"
  | null;

export interface FundingAccount {
  id: number;
  name: string;
  description: string | null;
  // The budget cap. Spend (and therefore "remaining") is NO LONGER stored
  // (funding-rework, 2026-06-08): it is computed live from purchase line items
  // via `computeFundingSpend` (lib/funding/spend.ts) wherever it is shown, so
  // there is one source of truth and no stale on-disk counter to reconcile. The
  // auto-migration strips the old `spent` / `remaining` fields from existing
  // funding-account files.
  total_budget: number;
  // Structured grant / award metadata (metadata implementation bot,
  // 2026-05-28). All optional + additive: funding-account files written
  // before this slice load unchanged (absent field = "not set"), and the
  // `fundingAccountsStore.update` spread-merge filters `undefined` so
  // partial updates never clobber these. Field names mirror DataCite
  // `fundingReference` (awardNumber, funderName, funderIdentifier,
  // funderIdentifierType, awardTitle) so a later export is a direct copy.
  //
  // NOTE: `name` stays the user-chosen label purchases match on; it and
  // `award_number` are deliberately separate values that may differ.
  award_number?: string | null;
  funder_name?: string | null;
  funder_id?: string | null;
  funder_id_type?: FunderIdType;
  award_title?: string | null;
}

export interface FundingAccountCreate {
  name: string;
  description?: string | null;
  total_budget?: number;
  // Structured grant metadata — see FundingAccount.
  award_number?: string | null;
  funder_name?: string | null;
  funder_id?: string | null;
  funder_id_type?: FunderIdType;
  award_title?: string | null;
}

export interface FundingAccountUpdate {
  name?: string;
  description?: string | null;
  total_budget?: number;
  // Structured grant metadata — see FundingAccount.
  award_number?: string | null;
  funder_name?: string | null;
  funder_id?: string | null;
  funder_id_type?: FunderIdType;
  award_title?: string | null;
}

export interface FundingSummary {
  accounts: FundingAccount[];
  total_budget: number;
  total_spent: number;
  total_remaining: number;
  uncategorized_spent: number;
}

// ── Deposit tracking ────────────────────────────────────────────────────────
//
// Deposit records (deposit-tracking bot, 2026-06-18). Per-user store at
// `users/<owner>/deposits/<id>.json`. One record per guided-deposit handoff:
// the user has downloaded the bundle and is uploading to the repository; the
// DOI is null until the repository mints it and the user pastes it back.
//
// No em-dashes, no emojis.

export interface Deposit {
  id: number;
  /** The deposited experiment id, or null for a project-level deposit. */
  task_id: number | null;
  /** The deposited project id, or null for a single-experiment deposit. */
  project_id: number | null;
  repository: "zenodo" | "figshare" | "other";
  /** Snapshot of the deposited item title at deposit time. */
  title: string | null;
  /** DOI minted by the repository; null until the user pastes it in. */
  doi: string | null;
  /** Permanent concept DOI bridging versions (Zenodo only); null until known. */
  concept_doi: string | null;
  /** 1, 2, 3, ... for re-deposited versions of the same item; null when unknown. */
  version_sequence: number | null;
  /** Back-link to the previous Deposit record in the chain; null for v1. */
  prior_version_id: number | null;
  /** ISO timestamp; set to now at handoff (the user is depositing right now). */
  deposited_at: string | null;
  /** ISO timestamp; record creation. */
  created_at: string;
  owner: string;
  shared_with: SharedUser[];
  created_by: string | null;
  last_edited_by?: string;
  last_edited_at?: string;
}

export interface DepositCreate {
  task_id?: number | null;
  project_id?: number | null;
  repository: "zenodo" | "figshare" | "other";
  title?: string | null;
  doi?: string | null;
  concept_doi?: string | null;
}

export interface DepositUpdate {
  doi?: string | null;
  concept_doi?: string | null;
  deposited_at?: string | null;
  version_sequence?: number | null;
  prior_version_id?: number | null;
}

// ── File-system shapes ──────────────────────────────────────────────────────

export interface GitHubTreeItem {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
}

// ── UI Types ─────────────────────────────────────────────────────────────────

export type SnapZone = "top" | "middle" | "bottom";

export type ViewMode =
  | "1week"
  | "2week"
  | "3week"
  | "1month"
  | "3month"
  | "6month"
  | "1year"
  | "all";

// ── Events (Calendar) ────────────────────────────────────────────────────────

export interface Event {
  id: number;
  title: string;
  event_type: "conference" | "deadline" | "meeting" | "other";
  start_date: string;
  end_date: string | null;
  /** Local time in HH:MM 24-hour form. `null` means the event is all-day. */
  start_time: string | null;
  /** Local time in HH:MM 24-hour form. `null` means no explicit end time. */
  end_time: string | null;
  location: string | null;
  url: string | null;
  notes: string | null;
  color: string | null;
  /** Streak-system PTO marker (Phase S5 of the streak-and-milestones arc).
   *  When `true`, the event's date(s) are mirrored into the user's
   *  `pto_dates` list in `_streak.json`, treating the day(s) like a weekend
   *  for streak continuation and project schedule reflow. One-way sync:
   *  toggling the flag writes to pto_dates, but pto_dates changes never
   *  push back into events. Optional / nullable for backward compat with
   *  pre-S5 event records. */
  is_pto?: boolean | null;
  /** Optional link to a task. `task_id` is the numeric id in the owner's
   *  namespace; `task_owner` is that owner's username, so the pair forms the
   *  composite "<owner>:<id>" key (matching `taskKey`) and resolves correctly
   *  for shared tasks. Both null/absent means the event is not linked. Same
   *  cross-owner linkage convention as purchase items and task notifications.
   *  Optional / nullable for backward compat with pre-link event records. */
  task_id?: number | null;
  task_owner?: string | null;
}

export interface EventCreate {
  title: string;
  event_type?: "conference" | "deadline" | "meeting" | "other";
  start_date: string;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  url?: string | null;
  notes?: string | null;
  color?: string | null;
  is_pto?: boolean | null;
  task_id?: number | null;
  task_owner?: string | null;
}

export interface EventUpdate {
  title?: string;
  event_type?: "conference" | "deadline" | "meeting" | "other";
  start_date?: string;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  url?: string | null;
  notes?: string | null;
  color?: string | null;
  is_pto?: boolean | null;
  task_id?: number | null;
  task_owner?: string | null;
}

// ── External Calendar Feeds (Google/Outlook/iCloud via ICS) ──

export type CalendarFeedProvider = "google" | "outlook" | "icloud" | "other";

/** How the feed pulls events. Only ICS subscriptions are supported — the
 *  legacy OAuth integrations were removed (2026-05-14). The field is kept
 *  as a single-member union for forward-compatibility if a richer transport
 *  is ever reintroduced. */
export type CalendarFeedKind = "ics";

export interface CalendarFeed {
  id: number;
  /** Display category — drives the icon and provider-specific help copy. */
  provider: CalendarFeedProvider;
  /** Transport. Always "ics" today; older files written when OAuth feeds
   *  existed are coerced to "ics" at the read boundary (the OAuth ones get
   *  filtered out — they can't be fetched anymore). */
  kind: CalendarFeedKind;
  label: string;
  /** The ICS URL the feed proxies. Required. */
  icsUrl: string | null;
  color: string;
  enabled: boolean;
  lastSyncAt: string | null;
}

export interface ExternalEvent {
  /** Stable string id derived from feedId + ICS UID. */
  id: string;
  feedId: number;
  /** Mirrors the parent feed's kind. Always "ics" today; kept as a field
   *  so future transports can identify themselves without a schema break. */
  feedKind: CalendarFeedKind;
  /** ICS UID (or a synthetic id when the source omitted one). */
  providerEventId: string;
  title: string;
  start_date: string;
  end_date: string | null;
  /** Local time in HH:MM 24-hour form (preserved from DTSTART when the
   *  event isn't all-day). `null` means an all-day event. */
  start_time: string | null;
  /** Local time in HH:MM 24-hour form (from DTEND). `null` means no end
   *  time was specified. */
  end_time: string | null;
  location: string | null;
  url: string | null;
  notes: string | null;
  color: string;
  source: "external";
}

// ── Lab Links ─────────────────────────────────────────────────────────────────

export interface LabLink {
  id: number;
  title: string;
  url: string;
  description: string | null;
  category: string | null;
  color: string | null;
  preview_image_url: string | null;
  sort_order: number;
  created_at: string;
  // Lab Mode retirement R1b (R1b sharing completion manager, 2026-05-23):
  // unified sharing surface. Optional during the migration window.
  owner?: string;
  shared_with?: SharedUser[];
  // VCP R3 attribution stamps (VCP R3 attribution stamps, 2026-05-26):
  // most-recent editor + when. Stamped on every `labLinksApi.update`
  // path. Optional on read for pre-R3 records; back-fills on next write.
  last_edited_by?: string;
  last_edited_at?: string;
}

export interface LabLinkCreate {
  title: string;
  url: string;
  description?: string | null;
  category?: string | null;
  color?: string | null;
  preview_image_url?: string | null;
  // Lab-share restore (links lab-share restore bot, 2026-05-29): the
  // Visibility toggle. `true` = "Whole lab" (stamps the edit-level "*"
  // whole-lab sentinel on `shared_with`); falsy / omitted = "Just me"
  // (private, empty `shared_with`). Default for a new link is "Just me".
  whole_lab?: boolean;
}

export interface LabLinkUpdate {
  title?: string;
  url?: string;
  description?: string | null;
  category?: string | null;
  color?: string | null;
  preview_image_url?: string | null;
  sort_order?: number;
  // VCP R3 — optional; auto-stamped by `labLinksApi.update`.
  last_edited_by?: string;
  last_edited_at?: string;
  // Lab-share restore: same Visibility toggle as create. When present it
  // rewrites `shared_with` in lockstep ("*" sentinel for whole-lab, [] for
  // private); when omitted the existing sharing is left untouched.
  whole_lab?: boolean;
}

export interface LinkPreview {
  title: string;
  description: string | null;
  image: string | null;
  site_name: string | null;
}

// ── Attachment Metadata ────────────────────────────────────────────────────────

export interface ImageMetadata {
  id: number;
  filename: string;
  original_filename: string | null;
  path: string;
  experiment_id: number;
  experiment_name: string;
  project_id: number | null;
  project_name: string | null;
  uploaded_at: string;
  file_size: number;
  file_type: string;
  folder: string;
}

export interface FileMetadata {
  id: number;
  filename: string;
  original_filename: string | null;
  path: string;
  experiment_id: number;
  experiment_name: string;
  project_id: number | null;
  project_name: string | null;
  uploaded_at: string;
  file_size: number;
  file_type: string;
  folder: string;
  attachment_type: "notes" | "results";
}

// ── Meeting Notes ───────────────────────────────────────────────────────────────

export interface NoteEntry {
  id: string;
  title: string;
  date: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface NoteEntryCreate {
  title: string;
  date: string;
  content?: string;
}

export interface NoteEntryUpdate {
  title?: string;
  date?: string;
  content?: string;
}

/**
 * VC Phase 2 (FLAG-1): the 24h undo-restore window sidecar. Written atomically
 * onto the live Note by the restore update, cleared by the undo update, and
 * stripped by the folder-connect expiry sweep once `expires_at` has passed.
 *
 * CRITICAL: this field is in the canonicalize VOLATILE_STAMP_DENYLIST
 * (FLAG-2), so it never appears in a history delta. It is a transient UI
 * affordance, not tracked content.
 */
export interface RevertUndoWindow {
  /** The version index (history row index) the note was at BEFORE the restore.
   *  Undo reverse-walks back to this. */
  from_version: number;
  /** The version index the restore reverted TO. */
  to_version: number;
  /** ISO 8601 timestamp the restore happened. */
  reverted_at: string;
  /** ISO 8601 timestamp the undo affordance expires (reverted_at + 24h). */
  expires_at: string;
  /** Username of whoever performed the restore. */
  reverted_by: string;
}

export interface NoteComment {
  id: string;
  author: string;       // username of the commenter (the real user, not "lab")
  text: string;
  created_at: string;
  // Lab Head Phase 2 (lab head Phase 2 manager, 2026-05-23) — threading +
  // @-mentions. See TaskComment for the same field docs.
  parent_id?: string | null;
  mentions?: string[];
}

export interface Note {
  id: number;
  title: string;
  description: string;
  is_running_log: boolean;
  is_shared: boolean;
  entries: NoteEntry[];
  comments?: NoteComment[];  // Lab-mode comment thread (#13); optional for backward compat
  // Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23): PI flag-for-
  // review. Same shape as on Task / PurchaseItem. Null/undefined = not
  // flagged. Additive — old records normalize fine without it.
  flagged?: PiFlag | null;
  // Note created_at field (Note created_at field manager, 2026-05-24):
  // optional + nullable so older on-disk notes (which may pre-date the
  // create-path writing this field) read as `undefined` without
  // breaking type checks. New notes always carry an ISO string set in
  // `notesApi.create`. Activity widgets that count "notes created
  // today" guard on `note.created_at && note.created_at.startsWith(todayIso)`,
  // so missing values fall out naturally (graceful degradation, same
  // pattern as PurchaseItem.declined_at in commit 07a1b7b3). Do NOT
  // backfill old notes — the undefined case is intentional.
  created_at?: string | null;
  updated_at: string;
  username: string;
  // Lab Mode retirement R1b (R1b sharing completion manager, 2026-05-23):
  // unified sharing surface. Notes had `is_shared: boolean` pre-R1b
  // (whole-lab toggle). Migration converts `is_shared: true` → a single
  // "*" entry in `shared_with`. Both fields are kept readable during
  // the release window so legacy code keeps working.
  shared_with?: SharedUser[];
  // VCP R3 attribution stamps (VCP R3 attribution stamps, 2026-05-26):
  // most-recent editor + when. Distinct from `username` (the original
  // author / creator stamp) and `updated_at` (the canonical write-time
  // field used by sorts and the activity sidecar; we keep BOTH because
  // existing call sites rely on `updated_at`). `last_edited_by` is
  // stamped on every update path including PI cross-owner edits — the
  // "(PI)" badge is a UI render concern, not a stored field. Optional
  // on read for pre-R3 records; back-fills on next write.
  last_edited_by?: string;
  last_edited_at?: string;
  // VC Phase 2 (FLAG-1): the 24h undo-restore window. Present only between a
  // restore and either its undo or the window's expiry. Denylisted from the
  // history canonical (FLAG-2) so it never pollutes a delta. Absent on every
  // note that was never restored.
  revert_undo_window?: RevertUndoWindow;
  // Shared Notebooks Phase 1 (notebooks-data bot, 2026-06-02): when set, this
  // note belongs to a shared 1:1 notebook (see `SharedNotebook`). The value is
  // the notebook's globally-unique id. ABSENT = a personal note (unchanged
  // behavior; the personal-notes path never sets this). A note carrying a
  // `notebook_id` is always created with `shared_with` = both notebook members
  // at level "edit" (via `pairingSharedWith`), so both members read AND edit
  // it. Additive / back-compat: old notes read as `undefined` and stay
  // personal.
  notebook_id?: string;
  // 1:1 revamp (oneonone data+strip bot, 2026-06-07). See
  // docs/proposals/NOTEBOOKS_AND_ONE_ON_ONE_REVAMP.md. When set, this note
  // belongs to a lab-head <-> member 1:1 (see `OneOnOne`), NOT a notebook. The
  // value is the 1:1's globally-unique id. `notebook_id` and `one_on_one_id`
  // are mutually exclusive: a note lives in a notebook OR a 1:1, never both.
  // ABSENT = an ordinary note (unchanged). Notes carrying this are always
  // created with `shared_with` = both 1:1 members at "edit", so both read +
  // edit. Additive / back-compat: old notes read as `undefined`.
  one_on_one_id?: string;
  // 1:1 revamp: distinguishes a weekly MEETING note ("meeting") from a freeform
  // SHARED note ("note") inside a 1:1. ABSENT on every ordinary (non-1:1) note.
  // Read alongside `one_on_one_id`; meaningless without it.
  note_kind?: "meeting" | "note";
  // Cross-boundary sharing (note-transfer adapter, 2026-06-03): provenance
  // marker stamped ONLY on notes imported from a received bundle (the locked
  // design in docs/proposals/CROSS_BOUNDARY_SHARING_INBOX_DESIGN.md). They keep
  // imported items traceable ("received from {email} on {date}") so a recipient
  // never confuses a foreign note with their own. All three are OPTIONAL and
  // additive, absent on every locally created note and on every pre-existing
  // record (graceful degradation, same pattern as created_at above). The send
  // (collect) path explicitly DROPS these from the shared entity so a re-shared
  // note never leaks the importer's provenance back out.
  received_from?: string;             // sender canonical email, set only on imported notes
  received_from_fingerprint?: string; // sender key fingerprint
  received_at?: string;               // ISO 8601 timestamp of import
  // Phase 3c chunk 3a (FLAG: new Note field): the collab doc id that travels
  // with the note when it is shared cross-boundary (see note-transfer.ts).
  // Written to the JSON record on import so the recipient's NoteDetailPopup can
  // seed the Loro meta map with the correct id and auto-join the shared doc's
  // relay room. The value is a UUID string. ADDITIVE and backward-compatible:
  // absent on all pre-existing notes and all unshared notes. The Loro sidecar
  // is the authoritative store (collab_doc_id key in the meta map); this JSON
  // field is the bootstrap bridge for newly-imported notes before the sidecar
  // is written for the first time.
  collab_doc_id?: string;
  // Phase 6a portable identity (phase6a-foundation bot, 2026-06-12): see
  // Project.source_uuid for the full contract. Minted at create time; lazy-backfilled
  // on read; never removed or renamed. ADDITIVE + back-compat.
  source_uuid?: string;
}

export interface NoteCreate {
  title: string;
  description?: string;
  is_running_log?: boolean;
  is_shared?: boolean;
  entries?: NoteEntryCreate[];
}

export interface NoteUpdate {
  title?: string;
  description?: string;
  is_shared?: boolean;
  /** Lab Head Phase 3 — PI flag (object sets, `null` clears). */
  flagged?: PiFlag | null;
  // VCP R3 — optional; auto-stamped by `notesApi.update`. The note
  // path also stamps `updated_at`; both fields land together.
  last_edited_by?: string;
  last_edited_at?: string;
  // VC Phase 2 (FLAG-1): the undo-restore window. Set (object) on a restore;
  // CLEARED (`null`) on an undo. `notesApi.update` deletes the key on `null`
  // so the live note carries no lingering field. Denylisted (FLAG-2).
  revert_undo_window?: RevertUndoWindow | null;
  // VC Phase 2 (FLAG-1): a restore writes the FULL tracked state back, which
  // for a note spans the structural fields below, not just title/description.
  // They live in a dedicated payload type (NoteRestorePayload) rather than
  // widening NoteUpdate's core fields, because NoteUpdate is structurally
  // compatible with `Partial<NoteCreate>` at several call sites and adding
  // `entries: NoteEntry[]` here would break that overlap (NoteCreate carries
  // NoteEntryCreate[]). The restore handler assembles a NoteRestorePayload and
  // passes it through notesApi.update; the partial-merge store keys on the
  // object at runtime, so the structural fields persist.
}

/**
 * VC Phase 2 (FLAG-1): the full-tracked-state payload a restore / undo writes.
 * Superset of NoteUpdate with every structural field the canonical tracks, so
 * `notesApi.update` overwrites the live note to exactly the target version.
 * Distinct type (not a NoteUpdate widening) to avoid colliding with the
 * `Partial<NoteCreate>` flows that also feed notesApi.update.
 */
export interface NoteRestorePayload extends NoteUpdate {
  title?: string;
  description?: string;
  is_shared?: boolean;
  is_running_log?: boolean;
  entries?: NoteEntry[];
  comments?: NoteComment[];
  shared_with?: SharedUser[];
  flagged?: PiFlag | null;
}

export interface NoteEntriesReorderRequest {
  entry_ids: string[];
}

// ── Weekly goals ───────────────────────────────────────────────────────────────
//
// Weekly goals widget (PI beta feedback, weekly-goals widget, 2026-05-29).
//
// DATA-SHAPE CHANGE (new entity). A WeeklyGoal is a LIGHTWEIGHT, STANDALONE
// record set by a trainee in (or around) a 1:1 meeting: "what do I want to
// get done this week". It is deliberately DISTINCT from `HighLevelGoal` /
// the Gantt goal system — no project_id, no SMART sub-goals, no date range,
// no color. A weekly goal NEVER lands on the Gantt. The two concepts stay
// visually and conceptually separate.
//
// Sharing mirrors `Note` EXACTLY so the same `canRead(record, viewer)` gate
// from `lib/sharing/unified.ts` works unchanged:
//   - `is_shared: boolean`  — the coarse "did the owner share this at all"
//     flag. `labApi.getWeeklyGoals({ shared_only: true })` filters on it,
//     mirroring `labApi.getNotes({ shared_only: true })`.
//   - `shared_with: SharedUser[]` — the precise recipient list. The "*"
//     sentinel = whole-lab. Goals set in a 1:1 DEFAULT to whole-lab
//     ("*", visible to the PI) but still flow through the REAL sharing
//     gate; there is no bypass.
//
// Stored per-user at `users/<owner>/weekly_goals/<id>.json` via a `JsonStore`,
// mirroring `notesStore` / `eventsStore` (per-user scoping + per-user
// counters). `id` is a numeric JsonStore key (not a UUID) to match the rest
// of the store records; `owner` carries the trainee username for the sharing
// gate (same role `note.username` plays for notes).
export interface WeeklyGoal {
  /** Numeric JsonStore key, unique within the owner's `weekly_goals` dir. */
  id: number;
  /** Trainee username this goal belongs to. Drives the sharing gate
   *  (`canRead` compares `owner` to the viewer). */
  owner: string;
  /** The goal text. Free-form, single line. */
  text: string;
  /** YYYY-MM-DD anchoring the week (the Monday of that week). Used to
   *  group goals by week in the UI. */
  week_of: string;
  /** Done toggle. */
  is_complete: boolean;
  /** ISO timestamp of creation. */
  created_at: string;
  /** Username that created the record (normally === owner; kept separate
   *  so a future PI-set-on-behalf flow has a home without a migration). */
  created_by: string;
  /** Coarse sharing flag — mirrors `Note.is_shared`. `shared_only`
   *  aggregations filter on this. */
  is_shared: boolean;
  /** Precise recipient list — mirrors `Note.shared_with`. "*" = whole lab.
   *  Optional on read so a record written before this field normalizes to
   *  owner-only (same back-compat shape as notes). */
  shared_with?: SharedUser[];
  // 1:1 revamp (oneonone data+strip bot, 2026-06-07). See
  // docs/proposals/NOTEBOOKS_AND_ONE_ON_ONE_REVAMP.md. When set, this weekly
  // goal is a SHARED weekly goal inside a lab-head <-> member 1:1 (see
  // `OneOnOne`). The value is the 1:1's globally-unique id. `text` is the goal,
  // `is_complete` the done toggle, `week_of` the grouping. A goal carrying this
  // is always created with `shared_with` = both 1:1 members at level "edit" (via
  // `membersSharedWith`), so either member can add a goal and either can check
  // it off. ABSENT = a personal / whole-lab weekly goal (unchanged behavior).
  // (Replaces the retired notebook weekly-task path; weekly goals belong to
  // 1:1s now, not notebooks.)
  one_on_one_id?: string;
  // Check-ins revamp Phase 2 (checkins-phase2 bot, 2026-06-12). See
  // docs/proposals/checkins-revamp.md "Phase 2 build spec". Optional single
  // assignee for a group goal board (a member username, or null/absent =
  // shared / everyone). ADDITIVE + back-compat: absent on every pre-Phase-2
  // goal; `normalizeWeeklyGoalRecord` defaults it to null on read.
  assignee?: string | null;
}

export interface WeeklyGoalCreate {
  text: string;
  /** Defaults to the current week's Monday when omitted. */
  week_of?: string;
  /** Defaults to true (1:1 goals are visible to the PI / whole lab). */
  is_shared?: boolean;
}

export interface WeeklyGoalUpdate {
  text?: string;
  week_of?: string;
  is_complete?: boolean;
  is_shared?: boolean;
}

// ── Shared 1:1 Notebooks ─────────────────────────────────────────────────────
//
// Shared Notebooks Phase 1 (notebooks-data bot, 2026-06-02). See
// docs/proposals/SHARED_NOTEBOOKS_PROPOSAL.md. A SharedNotebook is a dedicated
// shared workspace between EXACTLY two people (typically a PI and a student).
// Everything inside it (notes + weekly tasks) is ALWAYS shared between exactly
// those two members at level "edit" - no per-item toggle, never whole-lab.
//
// The sharing itself reuses the unified primitive unchanged: the record (and
// every item created inside it) carries `shared_with = pairingSharedWith(a, b)`
// (both members at "edit"), and `canRead` / `canWrite` honor that explicit
// list. No new sharing engine, no migration.
//
// ID SHAPE (data-shape decision, notebooks-data bot, 2026-06-02): `id` is a
// GLOBALLY-UNIQUE string (crypto.randomUUID), NOT a JsonStore numeric counter.
// The approved proposal specified `id: string`, and global uniqueness is
// REQUIRED because `notebook_id` is a cross-user query key: items live in each
// member's own folder, so a per-user numeric counter (the PI's notebook #1 and
// a student's notebook #1) would collide when aggregating a notebook's items
// across both members. A UUID has no such collision. The record is stored via
// a thin string-keyed per-user store (lib/shared-notebooks/store.ts) that
// mirrors JsonStore's `users/<owner>/<entity>/<id>.json` layout; JsonStore
// itself is `<T extends { id: number }>` and cannot hold a string id.
// GENERALIZED 1..N MODEL (notebooks-gen Phase 1, 2026-06-06): a `Notebook` is a
// single container that holds 1..N members. members.length === 1 is a PRIVATE
// (unshared) notebook living only in the owner's folder; members.length >= 2 is
// a SHARED notebook. The former 1:1 PI<->student `SharedNotebook` is the
// two-member special case. On-disk records may still carry the legacy
// `[string, string]` tuple shape; `normalizeNotebookRecord` coerces them to
// `string[]` lazily at the read boundary (no on-disk cutover, folder name
// `shared_notebooks` unchanged).
export interface Notebook {
  /** Globally-unique id (crypto.randomUUID). Referenced by `Note.notebook_id`
   *  and `WeeklyGoal.notebook_id` across ALL members' folders. */
  id: string;
  /** The members, 1..N. members[0] is the creator (=== created_by === owner).
   *  length 1 = private/unshared; length >= 2 = shared. All are real usernames. */
  members: string[];
  /** Username that created the notebook (either a PI or a student; no role
   *  gate on creation). Equals `owner` and `members[0]`. */
  created_by: string;
  /** ISO timestamp of creation. */
  created_at: string;
  /** Optional human title. Absent = the UI falls back to "<other member>".
   *  Editable by the creator via `notebooksApi.updateTitle`. */
  title?: string;
  /** Optional hex color for the notebook cover dot (e.g. "#3b82f6"). */
  color?: string;
  /** Optional subject icon key (see SubjectIconKey in subject-icons.tsx). */
  subject_icon?: string;
  /** Sharing owner — drives `canRead`/`canWrite`'s owner branch and the
   *  per-user folder the record lives in. Equals `created_by`. Kept as its
   *  own field so the record satisfies the unified `ShareableRecord` shape
   *  (owner + shared_with), exactly like WeeklyGoal carries `owner`. */
  owner: string;
  /** Always `membersSharedWith(members)` - every member at "edit", deduped.
   *  For a single-member (private) notebook this is just the owner, which is
   *  harmless (owner already has access via canRead/canWrite's owner branch). */
  shared_with: SharedUser[];
}

/** @deprecated use Notebook (Phase 2 removes this alias + renames callers). */
export type SharedNotebook = Notebook;

// ── Lab-head <-> member 1:1 ──────────────────────────────────────────────────
//
// 1:1 revamp (oneonone data+strip bot, 2026-06-07). See
// docs/proposals/NOTEBOOKS_AND_ONE_ON_ONE_REVAMP.md. A OneOnOne is a distinct
// advising workspace between exactly ONE lab head and ONE member, separate from
// a Notebook (which is now a plain note container). The lab head sets it up;
// both people edit. It scopes weekly goals, weekly meeting notes, freeform
// shared notes, and action items via `one_on_one_id`.
//
// ID + STORE: `id` is a globally-unique crypto.randomUUID (a cross-user query
// key, exactly like `Notebook.id`), stored at
// `users/<labHead>/one_on_ones/<uuid>.json` via the thin string-keyed per-user
// store in lib/one-on-one/store.ts (a sibling of the notebook store). The lab
// head's folder is the canonical home; the member discovers it via the
// sharing-respecting aggregation on `labApi.getOneOnOnes`.
// Check-ins revamp Phase 1 (checkins-revamp bot, 2026-06-11). See
// docs/proposals/checkins-revamp.md. The OneOnOne is generalized from a fixed
// lab-head <-> member binary into an any-account "check-in space" with a
// `members[]` array and an optional mentorship direction. The change is
// ADDITIVE and BACKWARD COMPATIBLE: the legacy `labHead`/`member` fields are
// now OPTIONAL so old on-disk records still parse, and every read path runs a
// record through `normalizeOneOnOne` (lib/one-on-one/normalize.ts) so the rest
// of the code only ever sees a populated `members`/`mentor`/`kind`.
export interface OneOnOne {
  /** Globally-unique id (crypto.randomUUID). Referenced by `Note.one_on_one_id`,
   *  `WeeklyGoal.one_on_one_id`, and `OneOnOneActionItem.one_on_one_id`. */
  id: string;
  /** LEGACY (optional). The lab-head username for an old two-person mentoring
   *  record. Phase 1 still writes this ONLY for a 2-person space WITH a mentor
   *  (`labHead = mentor`) so any pre-revamp reader keeps working; peer + group
   *  spaces leave it undefined. New code reads `members`/`mentor` instead. */
  labHead?: string;
  /** LEGACY (optional). The non-lab-head member username for an old two-person
   *  record. See `labHead`. New code reads `members`. */
  member?: string;
  /** The participants, two or more. `members[0]` is the creator (=== owner ===
   *  created_by). Always populated after `normalizeOneOnOne`; may be absent on a
   *  pre-revamp on-disk record (derived from `labHead`/`member` on read). */
  members?: string[];
  /** A member who is the mentor for this space, or null for a peer space. A
   *  pair space with a mentor is a mentoring relationship; with no mentor it is
   *  a peer check-in. Derived from `labHead` on a legacy record. */
  mentor?: string | null;
  /** "pair" (2 members) or "group" (3+). Stored so the UI + templates branch
   *  without guessing; derived from member count. */
  kind?: "pair" | "group";
  /** Optional human title (e.g. "Aim 2 team"). Absent = the UI falls back to the
   *  other member's name. */
  title?: string | null;
  /** Optional recurring cadence, drives the "your check-in is coming up" prompt.
   *  Phase 1 stores it but does not yet act on it. */
  cadence?: {
    every: "week" | "2weeks" | "month" | "none";
    weekday?: number;
  } | null;
  /** Check-ins Phase 4 (committee support). The next scheduled meeting date
   *  (YYYY-MM-DD), surfaced in the space header for a committee / annual-cadence
   *  space with a "pre-circulate the progress report and Specific Aims"
   *  reminder. ADDITIVE + back-compat: a record written before Phase 4 reads with
   *  this absent, and `normalizeOneOnOne` defaults it to null on read so callers
   *  never see `undefined`. */
  next_meeting_date?: string | null;
  /** Username that created the record. Equals `members[0]` and `owner`. */
  created_by: string;
  /** ISO timestamp of creation. */
  created_at: string;
  /** Sharing owner — drives `canRead`/`canWrite`'s owner branch and the
   *  per-user folder the record lives in. Equals the creator (`members[0]`). */
  owner: string;
  /** Always `membersSharedWith(members)` — every member at "edit", deduped.
   *  Everyone reads AND writes the space and everything scoped to it. */
  shared_with: SharedUser[];
}

// A tracked agenda / action item inside a 1:1. Lightweight + dedicated store at
// `users/<labHead>/one_on_one_action_items/<uuid>.json`. Carries the same
// `shared_with` (both at "edit") so either person adds, toggles, or deletes.
export interface OneOnOneActionItem {
  /** Globally-unique id (crypto.randomUUID). */
  id: string;
  /** The owning 1:1's id. */
  one_on_one_id: string;
  /** Free-form action-item text. */
  text: string;
  /** Done toggle. */
  is_done: boolean;
  /** Username that created the item (either member). */
  created_by: string;
  /** ISO timestamp of creation. */
  created_at: string;
  /** Sharing owner — the lab head's folder the item lives in. Equals labHead.
   *  Drives the per-user routing + the `canRead`/`canWrite` owner branch. */
  owner: string;
  /** Always `membersSharedWith([labHead, member])` — both at "edit". */
  shared_with: SharedUser[];
  // Check-ins revamp Phase 2 (checkins-phase2 bot, 2026-06-12). See
  // docs/proposals/checkins-revamp.md "Phase 2 build spec". All three are
  // ADDITIVE + back-compat: a record written before Phase 2 reads with these
  // absent, and `normalizeOneOnOneActionItem` (lib/one-on-one/normalize.ts)
  // defaults each to null on read so callers never see `undefined`.
  /** D3 single assignee — a member username, or null = shared / everyone. When
   *  set together with `due_date`, the item materializes a real Task (D4). */
  assignee?: string | null;
  /** YYYY-MM-DD the item is due. Together with `assignee` it triggers the D4
   *  Task sync. Null = no due date (in-space-only item). */
  due_date?: string | null;
  /** The numeric id of the Task this item spawned via D4, in the space owner's
   *  task namespace. Null until synced; cleared when the item detaches (the
   *  assignee or due_date is removed) or is deleted. */
  synced_task_id?: number | null;
}

// ── Individual Development Plan (Check-ins Phase 3) ───────────────────────────
//
// checkins-phase3 bot, 2026-06-12. See docs/proposals/checkins-revamp.md "IDP
// structure" and the approved mockup docs/mockups/2026-06-12-checkins-phase3-idp
// .html. The IDP is the academic-layer centerpiece, a living document the
// TRAINEE owns and the mentor reviews (a review, not co-ownership). It models
// the five-section spine shared by AAAS myIDP and the UW-Madison Grad School IDP
// (self-assess, explore, set goals, act, review-and-revisit-annually).
//
// HOME FOLDER + STORE: an IDP is owned by the trainee, so the record lives in
// THEIR folder only (`owner === trainee`), keyed on a globally-unique
// crypto.randomUUID at `users/<owner>/idps/<uuid>.json` via the thin string-
// keyed per-user store in lib/idp/store.ts (a sibling of the one-on-one store).
// The mentor discovers it via the sharing-respecting aggregation, then every
// non-owner read passes through `normalizeIdpForViewer` (lib/idp/visibility.ts)
// which blanks any section the trainee has not shared AND always strips the
// private values reflection. This is the "trainee owns it, mentor reviews
// shared sections, PI sees only a status line" model real IDPs use.

/** A trainee's career stage. Drives the preset filter on the IDP form. */
export type CareerStage = "undergrad" | "grad" | "postdoc" | "staff";

/** A goal's horizon: short-term (6 months or less) vs long-term. */
export type IdpGoalTerm = "short" | "long";

/** An action-plan row's status. */
export type IdpActionStatus = "not_started" | "in_progress" | "done";

/** The four mentor-shareable IDP sections (the values reflection is never in
 *  this set — it is always trainee-private and never shared). */
export type IdpSectionKey =
  | "self_assessment"
  | "career_exploration"
  | "goals"
  | "action_plan";

/** A single competency skill's dual rating. `self` is the trainee's
 *  proficiency/confidence (1 to 5); `importance` is how much the skill matters
 *  for the career they want (1 to 5). The gap between them is the goal signal.
 *  Either is null until the trainee rates it. */
export interface IdpSkillRating {
  self: number | null;
  importance: number | null;
}

/** A career or yearly goal. `term` splits short vs long; `priority` is the
 *  optional UW high/low tag (null = untagged). */
export interface IdpGoal {
  id: string;
  text: string;
  term: IdpGoalTerm;
  priority: "high" | "low" | null;
}

/** A row in the UW four-column SMART action plan. A row that has a
 *  `target_date` can become a real Lists task (D4); `synced_task_id` is the
 *  back-link to that task in the trainee's namespace (null until synced). */
export interface IdpActionRow {
  id: string;
  objective: string;
  approach: string;
  /** YYYY-MM-DD, or null when the row is not yet dated. */
  target_date: string | null;
  /** The "done-when" outcome. */
  outcome: string;
  status: IdpActionStatus;
  /** Set when the trainee adds this dated row to their tasks (D4). The task
   *  lives in the TRAINEE's namespace (owner === trainee), so no cross-user
   *  write. Null until synced; cleared on detach/delete. */
  synced_task_id?: number | null;
}

/** The mentor's review of the IDP. A comment plus a sign-off date and an annual
 *  revisit date. NOT co-ownership: the mentor comments and acknowledges, the
 *  trainee edits the plan. */
export interface IdpMentorReview {
  comment: string;
  /** The mentor username that signed off, or null if not yet reviewed. */
  reviewed_by: string | null;
  /** ISO timestamp of the sign-off, or null. */
  reviewed_at: string | null;
  /** YYYY-MM-DD, defaults to +1 year on create (annual cadence). */
  revisit_date: string | null;
}

/**
 * An Individual Development Plan. Trainee-owned, mentor-reviewed. Stored in the
 * trainee's folder; `owner` drives the `canRead`/`canWrite` owner branch.
 *
 * DATA-SHAPE FLAGGED: this is a NEW on-disk entity (`users/<owner>/idps/`). All
 * additions are new; no existing field or layout changes.
 */
export interface IDP {
  /** Globally-unique id (crypto.randomUUID). */
  id: string;
  /** The trainee username. The record lives in THEIR folder; drives the
   *  `canRead` owner branch. Equals the creator. */
  owner: string;
  career_stage: CareerStage;
  /** Section 1. Skill ratings keyed by competency-skill id (see
   *  lib/idp/competencies.ts), plus the free-text responsibilities box. */
  self_assessment: {
    ratings: Record<string, IdpSkillRating>;
    responsibilities: string;
  };
  /** Section 2. Free-text aspirations + a target-path field (the matching
   *  itself is done off-app at myIDP / ImaginePhD / ChemIDP). */
  career_exploration: { aspirations: string; target_path: string };
  /** Section 3. Short and long-term goals with optional priority. */
  goals: IdpGoal[];
  /** Section 4. The UW four-column SMART action plan rows. */
  action_plan: IdpActionRow[];
  /** Section 5. The mentor's review (comment + sign-off + revisit date). */
  mentor_review: IdpMentorReview;
  /** The optional, ALWAYS trainee-private values reflection. Never returned to
   *  a non-owner reader (stripped to null in `normalizeIdpForViewer`). Null /
   *  absent = the trainee has not opted in. */
  values_reflection?: { note: string } | null;
  /** Which of the four shareable sections the mentor may see. A section set to
   *  false is blanked for any non-owner viewer. */
  shared_sections: Record<IdpSectionKey, boolean>;
  /** The mentor username this IDP is shared with for review, or null. */
  mentor?: string | null;
  /** `[{username: mentor, level: "view"}]` when any section is shared, else
   *  `[]`. Drives `canRead` for the mentor's review surface. */
  shared_with: SharedUser[];
  created_at: string;
  updated_at: string;
  /** Username that last wrote the record (trainee on edit, mentor on sign-off). */
  last_edited_by?: string;
}

// ── Mentoring compact + onboarding checklist (Check-ins Phase 3b) ──────────────
//
// checkins-phase3b bot, 2026-06-12. See docs/proposals/checkins-revamp.md
// "Part 3, the academic layer" (the "Mentoring compact / expectations
// agreement" and "New-member onboarding checklist" paragraphs) and the approved
// mockup docs/mockups/2026-06-12-checkins-phase3-idp.html.
//
// Both records hang off a check-in space (`OneOnOne`). They live in the SPACE
// OWNER's folder (`owner === space.owner`) and carry `shared_with =
// membersSharedWith(members)` so every member reads AND writes them, exactly
// like the space's weekly goals and action items. There is at most ONE compact
// and ONE onboarding checklist per space (looked up by `space_id`).
//
// DATA-SHAPE FLAGGED: two NEW on-disk entities
// (`users/<owner>/checkin_compacts/` and `users/<owner>/checkin_onboarding/`).
// All additions are new; no existing field or layout changes.

/** One row of the expectations compact. `label` is the topic (working hours,
 *  authorship, communication, vacation), `value` is the agreed text (empty until
 *  filled). */
export interface CheckinCompactRow {
  id: string;
  label: string;
  value: string;
}

/** A member's acknowledgement of the compact. Appended (idempotently) when they
 *  click Acknowledge. */
export interface CheckinCompactAck {
  username: string;
  /** ISO timestamp of the acknowledgement. */
  at: string;
}

/**
 * A one-time, structured expectations agreement for a check-in relationship.
 * Both members edit the values and each acknowledges; "Acknowledged by both"
 * shows once every member has. Either member may revisit (edit) it later.
 */
export interface CheckinCompact {
  /** Globally-unique id (crypto.randomUUID). */
  id: string;
  /** The owning check-in space's id (`OneOnOne.id`). */
  space_id: string;
  /** Sharing owner — the space owner's folder the record lives in. Equals
   *  `OneOnOne.owner`. Drives the per-user routing + `canRead`/`canWrite` owner
   *  branch. */
  owner: string;
  /** The expectations rows (topic + agreed text). */
  rows: CheckinCompactRow[];
  /** One entry per member who has acknowledged the current agreement. */
  acknowledged: CheckinCompactAck[];
  /** Always `membersSharedWith(members)` — every member at "edit", so each can
   *  edit the values and acknowledge. */
  shared_with: SharedUser[];
  created_at: string;
  updated_at: string;
}

/** One item of the onboarding checklist. */
export interface CheckinOnboardingItem {
  id: string;
  label: string;
  done: boolean;
  /** Username that checked it off, or null. */
  done_by?: string | null;
  /** ISO timestamp it was checked off, or null. */
  done_at?: string | null;
}

/**
 * A first-check-in onboarding checklist for a check-in space (access and keys,
 * safety training, data-management practices, the lab norms doc, set the
 * cadence). Any member may check items off (the permissive D2 model). Most
 * relevant to a new-member space but exposed on every space.
 */
export interface CheckinOnboarding {
  /** Globally-unique id (crypto.randomUUID). */
  id: string;
  /** The owning check-in space's id (`OneOnOne.id`). */
  space_id: string;
  /** Sharing owner — the space owner's folder the record lives in. Equals
   *  `OneOnOne.owner`. */
  owner: string;
  /** The checklist items. */
  items: CheckinOnboardingItem[];
  /** Always `membersSharedWith(members)` — every member at "edit", so any member
   *  may check an item off. */
  shared_with: SharedUser[];
  created_at: string;
  updated_at: string;
}

// ── Check-ins Phase 4: presenter / journal-club rotation ─────────────────────
//
// checkins-phase4 bot, 2026-06-12. See docs/proposals/checkins-revamp.md
// "Part 3, the academic layer" (the "Rotating presenter / journal-club
// schedule" paragraph). A GROUP space can carry an auto-rotating schedule of
// who presents data and who leads journal club, visible to all members, with
// the upcoming presenter prompted to prep. Labs track this on a whiteboard or
// in a spreadsheet today.
//
// Stored as its own per-user sidecar in the SPACE OWNER's folder
// (`users/<owner>/checkin_rotations/<uuid>.json`), mirroring the compact /
// onboarding stores. At most one rotation per space (looked up by `space_id`).

/** One rotating track inside a space's rotation (e.g. "Data presentation" or
 *  "Journal club"). `order` is the member usernames in rotation order;
 *  `current_index` is whose turn it is now. */
export interface CheckinRotationTrack {
  /** Stable id (crypto.randomUUID) so a track survives reorder + rename. */
  id: string;
  /** Display name, e.g. "Data presentation" / "Journal club". */
  name: string;
  /** The member usernames in rotation order. */
  order: string[];
  /** Index into `order` of whose turn it is now. Advancing wraps modulo
   *  `order.length`. Clamped to a valid index on read of a degenerate record. */
  current_index: number;
}

/**
 * A group space's presenter / journal-club rotation. One per space, seeded with
 * two tracks ("Data presentation" and "Journal club"). Every member is in
 * `shared_with` at "edit" so any member can advance or reorder a track.
 */
export interface CheckinRotation {
  /** Globally-unique id (crypto.randomUUID). */
  id: string;
  /** The owning check-in space's id (`OneOnOne.id`), always a GROUP space. */
  space_id: string;
  /** Sharing owner — the space owner's folder the record lives in. Equals
   *  `OneOnOne.owner`. Drives the per-user routing + `canRead`/`canWrite` owner
   *  branch. */
  owner: string;
  /** The rotation tracks. */
  tracks: CheckinRotationTrack[];
  /** Always `membersSharedWith(members)` — every member at "edit". */
  shared_with: SharedUser[];
  created_at: string;
  updated_at: string;
}

// ── Lab Mode Notes ─────────────────────────────────────────────────────────────

export interface LabNoteEntry {
  id: string;
  title: string;
  date: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface LabNote {
  id: number;
  title: string;
  description: string;
  is_running_log: boolean;
  is_shared: boolean;
  entries: LabNoteEntry[];
  comments?: NoteComment[];
  created_at: string;
  updated_at: string;
  username: string;
  user_color: string;
  // VCP R3 attribution stamps (2026-05-26): mirror the optional
  // last-edited fields on `Note` so NoteCard can read them off the
  // `Note | LabNote` union without a type error. Optional + the
  // AttributionChip self-hides when absent, so lab notes that don't
  // carry attribution simply render no chip.
  last_edited_by?: string;
  last_edited_at?: string;
}

// ── Sequences (SnapGene-style sequence/plasmid surface, Phase 1) ────────────
// On-disk format is LOCKED (proposal docs/proposals/SEQUENCE_EDITOR_PROPOSAL.md,
// Grant 2026-06-02): the SOURCE OF TRUTH is a real GenBank file at
//   users/{username}/sequences/{id}.gb
// plus a small ResearchOS metadata SIDECAR at
//   users/{username}/sequences/{id}.meta.json
// The sidecar holds only the app-level metadata that GenBank does not carry.
// NOT a JSON-record-of-truth, NOT a dual-file mirror.
//
// DATA-SHAPE FLAGGED: this is a NEW on-disk shape. Review before merge.

/** A DNA / RNA / protein sequence's molecule kind. */
export type SeqType = "dna" | "rna" | "protein";

/**
 * The on-disk `{id}.meta.json` sidecar shape. This is the LOCKED metadata
 * envelope written next to each `{id}.gb` file. It deliberately mirrors the
 * `users/{username}/sequences/` per-item store convention of other entities.
 */
export interface SequenceMeta {
  /** Stable per-user numeric id; matches the `{id}.gb` / `{id}.meta.json` name. */
  id: number;
  /** User-facing name (the GenBank LOCUS name is the parser fallback). */
  display_name: string;
  /**
   * Collection links: ids of projects this sequence belongs to (PROJECTS ARE
   * COLLECTIONS). A sequence with no project links is "Unfiled". These ids
   * reference the CURRENT user's own project ids. Cross-user project links are
   * out of scope for v1 — see the per-user namespacing note in the Phase 1
   * report; project ids are per-owner and would need owner-qualifying.
   */
  project_ids: string[];
  /** ISO timestamp when the sequence was added to the library. */
  added_at: string;
  /** Molecule kind, derived from the GenBank LOCUS on create. */
  seq_type: SeqType;
  /**
   * Canonical figure-map style for this sequence (the publication look used in
   * the figure composer). Additive + optional, mirrors PhyloMeta.figure. Absent =
   * the renderer's defaults; a figure panel can still override per-panel on top.
   */
  figure?: SequenceMapStyle;

  // Cross-boundary provenance. Additive + optional, set ONLY on a sequence that
  // arrived through a cross-boundary share (sequence-transfer.ts importSequence).
  // A native sequence has none of these and the ReceivedFromBadge self-hides.
  // Same pattern as Note.received_from / Method.received_from.
  received_from?: string;             // sender canonical email, set only on imported sequences
  received_from_fingerprint?: string; // sender key fingerprint
  received_at?: string;               // ISO 8601 import timestamp

  // NCBI Datasets provenance. Additive + optional, stamped ONLY on a sequence
  // that arrived through the "Download from NCBI" import (ncbi-import.ts). A
  // native / file-imported sequence has none of these and the NCBI badge
  // self-hides. Same additive, sidecar-only, no-migration pattern as
  // received_from above (a record simply lacks them).
  // "ncbi-datasets" is a Datasets package import; "ncbi-efetch" is an annotated
  // efetch GenBank import (a gene by symbol, or any accession). See ncbi-efetch.ts.
  source?: "ncbi-datasets" | "ncbi-efetch";  // set only on an NCBI-downloaded sequence
  ncbi_accession?: string;   // GCF_..., a gene id, etc.
  organism?: string;         // source organism name from the dataset report
  tax_id?: string;           // NCBI taxonomy id
  // NCBI taxonomy enrichment (Phase 2). The named lineage (root -> organism
  // order), auto-filled on NCBI import and written by the opt-in "Enrich from
  // NCBI" action. Additive + optional sidecar, no migration, self-hides when
  // absent (a sequence that was never enriched lacks it).
  tax_lineage?: SequenceTaxonNode[];

  // restore audit bot (2026-06-04): deleted/restored provenance. Additive +
  // optional, stamped ONLY when this sequence was restored from Trash (see
  // trash-reader.ts restoreSequenceFromTrash). A sequence that was never trashed
  // has none of this and the RestoredBadge self-hides. The field key is the
  // shared RESTORE_AUDIT_FIELD ("_restore_audit") from lib/trash.
  _restore_audit?: SequenceRestoreAudit;
}

/** restore audit bot: the deleted/restored audit blob persisted on a sequence's
 *  `.meta.json` sidecar after a Trash restore. Mirrors lib/trash's RestoreAudit
 *  (duplicated here so lib/types stays free of a lib/trash import cycle). */
export interface SequenceRestoreAudit {
  deleted_at: string;
  deleted_by: string;
  restored_at: string;
  restored_by: string;
}

/**
 * The app-facing sequence record: the parsed view of a sequence, combining the
 * `.meta.json` sidecar with a light summary parsed from the `.gb` file. The raw
 * GenBank text and full feature list are loaded on demand by `sequencesApi.get`
 * (the read view needs the bases + annotations; the library only needs the
 * summary fields below).
 */
export interface SequenceRecord {
  id: number;
  display_name: string;
  project_ids: string[];
  added_at: string;
  seq_type: SeqType;
  /** Length in bases (or residues for protein). */
  length: number;
  /** Whether the molecule is circular (plasmid) vs linear. */
  circular: boolean;
  /** Number of annotated features in the GenBank record. */
  feature_count: number;

  // Cross-boundary provenance, carried through from the sidecar so the library
  // row + viewer can render the ReceivedFromBadge. Optional, absent on a native
  // sequence (the badge self-hides).
  received_from?: string;
  received_from_fingerprint?: string;
  received_at?: string;

  // NCBI Datasets provenance, carried through from the sidecar so the library
  // row + viewer can render the "From NCBI" badge. Absent on a native / file-
  // imported sequence (the badge self-hides).
  source?: "ncbi-datasets" | "ncbi-efetch";
  ncbi_accession?: string;
  organism?: string;
  tax_id?: string;
  // NCBI taxonomy enrichment (Phase 2). The named lineage, carried through from
  // the sidecar so the viewer can render the calm lineage line. Absent on a
  // non-enriched sequence (the line self-hides).
  tax_lineage?: SequenceTaxonNode[];

  // restore audit bot: carried through from the sidecar so the library row +
  // viewer header can render the RestoredBadge. Absent on a never-trashed
  // sequence (the badge self-hides).
  _restore_audit?: SequenceRestoreAudit;
}

/** A fully-loaded sequence, including the bases + parsed annotations needed by
 *  the read view, plus the raw GenBank text the file holds. */
export interface SequenceDetail extends SequenceRecord {
  /** The raw on-disk GenBank text (source of truth). */
  genbank: string;
  /** The sequence bases (uppercased), parsed from the GenBank ORIGIN. */
  seq: string;
  /** Parsed annotations, shaped for the SeqViz read view. */
  annotations: SequenceAnnotation[];
  /** GenBank LOCUS name (may differ from the user-facing display_name). */
  locus_name: string;
}

/** A parsed annotation, shaped for the SeqViz `annotations` prop. */
export interface SequenceAnnotation {
  name: string;
  start: number;
  end: number;
  direction: -1 | 0 | 1;
  type?: string;
  color?: string;
  // seq introns bot — OPTIONAL exon spans for a multi-segment (join) feature.
  // Same coordinate space as start/end. Present only when the feature has more
  // than one location (a spliced CDS); the SeqViz layer renders these as
  // separate exon boxes joined by a dashed intron connector.
  segments?: { start: number; end: number }[];
}

/** Input to `sequencesApi.create`. The caller provides the GenBank text (e.g.
 *  from a parsed import) and the metadata envelope minus the server-assigned
 *  fields. */
export interface SequenceCreate {
  display_name: string;
  genbank: string;
  project_ids?: string[];
  seq_type?: SeqType;
  // NCBI Datasets provenance, set only by the "Download from NCBI" import so the
  // created sequence's sidecar carries the source / accession / organism. Absent
  // for a native or file-imported create (the fields stay undefined).
  source?: "ncbi-datasets" | "ncbi-efetch";
  ncbi_accession?: string;
  organism?: string;
  tax_id?: string;
  // NCBI taxonomy enrichment (Phase 2). The named lineage, set on an NCBI import
  // (auto-fill) so the created sidecar carries it. Undefined for a native or
  // file create.
  tax_lineage?: SequenceTaxonNode[];
}

/** One node of a sequence's NCBI taxonomy lineage, persisted on the sidecar. The
 *  shape mirrors the resolver's TaxonomyNode (kept here so lib/types stays free
 *  of a lib/sequences import). Root -> organism order in the stored array. */
export interface SequenceTaxonNode {
  taxId: string;
  name: string;
  rank: string;
}

/** Patch shape for `sequencesApi.update`. Any subset; `genbank` replaces the
 *  on-disk `.gb` file, the rest patch the sidecar. */
export interface SequenceUpdate {
  display_name?: string;
  project_ids?: string[];
  seq_type?: SeqType;
  genbank?: string;
  // NCBI taxonomy enrichment (Phase 2). The opt-in "Enrich from NCBI" apply
  // writes organism / tax id / named lineage onto the sidecar. Additive +
  // optional, only set by the enrich flow.
  organism?: string;
  tax_id?: string;
  tax_lineage?: SequenceTaxonNode[];
  /** Canonical figure-map style; persisted to the meta sidecar. */
  figure?: SequenceMapStyle;
}

// ── Custom Calculator Builder (Phase 1, 2026-06-10) ──────────────────────────
//
// A user-authored calculator: a small typed spec (inputs, intermediate steps,
// guidance conditionals, outputs) that the pure evaluator in
// `lib/calculators/custom.ts` runs. The same shape backs both a saved record in
// the user's folder (`users/<owner>/calculators/<id>.json`, via
// `calculatorsApi`) and a static library template under
// `frontend/public/calculator-templates/` (the static template carries a
// string `slug` instead of the numeric record `id`; see the catalog loader).
//
// This is an ADDITIVE new entity. No existing on-disk record shape changes.

/** A single option of a `dropdown` input. The `value` is what the expression
 *  engine sees when this option is selected, so it may be numeric (e.g. an
 *  organism conversion factor) OR a string enum (e.g. "rpm" for a mode switch
 *  branched on with `mode == "rpm"`). The `label` is the human-facing choice. */
export interface CustomCalculatorDropdownOption {
  label: string;
  value: number | string;
}

/** One column of a `table` input (Phase 5, 2026-06-10).
 *  - `input`     the user types a value into this cell per row.
 *  - `computed`  the cell is derived per ROW from `expr`, evaluated against
 *                that row's input-column values plus the calculator's scalar
 *                inputs / steps. `expr` is required when kind is `computed`.
 *  The `key` is the variable name the per-row formula and the `col(table, key)`
 *  helper reference; it follows the same reserved-name / identifier rules as a
 *  scalar input key. A `name`-style descriptive column is just an `input`
 *  column whose value happens to be text (it is not referenced numerically). */
export interface CustomCalculatorTableColumn {
  key: string;
  label: string;
  kind: "input" | "computed";
  /** Optional unit shown in the column header (e.g. "uL"). */
  unit?: string;
  /** Per-row expression, required when `kind` is `computed`. */
  expr?: string;
}

/** One input the user fills in when running the calculator.
 *  - `number`    a single numeric field.
 *  - `replicate` a variable-length list of numbers (the multi-box row); the
 *                evaluator binds it as an array so list helpers (mean, sd,
 *                shannon, ...) can operate on it.
 *  - `dropdown`  a fixed choice; the selected option's `value` (number or
 *                string) is bound under `key`.
 *  - `table`     a mini-spreadsheet (Phase 5); the user adds / removes rows and
 *                fills the `input` columns, `computed` columns derive per row,
 *                and the whole table is bound under `key` as an array of row
 *                objects so steps / outputs can aggregate it via
 *                `col(table, "colKey")` wrapped in a list helper. */
export interface CustomCalculatorInput {
  /** Variable name referenced in step / conditional / output expressions. */
  key: string;
  type: "number" | "replicate" | "dropdown" | "table";
  /** Human-facing field label. */
  label: string;
  /** Optional unit shown next to the field (e.g. "mL", "mg/kg"). */
  unit?: string;
  /** Default value for `number` (a number) or `replicate` (a list); for a
   *  dropdown the default is the first option unless overridden here with the
   *  chosen option's value. */
  default?: number | number[] | string;
  /** Options for a `dropdown` input. */
  options?: CustomCalculatorDropdownOption[];
  /** Columns for a `table` input (Phase 5). */
  columns?: CustomCalculatorTableColumn[];
  /** Optional seed rows for a `table` input, each keyed by column `key`. A cell
   *  value is a number or a descriptive string; `computed` columns are derived
   *  at evaluation time and need not be stored here. */
  rows?: Record<string, number | string>[];
}

/** An intermediate named computation. Each `key` becomes available to later
 *  steps, conditionals, and outputs, evaluated in array order. */
export interface CustomCalculatorStep {
  key: string;
  /** Expression over inputs + earlier steps (expr-eval-fork syntax). */
  expr: string;
}

/** A guidance rule. The `expr` is typically an `if(cond, "message", "")`; a
 *  non-empty string result is surfaced to the user as a guidance message
 *  (e.g. "Viability below 80%, check handling"). */
export interface CustomCalculatorConditional {
  expr: string;
}

/** A reported result row. */
export interface CustomCalculatorOutput {
  label: string;
  /** Expression over inputs + steps. */
  expr: string;
  /** Optional unit shown next to the value. */
  unit?: string;
  /** How the numeric value is rendered. Omitted = "auto" (clean default that
   *  prints integers in full and trims float noise). "scientific" renders
   *  `2.5e8` via toExponential; "fixed" renders a fixed number of decimals via
   *  toFixed. A spore-concentration calc wants "scientific" so a large count
   *  reads as 2.5e8 rather than 250000000. */
  format?: "auto" | "scientific" | "fixed";
  /** Decimal places for "scientific" / "fixed". Defaults to 2 when omitted. */
  decimals?: number;
}

/** A saved, user-authored calculator record. Stored per-user at
 *  `users/<owner>/calculators/<id>.json`. */
export interface CustomCalculator {
  /** Numeric per-user record id (JsonStore counter). */
  id: number;
  name: string;
  description: string;
  /** Optional grouping label (e.g. "Microbiology"), mirrors the template field
   *  used to group the library gallery. */
  field?: string;
  inputs: CustomCalculatorInput[];
  steps: CustomCalculatorStep[];
  conditionals: CustomCalculatorConditional[];
  outputs: CustomCalculatorOutput[];
  /** Sharing selection, unified shape (Phase 2, 2026-06-10). Empty = "Just
   *  me"; the whole-lab share is the `{ username: "*", level: "read" }` entry,
   *  exactly like methods / tasks. Phase 1 wrote a `string[]` here; the read
   *  path lazy-normalizes those records via `normalizeSharedWith`, so a Phase 1
   *  record keeps working without a rewrite (the next save lands the new
   *  shape). */
  shared_with: SharedUser[];
  created_at: string;
  updated_at: string;
  /** Whose folder this record lives in. Not persisted to disk (the per-user
   *  directory IS the owner); overlaid at read time by
   *  `fetchAllCalculatorsIncludingShared` so the UI can badge a shared-in
   *  (non-owned) calculator and gate it read-only. */
  owner?: string;
  /** True when this calculator is owned by another lab member and surfaced to
   *  the current user via the whole-lab "*" share. Read-only for them (owner
   *  edits propagate, it is a live reference, not a copy). Never persisted. */
  is_shared_with_me?: boolean;
}

/** Create shape for `calculatorsApi.create` (id + timestamps are stamped by the
 *  API). `shared_with` defaults to [] (Just me) when omitted. */
export interface CustomCalculatorCreate {
  name: string;
  description?: string;
  field?: string;
  inputs: CustomCalculatorInput[];
  steps: CustomCalculatorStep[];
  conditionals: CustomCalculatorConditional[];
  outputs: CustomCalculatorOutput[];
  shared_with?: SharedUser[];
}

/** Patch shape for `calculatorsApi.update`. Any subset; `updated_at` is
 *  re-stamped on every write. */
export interface CustomCalculatorUpdate {
  name?: string;
  description?: string;
  field?: string;
  inputs?: CustomCalculatorInput[];
  steps?: CustomCalculatorStep[];
  conditionals?: CustomCalculatorConditional[];
  outputs?: CustomCalculatorOutput[];
  shared_with?: SharedUser[];
}

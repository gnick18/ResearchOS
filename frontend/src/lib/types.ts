// ── Shared Access Types ─────────────────────────────────────────────────────

export interface SharedUser {
  username: string;
  permission: "view" | "edit";
}

export interface ShareRequest {
  username: string;
  permission: "view" | "edit";
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

export type Notification =
  | SharedItemNotification
  | EventReminderNotification
  | ShiftAlertNotification
  | LabCommentNotification
  | LabAnnouncementNotification
  | LabTaskAssignmentNotification
  | LabPurchaseApprovalNotification
  | LabFlagForReviewNotification;

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
}

// ── Sub-Tasks ─────────────────────────────────────────────────────────────────

export interface SubTask {
  id: string;
  text: string;
  is_complete: boolean;
}

// ── Task Method Attachments ───────────────────────────────────────────────────

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
}

// ── UI Types ─────────────────────────────────────────────────────────────────

// ── Methods ──────────────────────────────────────────────────────────────────

export interface Method {
  id: number;
  name: string;
  source_path: string | null;
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
}

export interface MethodCreate {
  name: string;
  source_path?: string | null;
  method_type?: "markdown" | "pdf" | "pcr" | "lc_gradient" | "plate" | "cell_culture" | "mass_spec" | "compound" | "coding_workflow" | "qpcr_analysis";
  folder_path?: string | null;
  parent_method_id?: number | null;
  tags?: string[];
  is_public?: boolean;
  components?: CompoundComponent[];
}

export interface MethodUpdate {
  name?: string;
  source_path?: string | null;
  method_type?: "markdown" | "pdf" | "pcr" | "lc_gradient" | "plate" | "cell_culture" | "mass_spec" | "compound" | "coding_workflow" | "qpcr_analysis" | null;
  folder_path?: string | null;
  parent_method_id?: number | null;
  tags?: string[];
  is_public?: boolean;
  components?: CompoundComponent[];
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

/** Plate sizes supported in v1. 384 deferred to v2. */
export type PlateSize = 12 | 24 | 48 | 96;

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
  funding_string: string | null;  // New field for funding account
  vendor: string | null;
  category: string | null;
  // Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23): PI approval
  // (informational only, NOT a blocking gate per the brief). All three
  // additive — old records without them behave as if unapproved.
  approved?: boolean;
  approved_by?: string | null;
  approved_at?: string | null;
  // Lab Head Phase 3 — PI flag-for-review; same shape as on Task / Note.
  flagged?: PiFlag | null;
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
  funding_string?: string | null;  // New field for funding account
  vendor?: string | null;
  category?: string | null;
}

export interface PurchaseItemUpdate {
  item_name?: string;
  quantity?: number;
  link?: string | null;
  cas?: string | null;
  price_per_unit?: number;
  shipping_fees?: number;
  notes?: string | null;
  funding_string?: string | null;  // New field for funding account
  vendor?: string | null;
  category?: string | null;
  /** Lab Head Phase 3 — PI approval. The writer that flips this also
   *  stamps `approved_by` + `approved_at`. */
  approved?: boolean;
  approved_by?: string | null;
  approved_at?: string | null;
  /** Lab Head Phase 3 — PI flag (object sets, `null` clears). */
  flagged?: PiFlag | null;
}

export interface CatalogItem {
  id: number;
  item_name: string;
  link: string | null;
  cas: string | null;
  price_per_unit: number;
}

// ── Funding Accounts ──────────────────────────────────────────────────────────

export interface FundingAccount {
  id: number;
  name: string;
  description: string | null;
  total_budget: number;
  spent: number;
  remaining: number;
}

export interface FundingAccountCreate {
  name: string;
  description?: string | null;
  total_budget?: number;
}

export interface FundingAccountUpdate {
  name?: string;
  description?: string | null;
  total_budget?: number;
}

export interface FundingSummary {
  accounts: FundingAccount[];
  total_budget: number;
  total_spent: number;
  total_remaining: number;
  uncategorized_spent: number;
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
}

export interface LabLinkCreate {
  title: string;
  url: string;
  description?: string | null;
  category?: string | null;
  color?: string | null;
  preview_image_url?: string | null;
}

export interface LabLinkUpdate {
  title?: string;
  url?: string;
  description?: string | null;
  category?: string | null;
  color?: string | null;
  preview_image_url?: string | null;
  sort_order?: number;
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
  created_at: string;
  updated_at: string;
  username: string;
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
}

export interface NoteEntriesReorderRequest {
  entry_ids: string[];
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
}

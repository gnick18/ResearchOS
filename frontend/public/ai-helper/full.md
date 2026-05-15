## §1 Identity & role

> _Section pending — chip 2 will fill this in._

## §2 Architecture

> _Section pending — chip 2 will fill this in._

## §3 Mental model

> _Section pending — chip 2 will fill this in._

## §4 Entity schemas

Verbatim copy of `frontend/src/lib/types.ts`. Comments in the source file are the authoritative documentation for each field.

```typescript
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

export type Notification =
  | SharedItemNotification
  | EventReminderNotification
  | ShiftAlertNotification;

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
}

export interface ProjectUpdate {
  name?: string;
  weekend_active?: boolean;
  tags?: string[];
  color?: string;
  sort_order?: number;
  is_archived?: boolean;
  archived_at?: string | null;
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
  // PCR method copy fields - stored as JSON strings (only for PCR methods)
  pcr_gradient: string | null;  // JSON string of PCRGradient
  pcr_ingredients: string | null;  // JSON string of PCRIngredient[]
  // Variation notes - markdown content documenting method variations for this experiment
  variation_notes: string | null;  // Markdown string with timestamped entries
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
  method_type: "markdown" | "pdf" | "pcr" | null;
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
}

export interface MethodCreate {
  name: string;
  source_path?: string | null;
  method_type?: "markdown" | "pdf" | "pcr";
  folder_path?: string | null;
  parent_method_id?: number | null;
  tags?: string[];
  is_public?: boolean;
}

export interface MethodUpdate {
  name?: string;
  source_path?: string | null;
  method_type?: "markdown" | "pdf" | "pcr" | null;
  folder_path?: string | null;
  parent_method_id?: number | null;
  tags?: string[];
  is_public?: boolean;
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
}

export interface Note {
  id: number;
  title: string;
  description: string;
  is_running_log: boolean;
  is_shared: boolean;
  entries: NoteEntry[];
  comments?: NoteComment[];  // Lab-mode comment thread (#13); optional for backward compat
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
```

## §5 Canonical examples

One example per entity type, lifted verbatim from the demo fixture (`frontend/public/demo-data/`). Field shapes here are authoritative — they match what ResearchOS actually writes to disk today.

### Project

Source: `frontend/public/demo-data/users/alex/projects/1.json`

```json
{
  "id": 1,
  "name": "DEMO: Engineer FakeYeast for biofuel",
  "weekend_active": false,
  "tags": [
    "demo",
    "strains"
  ],
  "color": "#3b82f6",
  "created_at": "2026-02-01T00:00:00Z",
  "sort_order": 0,
  "is_archived": false,
  "archived_at": null,
  "owner": "alex",
  "shared_with": []
}
```

### Task — experiment

Source: `frontend/public/demo-data/users/alex/tasks/2.json`

```json
{
  "id": 2,
  "project_id": 1,
  "name": "Yeast transformation: pYES-GAL1::flbA",
  "start_date": "2026-05-08",
  "duration_days": 1,
  "end_date": "2026-05-08",
  "is_high_level": false,
  "is_complete": true,
  "task_type": "experiment",
  "weekend_override": null,
  "method_id": null,
  "method_ids": [
    1
  ],
  "deviation_log": "Demo: heat-shock ran 38 min instead of 40 (interrupted by timer reset). Noted for the colony count.",
  "tags": null,
  "sort_order": 2,
  "experiment_color": "#3b82f6",
  "sub_tasks": [
    {
      "id": "st1",
      "text": "Grow overnight FakeYeast-001 culture",
      "is_complete": true
    },
    {
      "id": "st2",
      "text": "Prep PEG/LiAc mix fresh",
      "is_complete": true
    },
    {
      "id": "st3",
      "text": "Heat shock 40 min @ 42°C",
      "is_complete": true
    },
    {
      "id": "st4",
      "text": "Plate on SD-Ura",
      "is_complete": true
    }
  ],
  "pcr_gradient": null,
  "pcr_ingredients": null,
  "method_attachments": [
    {
      "method_id": 1,
      "owner": "alex",
      "snapshot_at": "2026-05-08T09:00:00Z"
    }
  ],
  "owner": "alex",
  "shared_with": [],
  "external_project": null
}
```

### Task — purchase

Source: `frontend/public/demo-data/users/alex/tasks/7.json`

```json
{
  "id": 7,
  "project_id": 2,
  "name": "Order DemoStrain ΔADE2 reagents",
  "start_date": "2026-05-06",
  "duration_days": 1,
  "end_date": "2026-05-06",
  "is_high_level": false,
  "is_complete": true,
  "task_type": "purchase",
  "weekend_override": null,
  "method_id": null,
  "method_ids": [],
  "deviation_log": null,
  "tags": null,
  "sort_order": 7,
  "experiment_color": null,
  "sub_tasks": null,
  "pcr_gradient": null,
  "pcr_ingredients": null,
  "method_attachments": [],
  "owner": "alex",
  "shared_with": [],
  "external_project": null
}
```

### Task — list

Source: `frontend/public/demo-data/users/alex/tasks/1.json`

```json
{
  "id": 1,
  "project_id": 1,
  "name": "Design pYES-GAL1::flbA construct",
  "start_date": "2026-05-06",
  "duration_days": 1,
  "end_date": "2026-05-06",
  "is_high_level": false,
  "is_complete": true,
  "task_type": "list",
  "weekend_override": null,
  "method_id": null,
  "method_ids": [],
  "deviation_log": null,
  "tags": null,
  "sort_order": 1,
  "experiment_color": null,
  "sub_tasks": [
    {
      "id": "st1",
      "text": "Pull flbA CDS from FakeYeast genome",
      "is_complete": true
    },
    {
      "id": "st2",
      "text": "Design Gibson overlaps for pYES2",
      "is_complete": true
    },
    {
      "id": "st3",
      "text": "Order gBlocks",
      "is_complete": true
    }
  ],
  "pcr_gradient": null,
  "pcr_ingredients": null,
  "method_attachments": [],
  "owner": "alex",
  "shared_with": [],
  "external_project": null
}
```

### Method (one per method_type)

Source: `frontend/public/demo-data/users/alex/methods/1.json` — method_type="markdown"

```json
{
  "id": 1,
  "name": "[Demo protocol] Yeast transformation (LiAc)",
  "source_path": "users/alex/methods/1.md",
  "method_type": "markdown",
  "folder_path": "Strains",
  "parent_method_id": null,
  "tags": [
    "demo"
  ],
  "is_public": false,
  "created_by": "alex",
  "owner": "alex",
  "shared_with": []
}
```

Source: `frontend/public/demo-data/users/alex/methods/5.json` — method_type="pcr"

```json
{
  "id": 5,
  "name": "[Demo protocol] qPCR fakeGFP expression",
  "source_path": "pcr://protocol/1",
  "method_type": "pcr",
  "folder_path": "qPCR",
  "parent_method_id": null,
  "tags": [
    "demo",
    "qPCR"
  ],
  "attachments": [],
  "is_public": false,
  "created_by": "alex",
  "owner": "alex",
  "shared_with": []
}
```

### PCRProtocol

Source: `frontend/public/demo-data/users/alex/pcr_protocols/1.json`

```json
{
  "id": 1,
  "name": "[Demo protocol] qPCR fakeGFP expression",
  "gradient": {
    "initial": [
      {
        "name": "Initial denaturation",
        "temperature": 95,
        "duration": "3 min"
      }
    ],
    "cycles": [
      {
        "repeats": 35,
        "steps": [
          {
            "name": "Denaturation",
            "temperature": 95,
            "duration": "15 sec"
          },
          {
            "name": "Anneal/Extend",
            "temperature": 60,
            "duration": "60 sec"
          }
        ]
      }
    ],
    "final": [],
    "hold": null
  },
  "ingredients": [
    {
      "id": "i1",
      "name": "SYBR Master Mix (2x)",
      "concentration": "2x",
      "amount_per_reaction": "10"
    },
    {
      "id": "i2",
      "name": "fakeGFP-fwd",
      "concentration": "10 µM",
      "amount_per_reaction": "0.5"
    },
    {
      "id": "i3",
      "name": "fakeGFP-rev",
      "concentration": "10 µM",
      "amount_per_reaction": "0.5"
    },
    {
      "id": "i4",
      "name": "cDNA template (1:5)",
      "concentration": "—",
      "amount_per_reaction": "2"
    },
    {
      "id": "i5",
      "name": "Nuclease-free H2O",
      "concentration": "—",
      "amount_per_reaction": "7"
    },
    {
      "id": "i6",
      "name": "Total",
      "concentration": "",
      "amount_per_reaction": "20"
    }
  ],
  "notes": "Demo qPCR — use ACT1 as housekeeping reference. Public version available at users/public.",
  "tags": [
    "demo",
    "qPCR",
    "fakeGFP"
  ],
  "is_public": false,
  "created_by": "alex",
  "owner": "alex",
  "shared_with": []
}
```

### LCGradientProtocol

_No fixture coverage for this entity type yet — add one to `frontend/public/demo-data/users/{alex,morgan}/lc_gradient_protocols/` to surface a real example here._

### PlateProtocol

_No fixture coverage for this entity type yet — add one to `frontend/public/demo-data/users/{alex,morgan}/plate_protocols/` to surface a real example here._

### CellCultureSchedule

_No fixture coverage for this entity type yet — add one to `frontend/public/demo-data/users/{alex,morgan}/cell_culture_schedules/` to surface a real example here._

### PurchaseItem

Source: `frontend/public/demo-data/users/alex/purchase_items/1.json`

```json
{
  "id": 1,
  "task_id": 7,
  "item_name": "DemoStrain ΔADE2 (fake yeast collection)",
  "quantity": 1,
  "link": "https://example.org/demo-strain-catalog",
  "cas": null,
  "price_per_unit": 220,
  "shipping_fees": 25,
  "total_price": 245,
  "notes": "Demo strain — replaces nothing real.",
  "funding_string": "DEMO-DOE-EERE",
  "vendor": null,
  "category": null
}
```

### Note

Source: `frontend/public/demo-data/users/alex/notes/1.json`

```json
{
  "id": 1,
  "title": "Run 2026-05-08: pYES-GAL1::flbA transformation",
  "description": "Demo experiment note. Transformed FakeYeast-001 with pYES-GAL1::flbA using the LiAc protocol. Heat shock ran short (38 min, see deviation_log). Plated on SD-Ura. 40 colonies after 48 h — eight patched for downstream work.",
  "is_running_log": false,
  "is_shared": false,
  "entries": [],
  "comments": [],
  "created_at": "2026-05-08T14:00:00Z",
  "updated_at": "2026-05-11T09:00:00Z",
  "username": "alex"
}
```

### HighLevelGoal

Source: `frontend/public/demo-data/users/alex/goals/1.json`

```json
{
  "id": 1,
  "project_id": 1,
  "name": "DEMO: Publish FakeYeast biofuel paper",
  "start_date": "2026-04-01",
  "end_date": "2026-08-31",
  "color": "#3b82f6",
  "smart_goals": [
    {
      "id": "sg1",
      "text": "Verify pYES-GAL1::flbA integration",
      "is_complete": true
    },
    {
      "id": "sg2",
      "text": "Demonstrate biofuel yield improvement",
      "is_complete": false
    },
    {
      "id": "sg3",
      "text": "Draft methods + results",
      "is_complete": false
    }
  ],
  "is_complete": false,
  "created_at": "2026-04-01T00:00:00Z"
}
```

### Dependency

Source: `frontend/public/demo-data/users/alex/dependencies/1.json`

```json
{
  "id": 1,
  "parent_id": 1,
  "child_id": 2,
  "dep_type": "FS"
}
```

### Event

Source: `frontend/public/demo-data/users/alex/events/1.json`

```json
{
  "id": 1,
  "title": "Demo lab meeting — strain design review",
  "event_type": "meeting",
  "start_date": "2026-05-18",
  "end_date": "2026-05-18",
  "start_time": "11:00",
  "end_time": "12:00",
  "location": "Bio 4203 (demo)",
  "url": null,
  "notes": "Bring transformation gel images.",
  "color": "#3b82f6"
}
```

### CalendarFeed

_No fixture coverage for this entity type yet — add one to `frontend/public/demo-data/users/{alex,morgan}/<sidecar>/` to surface a real example here._

### LabLink

Source: `frontend/public/demo-data/users/alex/lab_links/1.json`

```json
{
  "id": 1,
  "title": "Benchling (demo workspace)",
  "url": "https://example.org/demo-benchling",
  "description": "Cloning notebook for the demo lab.",
  "category": "Bioinformatics tools",
  "color": "#3b82f6",
  "preview_image_url": null,
  "sort_order": 0,
  "created_at": "2026-02-01T00:00:00Z"
}
```

## §6 Feature catalog

> _Section pending — chip 2 will fill this in._

## §7 Common workflows

> _Section pending — chip 2 will fill this in._

## §8 Behavior & response style

> _Section pending — chip 2 will fill this in._

## §9 Drafting helpers

> _Section pending — chip 2 will fill this in._

## §10 Wiki navigation

Flat index of every wiki page (extracted from `WIKI_NAV` in `frontend/src/lib/wiki/nav.ts`). When a user asks "is there a doc for X?", consult this table first.

| Page | Path |
| --- | --- |
| Quickstart | `/wiki` |
| Getting Started | `/wiki/getting-started` |
| Browser Requirements | `/wiki/getting-started/browser-requirements` |
| Connecting Your Folder | `/wiki/getting-started/connecting-your-folder` |
| Creating a User | `/wiki/getting-started/creating-a-user` |
| Demo Mode | `/wiki/getting-started/demo-mode` |
| Shared Lab Accounts | `/wiki/shared-lab-accounts` |
| OneDrive | `/wiki/shared-lab-accounts/onedrive` |
| Google Drive | `/wiki/shared-lab-accounts/google-drive` |
| Dropbox | `/wiki/shared-lab-accounts/dropbox` |
| iCloud Drive | `/wiki/shared-lab-accounts/icloud` |
| Features | `/wiki/features` |
| Home & Projects | `/wiki/features/home` |
| Gantt Chart | `/wiki/features/gantt` |
| Experiments & Notes | `/wiki/features/experiments` |
| The Markdown Editor | `/wiki/features/markdown-editor` |
| Methods Library | `/wiki/features/methods` |
| PCR Protocols | `/wiki/features/pcr` |
| Purchases & Funding | `/wiki/features/purchases` |
| Calendar | `/wiki/features/calendar` |
| Lab Mode | `/wiki/features/lab-mode` |
| Activity | `/wiki/features/lab-mode/activity` |
| Combined GANTT | `/wiki/features/lab-mode/gantt` |
| Lab-wide purchases | `/wiki/features/lab-mode/purchases` |
| Cross-user lists | `/wiki/features/lab-mode/cross-user-lists` |
| The user filter | `/wiki/features/lab-mode/user-filter` |
| Search | `/wiki/features/search` |
| Lab Links | `/wiki/features/links` |
| Results (moved) | `/wiki/features/results` |
| Settings | `/wiki/features/settings` |
| Notifications & Inbox | `/wiki/features/notifications` |
| Integrations | `/wiki/integrations` |
| Telegram Bot | `/wiki/integrations/telegram` |
| Calendar Feeds | `/wiki/integrations/calendar-feeds` |
| LabArchives | `/wiki/integrations/labarchives` |

## §11 Build metadata

- **Variant:** `full`
- **Helper version:** `2`
- **Schema hash:** `a65063cfaed24daac531c92092effe4a3bb9a78d08ceaeb4f56c86d1baa4f41e`
- **Built at:** `2026-05-15T20:01:24.162Z`
- **Built from commit:** `97ffdb30153db5d0cfea41b99ce66cc55ca0483b`

_Generated by `scripts/build-ai-helper.mjs`. Do not edit by hand — run `npm run --prefix frontend ai-helper:refresh` to rebuild and commit._

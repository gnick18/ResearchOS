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

export type Notification = SharedItemNotification | EventReminderNotification;

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
  method_id: number | null;  // Deprecated: first method in method_ids for backwards compat
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
  method_id?: number | null;  // Deprecated
  method_ids?: number[];  // List of method IDs to attach
  tags?: string[];
  sort_order?: number;
  experiment_color?: string | null;
  sub_tasks?: SubTask[];
  method_attachments?: TaskMethodAttachment[];
}

export interface TaskUpdate {
  project_id?: number;
  name?: string;
  start_date?: string;
  duration_days?: number;
  is_high_level?: boolean;
  is_complete?: boolean;
  task_type?: "experiment" | "purchase" | "list";
  weekend_override?: boolean | null;
  method_id?: number | null;  // Deprecated
  method_ids?: number[];  // List of method IDs to attach
  deviation_log?: string | null;
  tags?: string[];
  sort_order?: number;
  experiment_color?: string | null;
  sub_tasks?: SubTask[];
  method_attachments?: TaskMethodAttachment[];
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

export interface MethodAttachment {
  id: string;
  name: string;
  attachment_type: "markdown" | "pdf" | "pcr";
  path: string;
  order: number;
}

export interface Method {
  id: number;
  name: string;
  github_path: string | null;
  method_type: "markdown" | "pdf" | "pcr" | null;
  folder_path: string | null;
  parent_method_id: number | null;
  tags: string[] | null;
  attachments: MethodAttachment[];
  is_public: boolean;
  created_by: string | null;
  // Sharing fields
  owner: string;
  shared_with: SharedUser[];
}

export interface MethodCreate {
  name: string;
  github_path?: string | null;
  method_type?: "markdown" | "pdf" | "pcr";
  folder_path?: string | null;
  parent_method_id?: number | null;
  tags?: string[];
  attachments?: MethodAttachment[];
  is_public?: boolean;
}

export interface MethodUpdate {
  name?: string;
  github_path?: string | null;
  method_type?: "markdown" | "pdf" | "pcr" | null;
  folder_path?: string | null;
  parent_method_id?: number | null;
  tags?: string[];
  attachments?: MethodAttachment[];
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
  new_github_path: string;
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

// ── External Calendar Feeds (Google/Outlook/iCloud via ICS, plus OAuth) ──

export type CalendarFeedProvider = "google" | "outlook" | "icloud" | "other";

/** How the feed actually pulls events.
 *
 *  - `ics`     — anonymous fetch of a public iCal URL (read-only).
 *  - `google`  — Google Calendar API via the user's OAuth tokens. Read/write.
 *  - `outlook` — Microsoft Graph API via the user's OAuth tokens. Read/write.
 *
 *  `provider` (above) is purely a display hint so iCloud + arbitrary iCal
 *  URLs can both render their own labels/icons.
 */
export type CalendarFeedKind = "ics" | "google" | "outlook";

export interface CalendarFeed {
  id: number;
  /** Display category — drives the icon and provider-specific help copy. */
  provider: CalendarFeedProvider;
  /** Transport. Defaults to "ics" when missing (back-compat with files
   *  written before OAuth landed). */
  kind: CalendarFeedKind;
  label: string;
  /** Set when `kind === "ics"`. */
  icsUrl: string | null;
  /** For OAuth feeds, the provider-side calendar identifier (e.g. Google's
   *  `primary` or a Microsoft Graph calendar id). Lets a single OAuth
   *  account back several feeds (one per source calendar). */
  oauthCalendarId: string | null;
  color: string;
  enabled: boolean;
  lastSyncAt: string | null;
}

export interface ExternalEvent {
  /** Stable string id derived from feedId + provider event id. */
  id: string;
  feedId: number;
  /** Mirrors the parent feed's kind so consumers can decide whether the
   *  event is writable without doing a second lookup. */
  feedKind: CalendarFeedKind;
  /** Provider-side identifier — Google/Outlook event id, or ICS UID. Used
   *  later for PATCH / DELETE calls against the source calendar. */
  providerEventId: string;
  title: string;
  start_date: string;
  end_date: string | null;
  /** Local time in HH:MM 24-hour form (preserved from DTSTART / Graph
   *  `start` when the event isn't all-day). `null` means an all-day event. */
  start_time: string | null;
  /** Local time in HH:MM 24-hour form (from DTEND / Graph `end`). `null`
   *  means no end time was specified. */
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

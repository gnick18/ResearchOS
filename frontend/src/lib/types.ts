// ── API Types (mirrors backend Pydantic schemas) ────────────────────────────

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

export interface SharedItemsResponse {
  projects: SharedItemEntry[];
  tasks: SharedItemEntry[];
  methods: SharedItemEntry[];
}

export interface Notification {
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

export interface NotificationResponse {
  notifications: Notification[];
  unread_count: number;
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
  // PCR method copy fields - stored as JSON strings (deprecated, use method_attachments)
  pcr_gradient: string | null;  // JSON string of PCRGradient
  pcr_ingredients: string | null;  // JSON string of PCRIngredient[]
  // New: method attachments with individual PCR data
  method_attachments: TaskMethodAttachment[];
  // Sharing fields
  owner: string;
  shared_with: SharedUser[];
  inherited_from_project?: number | null;
  is_shared_with_me?: boolean;  // True if this task is shared WITH the current user (not owned by them)
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
  pcr_gradient?: string | null;
  pcr_ingredients?: string | null;
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
  pcr_gradient?: string | null;
  pcr_ingredients?: string | null;
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

// ── GitHub ────────────────────────────────────────────────────────────────────

export interface GitHubFile {
  path: string;
  content: string;
  sha: string;
  html_url: string;
}

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
  location?: string | null;
  url?: string | null;
  notes?: string | null;
  color?: string | null;
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

export interface AttachmentUploadRequest {
  experiment_id: number;
  experiment_name: string;
  project_id?: number | null;
  project_name?: string | null;
  experiment_date: string;  // ISO date string YYYY-MM-DD
  attachment_type?: "notes" | "results";  // Only for files
  base64_content: string;
  original_filename: string;
}

export interface AttachmentUploadResponse {
  id: number;
  filename: string;
  original_filename: string;
  path: string;
  folder: string;
  file_size: number;
  file_type: string;
  warning: string | null;
  added_to_gitignore: boolean;
}

export interface AttachmentStats {
  images: {
    count: number;
    total_size: number;
    total_size_formatted: string;
  };
  files: {
    count: number;
    total_size: number;
    total_size_formatted: string;
  };
  total: {
    count: number;
    total_size: number;
    total_size_formatted: string;
  };
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

export interface Note {
  id: number;
  title: string;
  description: string;
  is_running_log: boolean;
  is_shared: boolean;
  entries: NoteEntry[];
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
  created_at: string;
  updated_at: string;
  username: string;
  user_color: string;
}

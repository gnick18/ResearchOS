import axios from "axios";
import type {
  AttachmentUploadRequest,
  AttachmentUploadResponse,
  AttachmentStats,
  CatalogItem,
  DeviationSaveRequest,
  Dependency,
  DependencyCreate,
  Event,
  EventCreate,
  EventUpdate,
  FileMetadata,
  FundingAccount,
  FundingAccountCreate,
  FundingAccountUpdate,
  FundingSummary,
  GitHubFile,
  GitHubTreeItem,
  HighLevelGoal,
  HighLevelGoalCreate,
  HighLevelGoalUpdate,
  ImageMetadata,
  LabLink,
  LabLinkCreate,
  LabLinkUpdate,
  LabNote,
  LinkPreview,
  SmartGoal,
  Method,
  MethodCreate,
  MethodUpdate,
  MethodForkRequest,
  Note,
  NoteCreate,
  NoteUpdate,
  NoteEntryCreate,
  NoteEntryUpdate,
  NoteEntriesReorderRequest,
  PCRProtocol,
  PCRProtocolCreate,
  PCRProtocolUpdate,
  PCRStep,
  PCRIngredient,
  Project,
  ProjectCreate,
  ProjectUpdate,
  PurchaseItem,
  PurchaseItemCreate,
  PurchaseItemUpdate,
  ShiftResult,
  Task,
  TaskCreate,
  TaskMoveRequest,
  TaskUpdate,
  // Sharing types
  SharedUser,
  ShareRequest,
  SharedItemsResponse,
  Notification,
  NotificationResponse,
  DependencyChainResponse,
} from "./types";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api",
  headers: {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
  },
});

// ── Types ────────────────────────────────────────────────────────────────────

export interface DataPathCheckResponse {
  status: "ok" | "error";
  error_type?: "not_configured" | "path_not_found" | "not_git_repo" | "permission_denied";
  message: string;
  configured_path?: string;
  storage_mode?: string;
}

// ── Folder Setup Types ────────────────────────────────────────────────────────

export interface FolderSetupRequest {
  mode: "github" | "local";
  local_path: string;
  github_token?: string;
  github_repo?: string;
  create_if_missing: boolean;
}

export interface FolderSetupResponse {
  status: string;
  message: string;
  path: string;
  mode: string;
  created_folders: boolean;
}

export interface StorageModeResponse {
  mode: string;
  path: string;
  is_configured: boolean;
}

// ── Shared Query Functions ────────────────────────────────────────────────────
// Centralized query functions that don't close over component state,
// preventing stale closure issues when React Query refetches.

export const fetchAllTasks = async () => {
  const projects = await api.get<Project[]>("/projects").then((r) => r.data);
  if (projects.length === 0) return [];
  const results = await Promise.all(
    projects.map((p) => api.get<Task[]>(`/tasks/by-project/${p.id}`).then((r) => r.data))
  );
  return results.flat();
};

export const fetchAllTasksIncludingShared = async () => {
  const tasks = await api.get<Task[]>("/tasks/including-shared").then((r) => r.data);
  return tasks;
};

// ── Error Handling ────────────────────────────────────────────────────────────

// Global callback for data path errors - set by the app
let onDataPathError: ((error: DataPathCheckResponse) => void) | null = null;

export function setDataPathErrorCallback(callback: (error: DataPathCheckResponse) => void) {
  onDataPathError = callback;
}

// Response interceptor to catch data path errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Check if this is a data path related error
    if (error.response?.status === 500 || error.response?.status === 400) {
      const detail = error.response?.data?.detail || "";
      const errorType = error.response?.data?.error_type;
      
      // Check for path-related error messages
      const pathErrorPatterns = [
        "Local path does not exist",
        "path not found",
        "No such file or directory",
        "Permission denied",
        "not a git repository",
      ];
      
      const isPathError = pathErrorPatterns.some(pattern => 
        detail.toLowerCase().includes(pattern.toLowerCase())
      );
      
      if (isPathError || errorType) {
        const pathError: DataPathCheckResponse = {
          status: "error",
          error_type: errorType || "path_not_found",
          message: detail,
          configured_path: error.response?.data?.configured_path,
        };
        
        if (onDataPathError) {
          onDataPathError(pathError);
        }
      }
    }
    return Promise.reject(error);
  }
);

// ── Projects ─────────────────────────────────────────────────────────────────

export const projectsApi = {
  list: () => api.get<Project[]>("/projects").then((r) => r.data),
  listWithShared: () => api.get<Project[]>("/projects/including-shared").then((r) => r.data),
  get: (id: number) => api.get<Project>(`/projects/${id}`).then((r) => r.data),
  create: (data: ProjectCreate) =>
    api.post<Project>("/projects", data).then((r) => r.data),
  update: (id: number, data: Partial<ProjectUpdate>) =>
    api.put<Project>(`/projects/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/projects/${id}`),
  reorder: (projectIds: number[]) =>
    api.post("/projects/reorder", { project_ids: projectIds }).then((r) => r.data),
  archive: (id: number, isArchived: boolean) =>
    api.post<Project>(`/projects/${id}/archive`, { is_archived: isArchived }).then((r) => r.data),
};

// ── Tasks ────────────────────────────────────────────────────────────────────

export interface DuplicateCheckResult {
  has_duplicate: boolean;
  matching_tasks: Array<{
    id: number;
    name: string;
    task_type: string;
    start_date: string;
    is_complete: boolean;
  }>;
}

export const tasksApi = {
  listByProject: (projectId: number) =>
    api.get<Task[]>(`/tasks/by-project/${projectId}`).then((r) => r.data),
  get: (id: number) => api.get<Task>(`/tasks/${id}`).then((r) => r.data),
  create: (data: TaskCreate) =>
    api.post<Task>("/tasks", data).then((r) => r.data),
  update: (id: number, data: TaskUpdate) =>
    api.put<Task>(`/tasks/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/tasks/${id}`),
  listByMethod: (methodId: number) =>
    api.get<Task[]>(`/tasks/by-method/${methodId}`).then((r) => r.data),
  move: (id: number, data: TaskMoveRequest) =>
    api.post<ShiftResult>(`/tasks/${id}/move`, data).then((r) => r.data),
  replicate: (id: number, count: number, offsetDays: number) =>
    api
      .post<Task[]>(`/tasks/${id}/replicate`, {
        count,
        offset_days: offsetDays,
      })
      .then((r) => r.data),
  resetPcr: (id: number, methodId?: number) =>
    api.post<Task>(`/tasks/${id}/reset-pcr`, null, {
      params: methodId ? { method_id: methodId } : {},
    }).then((r) => r.data),
  // Multi-method endpoints
  addMethod: (taskId: number, methodId: number) =>
    api.post<Task>(`/tasks/${taskId}/methods/${methodId}`).then((r) => r.data),
  removeMethod: (taskId: number, methodId: number) =>
    api.delete<Task>(`/tasks/${taskId}/methods/${methodId}`).then((r) => r.data),
  updateMethodPcr: (taskId: number, methodId: number, data: { pcr_gradient?: string; pcr_ingredients?: string }) =>
    api.put<Task>(`/tasks/${taskId}/methods/${methodId}/pcr`, data).then((r) => r.data),
  // Variation notes
  saveVariationNote: (taskId: number, methodId: number, variationNotes: string) =>
    api.put<Task>(`/tasks/${taskId}/methods/${methodId}/notes`, { variation_notes: variationNotes }).then((r) => r.data),
  // Duplicate check
  checkDuplicate: (projectId: number, name: string, taskType: string, excludeTaskId?: number) =>
    api.get<DuplicateCheckResult>("/tasks/check-duplicate", {
      params: {
        project_id: projectId,
        name,
        task_type: taskType,
        exclude_task_id: excludeTaskId,
      },
    }).then((r) => r.data),
  // Task type conversion
  convertType: (id: number, newTaskType: "experiment" | "purchase" | "list") =>
    api.post<Task>(`/tasks/${id}/convert`, null, {
      params: { new_task_type: newTaskType },
    }).then((r) => r.data),
};

// ── Dependencies ─────────────────────────────────────────────────────────────

// ── Methods ──────────────────────────────────────────────────────────────────

// Type for method experiments response
export interface MethodExperiment {
  id: number;
  name: string;
  project_id: number;
  start_date: string;
  duration_days: number;
  end_date: string;
  is_complete: boolean;
  task_type: string;
  experiment_color: string | null;
  variation_notes: string | null;
}

export const methodsApi = {
  list: () => api.get<Method[]>("/methods").then((r) => r.data),
  get: (id: number) => api.get<Method>(`/methods/${id}`).then((r) => r.data),
  create: (data: MethodCreate) =>
    api.post<Method>("/methods", data).then((r) => r.data),
  update: (id: number, data: MethodUpdate) =>
    api.put<Method>(`/methods/${id}`, data).then((r) => r.data),
  getChildren: (id: number) =>
    api.get<Method[]>(`/methods/${id}/children`).then((r) => r.data),
  getExperiments: (id: number) =>
    api.get<MethodExperiment[]>(`/methods/${id}/experiments`).then((r) => r.data),
  fork: (id: number, data: MethodForkRequest) =>
    api.post<Method>(`/methods/${id}/fork`, data).then((r) => r.data),
  saveDeviation: (data: DeviationSaveRequest) =>
    api.post("/methods/save-deviation", data).then((r) => r.data),
  delete: (id: number) => api.delete(`/methods/${id}`),
};

// ── GitHub ────────────────────────────────────────────────────────────────────

export interface ImageUploadResponse {
  path: string;
  sha: string;
  download_url: string;
  file_size: number;
  warning?: string;
  added_to_gitignore: boolean;
}

export const githubApi = {
  readFile: (path: string) =>
    api.get<GitHubFile>("/github/file", { params: { path } }).then((r) => r.data),
  writeFile: (path: string, content: string, message?: string) =>
    api
      .put("/github/file", { path, content, message: message || `Update ${path}` })
      .then((r) => r.data),
  uploadImage: (path: string, base64Content: string, message?: string) =>
    api
      .put<ImageUploadResponse>("/github/image", {
        path,
        base64_content: base64Content,
        message: message || `Upload ${path}`,
      })
      .then((r) => r.data),
  listDirectory: (path?: string) =>
    api
      .get<GitHubTreeItem[]>("/github/tree", { params: { path: path || "" } })
      .then((r) => r.data),
  deleteDirectory: (path: string) =>
    api.delete("/github/directory", { params: { path } }).then((r) => r.data),
  getRawUrl: (path: string) =>
    `${api.defaults.baseURL}/github/raw?path=${encodeURIComponent(path)}`,
};

// ── Dependencies ─────────────────────────────────────────────────────────────

export const dependenciesApi = {
  list: (projectId?: number) =>
    api
      .get<Dependency[]>("/dependencies", {
        params: projectId ? { project_id: projectId } : {},
      })
      .then((r) => r.data),
  create: (data: DependencyCreate) =>
    api.post<Dependency>("/dependencies", data).then((r) => r.data),
  delete: (id: number) => api.delete(`/dependencies/${id}`),
};

// ── Purchases ────────────────────────────────────────────────────────────────

export const purchasesApi = {
  listByTask: (taskId: number) =>
    api.get<PurchaseItem[]>(`/purchases/by-task/${taskId}`).then((r) => r.data),
  listAll: () =>
    api.get<PurchaseItem[]>("/purchases/all").then((r) => r.data),
  create: (data: PurchaseItemCreate) =>
    api.post<PurchaseItem>("/purchases", data).then((r) => r.data),
  update: (id: number, data: PurchaseItemUpdate) =>
    api.put<PurchaseItem>(`/purchases/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/purchases/${id}`),
  searchCatalog: (q: string) =>
    api
      .get<CatalogItem[]>("/purchases/catalog/search", { params: { q } })
      .then((r) => r.data),
  updateCatalogItem: (id: number, data: Partial<CatalogItem>) =>
    api.put<CatalogItem>(`/purchases/catalog/${id}`, data).then((r) => r.data),
  createCatalogItem: (data: Partial<CatalogItem>) =>
    api.post<CatalogItem>("/purchases/catalog", data).then((r) => r.data),
  // Funding Accounts
  listFundingAccounts: () =>
    api.get<FundingAccount[]>("/purchases/funding-accounts").then((r) => r.data),
  createFundingAccount: (data: FundingAccountCreate) =>
    api.post<FundingAccount>("/purchases/funding-accounts", data).then((r) => r.data),
  updateFundingAccount: (id: number, data: FundingAccountUpdate) =>
    api.put<FundingAccount>(`/purchases/funding-accounts/${id}`, data).then((r) => r.data),
  deleteFundingAccount: (id: number) =>
    api.delete(`/purchases/funding-accounts/${id}`),
  getFundingSummary: () =>
    api.get<FundingSummary>("/purchases/funding-summary").then((r) => r.data),
};

// ── Events (Calendar) ────────────────────────────────────────────────────────

export const eventsApi = {
  list: () => api.get<Event[]>("/events").then((r) => r.data),
  get: (id: number) => api.get<Event>(`/events/${id}`).then((r) => r.data),
  create: (data: EventCreate) =>
    api.post<Event>("/events", data).then((r) => r.data),
  update: (id: number, data: EventUpdate) =>
    api.put<Event>(`/events/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/events/${id}`),
};

// ── PCR Protocols ──────────────────────────────────────────────────────────────

export const pcrApi = {
  list: () => api.get<PCRProtocol[]>("/pcr").then((r) => r.data),
  get: (id: number) => api.get<PCRProtocol>(`/pcr/${id}`).then((r) => r.data),
  create: (data: PCRProtocolCreate) =>
    api.post<PCRProtocol>("/pcr", data).then((r) => r.data),
  update: (id: number, data: PCRProtocolUpdate) =>
    api.put<PCRProtocol>(`/pcr/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/pcr/${id}`),
  getDefaultGradient: () =>
    api.get<PCRStep[]>("/pcr/defaults/gradient").then((r) => r.data),
  getDefaultIngredients: () =>
    api.get<PCRIngredient[]>("/pcr/defaults/ingredients").then((r) => r.data),
};

// ── High-Level Goals ──────────────────────────────────────────────────────────

export const goalsApi = {
  list: () => api.get<HighLevelGoal[]>("/goals").then((r) => r.data),
  get: (id: number) => api.get<HighLevelGoal>(`/goals/${id}`).then((r) => r.data),
  create: (data: HighLevelGoalCreate) =>
    api.post<HighLevelGoal>("/goals", data).then((r) => r.data),
  update: (id: number, data: HighLevelGoalUpdate) =>
    api.patch<HighLevelGoal>(`/goals/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/goals/${id}`),
  addSmartGoal: (id: number, smartGoal: SmartGoal) =>
    api.post<HighLevelGoal>(`/goals/${id}/smart-goals`, smartGoal).then((r) => r.data),
  toggleSmartGoal: (id: number, smartGoalId: string, isComplete: boolean) =>
    api.patch<HighLevelGoal>(`/goals/${id}/smart-goals/${smartGoalId}`, null, {
      params: { is_complete: isComplete },
    }).then((r) => r.data),
  deleteSmartGoal: (id: number, smartGoalId: string) =>
    api.delete<HighLevelGoal>(`/goals/${id}/smart-goals/${smartGoalId}`).then((r) => r.data),
};

// -- Settings (Environment Configuration) --

export interface SettingsResponse {
  github_token_masked: string;
  github_repo: string;
  github_localpath: string;
  current_user: string;
  main_user: string;
  storage_mode: string;
  is_configured: boolean;
}

export interface SettingsUpdate {
  github_token?: string;
  github_repo?: string;
  github_localpath?: string;
  current_user?: string;
  main_user?: string;
  storage_mode?: string;
}

export interface SettingsVerifyResponse {
  status: "ok" | "error";
  message?: string;
  issues?: string[];
}

export const settingsApi = {
  get: () => api.get<SettingsResponse>("/settings").then((r) => r.data),
  update: (data: SettingsUpdate) =>
    api.put<SettingsResponse>("/settings", data).then((r) => r.data),
  verify: () =>
    api.post<SettingsVerifyResponse>("/settings/verify").then((r) => r.data),
  checkDataPath: () =>
    api.get<DataPathCheckResponse>("/settings/check-path").then((r) => r.data),
  reload: () =>
    api.post<{ status: string; message: string; github_localpath: string }>("/settings/reload").then((r) => r.data),
  getStorageMode: () =>
    api.get<StorageModeResponse>("/settings/storage-mode").then((r) => r.data),
  setupFolder: (data: FolderSetupRequest) =>
    api.post<FolderSetupResponse>("/settings/setup-folder", data).then((r) => r.data),
};

// ── Migration Types & API ────────────────────────────────────────────────────────

export interface MigrationRequest {
  destination_path: string;
  migration_type: "copy" | "move";
  target_mode: "github" | "local";
  remove_git_folder: boolean;
  new_github_repo?: string;
  new_github_token?: string;
}

export interface MigrationPreview {
  source_path: string;
  destination_path: string;
  total_size_bytes: number;
  file_count: number;
  folder_count: number;
  has_git_folder: boolean;
  users_found: string[];
  warnings: string[];
  can_proceed: boolean;
}

export interface MigrationProgress {
  status: "idle" | "in_progress" | "complete" | "error";
  bytes_copied: number;
  total_bytes: number;
  files_copied: number;
  total_files: number;
  current_file: string;
  error_message: string;
  progress_percent: number;
}

export interface MigrationResponse {
  status: string;
  message: string;
  source_path: string;
  destination_path: string;
  bytes_copied: number;
  files_copied: number;
  new_storage_mode: string;
}

export const migrationApi = {
  preview: (request: MigrationRequest) =>
    api.post<MigrationPreview>("/settings/migrate/preview", request).then((r) => r.data),
  execute: (request: MigrationRequest) =>
    api.post<MigrationResponse>("/settings/migrate", request).then((r) => r.data),
  getProgress: () =>
    api.get<MigrationProgress>("/settings/migrate/progress").then((r) => r.data),
  cancel: () =>
    api.post<{ status: string; message: string }>("/settings/migrate/cancel").then((r) => r.data),
};

// ── Lab Links ────────────────────────────────────────────────────────────────

export const labLinksApi = {
  list: () => api.get<LabLink[]>("/lab-links").then((r) => r.data),
  get: (id: number) => api.get<LabLink>(`/lab-links/${id}`).then((r) => r.data),
  create: (data: LabLinkCreate) =>
    api.post<LabLink>("/lab-links", data).then((r) => r.data),
  update: (id: number, data: LabLinkUpdate) =>
    api.put<LabLink>(`/lab-links/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/lab-links/${id}`),
  getPreview: (url: string) =>
    api.get<LinkPreview>("/lab-links/preview", { params: { url } }).then((r) => r.data),
};

// ── Users ────────────────────────────────────────────────────────────────────

export interface UserListResponse {
  users: string[];
  current_user: string;
}

export interface LoginResponse {
  status: string;
  current_user: string;
}

export interface CreateUserResponse {
  status: string;
  current_user: string;
  created: boolean;
}

export interface ValidateUserResponse {
  valid: boolean;
  current_user: string;
}

export interface RenameUserResponse {
  status: string;
  old_username: string;
  new_username: string;
}

export interface LogoutResponse {
  status: string;
  message: string;
}

export interface MainUserResponse {
  main_user: string;
  current_user: string;
}

export interface SetMainUserResponse {
  status: string;
  main_user: string;
}

export const usersApi = {
  list: () => api.get<UserListResponse>("/users").then((r) => r.data),
  login: (username: string) =>
    api.post<LoginResponse>("/users/login", { username }).then((r) => r.data),
  create: (username: string) =>
    api.post<CreateUserResponse>("/users/create", { username }).then((r) => r.data),
  validate: () => api.get<ValidateUserResponse>("/users/validate").then((r) => r.data),
  rename: (oldUsername: string, newUsername: string) =>
    api.put<RenameUserResponse>("/users/rename", {
      old_username: oldUsername,
      new_username: newUsername,
    }).then((r) => r.data),
  logout: () => api.post<LogoutResponse>("/users/logout").then((r) => r.data),
  getMainUser: () => api.get<MainUserResponse>("/users/main").then((r) => r.data),
  setMainUser: (username: string) =>
    api.put<SetMainUserResponse>("/users/main", { username }).then((r) => r.data),
};

// ── Lab Mode ──────────────────────────────────────────────────────────────────

export interface LabUser {
  username: string;
  color: string;
  created_at: string | null;
}

export interface LabUsersResponse {
  users: LabUser[];
}

export interface LabTask {
  id: number;
  name: string;
  project_id: number;
  start_date: string;
  duration_days: number;
  end_date: string;
  is_complete: boolean;
  task_type: string;
  username: string;
  user_color: string;
  experiment_color: string | null;
  method_ids: number[];
  notes: string | null;
}

export interface LabProject {
  id: number;
  name: string;
  color: string;
  username: string;
  user_color: string;
  is_archived: boolean;
}

export interface LabMethod {
  id: number;
  name: string;
  username: string;
  user_color: string;
  is_public: boolean;
}

export interface LabSearchResult {
  type: string;
  id: number;
  name: string;
  username: string;
  user_color: string;
  match_field: string;
  match_preview: string;
}

export interface LabSearchResponse {
  results: LabSearchResult[];
  total_count: number;
}

export interface LabSearchParams {
  q?: string;
  usernames?: string;
  task_types?: string;
  date_from?: string;
  date_to?: string;
  project_id?: number;
  method_id?: number;
  method_folder?: string;
  completion_status?: "all" | "complete" | "incomplete";
}

export const labApi = {
  getUsers: () => api.get<LabUsersResponse>("/lab/users").then((r) => r.data),
  getTasks: (params?: { exclude_goals?: boolean; exclude_lists?: boolean; usernames?: string }) =>
    api.get<LabTask[]>("/lab/tasks", { params }).then((r) => r.data),
  getProjects: (params?: { usernames?: string }) =>
    api.get<LabProject[]>("/lab/projects", { params }).then((r) => r.data),
  getMethods: () => api.get<LabMethod[]>("/lab/methods").then((r) => r.data),
  getMethodFolders: () => api.get<string[]>("/lab/method-folders").then((r) => r.data),
  getExperiments: (params?: { usernames?: string }) =>
    api.get<LabTask[]>("/lab/experiments", { params }).then((r) => r.data),
  getPurchases: (params?: { usernames?: string }) =>
    api.get<LabTask[]>("/lab/purchases", { params }).then((r) => r.data),
  search: (params: LabSearchParams) =>
    api.get<LabSearchResponse>("/lab/search", { params }).then((r) => r.data),
  getUserTasks: (username: string, params?: { exclude_goals?: boolean }) =>
    api.get<LabTask[]>(`/lab/user/${username}/tasks`, { params }).then((r) => r.data),
  getUserProjects: (username: string) =>
    api.get<LabProject[]>(`/lab/user/${username}/projects`).then((r) => r.data),
  getUserPurchaseItems: (username: string, taskId: number) =>
    api.get<PurchaseItem[]>(`/lab/user/${username}/purchases/${taskId}`).then((r) => r.data),
  // Notes
  getNotes: (params?: { usernames?: string; shared_only?: boolean }) =>
    api.get<LabNote[]>("/lab/notes", { params }).then((r) => r.data),
  getSharedNotes: (params?: { usernames?: string }) =>
    api.get<LabNote[]>("/lab/notes/shared", { params }).then((r) => r.data),
  getUserNotes: (username: string) =>
    api.get<LabNote[]>(`/lab/user/${username}/notes`).then((r) => r.data),
};

// ── Attachments ───────────────────────────────────────────────────────────────

export const attachmentsApi = {
  // Image endpoints
  uploadImage: (data: AttachmentUploadRequest) =>
    api.post<AttachmentUploadResponse>("/attachments/images", data).then((r) => r.data),
  listImages: (params?: { experiment_id?: number; folder?: string }) =>
    api.get<ImageMetadata[]>("/attachments/images", { params }).then((r) => r.data),
  getImage: (id: number) =>
    api.get<ImageMetadata>(`/attachments/images/${id}`).then((r) => r.data),
  deleteImage: (id: number) =>
    api.delete(`/attachments/images/${id}`).then((r) => r.data),
  
  // File endpoints
  uploadFile: (data: AttachmentUploadRequest) =>
    api.post<AttachmentUploadResponse>("/attachments/files", data).then((r) => r.data),
  listFiles: (params?: { experiment_id?: number; folder?: string; attachment_type?: string }) =>
    api.get<FileMetadata[]>("/attachments/files", { params }).then((r) => r.data),
  getFile: (id: number) =>
    api.get<FileMetadata>(`/attachments/files/${id}`).then((r) => r.data),
  deleteFile: (id: number) =>
    api.delete(`/attachments/files/${id}`).then((r) => r.data),
  
  // Utility endpoints
  getFolderName: (experimentName: string, experimentDate: string) =>
    api.get<{ folder_name: string }>("/attachments/folder-name", {
      params: { experiment_name: experimentName, experiment_date: experimentDate },
    }).then((r) => r.data),
  getStats: () =>
    api.get<AttachmentStats>("/attachments/stats").then((r) => r.data),
  // Search for image by filename (for fixing broken image links)
  searchImageByFilename: (filename: string) =>
    api.get<{ search_term: string; matches: Array<{ path: string; filename: string; match_type: string }>; count: number }>("/attachments/search-by-filename", {
      params: { filename },
    }).then((r) => r.data),
};

// ── Notes ──────────────────────────────────────────────────────────────────────

export const notesApi = {
  list: () => api.get<Note[]>("/notes").then((r) => r.data),
  get: (id: number) => api.get<Note>(`/notes/${id}`).then((r) => r.data),
  create: (data: NoteCreate) =>
    api.post<Note>("/notes", data).then((r) => r.data),
  update: (id: number, data: NoteUpdate) =>
    api.put<Note>(`/notes/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/notes/${id}`),
  // Entry management
  addEntry: (noteId: number, data: NoteEntryCreate) =>
    api.post<Note>(`/notes/${noteId}/entries`, data).then((r) => r.data),
  updateEntry: (noteId: number, entryId: string, data: NoteEntryUpdate) =>
    api.put<Note>(`/notes/${noteId}/entries/${entryId}`, data).then((r) => r.data),
  deleteEntry: (noteId: number, entryId: string) =>
    api.delete<Note>(`/notes/${noteId}/entries/${entryId}`).then((r) => r.data),
  reorderEntries: (noteId: number, entryIds: string[]) =>
    api.put<Note>(`/notes/${noteId}/entries/reorder`, { entry_ids: entryIds }).then((r) => r.data),
};

// ── Sharing ────────────────────────────────────────────────────────────────────

export interface ShareResponse {
  status: string;
  item_id: number;
  item_type?: string;
  shared_with: string;
  permission: string;
  chain_shared_count?: number;
  tasks_shared_count?: number;
}

export const sharingApi = {
  // Task sharing
  shareTask: (taskId: number, data: ShareRequest) =>
    api.post<ShareResponse>(`/sharing/tasks/${taskId}`, data).then((r) => r.data),
  unshareTask: (taskId: number, username: string) =>
    api.delete<ShareResponse>(`/sharing/tasks/${taskId}/users/${username}`).then((r) => r.data),
  getTaskDependencyChain: (taskId: number) =>
    api.get<DependencyChainResponse>(`/sharing/tasks/${taskId}/chain`).then((r) => r.data),
  
  // Method sharing
  shareMethod: (methodId: number, data: ShareRequest) =>
    api.post<ShareResponse>(`/sharing/methods/${methodId}`, data).then((r) => r.data),
  unshareMethod: (methodId: number, username: string) =>
    api.delete<ShareResponse>(`/sharing/methods/${methodId}/users/${username}`).then((r) => r.data),
  
  // Project sharing
  shareProject: (projectId: number, data: ShareRequest) =>
    api.post<ShareResponse>(`/sharing/projects/${projectId}`, data).then((r) => r.data),
  unshareProject: (projectId: number, username: string) =>
    api.delete<ShareResponse>(`/sharing/projects/${projectId}/users/${username}`).then((r) => r.data),
  
  // Shared items
  getSharedWithMe: () =>
    api.get<SharedItemsResponse>("/sharing/shared-with-me").then((r) => r.data),
  
  // Notifications
  getNotifications: (unreadOnly: boolean = false) =>
    api.get<NotificationResponse>("/sharing/notifications", { params: { unread_only: unreadOnly } }).then((r) => r.data),
  markNotificationRead: (notificationId: string) =>
    api.post<{ status: string; notification_id: string }>(`/sharing/notifications/${notificationId}/dismiss`).then((r) => r.data),
  markAllNotificationsRead: () =>
    api.post<{ status: string; dismissed_count: number }>("/sharing/notifications/dismiss-all").then((r) => r.data),
};
